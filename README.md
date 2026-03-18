# Shopify -> Mercado Libre Sync

Sync products, prices, and stock from Shopify/PostgreSQL to Mercado Libre.

Business rules already configured:
- Create and update listings.
- SKU mapping (Shopify variant SKU <-> Mercado Libre item).
- Price = Shopify price + 14%.
- Stock source = Odoo POS (tienda Bucaramanga #1).
- Inventory flow = Odoo POS -> Shopify -> Mercado Libre.
- Frequency = every 5 minutes.
- Listing type = premium (`gold_special`).
- Condition = new.
- Warranty = seller warranty, 30 days.

## 0) Configure stock source (Odoo POS)

Required `.env` variables:

```bash
STOCK_SOURCE=odoo
ODOO_URL=http://serverodoo.grupooba.co:8069
ODOO_DB=geobamain15450421
ODOO_USERNAME=tiendabogota1@comertex.com.co
ODOO_API_KEY=your_odoo_api_key
ODOO_WAREHOUSE_NAME=COMERTEX BUCARAMANGA # 1
STOCK_DEFAULT_WHEN_MISSING=0
SHOPIFY_LOCATION_ID=
```

Notes:
- `ODOO_WAREHOUSE_NAME` must match the warehouse name in Odoo exactly (case-insensitive search).
- Stock is read from `product.product.qty_available` filtered to the specified warehouse.
- Products without an internal reference (`default_code`) in Odoo are skipped.
- If a SKU exists in Shopify but not in Odoo results, `STOCK_DEFAULT_WHEN_MISSING=0` applies.
- `SHOPIFY_LOCATION_ID` is optional. If empty, the first active Shopify location is used.

## 1) Install dependencies

```bash
npm install
```

## 2) Get Mercado Libre access and refresh tokens

Generate auth URL:

```bash
npm run ml:token
```

Open the URL, login in Mercado Libre seller account, authorize app, then copy the `code` from callback URL and run:

```bash
npm run ml:token -- --code=YOUR_CODE
```

Copy output values into `.env`:
- `MELI_ACCESS_TOKEN`
- `MELI_REFRESH_TOKEN`
- `MELI_USER_ID`

## 3) Run one sync now

```bash
npm run sync:once
```

## 4) Run scheduler (every 5 minutes)

```bash
npm start
```

## 5) Run automatically in GitHub Actions

Workflow file:
- `.github/workflows/sync-shopify-mercadolibre.yml`

Required repository secrets:
- `SHOPIFY_STORE`
- `SHOPIFY_ACCESS_TOKEN`
- `SHOPIFY_LOCATION_ID` (optional)
- `ODOO_URL`
- `ODOO_DB`
- `ODOO_USERNAME`
- `ODOO_API_KEY`
- `ODOO_WAREHOUSE_NAME`
- `MELI_APP_ID`
- `MELI_CLIENT_SECRET`
- `MELI_REDIRECT_URI`
- `MELI_ACCESS_TOKEN`
- `MELI_REFRESH_TOKEN`
- `MELI_USER_ID`
- Optional: `MELI_DEFAULT_CATEGORY_ID`
- Optional: `MELI_DEFAULT_IMAGE_URL`

The workflow:
- Runs every 5 minutes.
- Runs one full sync (loads stock from PostgreSQL, updates Shopify inventory, then updates Mercado Libre).
- Automatically tries to reactivate paused listings.
- Commits `data/sku-map.json` changes back to the repository.

## Notes

- If Mercado Libre token expires during execution, the app auto-refreshes it in memory and prints the new pair in logs.
- SKU mappings are stored in `data/sku-map.json`.
- Inventory updates in Shopify use `inventory_levels/set` per SKU/inventory item.
- If a category cannot be inferred from product title, set `MELI_DEFAULT_CATEGORY_ID` in `.env`.
- Keep `MELI_UPDATE_TITLE=false` to avoid update errors on items that use `family_name` restrictions.
- Use `MAX_PRODUCTS_PER_RUN` for controlled test executions (for example, `20`). Set `0` to process all products.
- Set `MIN_PRICE` to enforce a floor price required by some Mercado Libre categories.
- Set `MELI_DEFAULT_IMAGE_URL` to publish products that do not have images in Shopify.

## Category Rules

You can control category routing in `data/category-rules.json`.

Priority used by the sync:
- `exactSku`
- `skuPrefix`
- `titleContains`
- `productTypeContains`
- `vendorContains`
- `tagContains`
- If no rule matches, the app uses `MELI_DEFAULT_CATEGORY_ID` (if set), otherwise auto-discovery.

## Category Attributes Template

You can force or override attributes in `data/category-attributes.json`.

- Use `*` for common attributes for all categories.
- Use a category id key (for example `MCO116389`) for category-specific attributes.
- Template placeholders supported in values: `{{sku}}`, `{{title}}`, `{{vendor}}`, `{{productType}}`, `{{variantTitle}}`.
