const fs = require("fs");
const path = require("path");

const ATTRIBUTES_PATH = path.join(__dirname, "..", "data", "category-attributes.json");

function readAttributesFile() {
    if (!fs.existsSync(ATTRIBUTES_PATH)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(ATTRIBUTES_PATH, "utf8");
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON in ${ATTRIBUTES_PATH}: ${error.message}`);
    }
}

function formatTemplate(value, product) {
    const dictionary = {
        sku: String(product.sku || ""),
        title: String(product.title || ""),
        vendor: String(product.vendor || ""),
        productType: String(product.productType || ""),
        variantTitle: String(product.variantTitle || "")
    };

    return String(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        if (dictionary[key] === undefined) {
            return "";
        }
        return dictionary[key];
    });
}

function objectToAttributeArray(attributesObject, product) {
    return Object.entries(attributesObject || {}).map(([id, value]) => ({
        id,
        value_name: formatTemplate(value, product)
    }));
}

function getTemplateAttributesForCategory(categoryId, product) {
    const templates = readAttributesFile();
    const common = objectToAttributeArray(templates["*"] || {}, product);
    const categorySpecific = objectToAttributeArray(templates[categoryId] || {}, product);

    return [...common, ...categorySpecific];
}

module.exports = {
    ATTRIBUTES_PATH,
    getTemplateAttributesForCategory
};
