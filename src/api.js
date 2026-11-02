import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, num } from './env.js';
import { createPriceService } from './prices.js';
import {
  filterOffers,
  withinAge,
  cheapestPerMerchant,
  merchantComparison,
  dedupeProducts,
  merchantBaskets,
  summary,
  normalizeRegion,
  REGIONS,
  DEFAULT_REGION,
} from './compare.js';

function round2(n) {
  return Math.round(n * 100) / 100;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);

export const MARKET = DEFAULT_REGION;

let service = null;

/** One service per process. Warm lambdas keep their cache and ledger. */
export function getPriceService() {
  if (!service) {
    service = createPriceService({
      cacheTtlMs: num(process.env.CACHE_TTL_HOURS, 24) * 3600 * 1000,
    });
  }
  return service;
}

function warningsFor(mode, items, region) {
  const notes = [];
  const regionLabel = REGIONS[region]?.label || 'this region';

  if (mode === 'demo') {
    notes.push({
      level: 'info',
      text: 'Demo dataset — synthetic US prices, no Datafiniti key set. Nothing here is a real price.',
    });
  }
  if (mode === 'live') {
    notes.push({
      level: 'warn',
      text: 'Live Datafiniti data: scraped online listing prices, not in-store shelf prices. Verify before displaying to anyone.',
    });
    const noOffers = items.filter((i) => !i.offers.length).length;
    if (noOffers) {
      notes.push({
        level: 'warn',
        text: `${noOffers} of ${items.length} cart lines returned no price in ${regionLabel}. That is the coverage question, answered.`,
      });
    }
  }
  return notes;
}

async function buildComparison(prices, body) {
  const requested = Array.isArray(body?.items) ? body.items : [];
  if (!requested.length) {
    return { status: 400, body: { error: 'Send { items: [{ id | upc, qty }] }' } };
  }
  if (requested.length > 25) {
    return { status: 400, body: { error: 'Cart is capped at 25 lines in the MVP.' } };
  }

  const region = normalizeRegion(body?.region);
  let spent = 0;
  let droppedStale = 0;
  const lines = [];

  for (const entry of requested) {
    // `id` is a barcode or `name:<product name>`, because real Datafiniti records
    // frequently have no barcode at all.
    const upc = String(entry.id || entry.upc || '').trim();
    if (!upc) continue;
    const qty = Math.min(20, Math.max(1, Number(entry.qty) || 1));

    const { product, credits } = await prices.lookupUpc(upc, { name: entry.name || null });
    spent += credits || 0;

    const base = product || {
      upc,
      name: entry.name || `Unknown product ${upc}`,
      brand: null,
      category: null,
      offers: [],
      source: prices.mode(),
    };
    const regional = filterOffers(base.offers || [], region);
    const offers = withinAge(regional, prices.offerMaxAgeDays);
    droppedStale += regional.length - offers.length;

    lines.push({
      upc,
      name: base.name,
      brand: base.brand,
      category: base.category,
      qty,
      source: base.source,
      offers,
      offersDroppedStale: regional.length - offers.length,
      cheapest: cheapestPerMerchant(offers)[0] || null,
    });
  }

  const baskets = merchantBaskets(lines);
  const mode = prices.mode();

  return {
    status: 200,
    body: {
      mode,
      market: region,
      region,
      generatedAt: new Date().toISOString(),
      credits: { thisRequest: spent, ...prices.credits() },
      freshness: { maxAgeDays: prices.offerMaxAgeDays, offersDroppedStale: droppedStale },
      warnings: warningsFor(mode, lines, region),
      items: lines,
      baskets,
      summary: summary(lines, baskets),
    },
  };
}

/**
 * Platform-neutral request handler. Used by the local HTTP server and by the
 * Vercel serverless function, so there is exactly one implementation of the
 * API surface.
 */
export async function handleRequest({ method = 'GET', pathname, query = {}, body = null }) {
  const prices = getPriceService();
  const route = String(pathname || '').replace(/\/+$/, '') || '/';

  if (route === '/api/health') {
    return {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        ok: true,
        mode: prices.mode(),
        market: MARKET,
        region: MARKET,
        credits: prices.credits(),
      },
    };
  }

  if (route === '/api/search') {
    const result = await prices.search(query.q || '');
    // The suggestion list shows one headline price per product. If that price
    // were a 2017 observation, or a GBP offer on a US screen, the list would
    // contradict the cart view - so search obeys the same two gates. Products
    // left with no offer are kept (they are a coverage answer) but sorted last.
    const items = (result.items || [])
      .map((item) => {
        const regional = filterOffers(item.offers || [], MARKET);
        const offers = withinAge(regional, prices.offerMaxAgeDays);
        return {
          ...item,
          offers,
          offersDroppedStale: regional.length - offers.length,
          // The search result IS a price comparison between merchants, so the
          // ladder is computed server side rather than left to the client.
          ...merchantComparison(offers),
        };
      })
      // A product nobody sells at a US price cannot be compared, so it is not a
      // result. Counted, though, so the emptiness is explainable.
      .filter((item) => item.merchantCount > 0);

    const deduped = dedupeProducts(items);
    for (const item of deduped) Object.assign(item, merchantComparison(item.offers));
    deduped.sort((a, b) => b.merchantCount - a.merchantCount || a.lowPrice - b.lowPrice);

    return {
      status: 200,
      body: {
        ...result,
        items: deduped,
        market: MARKET,
        category: prices.searchCategory(),
        uncomparable: Math.max(0, (result.items || []).length - items.length),
        duplicates: items.length - deduped.length,
        // When even the best match is sold by one retailer there is no ladder to
        // draw. Say it once, at the top, instead of on every card.
        singleMerchantOnly: deduped.length > 0 && deduped.every((item) => item.merchantCount < 2),
      },
    };
  }

  if (route === '/api/catalog') {
    return { status: 200, body: { items: prices.demoCatalog.items, market: MARKET } };
  }

  if (route === '/api/compare') {
    if (method !== 'POST') {
      // Read-only form of the same call, for verification and for anything that
      // cannot POST. It spends credits, so it is off unless explicitly enabled:
      // an open GET would let a crawler burn the trial balance via URLs.
      if (process.env.ALLOW_GET_COMPARE === '1') {
        const items = String(query.items || '')
          .split(',')
          .map((chunk) => chunk.trim())
          .filter(Boolean)
          .map((chunk) => {
            const [id, qty] = chunk.split(':');
            return { id, qty: Number(qty) || 1 };
          });
        return buildComparison(prices, { items, region: query.region });
      }
      return { status: 405, body: { error: 'Use POST' } };
    }
    return buildComparison(prices, body);
  }

  return { status: 404, body: { error: `No route for ${pathname}` } };
}
