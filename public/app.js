/* CartCompare MVP — vanilla client. No build step, no framework, on purpose. */

const state = {
  cart: new Map(), // id -> { upc, id, name, brand, size, qty }
  products: new Map(), // id -> product from search (for display only)
  comparison: null,
  mode: 'demo',
  busy: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  modePill: $('mode-pill'),
  credits: $('credits'),
  banners: $('banners'),
  q: $('q'),
  suggestions: $('suggestions'),
  scope: $('scope'),
  cart: $('cart'),
  cartCount: $('cart-count'),
  regionUS: $('region-us'),
  strict: $('strict'),
  clear: $('clear'),
  summary: $('summary'),
  baskets: $('baskets'),
  matrix: $('matrix'),
  provider: $('provider'),
};

/* ---------- formatting ---------- */
const moneyFmt = {};
function money(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(amount)) return '—';
  const cur = String(currency || 'USD').toUpperCase();
  if (!moneyFmt[cur]) {
    moneyFmt[cur] = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: cur,
      currencyDisplay: 'narrowSymbol',
    });
  }
  try {
    return moneyFmt[cur].format(amount);
  } catch {
    return `${cur} ${amount.toFixed(2)}`;
  }
}

function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/* ---------- cheapest-per-merchant, client side ---------- */
function priceMap(offers) {
  const map = new Map();
  for (const offer of offers || []) {
    const current = map.get(offer.merchant);
    if (!current || offer.price < current.price) map.set(offer.merchant, offer);
  }
  return map;
}

/* ---------- data ---------- */
async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function loadHealth() {
  try {
    const h = await api('/api/health');
    state.mode = h.mode;
    setMode(h.mode, h.credits);
  } catch (err) {
    banner('error', `Server not reachable: ${esc(err.message)}`);
  }
}

function setMode(mode, credits) {
  els.modePill.textContent = mode === 'live' ? 'Live · Datafiniti' : 'Demo data';
  els.modePill.className = `pill ${mode === 'live' ? 'live' : 'demo'}`;
  els.provider.textContent =
    mode === 'live' ? 'Datafiniti Product Data API (v4)' : 'Synthetic demo catalogue';
  if (credits) els.credits.textContent = `${credits.total} / ${credits.budget} credits`;
}

function banner(level, html) {
  const el = document.createElement('div');
  el.className = `banner ${level}`;
  el.innerHTML = `<div>${html}</div>`;
  els.banners.appendChild(el);
}

function clearBanners() {
  els.banners.innerHTML = '';
}

/* ---------- search ---------- */

const search = {
  seq: 0,        // bumps on every new query; stale responses are dropped
  q: '',
  page: 0,
  hasMore: false,
  loading: false,
  maxPages: 0,
  total: 0,
  shown: 0,
  seen: new Set(),
};

const MIN_QUERY = 3; // every distinct query is billable on a cache miss
let searchTimer = null;

function resetResults() {
  els.suggestions.innerHTML = '';
  els.suggestions.scrollTop = 0;
  search.seq += 1;
  search.q = '';
  search.page = 0;
  search.hasMore = false;
  search.loading = false;
  search.maxPages = 0;
  search.total = 0;
  search.shown = 0;
  search.seen = new Set();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 220);
}

async function runSearch() {
  const q = els.q.value.trim();
  resetResults();
  if (!q || q.length < MIN_QUERY) return;

  search.q = q;
  await loadPage(1, search.seq);
}

async function loadPage(page, seq) {
  if (search.loading) return;
  search.loading = true;
  search.error = null;
  renderFooter();

  try {
    const result = await api(
      `/api/search?q=${encodeURIComponent(search.q)}&page=${encodeURIComponent(page)}`,
    );
    if (seq !== search.seq) return;
    state.mode = result.mode;
    search.page = result.page ?? page;
    search.hasMore = Boolean(result.hasMore);
    search.maxPages = result.maxPages || 0;
    search.total = result.numFound || search.total;
    if (page === 1) setScope(result);
    appendItems(result.items || []);
  } catch (err) {
    if (seq !== search.seq) return;
    search.hasMore = false;
    search.error = err.message;
  } finally {
    if (seq === search.seq) {
      search.loading = false;
      renderFooter();
    }
  }
}

function newestDate(offers) {
  let best = null;
  for (const o of offers || []) {
    const t = o.dateSeen ? Date.parse(o.dateSeen) : NaN;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

function setScope(meta) {
  els.scope.innerHTML = meta.singleMerchantOnly
    ? `<span class="warn">No product in this page is sold by more than one merchant</span> · <b>${esc(meta.category)}</b>`
    : `Price comparison across merchants · <b>${esc(meta.category)}</b>`;
}

/**
 * One search result = one product = one price comparison between merchants.
 * The ladder is built server side (item.merchants), so this only has to render
 * it: cheapest merchant first, the rest behind it, and an honest label when
 * there is only one seller and therefore nothing to compare.
 */
function cardFor(item) {
  const merchants = item.merchants || [];
  const shown = merchants.slice(0, 3);
  const rest = merchants.length - shown.length;
  const seen = newestDate(item.offers);

  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'res';
  btn.type = 'button';

  const chips = shown
    .map(
      (m, idx) =>
        `<span class="mk${idx === 0 ? ' best' : ''}">
           <em>${esc(m.merchant)}</em>
           <b>${money(m.price, m.currency)}</b>
         </span>`,
    )
    .join('');

  const more = rest > 0 ? `<span class="mk more">+${rest} more</span>` : '';
  const one = merchants.length === 1;

  const foot = one
    ? `<span class="single">1 merchant</span>
       <span class="rng">${money(item.lowPrice, item.currency)}</span>`
    : `<span><b>${merchants.length}</b> merchants</span>
       <span class="rng">${money(item.lowPrice, item.currency)}–${money(item.highPrice, item.currency)} · save ${money(item.spread, item.currency)}</span>`;

  btn.innerHTML = `
    <span class="res-h">
      <span class="res-n">${esc(item.name)}</span>
      <span class="res-add">+ Add</span>
    </span>
    <span class="res-sub">${esc([item.brand, item.upc ? item.upc : 'no barcode'].filter(Boolean).join(' · '))}</span>
    <span class="mks">${chips}${more}</span>
    <span class="res-foot">
      ${foot}
      <span class="seen">${seen ? `seen ${shortDate(seen)}` : ''}</span>
    </span>`;

  btn.addEventListener('click', () => {
    state.products.set(item.id || item.upc, item);
    addToCart(item);
    els.q.value = '';
    resetResults();
    els.q.focus();
  });

  li.appendChild(btn);
  return li;
}

function appendItems(items) {
  for (const item of items) {
    const id = item.id || item.upc || item.name;
    if (search.seen.has(id)) continue; // pages can overlap; never show a product twice
    search.seen.add(id);
    els.suggestions.appendChild(cardFor(item));
    search.shown += 1;
  }
}

/** The row under the cards: a load-more button, a spinner, or the end. */
function renderFooter() {
  for (const node of els.suggestions.querySelectorAll('.more-row')) node.remove();
  if (!search.shown && !search.loading) return;

  const li = document.createElement('li');
  li.className = 'more-row';

  if (search.loading) {
    li.innerHTML = '<span class="muted">Loading…</span>';
  } else if (search.error) {
    li.innerHTML = `<span class="err">${esc(search.error)}</span>`;
  } else if (search.hasMore) {
    li.innerHTML = `
      <button class="more-btn" type="button">Load more</button>
      <span class="muted">${search.shown} of ${search.total.toLocaleString('en-US')} shown</span>`;
    li.querySelector('.more-btn').addEventListener('click', () => loadPage(search.page + 1, search.seq));
  } else if (search.maxPages && search.total > search.shown) {
    li.innerHTML = `<span class="muted">${search.shown} of ${search.total.toLocaleString('en-US')} shown · stopped at the ${search.maxPages}-page search limit</span>`;
  } else {
    li.innerHTML = `<span class="muted">End of results · ${search.shown} shown</span>`;
  }

  els.suggestions.appendChild(li);
}

// Scrolling to the bottom of the result list pulls the next page. Deliberately
// not an IntersectionObserver: a sentinel that is already visible would fire on
// mount and spend every page's credits without anyone asking.
els.suggestions.addEventListener('scroll', () => {
  if (!search.hasMore || search.loading) return;
  const el = els.suggestions;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 64) {
    loadPage(search.page + 1, search.seq);
  }
});

/* ---------- cart ---------- */
function addToCart(item) {
  const id = item.id || item.upc;
  const existing = state.cart.get(id);
  if (existing) {
    existing.qty = Math.min(20, existing.qty + 1);
  } else {
    state.cart.set(id, {
      upc: id,
      id,
      name: item.name,
      brand: item.brand,
      size: item.size,
      qty: 1,
    });
  }
  renderCart();
  refresh();
}

function setQty(upc, delta) {
  const line = state.cart.get(upc);
  if (!line) return;
  line.qty = Math.min(20, Math.max(1, line.qty + delta));
  renderCart();
  refresh();
}

function removeLine(upc) {
  state.cart.delete(upc);
  renderCart();
  refresh();
}

function renderCart() {
  els.cart.innerHTML = '';
  for (const line of state.cart.values()) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="n">${esc(line.name)}</div>
      <button class="x" type="button" aria-label="Remove ${esc(line.name)}">×</button>
      <div class="m">${esc([line.brand, line.size].filter(Boolean).join(' · ') || line.upc)}</div>
      <div class="qty">
        <button type="button" data-act="dec" aria-label="Fewer">−</button>
        <span>${line.qty}</span>
        <button type="button" data-act="inc" aria-label="More">+</button>
      </div>`;
    li.querySelector('[data-act="dec"]').addEventListener('click', () => setQty(line.upc, -1));
    li.querySelector('[data-act="inc"]').addEventListener('click', () => setQty(line.upc, 1));
    li.querySelector('.x').addEventListener('click', () => removeLine(line.upc));
    els.cart.appendChild(li);
  }
  const n = state.cart.size;
  const units = [...state.cart.values()].reduce((sum, l) => sum + l.qty, 0);
  els.cartCount.textContent = n ? `${n} line${n === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}` : '0 items';
}

/* ---------- comparison ---------- */
async function refresh() {
  if (!state.cart.size) {
    state.comparison = null;
    renderResults();
    return;
  }
  state.busy = true;
  try {
    const body = await api('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [...state.cart.values()].map((l) => ({ id: l.id || l.upc, qty: l.qty, name: l.name })),
        region: els.regionUS.checked ? 'US' : 'ANY',
      }),
    });
    state.comparison = body;
    state.mode = body.mode;
    setMode(body.mode, body.credits);
    clearBanners();
    for (const w of body.warnings || []) banner(w.level, esc(w.text));
    renderResults();
  } catch (err) {
    clearBanners();
    banner('error', `Comparison failed: ${esc(err.message)}`);
  } finally {
    state.busy = false;
  }
}

function visibleBaskets() {
  const data = state.comparison;
  if (!data) return [];
  return els.strict.checked ? data.baskets.filter((b) => b.fullCoverage) : data.baskets;
}

function renderResults() {
  const data = state.comparison;

  const existingPlaceholder = document.getElementById('results-placeholder');

  if (!data) {
    els.summary.innerHTML = '';
    els.baskets.innerHTML = '';
    els.matrix.innerHTML = '';
    els.baskets.style.display = 'none';
    els.summary.style.display = 'none';
    els.matrix.closest('.tw').style.display = 'none';
    if (!existingPlaceholder) {
      const ph = document.createElement('div');
      ph.id = 'results-placeholder';
      ph.className = 'placeholder';
      ph.innerHTML = '<b>No cart yet</b>Add two or three products on the left and this panel fills with a basket comparison.';
      els.baskets.parentNode.insertBefore(ph, els.baskets);
    }
    return;
  }
  existingPlaceholder?.remove();
  els.baskets.style.display = '';
  els.summary.style.display = '';
  els.matrix.closest('.tw').style.display = '';

  renderSummary(data);
  renderBaskets();
  renderMatrix();
}

function renderSummary(data) {
  const baskets = visibleBaskets();
  const full = baskets.filter((b) => b.fullCoverage);
  const total = data.items.length;

  if (!baskets.length) {
    els.summary.className = 'summary muted';
    els.summary.innerHTML = `<div class="note"><span class="lbl">No comparable basket</span>
      ${els.strict.checked
        ? 'No single store carries every line in this cart. Untick “only stores carrying the whole cart” to see partial baskets.'
        : 'No store returned a price for any line in this cart.'}</div>`;
    return;
  }

  if (full.length) {
    const best = full[0];
    const spread =
      full.length > 1 ? Math.round((full[full.length - 1].total - best.total) * 100) / 100 : null;
    els.summary.className = 'summary';
    els.summary.innerHTML = `
      <div>
        <span class="lbl">Cheapest full cart</span>
        <span class="big">${money(best.total, best.currency)}</span>
        <span class="note" style="display:block;font-size:12px;color:var(--mid);margin-top:2px">at ${esc(best.merchant)}</span>
      </div>
      <div class="note">${full.length} of ${baskets.length} stores shown can fill all ${total} lines${
        spread && spread > 0.01 ? ` — a ${money(spread, best.currency)} spread between the best and worst full cart` : ''
      }.</div>`;
    return;
  }

  const leader = baskets[0];
  els.summary.className = 'summary muted';
  els.summary.innerHTML = `
    <div>
      <span class="lbl">Best partial basket</span>
      <span class="big">${money(leader.total, leader.currency)}</span>
      <span class="note" style="display:block;font-size:12px;color:var(--mid);margin-top:2px">at ${esc(leader.merchant)}</span>
    </div>
    <div class="note">Covers ${leader.covered} of ${total} lines. No store in this region fills the whole cart — that gap is the product.</div>`;
}

function renderBaskets() {
  const baskets = visibleBaskets();
  els.baskets.innerHTML = '';
  baskets.forEach((basket, index) => {
    const isBest = index === 0 && (basket.fullCoverage || !els.strict.checked);
    const card = document.createElement('article');
    card.className = `basket${isBest ? ' best' : ''}`;
    const seen = shortDate(basket.newestDate);
    const tag = basket.fullCoverage
      ? '<span class="tag full">Full cart</span>'
      : `<span class="tag part">${basket.covered}/${state.comparison.items.length} items</span>`;
    card.innerHTML = `
      <div class="mk"><span class="rank">${index + 1}</span><span>${esc(basket.merchant)}</span></div>
      <div class="tot">${money(basket.total, basket.currency)}</div>
      <div class="cov">${basket.covered} of ${state.comparison.items.length} lines${seen ? ` · prices seen ${seen}` : ''}</div>
      ${tag}
      ${isBest ? '<span class="tag win">Lowest</span>' : ''}`;
    els.baskets.appendChild(card);
  });
}

function renderMatrix() {
  const data = state.comparison;
  if (!data) return;
  const baskets = visibleBaskets();
  const merchants = baskets.map((b) => b.merchant);
  if (!merchants.length) {
    els.matrix.innerHTML = '';
    return;
  }

  const head = ['<thead><tr><th>Item</th>'];
  for (const m of merchants) head.push(`<th>${esc(m)}</th>`);
  head.push('</tr></thead>');

  const rows = [];
  const totals = new Map(merchants.map((m) => [m, { sum: 0, count: 0 }]));

  for (const item of data.items) {
    const prices = priceMap(item.offers);
    const rowPrices = merchants.map((m) => prices.get(m)).filter(Boolean);
    const min = rowPrices.length ? Math.min(...rowPrices.map((p) => p.price)) : null;

    const cells = merchants.map((merchant) => {
      const offer = prices.get(merchant);
      if (!offer) return '<td class="cell none">—</td>';
      const total = offer.price * item.qty;
      const t = totals.get(merchant);
      t.sum += total;
      t.count += 1;
      const isBest = offer.price === min;
      const val = money(offer.price, offer.currency);
      return `<td class="cell${isBest ? ' best' : ''}">${val}${
        item.qty > 1 ? `<br><small style="color:var(--soft);font-weight:400">${money(total, offer.currency)}</small>` : ''
      }</td>`;
    });

    rows.push(`<tr>
      <td class="itemname">${esc(item.name)}${item.qty > 1 ? ` <small>× ${item.qty}</small>` : ''}
        ${item.brand ? `<small>${esc(item.brand)}</small>` : ''}</td>
      ${cells.join('')}
    </tr>`);
  }

  const currencyOf = new Map(baskets.map((b) => [b.merchant, b.currency]));
  const totalCells = merchants.map((m) => {
    const t = totals.get(m);
    if (!t.count) return '<td class="cell none">—</td>';
    const covered = data.items.filter((i) => priceMap(i.offers).has(m)).length;
    return `<td>${money(t.sum, currencyOf.get(m) || 'USD')}<br><small style="color:var(--soft);font-weight:600">${covered}/${data.items.length} items</small></td>`;
  });

  els.matrix.innerHTML = `${head.join('')}<tbody>${rows.join('')}
    <tr class="total"><td>Basket total</td>${totalCells.join('')}</tr></tbody>`;
}

/* ---------- wiring ---------- */
els.q.addEventListener('input', onSearchInput);
els.q.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.suggestions.querySelector('.sugg')?.click();
  }
});
els.regionUS.addEventListener('change', refresh);
els.strict.addEventListener('change', () => {
  if (!state.comparison) return;
  renderSummary(state.comparison);
  renderBaskets();
  renderMatrix();
});
els.clear.addEventListener('click', () => {
  state.cart.clear();
  renderCart();
  refresh();
});

renderCart();
renderResults();
loadHealth().then(runSearch);
