import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQuery, searchCategory } from '../src/datafiniti.js';
import { merchantComparison } from '../src/compare.js';

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
