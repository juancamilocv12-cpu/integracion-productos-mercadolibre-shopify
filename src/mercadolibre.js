const axios = require("axios");
const config = require("./config");
const logger = require("./logger");

const apiClient = axios.create({
    baseURL: "https://api.mercadolibre.com",
    timeout: config.sync.timeoutMs,
    headers: {
        "Content-Type": "application/json"
    }
});

let accessToken = config.meli.accessToken;
let refreshToken = config.meli.refreshToken;
let userId = config.meli.userId;

function computePrice(basePrice) {
    const multiplier = 1 + config.sync.markupPercent / 100;
    return Math.round(basePrice * multiplier * 100) / 100;
}

function buildTitle(product) {
    const suffix = product.optionValues && product.optionValues.length
        ? ` - ${product.optionValues.join(" / ")}`
        : "";
    const full = `${product.title}${suffix}`.trim();
    return full.slice(0, 60);
}

function buildSaleTerms() {
    return [
        {
            id: "WARRANTY_TYPE",
            value_name: "Garantia del vendedor"
        },
        {
            id: "WARRANTY_TIME",
            value_name: "30 dias"
        }
    ];
}

async function refreshAccessToken() {
    const response = await apiClient.post("/oauth/token", {
        grant_type: "refresh_token",
        client_id: config.meli.appId,
        client_secret: config.meli.clientSecret,
        refresh_token: refreshToken,
        redirect_uri: config.meli.redirectUri
    });

    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;

    logger.warn("Mercado Libre access token refreshed. Update .env with new tokens if you restart the service.");
}

async function authorizedRequest(requestFn, hasRetried = false) {
    try {
        return await requestFn();
    } catch (error) {
        const status = error.response ? error.response.status : null;
        if (status === 401 && !hasRetried) {
            await refreshAccessToken();
            return authorizedRequest(requestFn, true);
        }
        throw error;
    }
}

function authHeaders() {
    return {
        Authorization: `Bearer ${accessToken}`
    };
}

async function resolveUserId() {
    if (userId) {
        return userId;
    }

    const response = await authorizedRequest(() => apiClient.get("/users/me", { headers: authHeaders() }));
    userId = String(response.data.id);
    return userId;
}

async function searchItemBySku(sku) {
    const sellerId = await resolveUserId();
    const response = await authorizedRequest(() =>
        apiClient.get(`/users/${sellerId}/items/search`, {
            headers: authHeaders(),
            params: {
                seller_sku: sku,
                limit: 1
            }
        })
    );

    const first = (response.data.results || [])[0];
    return first || null;
}

async function discoverCategory(product) {
    if (config.meli.defaultCategoryId) {
        return config.meli.defaultCategoryId;
    }

    const response = await apiClient.get(`/sites/${config.meli.siteId}/domain_discovery/search`, {
        params: {
            q: product.title,
            limit: 1
        }
    });

    const first = (response.data || [])[0];
    if (!first || !first.category_id) {
        throw new Error(`No category could be discovered for SKU ${product.sku}`);
    }

    return first.category_id;
}

function buildPictures(product) {
    return (product.images || []).slice(0, 10).map((url) => ({ source: url }));
}

async function createItem(product) {
    const categoryId = await discoverCategory(product);
    const payload = {
        title: buildTitle(product),
        category_id: categoryId,
        price: computePrice(product.price),
        currency_id: config.sync.currencyId,
        available_quantity: config.sync.defaultQuantity,
        buying_mode: "buy_it_now",
        listing_type_id: config.meli.listingTypeId,
        condition: "new",
        seller_custom_field: product.sku,
        sale_terms: buildSaleTerms(),
        pictures: buildPictures(product)
    };

    const response = await authorizedRequest(() =>
        apiClient.post("/items", payload, {
            headers: authHeaders()
        })
    );

    return {
        itemId: response.data.id,
        price: payload.price
    };
}

async function updateItem(itemId, product) {
    const payload = {
        title: buildTitle(product),
        price: computePrice(product.price),
        available_quantity: config.sync.defaultQuantity
    };

    await authorizedRequest(() =>
        apiClient.put(`/items/${itemId}`, payload, {
            headers: authHeaders()
        })
    );

    return {
        itemId,
        price: payload.price
    };
}

module.exports = {
    computePrice,
    createItem,
    updateItem,
    searchItemBySku
};
