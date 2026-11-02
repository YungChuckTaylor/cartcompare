# What the real Datafiniti API actually returns

Measured 2026-11-02 against `api.datafiniti.co/v4/products/search` through the
deployed function, trial credentials, ~30 records spent. Every number below is
an observed `num_found`, not an estimate. `num_found` is free, so re-checking
any of these costs nothing.

## The database is large, US-heavy, and mostly not grocery

| Query | `num_found` |
| --- | --- |
| `merchants.country:US` | 46,169,864 |
| `prices.currency:USD` | 423,421,365 |
| `categories:"Grocery"` | 2,292,997 |
| `prices.currency:USD AND categories:"Grocery"` | not run |
| `prices.currency:USD AND prices.dateSeen:[2026-10-01 TO 2026-11-02]` | 14,893,872 |
| `country:US` | **0** |

Two things worth knowing:

- **`country` is not a product field.** `country:US` matches nothing. The
  populated field is `merchants.country`. A coverage probe built on `country:US`
  would have reported zero US coverage and been wrong by 46 million records.
- **About 3.5% of the USD pool was observed in the last month.** The rest is
  older. Prices are observations, and the corpus is a history of them, not a
  live feed.

## Barcode lookup works, but recall is the constraint

| Query | `num_found` |
| --- | --- |
| `upca:"016000275430"` (Cheerios) | **0** |
| `upca:"028400758956"` (Funyuns Minis) | 1 |
| `upc:"028400758956"` | 1 |
| `name:"funyuns"` | 570 |

The field name is not the problem — `upca` and `upc` both resolve. A
top-selling cereal simply is not in the corpus, while a single-serve snack bag
is. Coverage is per-SKU and unpredictable, so **any product-first UX has to
survive a miss**: CartCompare shows the line with no price and refuses to rank
the basket rather than quietly comparing a shorter cart.

## The data is messier than the schema suggests

Observed in real records:

1. **`prices[].dateSeen` is an array** of every observation, not a timestamp.
   One Funyuns record held dates in 2025 and 2026.
2. **Records mix years.** A single product carried a 2017 eBay price and a
   Target price seen hours ago. Comparing across those is meaningless.
3. **Records mix currencies.** A USD-currency query returned records whose
   offer list contained EUR and GBP merchants.
4. **`upc` is frequently `null`**, including for ordinary retail products.
5. **Merchant names carry UI debris** — `Pharmapacks.comLearn moreStore info`,
   `Walmart - Pharmapacks`, `king of deals - amazon.com`. Grouping baskets by
   raw merchant name splits one seller into three.
6. **`merchants[].country` is `null` in practice**, so region filtering has to
   run on currency.
7. **`domain` is often an aggregator**, not the retailer: rows resolve to
   `google.com/shopping` and `brickseek.com` rather than the store itself.
8. **The same merchant lists the same product at wildly different prices**
   because different pack sizes share a barcode — one Pedialyte record held
   $10.61 and $31.82 for the same "8 × 1L" listing. One Funyuns 50-pack was
   listed at $541.87.

## What this changed in the code

| Finding | Fix |
| --- | --- |
| `dateSeen` is an array | take the freshest observation per offer |
| Records mix years | drop offers older than `OFFER_MAX_AGE_DAYS` (default 180) before any maths; report the count in `freshness` |
| Mixed currencies | non-USD offers excluded from US comparisons, in search and in the cart |
| `upc` often null | a cart line id is a barcode **or** `name:<product name>` |
| Merchant debris | strip the trailing "Learn more…" UI text |
| `country` is empty | probes and filters use `merchants.country` / currency |

The `dateSeen`, merchant, currency and stale-price fixes are covered by
`test/live-shape.test.js`, built from the shapes above.

## What is still unsolved

- **Pack-size collisions.** Two listings for different quantities share a
  barcode, so "cheapest per merchant" can compare a single bottle to an
  eight-pack. Unit normalisation needs the `size`/`prices.amountMin` pair plus
  a unit parser; not attempted here.
- **Outliers.** No sanity band yet — a $541.87 bag of chips survives.
- **Merchant identity.** `walmart.com` and `Walmart - Pharmapacks` are treated
  as different sellers. That is conservative and honest, but it fragments
  baskets.
- **Freshness is per-offer, but matching is per-record.** A record can match a
  date-range query on one offer while other offers in it are years old, which
  is why the gate runs per offer rather than trusting the query.
