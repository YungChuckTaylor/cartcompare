import path from 'node:path';
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
export function createPriceService({ dataDir, cacheTtlMs }) {
  const store = new Store(path.join(dataDir, 'cache-root'));
  const demo = createDemoProvider(dataDir);

  function mode() {
    return datafiniti.hasCredentials() ? 'live' : 'demo';
  }

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
  async function search(query) {
    if (mode() === 'demo') {
      return {
        mode: 'demo',
        cached: false,
        credits: 0,
        items: demo.search(query).map(demo.asProduct),
      };
    }

    const q = String(query || '').trim();
    if (!q) return { mode: 'live', cached: false, credits: 0, items: [] };

    const dfQuery = q.includes(':') ? q : datafiniti.buildNameQuery(q);
    const key = Store.hashKey(['search', dfQuery, datafiniti.config().maxRecords]);

    const result = await cached(key, async () => {
      assertBudget(1);
      const res = await datafiniti.search(dfQuery, { numRecords: datafiniti.config().maxRecords });
      store.recordSpend({ purpose: `search: ${dfQuery}`, credits: res.credits });
      return {
        credits: res.credits,
        numFound: res.numFound,
        items: res.records.map(datafiniti.normalizeRecord),
      };
    });

    return {
      mode: 'live',
      cached: result.cached,
      credits: result.credits,
      numFound: result.numFound,
      items: result.items,
    };
  }

  /** Barcode lookup for one cart line. */
  async function lookupUpc(upc, { name = null } = {}) {
    if (mode() === 'demo') {
      const item = demo.byUpc(upc);
      return { product: item ? demo.asProduct(item) : null, credits: 0, cached: false };
    }

    const key = Store.hashKey(['upc', upc, datafiniti.config().maxRecords]);
    const result = await cached(key, async () => {
      assertBudget(datafiniti.config().maxRecords);
      const res = await datafiniti.search(datafiniti.buildUpcQuery(upc), {
        numRecords: datafiniti.config().maxRecords,
      });
      store.recordSpend({ purpose: `upc: ${upc}`, credits: res.credits });

      if (!res.records.length && name && process.env.FALLBACK_NAME_QUERY === 'true') {
        const fallback = await datafiniti.search(datafiniti.buildNameQuery(name), { numRecords: 1 });
        store.recordSpend({ purpose: `name fallback: ${name}`, credits: fallback.credits });
        return {
          credits: res.credits + fallback.credits,
          numFound: fallback.numFound,
          items: fallback.records.map(datafiniti.normalizeRecord),
        };
      }

      return {
        credits: res.credits,
        numFound: res.numFound,
        items: res.records.map(datafiniti.normalizeRecord),
      };
    });

    const product = mergeRecords(upc, result.items);
    return { product, credits: result.credits, cached: result.cached };
  }

  return { mode, credits, search, lookupUpc, demoCatalog: demo.catalog };
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
