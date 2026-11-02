import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterOffers,
  cheapestPerMerchant,
  merchantBaskets,
  summary,
  normalizeRegion,
  DEFAULT_REGION,
} from '../src/compare.js';

const offer = (merchant, price, extra = {}) => ({
  merchant,
  price,
  currency: 'USD',
  country: 'US',
  ...extra,
});

test('the default market is the US', () => {
  assert.equal(DEFAULT_REGION, 'US');
  assert.equal(normalizeRegion(undefined), 'US');
  assert.equal(normalizeRegion('nonsense'), 'US');
});

test('filterOffers keeps US evidence and drops foreign evidence', () => {
  const offers = [
    offer('Walmart', 5),
    offer('Loblaws', 4, { currency: 'CAD', country: 'CA' }),
    offer('Mystery', 3, { currency: null, country: null }),
  ];
  assert.deepEqual(filterOffers(offers, 'US').map((o) => o.merchant), ['Walmart', 'Mystery']);
  assert.deepEqual(filterOffers(offers, 'CA').map((o) => o.merchant), ['Loblaws', 'Mystery']);
  assert.equal(filterOffers(offers, 'ANY').length, 3);
});

test('cheapestPerMerchant collapses duplicate listings', () => {
  const best = cheapestPerMerchant([offer('Target', 9), offer('Target', 7), offer('Walmart', 8)]);
  assert.deepEqual(best.map((o) => [o.merchant, o.price]), [['Target', 7], ['Walmart', 8]]);
});

test('merchantBaskets totals quantities and records missing lines', () => {
  const items = [
    { upc: '1', name: 'Milk', qty: 2, offers: [offer('Walmart', 7), offer('Target', 8)] },
    { upc: '2', name: 'Bread', qty: 1, offers: [offer('Walmart', 3)] },
  ];
  const baskets = merchantBaskets(items);

  const walmart = baskets.find((b) => b.merchant === 'Walmart');
  assert.equal(walmart.total, 17); // 7*2 + 3
  assert.equal(walmart.covered, 2);
  assert.equal(walmart.missing, 0);
  assert.equal(walmart.fullCoverage, true);
  assert.equal(walmart.currency, 'USD');

  const target = baskets.find((b) => b.merchant === 'Target');
  assert.equal(target.total, 16);
  assert.equal(target.missing, 1);
  assert.equal(target.fullCoverage, false);

  // Full-coverage merchants rank above partial ones regardless of total.
  assert.equal(baskets[0].merchant, 'Walmart');
});

test('summary reports the cheapest full basket and the spread', () => {
  const items = [{ upc: '1', name: 'Milk', qty: 1, offers: [offer('A', 5), offer('B', 8)] }];
  const baskets = merchantBaskets(items);
  const s = summary(items, baskets);
  assert.equal(s.bestTotal, 5);
  assert.equal(s.bestMerchant, 'A');
  assert.equal(s.savings, 3);
  assert.equal(s.fullCoverageMerchants, 2);
  assert.equal(s.currency, 'USD');
});

test('an empty cart produces no baskets and a null best total', () => {
  const s = summary([], merchantBaskets([]));
  assert.equal(s.bestTotal, null);
  assert.equal(s.merchantCount, 0);
});
