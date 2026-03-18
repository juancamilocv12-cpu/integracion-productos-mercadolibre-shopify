#!/usr/bin/env node
// Run from project root: node scripts/set_secrets.js
require("dotenv").config();
const { execSync } = require("child_process");

const REPO = "juancamilocv12-cpu/integracion-productos-mercadolibre-shopify";

const secrets = {
    ODOO_URL: process.env.ODOO_URL,
    ODOO_DB: process.env.ODOO_DB,
    ODOO_USERNAME: process.env.ODOO_USERNAME,
    ODOO_API_KEY: process.env.ODOO_API_KEY,
    ODOO_WAREHOUSE_NAME: process.env.ODOO_WAREHOUSE_NAME,
};

for (const [name, value] of Object.entries(secrets)) {
    if (!value) {
        console.log(`SKIP (empty): ${name}`);
        continue;
    }
    execSync(`gh secret set ${name} --repo ${REPO}`, {
        input: value,
        stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`SET: ${name}`);
}
