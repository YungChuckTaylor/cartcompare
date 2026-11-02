#!/usr/bin/env node
/**
 * Coverage probe (US market) — the only sensible way to spend a 1,000-record trial.
 *
 * The point is not to build a catalogue. It is to answer one question in an
 * afternoon, for a few dozen credits:
 *
 *     Does Datafiniti actually hold US prices for the products in my cart,
 *     at enough merchants to compare a basket?
 *
 * How it stays cheap:
 *   - num_records: 1   → 1 credit per probe (a returned record costs 1 credit)
 *   - num_found        → free, and it is the number we actually care about
 *   So 9 probes ≈ 9 credits out of 1,000, and you get a real coverage read.
 *
 * Usage:
 *   npm run probe:dry     print the probes and the cost, call nothing
 *   npm run probe         run them (requires DATAFINITI_API_KEY)
 *   node scripts/probe-coverage.js --limit=5
 *   node scripts/probe-coverage.js --query='prices.currency:USD AND categories:"Grocery"'
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';
import * as datafiniti from '../src/datafiniti.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}`))?.split('=')[1] ?? null;
const DRY = args.includes('--dry-run');
const LIMIT = Number(flag('limit')) || null;
const EXTRA_QUERY = flag('query');

/**
 * Probes are ordered cheapest-signal-first. Each one is a question whose
 * answer changes a decision.
 */
const DEFAULT_PROBES = [
  {
    id: 'any-us',
    question: 'Does the product database hold US-sourced records?',
    query: 'country:US',
    decides: 'The baseline. Datafiniti is US-first, so this should be large.',
  },
  {
    id: 'usd-prices',
    question: 'Are there records with a USD price attached?',
    query: 'prices.currency:USD',
    decides: 'No USD prices = no US price product, full stop.',
  },
  {
    id: 'us-grocery',
    question: 'Is there US grocery at all?',
    query: 'country:US AND categories:"Grocery"',
    decides: 'The category your cart wants. Everything below refines this.',
  },
  {
    id: 'fresh',
    question: 'How fresh are US records? (last 30 days)',
    query: 'country:US AND prices.dateSeen:[2026-10-03 TO 2026-11-02]',
    decides: 'Stale scraper output cannot answer "what does this cost today".',
  },
  {
    id: 'us-grocery-priced',
    question: 'US grocery WITH a USD price — the real intersection?',
    query: 'country:US AND prices.currency:USD AND categories:"Grocery"',
    decides: 'This is the number that decides whether Datafiniti can seed a US cart MVP.',
  },
  {
    id: 'us-household',
    question: 'US household / general merchandise?',
    query: 'country:US AND categories:"Household"',
    decides: 'Household is the other half of a typical grocery cart.',
  },
  {
    id: 'us-banners',
    question: 'Are the big US banners even in the merchant list?',
    query: 'country:US AND (merchants.name:"Walmart" OR merchants.name:"Target" OR merchants.name:"Kroger")',
    decides: 'A cart comparison is worthless if the merchant column is empty.',
  },
  {
    id: 'us-multi-merchant',
    question: 'Do records carry MORE THAN ONE merchant with a price?',
    query: 'country:US AND prices.currency:USD AND prices.amountMin:[1 TO 500]',
    decides: 'Basket comparison needs the same UPC at several stores, not one listing.',
  },
  {
    id: 'us-electronics',
    question: 'Is the US electronics slice dense?',
    query: 'country:US AND categories:"Electronics"',
    decides: 'Electronics is where scraped catalogues are strongest — a viable fallback category.',
  },
];

/** Probe a specific barcode, if you have one you care about. */
function upcProbe(upc) {
  return {
    id: `upc-${upc}`,
    question: `Does it know barcode ${upc}?`,
    query: datafiniti.buildUpcQuery(upc),
    decides: 'This is the literal lookup your cart does. Run it on 10 of your real SKUs.',
  };
}

async function runProbe(probe) {
  const started = Date.now();
  try {
    const res = await datafiniti.search(probe.query, { numRecords: 1 });
    const sample = res.records[0] ? datafiniti.normalizeRecord(res.records[0]) : null;
    return {
      ...probe,
      ok: true,
      numFound: res.numFound,
      credits: res.credits,
      ms: Date.now() - started,
      sample: sample
        ? { name: sample.name, brand: sample.brand, offers: sample.offers.slice(0, 3) }
        : null,
    };
  } catch (error) {
    return { ...probe, ok: false, error: error.message, credits: 0, ms: Date.now() - started };
  }
}

function printResults(results) {
  const width = Math.max(...results.map((r) => r.question.length), 30);
  console.log('');
  for (const r of results) {
    if (!r.ok) {
      console.log(`✗ ${r.question.padEnd(width)}  ERROR  ${r.error}`);
      continue;
    }
    const mark = r.numFound === 0 ? '✗' : r.numFound < 100 ? '~' : '✓';
    const credits = `${r.credits} credit${r.credits === 1 ? '' : 's'}`;
    console.log(`${mark} ${r.question.padEnd(width)}  ${String(r.numFound).padStart(9)}  (${credits})`);
    if (r.sample) {
      const first = r.sample.offers[0];
      const price = first ? `${first.currency} ${first.price} @ ${first.merchant}` : 'no price on sample';
      console.log(`  ${' '.repeat(width + 2)}└─ ${r.sample.name.slice(0, 60)} — ${price}`);
    }
  }
}

function verdict(results) {
  const answered = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  // A failed request is not a zero. Conflating the two is how a network or auth
  // problem gets misread as "the vendor has no data".
  if (!answered.length) {
    return [
      '',
      'VERDICT',
      '-------',
      'INCONCLUSIVE — every probe failed before returning data.',
      'That is an auth, quota or network problem, not a coverage finding.',
      'Nothing was measured and nothing should be concluded from this run.',
      `First error: ${failed[0]?.error ?? 'unknown'}`,
    ].join('\n');
  }

  const by = Object.fromEntries(answered.map((r) => [r.id, r]));
  const usd = by['usd-prices']?.numFound ?? 0;
  const grocery = by['us-grocery-priced']?.numFound ?? 0;
  const electronics = by['us-electronics']?.numFound ?? 0;

  const lines = ['', 'VERDICT', '-------'];
  if (usd === 0) {
    lines.push('No USD-priced records at all. Datafiniti cannot supply this product. Stop here.');
  } else if (grocery >= 1000) {
    lines.push(`US grocery with USD pricing is substantial (${grocery} matching records). Viable as a seed layer — but verify per-item merchant spread before trusting basket comparison.`);
  } else if (grocery > 0) {
    lines.push(`US grocery is present but thin (${grocery} records). Enough for a demo, not for coverage. Treat grocery as a later phase.`);
  } else {
    lines.push('Zero US grocery with USD pricing. Datafiniti cannot seed a US grocery cart MVP.');
  }
  if (electronics >= 1000) {
    lines.push(`US electronics is dense (${electronics}). This is the category to launch the cart MVP in — scraped catalogues are strongest exactly here.`);
  }
  if (failed.length) {
    lines.push('');
    lines.push(`CAUTION: ${failed.length} of ${results.length} probes errored and were excluded from this verdict.`);
  }
  lines.push('');
  lines.push('Next step: run a UPC probe on 10 of your own SKUs (--query or edit the list).');
  lines.push('Per-item coverage raised to the power of your cart size is the number that matters.');
  return lines.join('\n');
}

async function main() {
  let probes = DEFAULT_PROBES;
  if (EXTRA_QUERY) {
    probes = [{ id: 'custom', question: `Custom: ${EXTRA_QUERY}`, query: EXTRA_QUERY, decides: 'Asked by hand.' }];
  }
  if (LIMIT) probes = probes.slice(0, LIMIT);

  console.log('');
  console.log('Datafiniti coverage probe — US market');
  console.log(`  probes       : ${probes.length}`);
  console.log(`  max credits  : ${probes.length} (one record per probe)`);
  console.log(`  endpoint     : POST https://api.datafiniti.co/v4/products/search`);
  console.log(`  barcode field: ${datafiniti.config().upcField}`);
  console.log(`  auth         : ${datafiniti.hasCredentials() ? 'key present' : 'NO KEY — dry run only'}`);

  if (DRY || !datafiniti.hasCredentials()) {
    console.log('');
    probes.forEach((p, i) => {
      console.log(`${String(i + 1).padStart(2)}. ${p.question}`);
      console.log(`    query : ${p.query}`);
      console.log(`    why   : ${p.decides}`);
    });
    if (!datafiniti.hasCredentials()) {
      console.log('\nSet DATAFINITI_API_KEY in .env to actually run these.');
    } else {
      console.log('\nDry run only — nothing was called, nothing was spent.');
    }
    return;
  }

  const results = [];
  for (const probe of probes) {
    process.stdout.write(`running: ${probe.question} … `);
    const result = await runProbe(probe);
    console.log(result.ok ? `${result.numFound} found` : 'error');
    results.push(result);
    await new Promise((r) => setTimeout(r, 400)); // be a polite API citizen
  }

  printResults(results);
  const spent = results.reduce((sum, r) => sum + (r.credits || 0), 0);
  console.log(`\nCredits spent: ${spent} of 1000 in the free trial.`);
  console.log(verdict(results));

  const out = path.join(ROOT, 'data', 'coverage-report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), spent, results }, null, 2));
  console.log(`\nWritten to ${path.relative(ROOT, out)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export { DEFAULT_PROBES, upcProbe };
