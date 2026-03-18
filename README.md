# Shopify -> Mercado Libre Sync

Sync products, prices, and stock from Shopify/PostgreSQL to Mercado Libre.

Business rules already configured:
- Create and update listings.
- SKU mapping (Shopify variant SKU <-> Mercado Libre item).
- Price = Shopify price + 14%.
- Stock source = PostgreSQL by SKU.
- Inventory flow = PostgreSQL -> Shopify -> Mercado Libre.
- Frequency = every 5 minutes.
- Listing type = premium (`gold_special`).
- Condition = new.
- Warranty = seller warranty, 30 days.

## 0) Configure stock source (PostgreSQL)

Required `.env` variables:

```bash
STOCK_SOURCE=postgres
POSTGRES_CONNECTION_STRING=postgres://user:password@host:5432/database
POSTGRES_STOCK_QUERY=SELECT sku, quantity FROM inventory WHERE branch_id = $1
POSTGRES_BRANCH_ID=MAIN_BOGOTA
POSTGRES_SSL=true
POSTGRES_SSL_REJECT_UNAUTHORIZED=false
STOCK_DEFAULT_WHEN_MISSING=0
SHOPIFY_LOCATION_ID=
```

Notes:
- Your SQL query must return columns named exactly `sku` and `quantity`.
- To filter one specific branch/sucursal, keep `$1` in `POSTGRES_STOCK_QUERY` and set `POSTGRES_BRANCH_ID`.
- If your query does not use `$1`, `POSTGRES_BRANCH_ID` is ignored.
- `SHOPIFY_LOCATION_ID` is optional. If empty, the first active Shopify location is used.
- If a SKU is missing in PostgreSQL, the sync uses `STOCK_DEFAULT_WHEN_MISSING`.

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
- `POSTGRES_CONNECTION_STRING`
- `POSTGRES_STOCK_QUERY` (optional, but recommended if your table/query differs)
- `POSTGRES_BRANCH_ID` (optional, required only if your query uses `$1`)
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
