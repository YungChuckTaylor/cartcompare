import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, num } from './env.js';
import { createPriceService } from './prices.js';
import { filterOffers, cheapestPerMerchant, merchantBaskets, summary } from './compare.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');

loadEnv(ROOT);

const PORT = num(process.env.PORT, 4173);
const HOST = '0.0.0.0';
const CACHE_TTL_MS = num(process.env.CACHE_TTL_HOURS, 24) * 3600 * 1000;

const prices = createPriceService({ dataDir: DATA_DIR, cacheTtlMs: CACHE_TTL_MS });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(file).pipe(res);
}

async function readBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function warningsFor(mode, items) {
  const notes = [];
  if (mode === 'demo') {
    notes.push({
      level: 'info',
      text: 'Demo dataset — synthetic prices, no Datafiniti key set. Nothing here is a real price.',
    });
  }
  if (mode === 'live') {
    notes.push({
      level: 'warn',
      text: 'Live Datafiniti data: scraped online listing prices, not in-store shelf prices. Coverage is US-first and sparse for Canadian grocery.',
    });
    const noOffers = items.filter((i) => !i.offers.length).length;
    if (noOffers) {
      notes.push({
        level: 'warn',
        text: `${noOffers} of ${items.length} cart lines returned no price at all. That is the coverage question, answered.`,
      });
    }
  }
  return notes;
}

async function handleCompare(req, res) {
  const body = await readBody(req);
  const requested = Array.isArray(body.items) ? body.items : [];
  if (!requested.length) return json(res, 400, { error: 'Send { items: [{ upc, qty }] }' });
  if (requested.length > 25) return json(res, 400, { error: 'Cart is capped at 25 lines in the MVP.' });

  const region = body.region === 'ANY' ? 'ANY' : 'CA';
  let spent = 0;

  const lines = [];
  for (const entry of requested) {
    const upc = String(entry.upc || '').trim();
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
    const offers = filterOffers(base.offers || [], region);

    lines.push({
      upc,
      name: base.name,
      brand: base.brand,
      category: base.category,
      qty,
      source: base.source,
      offers,
      cheapest: cheapestPerMerchant(offers)[0] || null,
    });
  }

  const baskets = merchantBaskets(lines);
  const mode = prices.mode();

  json(res, 200, {
    mode,
    region,
    generatedAt: new Date().toISOString(),
    credits: { thisRequest: spent, ...prices.credits() },
    warnings: warningsFor(mode, lines),
    items: lines,
    baskets,
    summary: summary(lines, baskets),
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        mode: prices.mode(),
        credits: prices.credits(),
        cacheTtlHours: CACHE_TTL_MS / 3600000,
      });
    }

    if (url.pathname === '/api/search') {
      const result = await prices.search(url.searchParams.get('q') || '');
      return json(res, 200, result);
    }

    if (url.pathname === '/api/catalog') {
      return json(res, 200, { items: prices.demoCatalog.items });
    }

    if (url.pathname === '/api/compare' && req.method === 'POST') {
      return await handleCompare(req, res);
    }

    if (url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: `No route for ${url.pathname}` });
    }

    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error('[cartcompare]', error.message);
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CartCompare MVP on http://${HOST}:${PORT}  (mode: ${prices.mode()})`);
  if (prices.mode() === 'demo') {
    console.log('No DATAFINITI_API_KEY set — serving the synthetic demo catalogue.');
  }
});
