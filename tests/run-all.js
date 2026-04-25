// Regression snapshot runner.
//
// Walks every *.pdf under SAMPLES/ (at repo root's parent — i.e.
// CAG TRADING APP/CAGTRADINGAPP/SAMPLES), runs parsePdf, and compares
// the normalized result against tests/snapshots/<basename>.json.
//
// Usage:
//   node tests/run-all.js            compare, exit 1 on any diff/miss
//   node tests/run-all.js --update   (re)write every snapshot from scratch
//   node tests/run-all.js --new      only write snapshots that don't exist
//   node tests/run-all.js --filter=sun     run only samples matching /sun/i
//
// The snapshot excludes filePath (machine-specific) and rawTextPreview
// (noisy) and sorts object keys deterministically so diffs stay meaningful.

const fs = require('fs');
const path = require('path');
const { parsePdf } = require('../src/pdf-parser');

const SAMPLES_DIR = path.join(__dirname, '..', 'SAMPLES');
const SNAP_DIR = path.join(__dirname, 'snapshots');

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const NEW_ONLY = args.includes('--new');
const filterArg = args.find(a => a.startsWith('--filter='));
const FILTER = filterArg ? new RegExp(filterArg.slice(9), 'i') : null;

function normalize(result) {
  const { filePath, rawTextPreview, ...rest } = result || {};
  return sortKeys(rest);
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  if (v instanceof Date) return { __date: v.toISOString() };
  return v;
}

function snapPath(pdfName) {
  return path.join(SNAP_DIR, pdfName.replace(/\.pdf$/i, '.json'));
}

function diffSummary(expected, actual) {
  const a = JSON.stringify(expected, null, 2).split('\n');
  const b = JSON.stringify(actual, null, 2).split('\n');
  const out = [];
  const max = Math.max(a.length, b.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 20; i++) {
    if (a[i] !== b[i]) {
      out.push(`  - ${a[i] ?? '(end)'}`);
      out.push(`  + ${b[i] ?? '(end)'}`);
      shown++;
    }
  }
  if (shown === 20) out.push('  … (truncated)');
  return out.join('\n');
}

(async () => {
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.error(`SAMPLES folder not found: ${SAMPLES_DIR}`);
    process.exit(2);
  }
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });

  const pdfs = fs.readdirSync(SAMPLES_DIR)
    .filter(f => /\.pdf$/i.test(f))
    .filter(f => !FILTER || FILTER.test(f))
    .sort();

  let pass = 0, fail = 0, wrote = 0, missing = 0, errored = 0;
  const failures = [];

  for (const name of pdfs) {
    const pdfPath = path.join(SAMPLES_DIR, name);
    const snap = snapPath(name);
    let actual;
    try {
      const buf = fs.readFileSync(pdfPath);
      const r = await parsePdf(buf, pdfPath);
      actual = normalize(r);
    } catch (e) {
      errored++;
      failures.push({ name, reason: `THREW: ${e.message}` });
      console.log(`✗ ${name}  (threw: ${e.message})`);
      continue;
    }

    const hasSnap = fs.existsSync(snap);

    if (UPDATE || (NEW_ONLY && !hasSnap)) {
      fs.writeFileSync(snap, JSON.stringify(actual, null, 2));
      wrote++;
      console.log(`↻ ${name}  (snapshot written)`);
      continue;
    }

    if (!hasSnap) {
      missing++;
      failures.push({ name, reason: 'no snapshot — run with --new to create' });
      console.log(`? ${name}  (no snapshot)`);
      continue;
    }

    const expected = JSON.parse(fs.readFileSync(snap, 'utf8'));
    const aStr = JSON.stringify(actual);
    const eStr = JSON.stringify(expected);
    if (aStr === eStr) {
      pass++;
      console.log(`✓ ${name}`);
    } else {
      fail++;
      const d = diffSummary(expected, actual);
      failures.push({ name, reason: 'diff', diff: d });
      console.log(`✗ ${name}`);
      console.log(d);
    }
  }

  console.log('\n--- SUMMARY ---');
  console.log(`total:   ${pdfs.length}`);
  console.log(`pass:    ${pass}`);
  console.log(`fail:    ${fail}`);
  console.log(`errored: ${errored}`);
  console.log(`missing: ${missing}`);
  console.log(`wrote:   ${wrote}`);

  if (fail || errored || missing) {
    console.log('\nHint: review failures above. If an intentional change,');
    console.log('      re-baseline with `node tests/run-all.js --update`.');
    process.exit(1);
  }
})();
