const fs = require("fs");
const path = require("path");

const RULES_PATH = path.join(__dirname, "..", "data", "category-rules.json");

function normalize(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function readRulesFile() {
    if (!fs.existsSync(RULES_PATH)) {
        return {
            exactSku: {},
            skuPrefix: {},
            titleContains: {},
            productTypeContains: {},
            vendorContains: {},
            tagContains: {}
        };
    }

    try {
        const raw = fs.readFileSync(RULES_PATH, "utf8");
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON in ${RULES_PATH}: ${error.message}`);
    }
}

function findByContains(table, value) {
    const normalizedValue = normalize(value);
    if (!normalizedValue) {
        return null;
    }

    for (const [needle, categoryId] of Object.entries(table || {})) {
        if (normalizedValue.includes(normalize(needle))) {
            return categoryId;
        }
    }

    return null;
}

function findByPrefix(table, value) {
    const source = String(value || "");
    if (!source) {
        return null;
    }

    const prefixes = Object.keys(table || {}).sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
        if (source.startsWith(prefix)) {
            return table[prefix];
        }
    }

    return null;
}

function resolveCategoryFromRules(product) {
    const rules = readRulesFile();
    const sku = String(product.sku || "").trim();
    const productType = String(product.productType || "").trim();
    const vendor = String(product.vendor || "").trim();
    const tags = Array.isArray(product.tags) ? product.tags.join(" ") : "";
    const title = String(product.title || "").trim();

    if (sku && rules.exactSku && rules.exactSku[sku]) {
        return rules.exactSku[sku];
    }

    const byPrefix = findByPrefix(rules.skuPrefix, sku);
    if (byPrefix) {
        return byPrefix;
    }

    const byTitle = findByContains(rules.titleContains, title);
    if (byTitle) {
        return byTitle;
    }

    const byProductType = findByContains(rules.productTypeContains, productType);
    if (byProductType) {
        return byProductType;
    }

    const byVendor = findByContains(rules.vendorContains, vendor);
    if (byVendor) {
        return byVendor;
    }

    const byTag = findByContains(rules.tagContains, tags);
    if (byTag) {
        return byTag;
    }

    return null;
}

module.exports = {
    RULES_PATH,
    resolveCategoryFromRules
};
