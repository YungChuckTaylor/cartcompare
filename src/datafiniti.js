/**
 * Datafiniti Product Data adapter (v4 API).
 *
 * Endpoint: POST https://api.datafiniti.co/v4/products/search
 * Body:     { query, num_records, format, download }
 * Billing:  one credit per record RETURNED, not per call. So the cheapest
 *           possible probe is num_records: 1 (see scripts/probe-coverage.js).
 *
 * Two things worth remembering while reading this file:
 *   1. Records are scraped from e-commerce listing pages. There is no shelf
 *      price and no in-store price in here.
 *   2. Coverage is US-first. `country:CA` works, but it is sparse.
 */

const ENDPOINT = 'https://api.datafiniti.co/v4/products/search';
const PAGINATE_ENDPOINT = 'https://api.datafiniti.co/v4/product/paginate';
const MAX_RECORDS = 10; // API ceiling for non-download searches
const PAGINATE_MAX_LIMIT = 500; // API ceiling per page, but each record is a credit

export function hasCredentials() {
  return Boolean(process.env.DATAFINITI_API_KEY && process.env.DATAFINITI_API_KEY.trim());
}

export function config() {
  return {
    upcField: process.env.DATAFINITI_UPC_FIELD || 'upca',
    maxRecords: Math.min(Number(process.env.DATAFINITI_MAX_RECORDS_PER_CALL) || MAX_RECORDS, MAX_RECORDS),
    budget: Number(process.env.CREDIT_BUDGET) || 250,
  };
}

async function post(url, payload, { timeoutMs = 25000, query = null } = {}) {
  if (!hasCredentials()) {
    throw new Error('DATAFINITI_API_KEY is not set');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DATAFINITI_API_KEY.trim()}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Datafiniti returned ${res.status} with a non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const detail = body?.error || body?.message || JSON.stringify(body).slice(0, 300);
    throw new Error(`Datafiniti ${res.status}: ${detail}`);
  }

  return {
    query,
    numFound: body.num_found ?? 0,
    credits: body.total_cost ?? 0,
    records: Array.isArray(body.records) ? body.records : [],
  };
}

/**
 * Raw search. Returns the HTTP body plus the numbers you need to reason about
 * money: `numFound` is FREE, `credits` is what this call actually cost you.
 */
export async function search(query, { numRecords = 10, timeoutMs = 25000 } = {}) {
  const records = Math.max(1, Math.min(numRecords, MAX_RECORDS));
  return post(ENDPOINT, { query, num_records: records, format: 'JSON', download: false }, { timeoutMs, query });
}

/**
 * Page N of the same query.
 *
 * `/v4/products/search` stops at 10 records, which is why a search felt like it
 * ended after one screen. Datafiniti exposes a separate paging endpoint for the
 * rest: POST /v4/product/paginate?page=N&limit=L. `limit` may go to 500, but
 * every returned record is a credit, so this passes a shopper-sized limit and
 * lets the caller decide how many pages it can afford.
 *
 * Pages are 1-based and `page=1` should tile with what a plain search returns
 * first; the client de-duplicates across pages in case it does not.
 */
export async function paginate(query, { page = 2, numRecords = 10, timeoutMs = 25000 } = {}) {
  const limit = Math.max(1, Math.min(numRecords, PAGINATE_MAX_LIMIT));
  const n = Math.max(1, Math.floor(Number(page) || 1));
  const url = `${PAGINATE_ENDPOINT}?page=${n}&limit=${limit}`;
  return post(url, { query }, { timeoutMs, query });
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * `prices[].dateSeen` comes back as an ARRAY of ISO strings (every time the
 * listing was observed), not a single timestamp. Collapsing it to the most
 * recent observation is what makes "how fresh is this price" answerable.
 */
export function latestDate(value) {
  if (!value) return null;
  const list = Array.isArray(value) ? value : [value];
  let best = null;
  for (const entry of list) {
    const t = Date.parse(entry);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Merchant names in the wild carry UI debris: "Pharmapacks.comLearn moreStore
 * info". Left alone, one seller becomes three and basket grouping silently
 * breaks. This only removes obvious noise - it does NOT try to decide that
 * "Walmart - Pharmapacks" is Walmart, because that would be a lie.
 */
export function cleanMerchant(name) {
  return String(name || '')
    .replace(/\s*learn more.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Datafiniti's product shape is loose: `prices` can hold several offers, each
 * with an optional `merchant`, and merchants can be a string or an array.
 * This flattens it into one offer per (product, seller) pair and refuses to
 * invent a merchant that was not in the record.
 */
export function normalizeRecord(record) {
  const merchantMeta = new Map();
  if (Array.isArray(record.merchants)) {
    for (const m of record.merchants) {
      if (m && typeof m === 'object' && m.name) merchantMeta.set(String(m.name).toLowerCase(), m);
    }
  }

  const offers = [];
  const prices = Array.isArray(record.prices) ? record.prices : [];
  for (const p of prices) {
    if (!p || typeof p !== 'object') continue;
    const amount = toNumber(p.amountMin) ?? toNumber(p.amountMax);
    if (amount == null) continue;

    const url = Array.isArray(p.sourceURLs) ? p.sourceURLs[0] : p.sourceURL || null;
    const domain = url ? safeHost(url) : null;
    const names = Array.isArray(p.merchant)
      ? p.merchant.filter(Boolean)
      : p.merchant
        ? [p.merchant]
        : [];

    const sellers = names.length ? names.map(cleanMerchant).filter(Boolean) : [domain || null];
    for (const seller of (sellers.length ? sellers : [null])) {
      const meta = seller ? merchantMeta.get(seller.toLowerCase()) || {} : {};
      offers.push({
        merchant: seller || 'Unlisted seller',
        domain: domain || (meta.website ? safeHost(meta.website) : null),
        price: amount,
        currency: (p.currency || 'USD').toUpperCase(),
        dateSeen: latestDate(p.dateSeen) || latestDate(record.mostRecentPriceUpdate),
        isSale: Boolean(p.isSale),
        availability: p.availability ?? null,
        country: meta.country ? String(meta.country).toUpperCase() : null,
        province: meta.province || null,
        url,
      });
    }
  }

  const barcode =
    record.upca || record.upc || record.ean || record.gtin || record.isbn || record.asin || null;

  return {
    upc: barcode ? String(barcode) : null,
    name: record.name || record.title || 'Unnamed product',
    brand: record.brand || record.manufacturer || null,
    category: Array.isArray(record.categories) ? record.categories.join(' / ') : record.categories || null,
    image: Array.isArray(record.imageURLs) ? record.imageURLs[0] : null,
    source: 'datafiniti',
    offers,
  };
}

export function buildUpcQuery(upc) {
  const field = config().upcField;
  return `${field}:"${String(upc).replace(/"/g, '')}"`;
}

export function buildNameQuery(name) {
  return `name:"${String(name).replace(/"/g, '').slice(0, 120)}"`;
}

/**
 * Search is limited to one category on purpose.
 *
 * Measured on the live API, 2026-11-02:
 *   categories:"Grocery & Gourmet Food"        -> 1,543,983 records
 *   categories:"Food, Beverages & Tobacco"     ->     2,218 records
 *
 * The second is the Google/Flipp taxonomy name and it does exist in the corpus,
 * but every record we sampled was a one-off Shopify storefront with no US
 * merchant price at all - useless for comparing merchants. "Grocery & Gourmet
 * Food" is Datafiniti's own label for the same shelf and it is the one with
 * real Walmart/Target/Kroger offers in it.
 *
 * Override with SEARCH_CATEGORY if you want to widen or change it.
 */
/**
 * Search asks for more records than a single-cart lookup does.
 *
 * A Datafiniti product record usually carries offers from ONE retailer's crawl,
 * so a query that returns the first five matches can easily produce five
 * single-merchant products and nothing to compare. Ten records is the API
 * ceiling for a non-download search and it is what makes a merchant ladder
 * likely to appear at all. Costs 10 credits on a cache miss, hence the cache.
 */
export function searchRecords() {
  const n = Number(process.env.SEARCH_RECORDS ?? 10);
  return Math.max(1, Math.min(Number.isFinite(n) ? n : 10, MAX_RECORDS));
}

/**
 * The hard stop on infinite scroll.
 *
 * A grocery query can match tens of thousands of records and every page of ten
 * costs ten credits. Without a ceiling, one enthusiastic scroll would empty the
 * trial. Five pages = 50 credits for a full scroll.
 */
export function searchMaxPages() {
  const n = Number(process.env.SEARCH_MAX_PAGES ?? 5);
  return Math.max(1, Math.min(Number.isFinite(n) ? Math.floor(n) : 5, 20));
}

export function searchCategory() {
  return (process.env.SEARCH_CATEGORY || 'Grocery & Gourmet Food').trim();
}

/** Free text -> name phrase match, restricted to the category. */
export function buildSearchQuery(term) {
  const clean = String(term || '').replace(/"/g, ' ').trim().slice(0, 120);
  if (!clean) return null;
  return `${buildNameQuery(clean)} AND categories:"${searchCategory()}"`;
}
