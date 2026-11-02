# CartCompare

A minimal, working **cart-level** price comparison MVP for the **US market**. You build a basket,
it tells you what that basket costs at each store, and it is honest about which stores can actually
fill it.

It runs at **$0 with no API key**, because the price source is behind a swappable adapter and ships
with a synthetic demo provider. Datafiniti is one adapter, not a dependency.

> **Read this first:** [`docs/datafiniti-us-verdict.html`](docs/datafiniti-us-verdict.html) — the answer
> to "can the Datafiniti free tier carry this MVP?" Short version: in the US, **yes** — coverage is the
> vendor's home turf. What still gates you is the **14-day trial term** and the **licence's resale
> clause**, not the data.

## Quick start

No install step. No dependencies. Node 20+.

```bash
npm start          # http://localhost:4173
npm test           # basket-maths unit tests
npm run probe:dry  # show the Datafiniti coverage probes, spend nothing
```

The app boots in **demo mode**: a synthetic catalogue of 12 products across 9 US retailers. The UI
shows a banner saying so, and `/api/health` reports `mode: "demo"` and `market: "US"` so nothing can be
mistaken for real pricing.

## Live mode

```bash
cp .env.example .env
# paste your token into DATAFINITI_API_KEY
npm start          # mode: "live"
```

Three spending controls, because the trial is metered and expiring:

| Control | Env var | Default | Why |
|---|---|---|---|
| Response cache | `CACHE_TTL_HOURS` | 24 | Re-viewing the same barcode is free |
| Records per call | `DATAFINITI_MAX_RECORDS_PER_CALL` | 10 | You pay per record **returned** |
| Hard budget stop | `CREDIT_BUDGET` | 250 | Refuses to call once spent; protects the 1,000 |

Every call's real cost is recorded from the response's `total_cost` field and shown in the header.

**The one plan that fits inside 1,000 records:** curate ~40 SKUs, cache permanently, and never query
open-ended search. 40 SKUs × 10 records = 400 credits as a one-time seed, then the cache serves every
visit. That is a demoable US catalogue for free.

## Measure coverage before you pay

```bash
npm run probe      # ~9 credits, ~20 seconds, writes data/coverage-report.json
```

Nine targeted US queries, one record each, reading `num_found` (which is **free**). It answers the only
question that matters at this stage: *does this provider hold US prices, at enough merchants, for the
products in my cart?* It ends with a verdict, not a dump.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | mode, market, credits spent vs budget |
| `GET /api/search?q=` | product search → normalised products with offers |
| `POST /api/compare` | `{ items: [{upc, qty}], region: "US" \| "CA" \| "ANY" }` → baskets + item offers |
| `GET /api/catalog` | demo catalogue (used by the search box in demo mode) |

`US` is the default region. Offers are filtered on evidence: a USD currency **and** a US country when
either is present. Offers with no evidence are kept so a coverage gap stays visible.

## How it fits together

```
public/            cart builder, basket cards, item-by-item matrix (vanilla, no build step)
api/[...path].js   Vercel serverless entry point (catch-all for /api/*)
src/api.js         one request handler shared by the server and the function
src/prices.js      provider choice + cache + credit ledger   ← swap providers here
src/datafiniti.js  Datafiniti v4 client + record normaliser  ← the only file that knows it exists
src/demo.js        synthetic US provider, same interface
src/compare.js     basket maths: cheapest-per-merchant, totals, coverage (pure, unit tested)
scripts/probe-*.js coverage measurement using the free trial
```

A new provider is one file plus three lines in `src/prices.js`. The comparison maths and the UI never
change.

## Two decisions that are product, not plumbing

1. **A partial basket is never ranked as a cheap basket.** In the demo, Costco is the cheapest basket at
   $18.48 on 2 of 4 lines while Kroger is $31.63 on all 4. Every card carries its coverage, and a filter
   restricts the view to stores that carry the whole cart.
2. **Region is a first-class filter.** "US offers only" is on by default, and offers without US evidence
   are excluded rather than blended in — so a coverage gap is the first thing you see.

## Deployment

**Live: https://cartcompare-seven.vercel.app**

Hosted on Vercel as the project `cartcompare` (team *Lucro*), linked to
`YungChuckTaylor/cartcompare`. Production builds come from
`arena/abebc7f2-cartcompare`; `cartcompare.vercel.app` was already taken, so Vercel
assigned `cartcompare-seven.vercel.app`.

- Static site: `public/`
- API: `api/[...path].js` → `src/api.js`
- Node: 22.x, function `maxDuration` 30s
- Build config lives in `vercel.json` as explicit `builds` + `routes`. This is
  deliberate: with zero-config, Vercel's Node.js preset treated the whole repo as a
  single app and used `public/app.js` as the root lambda entrypoint, so every route
  including `/` returned `FUNCTION_INVOCATION_FAILED`. The explicit config keeps
  `public/` static and gives `api/[...path].js` its own function.
- Environment: `DATAFINITI_API_KEY` switches the deployment to live mode. It is set in project settings
  (encrypted, production only) and is **not** in git; without it the deployment falls back to the demo
  catalogue. Tuning vars: `DATAFINITI_MAX_RECORDS_PER_CALL` (5), `CREDIT_BUDGET` (200),
  `CACHE_TTL_HOURS` (24), `OFFER_MAX_AGE_DAYS` (180), and `ALLOW_GET_COMPARE` (off — the GET form of
  `/api/compare` spends credits, so it is disabled unless set to `1`).

## Live mode: what the real API does to this app

The deployment currently runs on **live Datafiniti data**. Measured numbers, the messy shapes in the
corpus, and the fixes they forced are in [`docs/live-api-findings.md`](docs/live-api-findings.md).
Short version: the corpus is ~423M USD-priced records and ~2.3M in Grocery, but it is a *history* of
observations, not a live feed, and barcode recall is per-SKU (a top-selling cereal returned zero rows
while a single-serve snack returned one). Three rules follow, and they apply to the search list as well
as the cart:

1. Offers older than `OFFER_MAX_AGE_DAYS` are dropped before any maths. `dateSeen` is an array of
   observations; each offer keeps its freshest.
2. Non-USD offers are excluded from a US comparison.
3. A cart line with no price is shown as missing, and the basket is not ranked.

Serverless notes: the filesystem is read-only, so `src/store.js` degrades the cache and credit ledger to
per-instance memory. The cache is an optimisation and the ledger is an estimate — neither is a source of
truth. For production, move both to a shared store (Vercel KV or Upstash Redis).

## Deliberately not built

Accounts, payments, shelf-label photos, receipt OCR, verification gates, price history charts,
crowdsourced submission, retailer matching at scale. Those are the *next* product. This repo is the
thing you show someone to find out whether the cart comparison is worth building.

## Caveat on the demo data

`src/demo-catalog.js` is **synthetic**. Invented prices, invented barcodes, plausible merchant names.
It exists to make the UI runnable and reviewable at zero cost and must never be presented as real
pricing or as Datafiniti data.
