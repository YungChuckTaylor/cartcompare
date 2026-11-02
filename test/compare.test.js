import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOffers, cheapestPerMerchant, merchantBaskets, summary } from '../src/compare.js';

const offer = (merchant, price, extra = {}) => ({
  merchant,
  price,
  currency: 'CAD',
  country: 'CA',
  ...extra,
});

test('filterOffers keeps Canadian evidence and drops foreign evidence', () => {
  const offers = [
    offer('Loblaws', 5),
    offer('Walmart US', 4, { currency: 'USD', country: 'US' }),
    offer('Mystery', 3, { currency: null, country: null }),
  ];
  assert.deepEqual(filterOffers(offers, 'CA').map((o) => o.merchant), ['Loblaws', 'Mystery']);
  assert.equal(filterOffers(offers, 'ANY').length, 3);
});

test('cheapestPerMerchant collapses duplicate listings', () => {
  const best = cheapestPerMerchant([offer('Metro', 9), offer('Metro', 7), offer('Loblaws', 8)]);
  assert.deepEqual(best.map((o) => [o.merchant, o.price]), [['Metro', 7], ['Loblaws', 8]]);
});

test('merchantBaskets totals quantities and records missing lines', () => {
  const items = [
    { upc: '1', name: 'Milk', qty: 2, offers: [offer('Loblaws', 7), offer('Metro', 8)] },
    { upc: '2', name: 'Bread', qty: 1, offers: [offer('Loblaws', 3)] },
  ];
  const baskets = merchantBaskets(items);

  const loblaws = baskets.find((b) => b.merchant === 'Loblaws');
  assert.equal(loblaws.total, 17); // 7*2 + 3
  assert.equal(loblaws.covered, 2);
  assert.equal(loblaws.missing, 0);
  assert.equal(loblaws.fullCoverage, true);

  const metro = baskets.find((b) => b.merchant === 'Metro');
  assert.equal(metro.total, 16);
  assert.equal(metro.missing, 1);
  assert.equal(metro.fullCoverage, false);

  // Full-coverage merchants rank above partial ones regardless of total.
  assert.equal(baskets[0].merchant, 'Loblaws');
});

test('summary reports the cheapest full basket and the spread', () => {
  const items = [
    { upc: '1', name: 'Milk', qty: 1, offers: [offer('A', 5), offer('B', 8)] },
  ];
  const baskets = merchantBaskets(items);
  const s = summary(items, baskets);
  assert.equal(s.bestTotal, 5);
  assert.equal(s.bestMerchant, 'A');
  assert.equal(s.savings, 3);
  assert.equal(s.fullCoverageMerchants, 2);
});

test('an empty cart produces no baskets and a null best total', () => {
  const s = summary([], merchantBaskets([]));
  assert.equal(s.bestTotal, null);
  assert.equal(s.merchantCount, 0);
});
