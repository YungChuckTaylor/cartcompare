#!/usr/bin/env node
/**
 * Coverage probe — the only sensible way to spend a 1,000-record trial.
 *
 * The point is not to build a catalogue. It is to answer one question in an
 * afternoon, for a few dozen credits:
 *
 *     Does Datafiniti actually hold Canadian prices for the products
 *     in my cart-compare product?
 *
 * How it stays cheap:
 *   - num_records: 1   → 1 credit per probe (a returned record costs 1 credit)
 *   - num_found        → free, and it is the number we actually care about
 *   So 25 probes ≈ 25 credits out of 1,000, and you get a real coverage read.
 *
 * Usage:
 *   npm run probe:dry     print the probes and the cost, call nothing
 *   npm run probe         run them (requires DATAFINITI_API_KEY)
 *   node scripts/probe-coverage.js --limit=5
 *   node scripts/probe-coverage.js --query='prices.currency:CAD AND categories:"Grocery"'
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
    id: 'any-ca',
    question: 'Does the product database hold ANY Canadian-sourced record?',
    query: 'country:CA',
    decides: 'If this is tiny, everything below is academic.',
  },
  {
    id: 'cad-prices',
    question: 'Are there any records with a CAD price at all?',
    query: 'prices.currency:CAD',
    decides: 'No CAD prices = no Canadian price product, full stop.',
  },
  {
    id: 'ca-grocery',
    question: 'Is there Canadian grocery?',
    query: 'country:CA AND categories:"Grocery"',
    decides: 'The category you actually want. Expect this to be near zero.',
  },
  {
    id: 'ca-fresh',
    question: 'How fresh are the Canadian records?',
    query: 'country:CA AND prices.dateSeen:[2026-10-01 TO 2026-11-02]',
    decides: 'Stale scraper output cannot power a "what does this cost today" answer.',
  },
  {
    id: 'ca-cad-grocery',
    question: 'Canadian grocery WITH a CAD price — the real intersection?',
    query: 'country:CA AND prices.currency:CAD AND categories:"Grocery"',
    decides: 'This is the number that decides whether Datafiniti can seed a cart MVP.',
  },
  {
    id: 'ca-electronics',
    question: 'Is the Canadian electronics slice usable instead?',
    query: 'country:CA AND categories:"Electronics"',
    decides: 'If grocery fails and electronics works, the MVP category is electronics.',
  },
  {
    id: 'ca-household',
    question: 'Canadian household / general merchandise?',
    query: 'country:CA AND categories:"Household"',
    decides: 'Household is the other half of a typical grocery cart.',
  },
  {
    id: 'ca-banner-merchants',
    question: 'Are the big Canadian banners even in the merchant list?',
    query: 'country:CA AND (merchants.name:"Walmart" OR merchants.name:"Loblaws" OR merchants.name:"Metro")',
    decides: 'A cart comparison is worthless if the merchant column is empty.',
  },
];

/** Probe a specific barcode, if you have one you care about. */
function upcProbe(upc) {
  return {
    id: `upc-${upc}`,
    question: `Does it know barcode ${upc}?`,
    query: datafiniti.buildUpcQuery(upc),
    decides: 'This is the literal lookup your cart does. Run it on 5–10 of your real SKUs.',
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
        ? {
            name: sample.name,
            brand: sample.brand,
            offers: sample.offers.slice(0, 3),
          }
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
    const mark = r.numFound === 0 ? '✗' : r.numFound < 50 ? '~' : '✓';
    console.log(`${mark} ${r.question.padEnd(width)}  ${String(r.numFound).padStart(9)}  (${r.credits} credit${r.credits === 1 ? '' : 's'})`);
    if (r.sample) {
      const first = r.sample.offers[0];
      const price = first ? `${first.currency} ${first.price} @ ${first.merchant}` : 'no price on sample';
      console.log(`  ${' '.repeat(width + 2)}└─ ${r.sample.name.slice(0, 60)} — ${price}`);
    }
  }
}

function verdict(results) {
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  const cad = by['cad-prices']?.numFound ?? 0;
  const caGrocery = by['ca-cad-grocery']?.numFound ?? 0;
  const caElectronics = by['ca-electronics']?.numFound ?? 0;

  const lines = [];
  lines.push('');
  lines.push('VERDICT');
  lines.push('-------');
  if (cad === 0) {
    lines.push('No CAD-priced records at all. Datafiniti cannot supply this product. Stop here.');
  } else if (caGrocery >= 500) {
    lines.push(`Canadian grocery with CAD pricing exists (${caGrocery} matching records). It may be viable as a seed layer — check freshness and merchant spread before believing it.`);
  } else if (caGrocery > 0) {
    lines.push(`Canadian grocery is present but thin (${caGrocery} records). Enough for a demo, not for coverage. Treat Datafiniti as a US reference layer.`);
  } else {
    lines.push('Zero Canadian grocery with CAD pricing. Datafiniti cannot seed a Canadian grocery cart MVP, whatever the pricing page implies.');
    if (caElectronics > 100) {
      lines.push(`Canadian electronics does exist (${caElectronics}). If you must use Datafiniti, build the MVP in electronics, not grocery.`);
    }
  }
  return lines.join('\n');
}

async function main() {
  let probes = DEFAULT_PROBES;
  if (EXTRA_QUERY) {
    probes = [{ id: 'custom', question: `Custom: ${EXTRA_QUERY}`, query: EXTRA_QUERY, decides: 'Asked by hand.' }];
  }
  if (LIMIT) probes = probes.slice(0, LIMIT);

  console.log('');
  console.log('Datafiniti coverage probe');
  console.log(`  probes      : ${probes.length}`);
  console.log(`  max credits : ${probes.length} (one record per probe)`);
  console.log(`  endpoint    : POST https://api.datafiniti.co/v4/products/search`);
  console.log(`  barcode field: ${datafiniti.config().upcField}`);
  if (!datafiniti.hasCredentials()) {
    console.log('  auth        : NO KEY — dry run only');
  }

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
    // Be polite and avoid anything that looks like hammering.
    await new Promise((r) => setTimeout(r, 400));
  }

  printResults(results);
  const spent = results.reduce((sum, r) => sum + (r.credits || 0), 0);
  console.log(`\nCredits spent: ${spent} of 1000 in the free trial.`);
  console.log(verdict(results));

  const out = path.join(ROOT, 'data', 'coverage-report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify({ ranAt: new Date().toISOString(), spent, results }, null, 2),
  );
  console.log(`\nWritten to ${path.relative(ROOT, out)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export { DEFAULT_PROBES, upcProbe };
