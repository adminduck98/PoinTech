/**
 * Minimal test runner — no framework, no dependencies beyond esbuild (fetched
 * on demand by the harness).
 *
 *   npm run test
 *   npm run test -- client-api        # run suites whose name matches
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] ?? '';

const suites = fs.readdirSync(path.join(HERE, 'edge'))
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (suites.length === 0) {
  console.error(filter ? `No suites match "${filter}"` : 'No suites found');
  process.exit(1);
}

let totalPass = 0;
let totalFail = 0;
const failedSuites = [];
const skippedSuites = [];

for (const file of suites) {
  const name = file.replace('.test.mjs', '');
  console.log(`\n\x1b[1m${name}\x1b[0m`);

  const results = [];
  globalThis.__EXPECT__ = (label, condition, detail = '') => {
    results.push({ label, ok: !!condition, detail });
  };
  globalThis.__SECTION__ = (title) => results.push({ section: title });

  try {
    await import(`${pathToFileURL(path.join(HERE, 'edge', file)).href}?v=${Date.now()}`);
  } catch (err) {
    // A suite that compares against the pre-fix revision cannot run at all
    // without the project's git history. That is "not measured", not "broken",
    // and calling it a failure trained everyone to ignore a red run.
    if (err?.name === 'BaselineUnavailableError') {
      console.log(`  \x1b[33m⊘ пропущено\x1b[0m: ${err.message}`);
      skippedSuites.push(name);
      continue;
    }
    console.log(`  \x1b[31m✗ suite crashed\x1b[0m: ${err.message}`);
    totalFail++;
    failedSuites.push(name);
    continue;
  }

  for (const r of results) {
    if (r.section) { console.log(`  \x1b[2m${r.section}\x1b[0m`); continue; }
    if (r.ok) { totalPass++; console.log(`    \x1b[32m✓\x1b[0m ${r.label}`); }
    else {
      totalFail++;
      if (!failedSuites.includes(name)) failedSuites.push(name);
      console.log(`    \x1b[31m✗\x1b[0m ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }
}

console.log(
  `\n${totalPass} passed, ${totalFail} failed` +
  (skippedSuites.length ? `, ${skippedSuites.length} suites skipped` : '')
);
if (failedSuites.length) console.log(`failing suites: ${failedSuites.join(', ')}`);
if (skippedSuites.length) {
  // Loud on purpose: a skipped suite asserted nothing, and these four carry the
  // regression checks for admin-api authorisation, checkout, the notification
  // path and the Payme callback. Green here means "not measured".
  console.log(
    `\x1b[33mskipped: ${skippedSuites.join(', ')}\x1b[0m — сравнение с дофиксовой ` +
    `ревизией недоступно, эти проверки НЕ выполнялись`
  );
}
process.exit(totalFail === 0 ? 0 : 1);
