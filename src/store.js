const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data", "sku-map.json");

function ensureStore() {
    if (!fs.existsSync(STORE_PATH)) {
        const base = {
            updatedAt: new Date().toISOString(),
            items: {}
        };
        fs.writeFileSync(STORE_PATH, JSON.stringify(base, null, 2));
    }
}

function readStore() {
    ensureStore();
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
}

function writeStore(data) {
    const next = {
        ...data,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2));
}

function getMappingBySku(sku) {
    const store = readStore();
    return store.items[sku] || null;
}

function saveMapping(sku, payload) {
    const store = readStore();
    store.items[sku] = {
        ...(store.items[sku] || {}),
        ...payload,
        updatedAt: new Date().toISOString()
    };
    writeStore(store);
}

function getAllMappings() {
    const store = readStore();
    return store.items || {};
}

module.exports = {
    STORE_PATH,
    getAllMappings,
    getMappingBySku,
    saveMapping
};
