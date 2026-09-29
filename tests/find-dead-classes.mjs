/**
 * Report Tailwind class names used in the source that produce no CSS.
 *
 *   npm run build && node tests/find-dead-classes.mjs
 *
 * Tailwind only emits utilities it finds in the content globs, so a class that
 * is absent from the built stylesheet is a class that does nothing at runtime —
 * a silent styling bug, since neither the compiler nor the linter looks at
 * strings inside className.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cssFiles = fs.readdirSync(path.join(ROOT, 'dist/assets')).filter((f) => f.endsWith('.css'));
if (cssFiles.length === 0) {
  console.error('No built CSS found — run `npm run build` first.');
  process.exit(1);
}
const css = cssFiles.map((f) => fs.readFileSync(path.join(ROOT, 'dist/assets', f), 'utf8')).join('\n');

/** Collect every class token that appears in a className/class attribute. */
function collectClasses(dir, acc = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { collectClasses(full, acc); continue; }
    if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;

    const text = fs.readFileSync(full, 'utf8');
    const rel = path.relative(ROOT, full);

    // className="..." / className={`...`} / className={cn('...', "...")}
    for (const m of text.matchAll(/class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? '';
      // Inside a JSX expression only literal segments are meaningful.
      // Inside a JSX expression, drop ${...} interpolations before pulling out
      // string literals — otherwise fragments of JS expressions leak through and
      // masquerade as class names.
      const literals = m[3] !== undefined
        ? [...raw.replace(/\$\{[^}]*\}/g, ' ').matchAll(/["'`]([^"'`]*)["'`]/g)].map((x) => x[1])
        : [raw];
      for (const literal of literals) {
        addTokens(literal, rel, acc);
      }
    }

    // Class names that never touch a `className` attribute.
    //
    // Scanning only `className=` is how the order-status badges went unnoticed:
    // src/lib/orderStatuses.ts keeps its classes as strings in a data table and
    // the pages spread them in later, so `bg-brand-600` — a colour that exists
    // in no config — produced no CSS and no complaint, and three order statuses
    // rendered as white text on a white card.
    //
    // Any string literal that looks like a run of Tailwind utilities is worth
    // checking wherever it appears. The shape test below is deliberately strict:
    // at least two hyphenated, lowercase, Tailwind-looking tokens, so ordinary
    // prose and identifiers are not mistaken for classes.
    for (const m of stripComments(text).matchAll(/["'`]([^"'`\n]{3,200})["'`]/g)) {
      const literal = m[1];
      if (literal.includes('${')) continue;
      const tokens = literal.trim().split(/\s+/);
      const utilityLike = tokens.filter((t) => UTILITY_SHAPE.test(t));

      if (tokens.length === 1) {
        // A lone token is only worth checking when it opens with a property
        // prefix Tailwind actually owns. Without that gate every hyphenated
        // string in the codebase — 'price-desc', 'new-arrival', a slug — would
        // be reported as a dead class.
        if (utilityLike.length === 1 && OWNED_PREFIX.test(tokens[0])) {
          addTokens(literal, rel, acc);
        }
        continue;
      }

      // Most of a multi-token literal has to look like utilities before we
      // trust it enough to check every token in it.
      if (utilityLike.length < 2 || utilityLike.length < tokens.length / 2) continue;
      addTokens(literal, rel, acc);
    }
  }
  return acc;
}

/** Roughly "looks like a Tailwind utility", including any variant prefixes. */
const UTILITY_SHAPE = /^[a-z][a-z0-9]*(:[a-z-]+)*-[a-z0-9[\]/.%-]+$/;

/**
 * Property prefixes Tailwind owns, used to decide whether a single-token string
 * is a class name or just a hyphenated identifier.
 */
const OWNED_PREFIX = new RegExp(
  '^([a-z-]+:)*(bg|text|border|ring|shadow|fill|stroke|divide|outline|decoration|caret)-'
);

/**
 * Strip comments before hunting for class names in string literals.
 *
 * Comments discuss class names as a matter of course — the note in
 * orderStatuses.ts explaining the `bg-brand-600` bug quotes the dead class in
 * backticks — and reporting those would train everyone to ignore this tool.
 * Crude but adequate here: the scan that follows only needs the code's own
 * string literals, and a `//` inside a URL costs us a line, not a class.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*\*.*$/gm, ' ');
}

/** Split a literal into candidate class tokens and record them. */
function addTokens(literal, rel, acc) {
  for (const token of literal.split(/\s+/)) {
    if (!token || token.includes('${') || token.includes('{')) continue;
    if (!/^[a-zA-Z][a-zA-Z0-9:_\-./[\]()%#'",]*$/.test(token)) continue;
    // A dot is only valid in Tailwind for fractional scales (p-1.5, w-4.5).
    if (token.includes('.') && !/\.\d/.test(token)) continue;
    if (!acc.has(token)) acc.set(token, new Set());
    acc.get(token).add(rel);
  }
}

/** Escape a class name the way Tailwind writes it into a selector. */
function toSelector(token) {
  return '.' + token.replace(/[:./[\]()%#'",]/g, (ch) => '\\' + ch);
}

const used = collectClasses(path.join(ROOT, 'src'));
const dead = [];

for (const [token, files] of used) {
  // Strip a responsive/state prefix chain: Tailwind writes those into the
  // selector too, so the escaped full token is what we look for.
  if (css.includes(toSelector(token))) continue;
  // Some utilities appear only inside media queries with the prefix escaped
  // differently; fall back to a looser check on the final segment.
  const bare = token.split(':').pop();
  if (bare !== token && css.includes(toSelector(bare))) continue;
  dead.push({ token, files: [...files] });
}

// Tokens with no dash, colon or slash are almost always JS identifiers picked
// up from a ternary rather than class names; report them separately so the
// actionable list stays clean.
const looksLikeClass = (t) => /[-:/]/.test(t);
const suspects = dead.filter((d) => !looksLikeClass(d.token));
const real = dead.filter((d) => looksLikeClass(d.token));

dead.length = 0;
dead.push(...real);
dead.sort((a, b) => b.files.length - a.files.length || a.token.localeCompare(b.token));

if (dead.length === 0) {
  console.log('Все использованные классы порождают CSS.');
  if (suspects.length) {
    console.log(`\n(${suspects.length} однословных токенов пропущено как вероятные идентификаторы JS)`);
  }
  process.exit(0);
}

console.log(`Классы без CSS: ${dead.length}\n`);
for (const { token, files } of dead) {
  console.log(`  ${token.padEnd(28)} ${files.length} файл(ов)  ${files.slice(0, 3).join(', ')}${files.length > 3 ? ' …' : ''}`);
}
process.exit(1);
