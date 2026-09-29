/**
 * Test harness for Supabase Edge Functions.
 *
 * The functions target Deno and import via `npm:` / `jsr:` specifiers, so they
 * cannot be imported into Node directly. This rewrites only the *import lines*
 * — the handler body is untouched — bundles with esbuild, and runs the real
 * handler against a stubbed Supabase client and a stubbed `fetch`.
 *
 * Nothing here is a mock of the logic under test: the assertions exercise the
 * shipped code paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '../..');
const FUNCTIONS = path.join(PROJECT_ROOT, 'supabase/functions');
const SHARED = path.join(FUNCTIONS, '_shared');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-tests-'));
process.on('exit', () => fs.rmSync(workDir, { recursive: true, force: true }));

fs.writeFileSync(path.join(workDir, 'supabase-stub.mjs'),
  'export function createClient(){ return globalThis.__SUPABASE__; }\n');
fs.writeFileSync(path.join(workDir, 'notify-stub.mjs'), `
export const notifyNewOrder = async () => {};
export const notifyOrderStatusChanged = async () => {};
export const notifyProductOutOfStock = async () => {};
export const notifyProductBackInStock = async () => {};
export const notifyProductPriceChanged = async () => {};
export const notifyPaymentSuccess = async () => {};
export const notifyPaymentFailed = async () => {};
export const notifyCustomerMessage = async () => {};
export const notifyAdmin = async () => {};
`);

let counter = 0;

/**
 * Bundle a file with esbuild.
 *
 * Prefers the copy already sitting in node_modules/.bin (installed
 * transitively by vite) over `npx esbuild@0.24.0`. npx has to hit the npm
 * registry for a pinned version it doesn't already have cached, which hangs
 * indefinitely in network-restricted environments (CI sandboxes, offline
 * dev) even though a perfectly good esbuild is sitting right there.
 */
export function runEsbuild(tsPath, outPath) {
  const args = [tsPath, '--format=esm', '--bundle', `--outfile=${outPath}`];
  const localBin = path.join(
    PROJECT_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'
  );
  if (fs.existsSync(localBin)) {
    execFileSync(localBin, args, { stdio: 'pipe', shell: process.platform === 'win32' });
    return;
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['--yes', 'esbuild@0.24.0', ...args], { stdio: 'pipe', shell: process.platform === 'win32' });
}

/**
 * Build an Edge Function (or an arbitrary source file with the same shape) and
 * return its `Deno.serve` handler.
 *
 * `_shared/telegram-verify`, `_shared/coupons` and `_shared/env` are resolved to
 * the real files — those are part of what we are testing. Only telegram-notify
 * (which would call the Telegram API) is stubbed.
 */
export async function loadFunction(source) {
  const src = path.isAbsolute(source) ? source : path.join(FUNCTIONS, source, 'index.ts');
  const name = `fn-${counter++}`;
  const tsPath = path.join(workDir, `${name}.ts`);
  const outPath = path.join(workDir, `${name}.mjs`);

  const code = fs.readFileSync(src, 'utf8')
    .replace(/import "jsr:[^"]*";\n/g, '')
    .replace(/from "npm:@supabase\/supabase-js@2"/g, `from ${JSON.stringify(path.join(workDir, 'supabase-stub.mjs'))}`)
    .replace(/from "\.\.\/_shared\/telegram-notify\.ts"/g, `from ${JSON.stringify(path.join(workDir, 'notify-stub.mjs'))}`)
    .replace(/from "\.\.\/_shared\/([a-z-]+)\.ts"/g, (_m, mod) => `from ${JSON.stringify(path.join(SHARED, `${mod}.ts`))}`);

  fs.writeFileSync(tsPath, code);
  runEsbuild(tsPath, outPath);

  delete globalThis.__HANDLER__;
  await import(`file://${outPath}?v=${Date.now()}`);
  const handler = globalThis.__HANDLER__;
  if (!handler) throw new Error(`${source} did not register a Deno.serve handler`);
  return handler;
}

/**
 * The revision these regression tests treat as "before the fix".
 *
 * This used to be the literal string `HEAD`, which works exactly once: while
 * the fixes sit uncommitted, HEAD is the buggy code and the comparisons hold.
 * The moment the fixes are committed, HEAD *is* the fixed code and every
 * "старый код had the bug" assertion fails — the suite goes red on a commit
 * that changed no behaviour at all.
 *
 * Pinned to the last commit before the audit work instead, so the baseline
 * stays what the tests were written against. Override with BASELINE_REF when
 * comparing against something else.
 */
const BASELINE_REF = process.env.BASELINE_REF || 'f0e85da';

/**
 * Raised when the baseline revision cannot be read — no git history in this
 * copy of the project, or a checkout that does not contain BASELINE_REF.
 *
 * A distributed copy of this project (a zip, a fresh `git init`) has no
 * `f0e85da`, and `execFileSync` then threw a raw "Command failed: git show"
 * out of the suite's top-level await. The runner counted the whole file as one
 * failure, so four suites reported red for a reason that has nothing to do
 * with the code — and their assertions about the *current* handlers, which
 * need no baseline at all, were never reached either way.
 *
 * Named so tests/run.mjs can tell "cannot compare" apart from "comparison
 * failed" and report it as skipped rather than broken.
 */
export class BaselineUnavailableError extends Error {
  constructor(repoPath, cause) {
    super(
      `baseline ${BASELINE_REF} unavailable for ${repoPath} — ` +
      `run the suite in a checkout that has the project's git history, ` +
      `or set BASELINE_REF to a revision this one contains`
    );
    this.name = 'BaselineUnavailableError';
    this.cause = cause;
  }
}

/** Read a file as it was at the pre-fix baseline revision. */
export function fromGitHead(repoPath) {
  let out;
  try {
    out = execFileSync('git', ['-C', PROJECT_ROOT, 'show', `${BASELINE_REF}:${repoPath}`], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    throw new BaselineUnavailableError(repoPath, err);
  }
  const dest = path.join(workDir, `head-${counter++}-${path.basename(repoPath)}`);
  fs.writeFileSync(dest, out);
  return dest;
}

/** Install the Deno globals the functions expect. */
export function installDenoEnv(env = {}) {
  globalThis.Deno = {
    env: { get: (k) => env[k] },
    serve: (h) => { globalThis.__HANDLER__ = h; },
  };
}

/**
 * A chainable stand-in for supabase-js's query builder.
 *
 * Deliberately thenable-without-`.catch`, exactly like PostgrestBuilder, and it
 * honours `.select(columns)` by projecting rows — otherwise assertions about
 * columns never leaving the server would pass vacuously.
 */
export function makeSupabaseStub({ tables = {}, rpc = {} } = {}) {
  const calls = { rpc: [], writes: [], selects: [] };

  // Always hand back a copy. A real client deserialises rows from the wire, so
  // callers cannot mutate stored state by writing to a returned object — and a
  // stub that returns live references hides bugs where code re-reads a value
  // across a write.
  function project(row, columns) {
    if (!columns || columns === '*' || typeof columns !== 'string') return { ...row };
    if (!columns.includes(',') && !(columns in row)) return { ...row };
    const out = {};
    for (const c of columns.split(',').map((x) => x.trim())) if (c in row) out[c] = row[c];
    return out;
  }

  function builder(table) {
    const st = { table, filters: {}, columns: '*', inColumn: null, inValues: null, payload: undefined };
    const source = () => (typeof tables[table] === 'function' ? tables[table]() : tables[table]) ?? [];
    const rows = () => source()
      .filter((r) => (st.inValues ? st.inValues.includes(r[st.inColumn]) : true))
      .filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v))
      .map((r) => project(r, st.columns));

    const b = {
      select: (columns, opts) => {
        st.columns = columns ?? '*';
        calls.selects.push({ table, columns: st.columns, head: !!opts?.head });
        return b;
      },
      insert: (payload) => { st.payload = payload; calls.writes.push({ table, op: 'insert', payload }); return b; },
      update: (payload) => { st.payload = payload; calls.writes.push({ table, op: 'update', payload }); return b; },
      delete: () => { calls.writes.push({ table, op: 'delete' }); return b; },
      eq: (k, v) => { st.filters[k] = v; return b; },
      in: (column, values) => { st.inColumn = column; st.inValues = values; return b; },
      gte: () => b, lte: () => b, order: () => b, range: () => b, limit: () => b,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (onFulfilled, onRejected) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(onFulfilled, onRejected),
    };
    return b;
  }

  const client = {
    from: builder,
    rpc: (fn, args) => {
      calls.rpc.push({ fn, args });
      const impl = rpc[fn];
      const result = typeof impl === 'function' ? impl(args) : (impl ?? { data: null, error: null });
      return {
        ...result,
        single: async () => result,
        maybeSingle: async () => result,
        then: (res, rej) => Promise.resolve(result).then(res, rej),
      };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };

  globalThis.__SUPABASE__ = client;
  return calls;
}

/** Capture outgoing HTTP, with optional routing to other loaded handlers. */
export function installFetchStub(routes = []) {
  const captured = { telegram: [], all: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    captured.all.push({ url: u, opts });
    for (const route of routes) {
      if (u.includes(route.match)) return route.handle(u, opts);
    }
    if (u.includes('api.telegram.org')) {
      captured.telegram.push({ url: u, body: JSON.parse(opts.body ?? '{}') });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  return captured;
}

/** Sign initData the way Telegram does, for tests that need a real identity. */
export function signInitData(botToken, fields) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .filter(([k]) => k !== 'hash' && k !== 'signature')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function post(handler, body, { origin = 'http://localhost:5173' } = {}) {
  return handler(new Request('https://test.local/fn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  }));
}
