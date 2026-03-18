const logger = require("./logger");
const config = require("./config");
const { fetchVariantRows, setInventoryLevel } = require("./shopify");
const { fetchStockBySku } = require("./odooStock");
const { getMappingBySku, saveMapping } = require("./store");
const meli = require("./mercadolibre");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncOnce() {
    logger.info("Starting Shopify -> Mercado Libre sync");

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
    const seenSkus = new Set();

    for (const variant of variantsToProcess) {
        if (!variant.sku) {
            skipped += 1;
            continue;
        }

        if (seenSkus.has(variant.sku)) {
            skipped += 1;
            continue;
        }

        seenSkus.add(variant.sku);

        if (!Number.isFinite(variant.price) || variant.price <= 0) {
            skipped += 1;
            logger.warn("Skipped SKU due invalid price", { sku: variant.sku, price: variant.price });
            continue;
        }

        const stockValue = stockBySku.has(variant.sku)
            ? stockBySku.get(variant.sku)
            : config.stock.defaultWhenMissing;

        if (!stockBySku.has(variant.sku) && config.stock.source === "odoo") {
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
            let itemId = existingMapping ? existingMapping.itemId : null;

            if (!itemId) {
                itemId = await meli.searchItemBySku(variant.sku);
            }

            if (itemId) {
                itemId = await meli.resolveUpdatableItemId(itemId);
            }

            if (itemId) {
                const result = await meli.updateItem(itemId, variant);
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

    logger.info("Sync finished", {
        created,
        updated,
        skipped,
        failed,
        inventorySynced,
        inventoryMissingSku,
        inventoryMissingItem
    });

    return {
        created,
        updated,
        skipped,
        failed,
        inventorySynced,
        inventoryMissingSku,
        inventoryMissingItem
    };
}

module.exports = {
    syncOnce
};
