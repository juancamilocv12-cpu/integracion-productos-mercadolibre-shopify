const axios = require("axios");
const config = require("./config");
const logger = require("./logger");

const client = axios.create({
    baseURL: `https://${config.shopify.store}/admin/api/${config.shopify.apiVersion}`,
    timeout: config.sync.timeoutMs,
    headers: {
        "X-Shopify-Access-Token": config.shopify.accessToken,
        "Content-Type": "application/json"
    }
});

let cachedLocationId = null;

function extractNextPageInfo(linkHeader) {
    if (!linkHeader) {
        return null;
    }

    const nextPart = linkHeader
        .split(",")
        .map((part) => part.trim())
        .find((part) => part.includes('rel="next"'));

    if (!nextPart) {
        return null;
    }

    const match = nextPart.match(/page_info=([^&>]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

function parseVariantRows(products) {
    const rows = [];

    for (const product of products) {
        const images = (product.images || []).map((img) => img.src).filter(Boolean);
        const tags = (product.tags || "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean);

        for (const variant of product.variants || []) {
            const sku = (variant.sku || "").trim();
            if (!sku) {
                continue;
            }

            const optionValues = [variant.option1, variant.option2, variant.option3]
                .filter(Boolean)
                .map((value) => String(value).trim())
                .filter(Boolean);

            rows.push({
                shopifyProductId: product.id,
                shopifyVariantId: variant.id,
                inventoryItemId: variant.inventory_item_id,
                sku,
                title: product.title,
                variantTitle: variant.title,
                optionValues,
                descriptionHtml: product.body_html || "",
                vendor: product.vendor || "",
                productType: product.product_type || "",
                tags,
                images,
                price: Number(variant.price)
            });
        }
    }

    return rows;
}

async function fetchVariantRows() {
    const allProducts = [];
    let pageInfo = null;

    do {
        const params = {
            limit: 250
        };

        if (pageInfo) {
            params.page_info = pageInfo;
        } else {
            params.status = "active";
        }

        const response = await client.get("/products.json", { params });
        allProducts.push(...(response.data.products || []));
        pageInfo = extractNextPageInfo(response.headers.link);
    } while (pageInfo);

    return parseVariantRows(allProducts);
}

async function resolveLocationId() {
    if (config.shopify.locationId) {
        return config.shopify.locationId;
    }

    if (cachedLocationId) {
        return cachedLocationId;
    }

    const response = await client.get("/locations.json", {
        params: {
            limit: 250
        }
    });

    const locations = response.data.locations || [];
    const activeLocation = locations.find((location) => location.active !== false) || locations[0];

    if (!activeLocation || !activeLocation.id) {
        throw new Error("No Shopify location available for inventory sync");
    }

    cachedLocationId = Number(activeLocation.id);
    logger.info("Shopify inventory location resolved", {
        locationId: cachedLocationId,
        locationName: activeLocation.name || ""
    });

    return cachedLocationId;
}

async function setInventoryLevel(inventoryItemId, availableQuantity) {
    if (!inventoryItemId && inventoryItemId !== 0) {
        throw new Error("Missing inventoryItemId for Shopify inventory update");
    }

    const locationId = await resolveLocationId();
    await client.post("/inventory_levels/set.json", {
        location_id: Number(locationId),
        inventory_item_id: Number(inventoryItemId),
        available: Number(availableQuantity)
    });
}

module.exports = {
    fetchVariantRows,
    setInventoryLevel
};
