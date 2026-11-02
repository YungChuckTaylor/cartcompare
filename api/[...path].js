/**
 * Vercel serverless entry point — catch-all for /api/*.
 * All real logic lives in src/api.js so local dev and production agree.
 */
import { handleRequest } from '../src/api.js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const result = await handleRequest({
      method: req.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: req.body ?? null,
    });

    res.status(result.status);
    res.setHeader('Cache-Control', 'no-store');
    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }
    res.json(result.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
