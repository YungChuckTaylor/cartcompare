# CartCompare

A minimal, working **cart-level** price comparison MVP. You build a basket, it tells you what that
basket costs at each store, and it is honest about which stores can actually fill it.

It runs at **$0 with no API key**, because the price source is behind a swappable adapter and ships
with a synthetic demo provider. Datafiniti is one adapter, not a dependency.

> **Read this first:** [`docs/datafiniti-free-tier-verdict.html`](docs/datafiniti-free-tier-verdict.html)
> — the answer to "can the Datafiniti free tier carry this MVP?" Short version: you can *build* on it,
> you cannot *ship* on it. It is a 14-day / 1,000-record trial, Canadian grocery coverage is near zero,
> and the licence blocks republishing prices without written clarification.

## Quick start

No install step. No dependencies. Node 20+.

```bash
npm start          # http://localhost:4173
npm test           # basket-maths unit tests
npm run probe:dry  # show the Datafiniti coverage probes, spend nothing
```

The app boots in **demo mode**: a synthetic catalogue of 12 products across 8 Canadian banners. The UI
shows a banner saying so, and `/api/health` reports `mode: "demo"` so nothing can be mistaken for real
pricing.

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

## Measure coverage before you pay

```bash
npm run probe      # ~8 credits, ~15 seconds, writes data/coverage-report.json
```

Eight targeted queries, one record each, reading `num_found` (which is **free**). It answers the only
question that matters at this stage: *does this provider hold Canadian prices for the products in my
cart?* It ends with a verdict, not a dump.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | mode, credits spent vs budget, cache TTL |
| `GET /api/search?q=` | product search → normalised products with offers |
| `POST /api/compare` | `{ items: [{upc, qty}], region: "CA" \| "ANY" }` → baskets + item-level offers |
| `GET /api/catalog` | demo catalogue (used by the search box in demo mode) |

## How it fits together

```
public/            cart builder, basket cards, item-by-item matrix (vanilla, no build step)
src/prices.js      provider choice + cache + credit ledger   ← swap providers here
src/datafiniti.js  Datafiniti v4 client + record normaliser  ← the only file that knows it exists
src/demo.js        synthetic provider, same interface
src/compare.js     basket maths: cheapest-per-merchant, totals, coverage (pure, unit tested)
scripts/probe-*.js coverage measurement using the free trial
```

A new provider is one file plus three lines in `src/prices.js`. The comparison maths and the UI never
change.

## Two decisions that are product, not plumbing

1. **A partial basket is never ranked as a cheap basket.** A store covering 2 of 5 lines always shows
   a lower total than one covering all 5. Every basket card carries its coverage, and a filter restricts
   the view to stores that carry the whole cart.
2. **Region is a first-class filter.** "Canadian offers only" is on by default, and offers without
   Canadian evidence are excluded rather than blended in — so a coverage gap is the first thing you see.

## Deliberately not built

Accounts, payments, shelf-label photos, receipt OCR, verification gates, price history charts,
crowdsourced submission, retailer matching at scale. Those are the *next* product, described in the
build plan. This repo is the thing you show someone to find out whether the cart comparison is worth
building.

## Caveat on the demo data

`data/demo-catalog.json` is **synthetic**. Invented prices, invented UPCs, plausible merchant names.
It exists to make the UI runnable and reviewable at zero cost and must never be presented as real
pricing or as Datafiniti data.
