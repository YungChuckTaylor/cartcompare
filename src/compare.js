/**
 * Basket maths. Deliberately isolated from any provider so it can be unit
 * tested and so swapping Datafiniti for anything else does not touch it.
 */

/**
 * Region filter. In 'CA' mode we keep an offer only when we have positive
 * evidence it is Canadian. Unknown-everything offers are kept, because
 * dropping them would hide exactly the coverage gap we are trying to measure.
 */
export function filterOffers(offers, region) {
  if (!region || region === 'ANY') return offers;
  if (region !== 'CA') return offers;
  return offers.filter((o) => {
    const currency = o.currency ? String(o.currency).toUpperCase() : null;
    const country = o.country ? String(o.country).toUpperCase() : null;
    if (currency && currency !== 'CAD') return false;
    if (country && country !== 'CA') return false;
    return true;
  });
}

/**
 * Cheapest offer per merchant for a single product. A merchant can appear
 * several times in a record (multiple listings, sale + regular); the basket
 * total should use the price a shopper could actually get.
 */
export function cheapestPerMerchant(offers) {
  const best = new Map();
  for (const offer of offers) {
    const key = offer.merchant;
    const current = best.get(key);
    if (!current || offer.price < current.price) best.set(key, offer);
  }
  return [...best.values()].sort((a, b) => a.price - b.price);
}

/**
 * Turn per-item offer lists into per-merchant basket totals.
 *
 * `items` is [{ upc, name, qty, offers }]. A merchant only appears if it
 * carries at least one line. `missing` is the number of lines it cannot fill,
 * which is why the UI should never rank a 2/5 basket against a 5/5 basket
 * without saying so.
 */
export function merchantBaskets(items) {
  const baskets = new Map();

  for (const item of items) {
    const qty = Math.max(1, Number(item.qty) || 1);
    for (const offer of cheapestPerMerchant(item.offers || [])) {
      const key = offer.merchant;
      if (!baskets.has(key)) {
        baskets.set(key, {
          merchant: key,
          domain: offer.domain || null,
          currency: offer.currency || 'CAD',
          total: 0,
          lines: [],
          covered: 0,
          missing: 0,
          newestDate: null,
        });
      }
      const basket = baskets.get(key);
      const lineTotal = Math.round(offer.price * qty * 100) / 100;
      basket.total = Math.round((basket.total + lineTotal) * 100) / 100;
      basket.covered += 1;
      basket.lines.push({
        upc: item.upc,
        name: item.name,
        qty,
        unitPrice: offer.price,
        lineTotal,
        dateSeen: offer.dateSeen || null,
      });
      if (offer.dateSeen && (!basket.newestDate || offer.dateSeen > basket.newestDate)) {
        basket.newestDate = offer.dateSeen;
      }
    }
  }

  const list = [...baskets.values()].map((b) => ({
    ...b,
    missing: items.length - b.covered,
    fullCoverage: b.covered === items.length,
  }));

  list.sort((a, b) => {
    if (a.missing !== b.missing) return a.missing - b.missing;
    return a.total - b.total;
  });
  return list;
}

/** The headline number: what the full cart costs at the best full-coverage store. */
export function summary(items, baskets) {
  const full = baskets.filter((b) => b.fullCoverage);
  const best = full[0] || null;
  const worst = full.length ? full[full.length - 1] : null;
  return {
    itemCount: items.length,
    merchantCount: baskets.length,
    fullCoverageMerchants: full.length,
    bestTotal: best ? best.total : null,
    bestMerchant: best ? best.merchant : null,
    worstTotal: worst ? worst.total : null,
    savings: best && worst ? Math.round((worst.total - best.total) * 100) / 100 : null,
    currency: baskets[0]?.currency || 'CAD',
  };
}
