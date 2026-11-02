import fs from 'node:fs';
import path from 'node:path';

/**
 * Demo provider.
 *
 * This exists for one reason: the app has to be runnable and demoable with a
 * $0 budget and no API key. It serves a synthetic catalogue so the UI, the
 * basket maths and the comparison layout can be built and reviewed before a
 * single free-trial credit is spent.
 *
 * Every response from here is tagged source: "demo" and the UI shows a banner.
 * Never ship this data as if it were real prices.
 */
export function createDemoProvider(dataDir) {
  const file = path.join(dataDir, 'demo-catalog.json');
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));

  return {
    mode: 'demo',
    catalog,
    search(query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return catalog.items.slice(0, 6);
      return catalog.items
        .filter((item) => {
          const haystack = [item.name, item.brand, item.upc, item.category, item.size]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return q.split(/\s+/).every((token) => haystack.includes(token));
        })
        .slice(0, 12);
    },
    byUpc(upc) {
      return catalog.items.find((item) => item.upc === String(upc)) || null;
    },
    asProduct(item) {
      return {
        upc: item.upc,
        name: item.name,
        brand: item.brand,
        category: item.category,
        size: item.size,
        image: null,
        source: 'demo',
        offers: item.offers.map((offer) => ({ ...offer, source: 'demo' })),
      };
    },
  };
}
