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
const MAX_RECORDS = 10; // API ceiling for non-download searches

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

/**
 * Raw search. Returns the HTTP body plus the numbers you need to reason about
 * money: `numFound` is FREE, `credits` is what this call actually cost you.
 */
export async function search(query, { numRecords = 10, timeoutMs = 25000 } = {}) {
  if (!hasCredentials()) {
    throw new Error('DATAFINITI_API_KEY is not set');
  }
  const records = Math.max(1, Math.min(numRecords, MAX_RECORDS));
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DATAFINITI_API_KEY.trim()}`,
    },
    body: JSON.stringify({ query, num_records: records, format: 'JSON', download: false }),
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

    const sellers = names.length ? names.map(String) : [domain || null];
    for (const seller of sellers) {
      const meta = seller ? merchantMeta.get(seller.toLowerCase()) || {} : {};
      offers.push({
        merchant: seller || 'Unlisted seller',
        domain: domain || (meta.website ? safeHost(meta.website) : null),
        price: amount,
        currency: (p.currency || 'USD').toUpperCase(),
        dateSeen: p.dateSeen || record.mostRecentPriceUpdate || null,
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
