#!/usr/bin/env node
// Updates .local/ACCESOS_PRIVADOS.md with current .env values
require("dotenv").config();
const fs = require("fs");

const filePath = ".local/ACCESOS_PRIVADOS.md";
let content = fs.readFileSync(filePath, "utf8");

// Update timestamp
content = content.replace(/Actualizado: .+/, "Actualizado: " + new Date().toISOString());

// Remove any existing Odoo POS section
content = content.replace(/\n## Odoo POS[\s\S]*?(?=\n##|$)/, "");

// Append Odoo section
const odooSection = [
    "",
    "## Odoo POS — COMERTEX BUCARAMANGA #1",
    "- ODOO_URL: " + process.env.ODOO_URL,
    "- ODOO_DB: " + process.env.ODOO_DB,
    "- ODOO_USERNAME: " + process.env.ODOO_USERNAME,
    "- ODOO_API_KEY: " + process.env.ODOO_API_KEY,
    "- ODOO_WAREHOUSE_NAME: " + process.env.ODOO_WAREHOUSE_NAME,
    "- STOCK_SOURCE: " + process.env.STOCK_SOURCE,
    "- STOCK_DEFAULT_WHEN_MISSING: " + process.env.STOCK_DEFAULT_WHEN_MISSING,
].join("\n");

content = content.trimEnd() + odooSection + "\n";
fs.writeFileSync(filePath, content);
console.log("Updated .local/ACCESOS_PRIVADOS.md");
