const { Client } = require("pg");
const config = require("./config");
const logger = require("./logger");

function normalizeQuantity(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }

    return Math.max(0, Math.floor(numeric));
}

function buildClient() {
    if (!config.postgres.connectionString) {
        throw new Error("Missing POSTGRES_CONNECTION_STRING for stock source postgres");
    }

    const ssl = config.postgres.ssl
        ? { rejectUnauthorized: config.postgres.sslRejectUnauthorized }
        : false;

    return new Client({
        connectionString: config.postgres.connectionString,
        ssl
    });
}

async function fetchStockBySku() {
    if (config.stock.source !== "postgres") {
        return new Map();
    }

    const client = buildClient();
    await client.connect();

    try {
        const hasBranchPlaceholder = /\$1\b/.test(config.postgres.stockQuery);
        const shouldUseBranchFilter = Boolean(config.postgres.branchId && hasBranchPlaceholder);

        if (config.postgres.branchId && !hasBranchPlaceholder) {
            logger.warn("POSTGRES_BRANCH_ID is set, but POSTGRES_STOCK_QUERY does not contain $1 placeholder. Branch filter ignored.");
        }

        const result = shouldUseBranchFilter
            ? await client.query(config.postgres.stockQuery, [config.postgres.branchId])
            : await client.query(config.postgres.stockQuery);
        const stockBySku = new Map();
        let invalidRows = 0;

        for (const row of result.rows || []) {
            const sku = String(row.sku || "").trim();
            if (!sku) {
                continue;
            }

            const quantity = normalizeQuantity(row.quantity);
            if (quantity === null) {
                invalidRows += 1;
                continue;
            }

            stockBySku.set(sku, quantity);
        }

        logger.info("Stock loaded from PostgreSQL", {
            rows: result.rowCount || 0,
            skus: stockBySku.size,
            invalidRows,
            branchFilterApplied: shouldUseBranchFilter
        });

        return stockBySku;
    } finally {
        await client.end();
    }
}

module.exports = {
    fetchStockBySku
};