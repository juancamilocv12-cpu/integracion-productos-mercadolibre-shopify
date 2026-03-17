# Shopify -> Mercado Libre Sync

Sync products and prices from Shopify to Mercado Libre.

Business rules already configured:
- Create and update listings.
- SKU mapping (Shopify variant SKU <-> Mercado Libre item).
- Price = Shopify price + 14%.
- Fixed quantity = 1.
- Frequency = every 5 minutes.
- Listing type = premium (`gold_special`).
- Condition = new.
- Warranty = seller warranty, 30 days.

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

## Notes

- If Mercado Libre token expires during execution, the app auto-refreshes it in memory and prints the new pair in logs.
- SKU mappings are stored in `data/sku-map.json`.
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
