import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQuery, searchCategory } from '../src/datafiniti.js';
import { merchantComparison, dedupeProducts } from '../src/compare.js';

// The category pin is the whole point of search here: without it Datafiniti
// happily returns perfume and video mounts for "milk".

test('free text is phrase-matched AND pinned to the category', () => {
  const q = buildSearchQuery('olive oil');
  assert.match(q, /^name:"olive oil"/);
  assert.match(q, /AND categories:"Grocery & Gourmet Food"$/);
});

test('quotes in shopper input cannot break out of the phrase', () => {
  const q = buildSearchQuery('oat "milk"');
  assert.equal(q, 'name:"oat  milk" AND categories:"Grocery & Gourmet Food"');
});

test('empty input produces no query at all', () => {
  assert.equal(buildSearchQuery('   '), null);
});

test('the category is overridable and defaults to the grocery shelf', () => {
  assert.equal(searchCategory(), 'Grocery & Gourmet Food');
});

test('a result summarises the merchant ladder, cheapest first', () => {
  const c = merchantComparison([
    { merchant: 'Target', price: 24.99, currency: 'USD' },
    { merchant: 'walmart.com', price: 22.39, currency: 'USD' },
    { merchant: 'walmart.com', price: 26.0, currency: 'USD' }, // worse listing, same seller
  ]);
  assert.deepEqual(c.merchants.map((m) => m.merchant), ['walmart.com', 'Target']);
  assert.equal(c.merchantCount, 2);
  assert.equal(c.lowPrice, 22.39);
  assert.equal(c.lowMerchant, 'walmart.com');
  assert.equal(c.highPrice, 24.99);
  assert.equal(c.spread, 2.6);
});

test('a single-merchant product has no spread to brag about', () => {
  const c = merchantComparison([{ merchant: 'walmart.com', price: 10, currency: 'USD' }]);
  assert.equal(c.merchantCount, 1);
  assert.equal(c.spread, 0);
});

test('a product nobody sells yields an empty ladder', () => {
  const c = merchantComparison([]);
  assert.equal(c.merchantCount, 0);
  assert.equal(c.lowPrice, null);
  assert.equal(c.spread, null);
  assert.equal(c.currency, 'USD');
});

// Live records duplicate themselves: the same product once with a barcode and
// once with upc:null, at prices that differ by 5x (single vs multipack).
test('duplicate records collapse and their offers union', () => {
  const out = dedupeProducts([
    {
      upc: '850791002352',
      name: 'PB2 Powdered Peanut Butter, 16 oz',
      offers: [{ merchant: 'walmart.com', price: 8.76, url: 'a' }, { merchant: 'Target', price: 14.99, url: 'b' }],
      offersDroppedStale: 2,
    },
    {
      upc: null,
      name: 'PB2 Powdered Peanut Butter, 16 oz',
      offers: [{ merchant: 'walmart.com', price: 47.3, url: 'a' }],
      offersDroppedStale: 0,
    },
  ]);
  assert.equal(out.length, 1);
  // The $47.30 multipack observation is kept - it is a real listing - but it
  // cannot win the ladder, so the merged card still reads $8.76 at Walmart.
  assert.equal(out[0].offers.length, 3);
  const ladder = merchantComparison(out[0].offers);
  assert.equal(ladder.merchantCount, 2);
  assert.equal(ladder.lowPrice, 8.76);
  assert.equal(ladder.highPrice, 14.99);
  assert.equal(out[0].offersDroppedStale, 2);
});

test('identical offers from two records are not double counted', () => {
  const offer = { merchant: 'walmart.com', price: 1.88, url: 'x' };
  const out = dedupeProducts([
    { upc: null, name: 'Marketside Bites', offers: [offer], offersDroppedStale: 0 },
    { upc: '194346616428', name: 'Marketside Bites', offers: [{ ...offer }], offersDroppedStale: 0 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].offers.length, 1);
});

test('different products are not merged just because they share a word', () => {
  const out = dedupeProducts([
    { upc: '1', name: 'Peanut Butter', offers: [] },
    { upc: '2', name: 'Peanut Butter Cookies', offers: [] },
  ]);
  assert.equal(out.length, 2);
});

// Paging: /v4/products/search stops at 10 records, so deeper pages have to go
// through the paginate endpoint. Pinning the URL prevents a silent regression
// to "page 2 returns page 1 again".
test('deeper pages call the paginate endpoint with page and limit', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  process.env.DATAFINITI_API_KEY = 'stub';
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ num_found: 1, total_cost: 3, records: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const { paginate } = await import('../src/datafiniti.js');
    await paginate('name:"milk"', { page: 2, numRecords: 3 });
    assert.match(seen[0], /\/v4\/product\/paginate\?page=2&limit=3$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the page ceiling is configurable and sane', async () => {
  const { searchMaxPages } = await import('../src/datafiniti.js');
  delete process.env.SEARCH_MAX_PAGES;
  assert.equal(searchMaxPages(), 5);
  process.env.SEARCH_MAX_PAGES = '999';
  assert.equal(searchMaxPages(), 20); // clamped, so a typo cannot uncork the trial
  delete process.env.SEARCH_MAX_PAGES;
});
