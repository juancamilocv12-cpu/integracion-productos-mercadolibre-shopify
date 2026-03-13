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
