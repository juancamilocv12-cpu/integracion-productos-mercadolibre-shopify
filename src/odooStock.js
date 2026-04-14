const axios = require("axios");
const config = require("./config");
const logger = require("./logger");

const BATCH_SIZE = 500;

function normalizeSku(value) {
    return String(value || "").trim().toUpperCase();
}

async function rpcCall(service, method, args) {
    const response = await axios.post(
        `${config.odoo.url}/jsonrpc`,
        {
            jsonrpc: "2.0",
            method: "call",
            id: 1,
            params: { service, method, args }
        },
        { timeout: config.sync.timeoutMs }
    );

    if (response.data.error) {
        throw new Error(`Odoo RPC error: ${JSON.stringify(response.data.error)}`);
    }

    return response.data.result;
}

async function authenticate() {
    if (!config.odoo.url || !config.odoo.db || !config.odoo.username || !config.odoo.apiKey) {
        throw new Error(
            "Missing Odoo configuration. Set ODOO_URL, ODOO_DB, ODOO_USERNAME and ODOO_API_KEY."
        );
    }

    const uid = await rpcCall("common", "authenticate", [
        config.odoo.db,
        config.odoo.username,
        config.odoo.apiKey,
        {}
    ]);

    if (!uid) {
        throw new Error(
            "Odoo authentication failed. Verify ODOO_DB, ODOO_USERNAME and ODOO_API_KEY."
        );
    }

    return uid;
}

async function executeKw(uid, model, method, args, kwargs = {}) {
    return rpcCall("object", "execute_kw", [
        config.odoo.db,
        uid,
        config.odoo.apiKey,
        model,
        method,
        args,
        kwargs
    ]);
}

async function resolveWarehouseId(uid) {
    if (!config.odoo.warehouseName) {
        return null;
    }

    const warehouses = await executeKw(
        uid,
        "stock.warehouse",
        "search_read",
        [[["name", "ilike", config.odoo.warehouseName]]],
        { fields: ["id", "name"] }
    );

    if (!warehouses || warehouses.length === 0) {
        throw new Error(
            `Odoo warehouse not found: "${config.odoo.warehouseName}". Verify ODOO_WAREHOUSE_NAME.`
        );
    }

    const targetName = String(config.odoo.warehouseName || "").trim().toLowerCase();
    const exactMatch = warehouses.find((warehouse) =>
        String(warehouse.name || "").trim().toLowerCase() === targetName
    );

    if (exactMatch) {
        return exactMatch.id;
    }

    if (warehouses.length === 1) {
        return warehouses[0].id;
    }

    throw new Error(
        `Multiple Odoo warehouses matched "${config.odoo.warehouseName}": ${warehouses
            .map((warehouse) => `"${warehouse.name}"`)
            .join(", ")}. Use the exact warehouse name in ODOO_WAREHOUSE_NAME.`
    );
}

async function fetchAllProducts(uid, warehouseId) {
    const allProducts = [];
    let offset = 0;

    while (true) {
        const kwargs = {
            fields: ["default_code", "qty_available"],
            limit: BATCH_SIZE,
            offset
        };

        if (warehouseId) {
            kwargs.context = { warehouse: warehouseId };
        }

        const batch = await executeKw(
            uid,
            "product.product",
            "search_read",
            [[["qty_available", ">", 0]]],
            kwargs
        );

        allProducts.push(...batch);

        if (batch.length < BATCH_SIZE) {
            break;
        }

        offset += BATCH_SIZE;
    }

    return allProducts;
}

async function fetchStockBySku() {
    if (config.stock.source !== "odoo") {
        return new Map();
    }

    const uid = await authenticate();
    const warehouseId = await resolveWarehouseId(uid);

    logger.info("Fetching stock from Odoo POS", {
        warehouse: config.odoo.warehouseName || "default",
        warehouseId: warehouseId || "not filtered"
    });

    const products = await fetchAllProducts(uid, warehouseId);

    const stockBySku = new Map();
    let skippedNoCode = 0;

    for (const product of products) {
        const sku = normalizeSku(product.default_code);

        if (!sku || sku === "FALSE") {
            skippedNoCode += 1;
            continue;
        }

        const quantity = Math.max(0, Math.floor(Number(product.qty_available)));
        stockBySku.set(sku, quantity);
    }

    logger.info("Stock loaded from Odoo POS", {
        totalProducts: products.length,
        skusLoaded: stockBySku.size,
        skippedNoCode
    });

    return stockBySku;
}

module.exports = { fetchStockBySku };
