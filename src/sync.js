const logger = require("./logger");
const config = require("./config");
const { fetchVariantRows } = require("./shopify");
const { getMappingBySku, saveMapping } = require("./store");
const meli = require("./mercadolibre");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncOnce() {
    logger.info("Starting Shopify -> Mercado Libre sync");

    const variants = await fetchVariantRows();
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

        try {
            const existingMapping = getMappingBySku(variant.sku);
            let itemId = existingMapping ? existingMapping.itemId : null;

            if (!itemId) {
                itemId = await meli.searchItemBySku(variant.sku);
            }

            if (itemId) {
                const result = await meli.updateItem(itemId, variant);
                if (result.skipped) {
                    skipped += 1;
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

            await sleep(150);
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
        failed
    });

    return {
        created,
        updated,
        skipped,
        failed
    };
}

module.exports = {
    syncOnce
};
