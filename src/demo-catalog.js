/**
 * SYNTHETIC DEMO CATALOGUE — US MARKET.
 *
 * Prices, barcodes and offer spread here are invented for UI development.
 * They are NOT Datafiniti records and NOT real shelf prices. The UI shows a
 * banner saying so, and /api/health reports mode: "demo" so nothing can be
 * mistaken for live pricing.
 *
 * Kept as a JS module rather than JSON on purpose: it survives serverless
 * bundling without any file-system or import-attribute assumptions.
 */
export const demoCatalog = {
  market: 'US',
  currency: 'USD',
  generatedAt: '2026-11-02',
  note: 'SYNTHETIC DEMO DATA. Invented for UI development. Not Datafiniti data, not real prices.',
  merchants: [
    { name: 'Walmart', domain: 'walmart.com', country: 'US' },
    { name: 'Target', domain: 'target.com', country: 'US' },
    { name: 'Kroger', domain: 'kroger.com', country: 'US' },
    { name: 'Safeway', domain: 'safeway.com', country: 'US' },
    { name: 'Whole Foods Market', domain: 'wholefoodsmarket.com', country: 'US' },
    { name: 'Amazon', domain: 'amazon.com', country: 'US' },
    { name: 'Costco', domain: 'costco.com', country: 'US' },
    { name: 'Best Buy', domain: 'bestbuy.com', country: 'US' },
    { name: 'CVS', domain: 'cvs.com', country: 'US' },
  ],
  items: [
    {
      upc: '704700123456',
      name: 'Horizon Organic Whole Milk',
      brand: 'Horizon Organic',
      category: 'Dairy',
      size: '1/2 gal',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 5.48, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 5.79, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 5.29, currency: 'USD', dateSeen: '2026-11-01', isSale: true, country: 'US' },
        { merchant: 'Safeway', domain: 'safeway.com', price: 5.99, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Whole Foods Market', domain: 'wholefoodsmarket.com', price: 6.49, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '016000275430',
      name: 'Cheerios Original Cereal',
      brand: 'General Mills',
      category: 'Breakfast',
      size: '12 oz',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 4.48, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 4.99, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 4.29, currency: 'USD', dateSeen: '2026-11-01', isSale: true, country: 'US' },
        { merchant: 'Safeway', domain: 'safeway.com', price: 4.79, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Amazon', domain: 'amazon.com', price: 5.29, currency: 'USD', dateSeen: '2026-10-29', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '021000658831',
      name: 'Kraft Original Macaroni & Cheese Dinner',
      brand: 'Kraft',
      category: 'Pantry',
      size: '7.25 oz',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 1.24, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 1.39, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 1.19, currency: 'USD', dateSeen: '2026-11-01', isSale: true, country: 'US' },
        { merchant: 'Safeway', domain: 'safeway.com', price: 1.49, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Amazon', domain: 'amazon.com', price: 1.98, currency: 'USD', dateSeen: '2026-10-29', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '037000352614',
      name: 'Tide Original Liquid Laundry Detergent',
      brand: 'Tide',
      category: 'Household',
      size: '92 fl oz / 64 loads',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 12.94, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 13.99, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 12.49, currency: 'USD', dateSeen: '2026-11-01', isSale: true, country: 'US' },
        { merchant: 'Costco', domain: 'costco.com', price: 11.99, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Amazon', domain: 'amazon.com', price: 13.49, currency: 'USD', dateSeen: '2026-10-29', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '030772048834',
      name: 'Bounty Select-A-Size Paper Towels',
      brand: 'Bounty',
      category: 'Household',
      size: '6 double rolls',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 14.97, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 15.99, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 14.49, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Costco', domain: 'costco.com', price: 13.99, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '037000975610',
      name: 'Dawn Ultra Dish Soap',
      brand: 'Dawn',
      category: 'Household',
      size: '19.4 fl oz',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 4.24, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 4.49, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 3.99, currency: 'USD', dateSeen: '2026-10-30', isSale: true, country: 'US' },
        { merchant: 'Amazon', domain: 'amazon.com', price: 4.12, currency: 'USD', dateSeen: '2026-10-29', isSale: false, country: 'US' },
        { merchant: 'CVS', domain: 'cvs.com', price: 5.29, currency: 'USD', dateSeen: '2026-10-28', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '049000006346',
      name: 'Coca-Cola Classic Cans',
      brand: 'Coca-Cola',
      category: 'Beverages',
      size: '12 x 12 fl oz',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 7.48, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 7.99, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 6.99, currency: 'USD', dateSeen: '2026-11-01', isSale: true, country: 'US' },
        { merchant: 'Safeway', domain: 'safeway.com', price: 8.49, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Costco', domain: 'costco.com', price: 6.49, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '028400001852',
      name: "Lay's Classic Potato Chips",
      brand: "Lay's",
      category: 'Snacks',
      size: '8 oz',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 4.28, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 4.49, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 3.99, currency: 'USD', dateSeen: '2026-10-30', isSale: true, country: 'US' },
        { merchant: 'Safeway', domain: 'safeway.com', price: 4.99, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '076808506484',
      name: 'Barilla Spaghetti',
      brand: 'Barilla',
      category: 'Pantry',
      size: '16 oz',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 1.68, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 1.79, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 1.49, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Safeway', domain: 'safeway.com', price: 1.89, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '041570054438',
      name: 'Blue Diamond Almonds Whole Natural',
      brand: 'Blue Diamond',
      category: 'Snacks',
      size: '16 oz',
      offers: [
        { merchant: 'Walmart', domain: 'walmart.com', price: 8.98, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 9.49, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Kroger', domain: 'kroger.com', price: 8.79, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Amazon', domain: 'amazon.com', price: 8.49, currency: 'USD', dateSeen: '2026-10-29', isSale: false, country: 'US' },
        { merchant: 'Costco', domain: 'costco.com', price: 7.99, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '848061065640',
      name: 'Anker PowerCore 10,000 mAh Power Bank',
      brand: 'Anker',
      category: 'Electronics',
      size: '10,000 mAh',
      offers: [
        { merchant: 'Amazon', domain: 'amazon.com', price: 25.99, currency: 'USD', dateSeen: '2026-11-01', isSale: true, country: 'US' },
        { merchant: 'Best Buy', domain: 'bestbuy.com', price: 29.99, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Walmart', domain: 'walmart.com', price: 27.49, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 28.99, currency: 'USD', dateSeen: '2026-10-30', isSale: false, country: 'US' },
      ],
    },
    {
      upc: '190198910274',
      name: 'Apple AirPods (2nd generation)',
      brand: 'Apple',
      category: 'Electronics',
      size: 'with charging case',
      offers: [
        { merchant: 'Best Buy', domain: 'bestbuy.com', price: 99.99, currency: 'USD', dateSeen: '2026-11-01', isSale: false, country: 'US' },
        { merchant: 'Amazon', domain: 'amazon.com', price: 89.99, currency: 'USD', dateSeen: '2026-11-01', isSale: true, country: 'US' },
        { merchant: 'Walmart', domain: 'walmart.com', price: 94.0, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Target', domain: 'target.com', price: 99.99, currency: 'USD', dateSeen: '2026-10-31', isSale: false, country: 'US' },
        { merchant: 'Costco', domain: 'costco.com', price: 89.99, currency: 'USD', dateSeen: '2026-10-29', isSale: false, country: 'US' },
      ],
    },
  ],
};

export default demoCatalog;
