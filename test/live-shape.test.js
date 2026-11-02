import test from 'node:test';
import assert from 'node:assert/strict';
import { latestDate, cleanMerchant, normalizeRecord } from '../src/datafiniti.js';
import { withinAge, filterOffers } from '../src/compare.js';
import { withId } from '../src/prices.js';

// These lock in shapes observed from the live Datafiniti API on 2026-11-02.
// Every case here was a real bug against real records.

test('dateSeen is an array; the freshest observation wins', () => {
  const iso = latestDate(['2021-09-16T17:09:58Z', '2026-10-26T04:13:51.287Z', '2017-05-23T21:00:00Z']);
  assert.equal(iso, '2026-10-26T04:13:51.287Z');
});

test('dateSeen still accepts a plain string and tolerates junk', () => {
  assert.equal(latestDate('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z');
  assert.equal(latestDate(['not-a-date', null]), null);
  assert.equal(latestDate(undefined), null);
});

test('merchant UI debris is stripped', () => {
  assert.equal(cleanMerchant('Pharmapacks.comLearn moreStore info'), 'Pharmapacks.com');
  assert.equal(cleanMerchant('  Walmart   -  Pharmapacks '), 'Walmart - Pharmapacks');
});

test('a record with several observations keeps them all but stamps each with its freshest date', () => {
  const rec = normalizeRecord({
    name: 'Funyuns Minis Original Chips - 1.125oz',
    upc: '028400758956',
    prices: [{
      amountMin: '1.48',
      currency: 'USD',
      merchant: ['Target', 'walmart.com'],
      dateSeen: ['2025-10-06T14:34:00Z', '2026-11-02T18:48:00Z'],
      sourceURLs: ['https://www.target.com/p/x/-/A-93087160'],
    }],
  });
  assert.equal(rec.offers.length, 2);
  assert.equal(rec.offers[0].price, 1.48); // string -> number
  assert.equal(rec.offers[0].dateSeen, '2026-11-02T18:48:00.000Z');
});

test('stale offers are refused, undated offers are kept', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  const offers = [
    { merchant: 'a', dateSeen: '2017-05-23T21:00:00.000Z' },
    { merchant: 'b', dateSeen: '2026-10-30T00:00:00.000Z' },
    { merchant: 'c', dateSeen: null },
  ];
  const kept = withinAge(offers, 180, now);
  assert.deepEqual(kept.map((o) => o.merchant), ['b', 'c']);
  assert.equal(withinAge(offers, 0, now).length, 3); // gate disabled
});

test('non-USD offers are dropped from a US comparison', () => {
  const offers = [
    { merchant: 'uk', currency: 'GBP', country: null },
    { merchant: 'fr', currency: 'EUR', country: null },
    { merchant: 'us', currency: 'USD', country: null },
  ];
  assert.deepEqual(filterOffers(offers, 'US').map((o) => o.merchant), ['us']);
});

test('a product with no barcode still gets a usable cart id', () => {
  assert.equal(withId({ upc: null, name: 'Leitz Cine HUGO iD Mount' }).id, 'name:Leitz Cine HUGO iD Mount');
  assert.equal(withId({ upc: '028400758956', name: 'x' }).id, '028400758956');
});
