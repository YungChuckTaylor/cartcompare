import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoProvider } from './demo.js';
import * as datafiniti from './datafiniti.js';
import { Store } from './store.js';

/**
 * The price service. This is the only place that knows Datafiniti exists.
 *
 * Swapping providers = changing this file. The comparison maths in
 * compare.js and the UI in public/ do not care where offers come from.
 *
 * Spending controls, in order of importance:
 *   1. Cache by barcode, 24h default. Repeat views are free.
 *   2. Credit budget hard stop. Refuses to call once you hit CREDIT_BUDGET.
 *   3. num_records cap. Only ask for as many records as you will display.
 */
const DEFAULT_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
);

/** A cart line needs a stable id; barcode when we have one, name when we do not. */
export function withId(product) {
  return { ...product, id: product.upc || `name:${product.name}` };
}

export function createPriceService({ cacheTtlMs = 24 * 3600 * 1000, dataDir = null } = {}) {
  const store = new Store(path.join(dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR, 'cache-root'));
  const demo = createDemoProvider();

  function mode() {
    return datafiniti.hasCredentials() ? 'live' : 'demo';
  }

  // How old an offer may be before it is refused. Datafiniti keeps price
  // observations for years, so without this a 2017 marketplace price can win a
  // 2026 comparison. 0 disables the gate.
  const offerMaxAgeDays = Number(process.env.OFFER_MAX_AGE_DAYS ?? 180);

  function credits() {
    return {
      total: store.creditsUsed(),
      budget: datafiniti.config().budget,
    };
  }

  function budgetLeft() {
    const { total, budget } = credits();
    return Math.max(0, budget - total);
  }

  function assertBudget(cost) {
    if (budgetLeft() < cost) {
      throw new Error(
        `Credit budget reached (${credits().total}/${credits().budget}). ` +
          `Raise CREDIT_BUDGET in .env only if you mean it.`,
      );
    }
  }

  async function cached(key, fn) {
    const hit = store.get(key);
    if (hit) return { ...hit, cached: true };
    const value = await fn();
    store.set(key, value, cacheTtlMs);
    return { ...value, cached: false };
  }

  /**
   * Free-text product search.
   * In live mode the query is passed through if it already looks like
   * Datafiniti syntax (contains a colon), otherwise it is wrapped as a name
   * phrase search. Credits are recorded either way.
   */
  async function search(query, { page = 1 } = {}) {
    const pageNo = Math.max(1, Math.floor(Number(page) || 1));

    if (mode() === 'demo') {
      return {
        mode: 'demo',
        cached: false,
        credits: 0,
        page: pageNo,
        numFound: pageNo === 1 ? demo.search(query).length : 0,
        items: pageNo === 1 ? demo.search(query).map(demo.asProduct).map(withId) : [],
      };
    }

    const q = String(query || '').trim();
    if (!q) return { mode: 'live', cached: false, credits: 0, page: pageNo, items: [] };

    // A query containing ':' is treated as raw Datafiniti syntax and passed
    // through unfiltered - that is the probe/debug path. Anything a shopper
    // types is phrase-matched and pinned to the category.
    const dfQuery = q.includes(':') ? q : datafiniti.buildSearchQuery(q);
    if (!dfQuery) return { mode: 'live', cached: false, credits: 0, page: pageNo, items: [] };
    const records = datafiniti.searchRecords();
    const key = Store.hashKey(['search', dfQuery, records, pageNo]);

    const result = await cached(key, async () => {
      assertBudget(records);
      // Page 1 is the plain search endpoint; deeper pages use the paging
      // endpoint, because /products/search cannot return more than ten.
      const res =
        pageNo === 1
          ? await datafiniti.search(dfQuery, { numRecords: records })
          : await datafiniti.paginate(dfQuery, { page: pageNo, numRecords: records });
      store.recordSpend({ purpose: `search p${pageNo}: ${dfQuery}`, credits: res.credits });
      return {
        credits: res.credits,
        numFound: res.numFound,
        fetched: res.records.length,
        items: res.records.map(datafiniti.normalizeRecord).map(withId),
      };
    });

    return {
      mode: 'live',
      cached: result.cached,
      credits: result.credits,
      page: pageNo,
      numFound: result.numFound,
      fetched: result.fetched,
      items: result.items,
    };
  }

  /**
   * Lookup for one cart line.
   *
   * Not every Datafiniti record has a barcode - apparel, marketplace listings and
   * plenty of grocery rows come back with `upc: null`. A cart that only accepts
   * barcodes would therefore reject real products, so a line id is either a
   * barcode or `name:<product name>` as a fallback identity.
   */
  async function lookupUpc(upc, { name = null } = {}) {
    const id = String(upc || '');
    const isName = id.startsWith('name:');

    if (mode() === 'demo') {
      const item = demo.byUpc(id);
      return { product: item ? demo.asProduct(item) : null, credits: 0, cached: false };
    }

    const key = Store.hashKey(['lookup', id, datafiniti.config().maxRecords]);
    const result = await cached(key, async () => {
      assertBudget(datafiniti.config().maxRecords);
      const query = isName
        ? datafiniti.buildNameQuery(name || id.slice(5))
        : datafiniti.buildUpcQuery(id);
      const res = await datafiniti.search(query, {
        numRecords: datafiniti.config().maxRecords,
      });
      store.recordSpend({ purpose: `${isName ? 'name' : 'upc'}: ${id.slice(0, 60)}`, credits: res.credits });

      if (!res.records.length && name && process.env.FALLBACK_NAME_QUERY === 'true') {
        const fallback = await datafiniti.search(datafiniti.buildNameQuery(name), { numRecords: 1 });
        store.recordSpend({ purpose: `name fallback: ${name}`, credits: fallback.credits });
        return {
          credits: res.credits + fallback.credits,
          numFound: fallback.numFound,
          items: fallback.records.map(datafiniti.normalizeRecord).map(withId),
        };
      }

      return {
        credits: res.credits,
        numFound: res.numFound,
        items: res.records.map(datafiniti.normalizeRecord).map(withId),
      };
    });

    const product = mergeRecords(upc, result.items);
    return { product, credits: result.credits, cached: result.cached };
  }

  return {
    mode,
    credits,
    search,
    lookupUpc,
    offerMaxAgeDays,
    // Kept on the service so api.js still never mentions Datafiniti directly.
    searchCategory: () => (mode() === 'demo' ? 'Demo catalogue' : datafiniti.searchCategory()),
    searchRecords: () => (mode() === 'demo' ? 0 : datafiniti.searchRecords()),
    searchMaxPages: () => datafiniti.searchMaxPages(),
    demoCatalog: demo.catalog,
  };
}

/**
 * One barcode can return several Datafiniti records (the same product listed
 * on different sites). Merge their offers into a single product, de-duped by
 * merchant, keeping the lowest price seen per merchant.
 */
export function mergeRecords(upc, records) {
  if (!records.length) return null;
  const base = records[0];
  const seen = new Map();
  for (const record of records) {
    for (const offer of record.offers) {
      const key = `${offer.merchant}|${offer.price}`;
      if (!seen.has(key)) seen.set(key, offer);
    }
  }
  const offers = [...seen.values()].sort((a, b) => a.price - b.price);
  return {
    upc: base.upc || upc,
    name: base.name,
    brand: base.brand,
    category: base.category,
    image: base.image,
    source: 'datafiniti',
    offers,
  };
}
