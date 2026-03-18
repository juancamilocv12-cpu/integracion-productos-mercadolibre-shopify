const dotenv = require("dotenv");

dotenv.config();

function required(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value.trim();
}

function optional(name, fallback = "") {
    const value = process.env[name];
    return value && value.trim() ? value.trim() : fallback;
}

function toNumber(name, fallback) {
    const raw = optional(name, String(fallback));
    const value = Number(raw);
    if (Number.isNaN(value)) {
        throw new Error(`Environment variable ${name} must be numeric`);
    }
    return value;
}

function optionalNumber(name) {
    const value = optional(name, "");
    if (!value) {
        return null;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${name} must be numeric when provided`);
    }

    return parsed;
}

function toBoolean(name, fallback) {
    const raw = optional(name, fallback ? "true" : "false").toLowerCase();
    return ["1", "true", "yes", "y", "on"].includes(raw);
}

const config = {
    shopify: {
        store: required("SHOPIFY_STORE"),
        accessToken: required("SHOPIFY_ACCESS_TOKEN"),
        apiVersion: optional("SHOPIFY_API_VERSION", "2025-01"),
        locationId: optionalNumber("SHOPIFY_LOCATION_ID")
    },
    postgres: {
        connectionString: optional("POSTGRES_CONNECTION_STRING"),
        branchId: optional("POSTGRES_BRANCH_ID"),
        stockQuery: optional(
            "POSTGRES_STOCK_QUERY",
            "SELECT sku, quantity FROM inventory"
        ),
        ssl: toBoolean("POSTGRES_SSL", true),
        sslRejectUnauthorized: toBoolean("POSTGRES_SSL_REJECT_UNAUTHORIZED", false)
    },
    meli: {
        siteId: optional("MELI_SITE_ID", "MCO"),
        appId: required("MELI_APP_ID"),
        clientSecret: required("MELI_CLIENT_SECRET"),
        redirectUri: required("MELI_REDIRECT_URI"),
        accessToken: required("MELI_ACCESS_TOKEN"),
        refreshToken: required("MELI_REFRESH_TOKEN"),
        userId: optional("MELI_USER_ID"),
        authBaseUrl: optional("MELI_AUTH_BASE_URL"),
        defaultCategoryId: optional("MELI_DEFAULT_CATEGORY_ID"),
        listingTypeId: optional("MELI_LISTING_TYPE_ID", "gold_special"),
        defaultImageUrl: optional("MELI_DEFAULT_IMAGE_URL")
    },
    sync: {
        markupPercent: toNumber("PRICE_MARKUP_PERCENT", 14),
        minPrice: toNumber("MIN_PRICE", 0),
        defaultQuantity: toNumber("DEFAULT_QUANTITY", 1),
        intervalMinutes: toNumber("SYNC_INTERVAL_MINUTES", 5),
        currencyId: optional("CURRENCY_ID", "COP"),
        timeoutMs: toNumber("REQUEST_TIMEOUT_MS", 30000),
        requestDelayMs: toNumber("REQUEST_DELAY_MS", 350),
        autoActivatePaused: toBoolean("MELI_AUTO_ACTIVATE_PAUSED", true),
        updateTitle: toBoolean("MELI_UPDATE_TITLE", false),
        maxProductsPerRun: toNumber("MAX_PRODUCTS_PER_RUN", 0)
    },
    stock: {
        source: optional("STOCK_SOURCE", "postgres").toLowerCase(),
        defaultWhenMissing: toNumber("STOCK_DEFAULT_WHEN_MISSING", 0)
    }
};

if (!["postgres", "fixed"].includes(config.stock.source)) {
    throw new Error("STOCK_SOURCE must be one of: postgres, fixed");
}

module.exports = config;
