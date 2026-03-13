const logger = require("./logger");
const { fetchVariantRows } = require("./shopify");
const { getMappingBySku, saveMapping } = require("./store");
const meli = require("./mercadolibre");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncOnce() {
    logger.info("Starting Shopify -> Mercado Libre sync");

    const variants = await fetchVariantRows();
    logger.info("Variants fetched from Shopify", { count: variants.length });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const variant of variants) {
        if (!variant.sku) {
            skipped += 1;
            continue;
        }

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
