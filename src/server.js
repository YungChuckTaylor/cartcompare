/**
 * Local development server. The API itself lives in src/api.js so that this
 * file and the Vercel function in api/[...path].js are guaranteed to behave
 * identically.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { num } from './env.js';
import { handleRequest, MARKET } from './api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = num(process.env.PORT, 4173);
const HOST = '0.0.0.0';

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
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(res, url.pathname);
  }

  try {
    const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : null;
    const result = await handleRequest({
      method: req.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    json(res, result.status, result.body);
  } catch (error) {
    console.error('[cartcompare]', error.message);
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CartCompare MVP (US market) on http://${HOST}:${PORT}`);
  console.log(`mode: ${process.env.DATAFINITI_API_KEY ? 'live Datafiniti' : 'demo catalogue'}`);
  if (!process.env.DATAFINITI_API_KEY) {
    console.log('No DATAFINITI_API_KEY set — serving the synthetic US demo catalogue.');
  }
  if (MARKET !== 'US') console.log(`market: ${MARKET}`);
});
