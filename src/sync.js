const logger = require("./logger");
const config = require("./config");
const { fetchVariantRows, setInventoryLevel } = require("./shopify");
const { fetchStockBySku } = require("./odooStock");
const { getAllMappings, getMappingBySku, saveMapping } = require("./store");
const meli = require("./mercadolibre");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSku(value) {
    return String(value || "").trim().toUpperCase();
}

async function resolveActiveItemIdBySku(variantSku, normalizedSku) {
    const candidates = [variantSku, normalizedSku]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    for (const skuCandidate of candidates) {
        const activeId = await meli.searchActiveItemBySku(skuCandidate);
        if (activeId) {
            return String(activeId);
        }
    }

    return null;
}

async function resolveAnyItemIdBySku(variantSku, normalizedSku) {
    const candidates = [variantSku, normalizedSku]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    for (const skuCandidate of candidates) {
        const itemId = await meli.searchItemBySku(skuCandidate);
        if (itemId) {
            return String(itemId);
        }
    }

    return null;
}

async function forceZeroStockForSkusMissingInOdoo(stockBySku, skipItemIds = new Set()) {
    const mappingsBySku = getAllMappings();
    let reviewed = 0;
    let forcedToZero = 0;
    let failed = 0;

    for (const [sku, mapping] of Object.entries(mappingsBySku)) {
        if (!mapping || !mapping.itemId) {
            continue;
        }

        const itemId = String(mapping.itemId);
        if (skipItemIds.has(itemId)) {
            continue;
        }

        reviewed += 1;
        const normalizedSku = normalizeSku(sku);
        if (stockBySku.has(normalizedSku)) {
            continue;
        }

        try {
            await meli.setItemQuantity(itemId, 0);
            forcedToZero += 1;
        } catch (error) {
            failed += 1;
            const details = error.response && error.response.data ? error.response.data : { message: error.message };
            logger.error("Failed forcing Mercado Libre stock to zero for missing Odoo SKU", {
                sku,
                itemId,
                details
            });
        }
    }

    return {
        reviewed,
        forcedToZero,
        failed
    };
}

async function syncOnce() {
    logger.info("Starting Shopify -> Mercado Libre sync");

    const cleanupStats = await meli.cleanupNonApprovedMappedItems(getAllMappings());
    const closedItemIds = new Set((cleanupStats.closedItemIds || []).map((itemId) => String(itemId)));

    const variants = await fetchVariantRows();
    const stockBySku = await fetchStockBySku();
    const variantsToProcess = config.sync.maxProductsPerRun > 0
        ? variants.slice(0, config.sync.maxProductsPerRun)
        : variants;

    logger.info("Variants fetched from Shopify", {
        total: variants.length,
        toProcess: variantsToProcess.length
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let inventorySynced = 0;
    let inventoryMissingSku = 0;
    let inventoryMissingItem = 0;
    let stockOnlyUpdated = 0;
    const touchedItemIds = new Set();
    const seenSkus = new Set();

    for (const variant of variantsToProcess) {
        if (!variant.sku) {
            skipped += 1;
            continue;
        }

        const normalizedSku = normalizeSku(variant.sku);
        if (!normalizedSku) {
            skipped += 1;
            continue;
        }

        if (seenSkus.has(normalizedSku)) {
            skipped += 1;
            continue;
        }

        seenSkus.add(normalizedSku);

        if (!Number.isFinite(variant.price) || variant.price <= 0) {
            skipped += 1;
            logger.warn("Skipped SKU due invalid price", { sku: variant.sku, price: variant.price });
            continue;
        }

        const stockValue = stockBySku.has(normalizedSku)
            ? stockBySku.get(normalizedSku)
            : config.stock.defaultWhenMissing;

        if (!stockBySku.has(normalizedSku) && config.stock.source === "odoo") {
            inventoryMissingSku += 1;
        }

        const availableQuantity = Math.max(0, Math.floor(Number(stockValue)));
        variant.availableQuantity = availableQuantity;

        if (config.stock.source === "odoo") {
            if (!variant.inventoryItemId && variant.inventoryItemId !== 0) {
                inventoryMissingItem += 1;
                logger.warn("Skipped Shopify inventory update because inventory_item_id is missing", {
                    sku: variant.sku,
                    shopifyVariantId: variant.shopifyVariantId
                });
            } else {
                await setInventoryLevel(variant.inventoryItemId, availableQuantity);
                inventorySynced += 1;
            }
        }

        try {
            const existingMapping = getMappingBySku(variant.sku);
            let itemId = existingMapping ? String(existingMapping.itemId || "") : null;

            if (!itemId) {
                itemId = await resolveActiveItemIdBySku(variant.sku, normalizedSku);
            }

            if (itemId) {
                const itemStatus = await meli.getItemStatus(itemId);
                if (itemStatus.isActive) {
                    await meli.setItemQuantity(itemId, availableQuantity);
                    touchedItemIds.add(String(itemId));
                    stockOnlyUpdated += 1;

                    saveMapping(variant.sku, {
                        itemId: String(itemId),
                        shopifyVariantId: variant.shopifyVariantId,
                        shopifyProductId: variant.shopifyProductId
                    });

                    await sleep(config.sync.requestDelayMs);
                    continue;
                }

                itemId = await meli.resolveUpdatableItemId(itemId);
            }

            if (!itemId) {
                itemId = await resolveActiveItemIdBySku(variant.sku, normalizedSku);
                if (itemId) {
                    await meli.setItemQuantity(itemId, availableQuantity);
                    touchedItemIds.add(String(itemId));
                    stockOnlyUpdated += 1;

                    saveMapping(variant.sku, {
                        itemId: String(itemId),
                        shopifyVariantId: variant.shopifyVariantId,
                        shopifyProductId: variant.shopifyProductId
                    });

                    await sleep(config.sync.requestDelayMs);
                    continue;
                }
            }

            if (!itemId) {
                itemId = await resolveAnyItemIdBySku(variant.sku, normalizedSku);
            }

            if (itemId) {
                const result = await meli.updateItem(itemId, variant);
                touchedItemIds.add(String(result.itemId));
                if (result.skipped) {
                    skipped += 1;
                    saveMapping(variant.sku, {
                        itemId: result.itemId,
                        shopifyVariantId: variant.shopifyVariantId,
                        shopifyProductId: variant.shopifyProductId,
                        lastSyncedPrice: result.price
                    });
                    continue;
                }

                updated += 1;
                saveMapping(variant.sku, {
                    itemId: result.itemId,
                    shopifyVariantId: variant.shopifyVariantId,
                    shopifyProductId: variant.shopifyProductId,
                    lastSyncedPrice: result.price
                });
            } else {
                const result = await meli.createItem(variant);
                touchedItemIds.add(String(result.itemId));
                created += 1;
                saveMapping(variant.sku, {
                    itemId: result.itemId,
                    shopifyVariantId: variant.shopifyVariantId,
                    shopifyProductId: variant.shopifyProductId,
                    lastSyncedPrice: result.price
                });
            }

            await sleep(config.sync.requestDelayMs);
        } catch (error) {
            failed += 1;
            const details = error.response && error.response.data ? error.response.data : { message: error.message };
            logger.error("Failed syncing SKU", {
                sku: variant.sku,
                details
            });
        }
    }

    const zeroOutStats = await forceZeroStockForSkusMissingInOdoo(stockBySku, new Set([
        ...closedItemIds,
        ...touchedItemIds
    ]));

    logger.info("Sync finished", {
        created,
        updated,
        skipped,
        failed,
        inventorySynced,
        inventoryMissingSku,
        inventoryMissingItem,
        stockOnlyUpdated,
        nonApprovedReviewed: cleanupStats.reviewed,
        nonApprovedClosed: cleanupStats.closed,
        nonApprovedCleanupFailed: cleanupStats.failed,
        zeroOutReviewed: zeroOutStats.reviewed,
        zeroOutApplied: zeroOutStats.forcedToZero,
        zeroOutFailed: zeroOutStats.failed
    });

    return {
        created,
        updated,
        skipped,
        failed,
        inventorySynced,
        inventoryMissingSku,
        inventoryMissingItem,
        stockOnlyUpdated,
        nonApprovedReviewed: cleanupStats.reviewed,
        nonApprovedClosed: cleanupStats.closed,
        nonApprovedCleanupFailed: cleanupStats.failed,
        zeroOutReviewed: zeroOutStats.reviewed,
        zeroOutApplied: zeroOutStats.forcedToZero,
        zeroOutFailed: zeroOutStats.failed
    };
}

module.exports = {
    syncOnce
};
