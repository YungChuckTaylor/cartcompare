import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Two tiny bits of state, on disk, so a restart does not re-bill you:
 *
 *  - a response cache  (re-querying the same barcode inside the TTL is free)
 *  - a credit ledger   (so you can see what the trial has actually cost)
 *
 * Both are JSON files under data/. They are gitignored on purpose.
 */
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.cacheFile = path.join(dir, 'cache.json');
    this.creditsFile = path.join(dir, 'credits.json');
    fs.mkdirSync(dir, { recursive: true });
    this.cache = this.#read(this.cacheFile, {});
    this.credits = this.#read(this.creditsFile, { spent: 0, calls: 0, history: [] });
  }

  #read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  #write(file, value) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  }

  static hashKey(parts) {
    return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
  }

  get(key) {
    const hit = this.cache[key];
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      delete this.cache[key];
      return null;
    }
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.cache[key] = { value, expiresAt: Date.now() + ttlMs };
    // Keep the file bounded. Oldest 100 entries go when we exceed 800.
    const keys = Object.keys(this.cache);
    if (keys.length > 800) {
      keys
        .sort((a, b) => this.cache[a].expiresAt - this.cache[b].expiresAt)
        .slice(0, 100)
        .forEach((k) => delete this.cache[k]);
    }
    this.#write(this.cacheFile, this.cache);
  }

  recordSpend({ purpose, credits }) {
    this.credits.spent = (this.credits.spent || 0) + credits;
    this.credits.calls = (this.credits.calls || 0) + 1;
    this.credits.history.unshift({ at: new Date().toISOString(), purpose, credits });
    this.credits.history = this.credits.history.slice(0, 200);
    this.#write(this.creditsFile, this.credits);
  }

  creditsUsed() {
    return this.credits.spent || 0;
  }
}
