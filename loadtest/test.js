/**
 * KUPI Shop — Load Test (Node.js)
 *
 * Simulates up to 1000 concurrent users hitting the Supabase backend.
 * Measures response times, error rates, throughput, and identifies bottlenecks.
 *
 * Usage:  node loadtest/test.js
 * Output: loadtest/report.md + loadtest/results.json
 */

import https from 'node:https';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

// ─── State ──────────────────────────────────────────────────────────────────
const results = {
  startTime: new Date().toISOString(),
  phases: [],
  endpoints: {},
  errors: [],
  slowQueries: [],
  summary: {},
};

let totalRequests = 0;
let totalErrors = 0;
let totalSuccess = 0;
let allResponseTimes = [];
let activeUsers = 0;
let peakConcurrent = 0;
let running = true;

// ─── HTTP helper ────────────────────────────────────────────────────────────
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CONFIG.ANON_KEY,
        'Authorization': `Bearer ${CONFIG.ANON_KEY}`,
        ...options.headers,
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          time: performance.now(),
          body: data,
          size: data.length,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// ─── Metric tracking ────────────────────────────────────────────────────────
function trackEndpoint(name, startTime, status, size) {
  const elapsed = performance.now() - startTime;
  if (!results.endpoints[name]) {
    results.endpoints[name] = {
      count: 0, errors: 0, totalTime: 0, minTime: Infinity, maxTime: 0,
      times: [], statusCodes: {}, totalSize: 0,
    };
  }
  const ep = results.endpoints[name];
  ep.count++;
  ep.totalTime += elapsed;
  ep.minTime = Math.min(ep.minTime, elapsed);
  ep.maxTime = Math.max(ep.maxTime, elapsed);
  ep.times.push(elapsed);
  ep.totalSize += size || 0;
  ep.statusCodes[status] = (ep.statusCodes[status] || 0) + 1;
  if (status >= 400) ep.errors++;

  allResponseTimes.push(elapsed);
  totalRequests++;
  if (status >= 400) totalErrors++;
  else totalSuccess++;
}

function logError(endpoint, error, phase) {
  results.errors.push({
    time: new Date().toISOString(),
    endpoint,
    error: String(error),
    phase,
  });
}

// ─── User scenarios ─────────────────────────────────────────────────────────

// Scenario: Browse catalog (products list)
async function scenarioBrowseCatalog() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?select=*&is_active=eq.true&order=created_at.desc&limit=20&offset=0`
    );
    trackEndpoint('GET /products', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /products', start, 500, 0);
    logError('GET /products', e.message, 'browse');
  }
}

// Scenario: View product detail
async function scenarioViewProduct() {
  // First get a product list, then pick one
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?select=id,slug&is_active=eq.true&limit=5&order=created_at.desc`
    );
    trackEndpoint('GET /products (slug)', start, res.status, res.size);

    if (res.status === 200) {
      const data = JSON.parse(res.body);
      if (data?.length > 0) {
        const product = data[Math.floor(Math.random() * data.length)];
        const start2 = performance.now();
        try {
          const detail = await httpRequest(
            `${CONFIG.SUPABASE_URL}/rest/v1/products?select=*&slug=eq.${encodeURIComponent(product.slug)}`
          );
          trackEndpoint('GET /product/:slug', start2, detail.status, detail.size);
        } catch (e) {
          trackEndpoint('GET /product/:slug', start2, 500, 0);
          logError('GET /product/:slug', e.message, 'view_product');
        }

        // Increment views (RPC)
        const start3 = performance.now();
        try {
          const rpcRes = await httpRequest(
            `${CONFIG.SUPABASE_URL}/rest/v1/rpc/increment_views`,
            { method: 'POST', body: { p_id: product.id } }
          );
          trackEndpoint('RPC increment_views', start3, rpcRes.status, rpcRes.size);
        } catch (e) {
          trackEndpoint('RPC increment_views', start3, 500, 0);
          logError('RPC increment_views', e.message, 'view_product');
        }
      }
    }
  } catch (e) {
    trackEndpoint('GET /products (slug)', start, 500, 0);
    logError('GET /products (slug)', e.message, 'view_product');
  }
}

// Scenario: Search products via direct PostgREST ilike on single JSONB column
async function scenarioSearch() {
  const queries = ['час', 'телефон', 'наушник', 'сумк', 'очк'];
  const q = queries[Math.floor(Math.random() * queries.length)];
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?select=*&is_active=eq.true&name->>ru=ilike.*${encodeURIComponent(q)}*&limit=20`
    );
    trackEndpoint('GET /products (search)', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /products (search)', start, 500, 0);
    logError('GET /products (search)', e.message, 'search');
  }
}

// Scenario: Get categories
async function scenarioCategories() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/categories?select=*&order=name->ru`
    );
    trackEndpoint('GET /categories', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /categories', start, 500, 0);
    logError('GET /categories', e.message, 'categories');
  }
}

// Scenario: Get banners
async function scenarioBanners() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/banners?select=*&is_active=eq.true&order=sort_order`
    );
    trackEndpoint('GET /banners', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /banners', start, 500, 0);
    logError('GET /banners', e.message, 'banners');
  }
}

// Scenario: Get collections
async function scenarioCollections() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/product_collections?select=*&is_active=eq.true&order=sort_order`
    );
    trackEndpoint('GET /collections', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /collections', start, 500, 0);
    logError('GET /collections', e.message, 'collections');
  }
}

// Scenario: Add to cart (simulated — just read stock)
async function scenarioAddToCart() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?select=id,stock,price,name&is_active=eq.true&stock=gt.0&limit=3&order=created_at.desc`
    );
    trackEndpoint('GET /products (cart)', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /products (cart)', start, 500, 0);
    logError('GET /products (cart)', e.message, 'add_to_cart');
  }
}

// Scenario: Checkout (edge function call)
async function scenarioCheckout() {
  const start = performance.now();
  try {
    // First get a real product to use in checkout
    const prodRes = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?select=id,price,stock&is_active=eq.true&stock=gt.0&limit=1&order=created_at.desc`
    );
    if (prodRes.status !== 200) {
      trackEndpoint('POST /checkout', start, prodRes.status, prodRes.size);
      return;
    }
    const products = JSON.parse(prodRes.body);
    if (!products?.length) {
      trackEndpoint('POST /checkout', start, 404, 0);
      return;
    }
    const product = products[0];

    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/functions/v1/checkout`,
      {
        method: 'POST',
        body: {
          telegram_user_id: 9999999000 + Math.floor(Math.random() * 1000),
          items: [{
            productId: product.id,
            name: { ru: 'Load Test Item', uz: 'Load Test Item' },
            price: product.price,
            quantity: 1,
          }],
          total_amount: product.price + 20000,
          customer_info: {
            name: 'Load Test User',
            phone: `+99890${String(Math.floor(Math.random() * 9999999)).padStart(7, '0')}`,
            city: 'Ташкент',
            address: 'Тестовый адрес 123',
          },
          delivery_type: 'standard',
          delivery_cost: 20000,
          payment_method: 'cash',
          notes: 'Load test order',
        },
      }
    );
    trackEndpoint('POST /checkout', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('POST /checkout', start, 500, 0);
    logError('POST /checkout', e.message, 'checkout');
  }
}

// Scenario: Client API (rate-limited 30/min per IP — will 429 under load from single machine)
async function scenarioClientApi() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/functions/v1/client-api`,
      {
        method: 'POST',
        body: {
          action: 'upsert_user',
          p_telegram_id: 9999999000 + Math.floor(Math.random() * 1000),
          p_first_name: 'LoadTest',
        },
      }
    );
    trackEndpoint('POST /client-api', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('POST /client-api', start, 500, 0);
    logError('POST /client-api', e.message, 'client_api');
  }
}

// Scenario: Get reviews
async function scenarioReviews() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/reviews?select=*&is_approved=eq.true&limit=10&order=created_at.desc`
    );
    trackEndpoint('GET /reviews', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /reviews', start, 500, 0);
    logError('GET /reviews', e.message, 'reviews');
  }
}

// Scenario: Get delivery zones
async function scenarioDeliveryZones() {
  const start = performance.now();
  try {
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/delivery_zones?select=*&order=standard_price`
    );
    trackEndpoint('GET /delivery_zones', start, res.status, res.size);
  } catch (e) {
    trackEndpoint('GET /delivery_zones', start, 500, 0);
    logError('GET /delivery_zones', e.message, 'delivery');
  }
}

// ─── User simulator ─────────────────────────────────────────────────────────
const SCENARIO_DISPATCH = [
  { weight: 30, fn: scenarioBrowseCatalog },
  { weight: 25, fn: scenarioViewProduct },
  { weight: 15, fn: scenarioSearch },
  { weight: 5,  fn: scenarioCategories },
  { weight: 5,  fn: scenarioBanners },
  { weight: 5,  fn: scenarioCollections },
  { weight: 10, fn: scenarioAddToCart },
  { weight: 5,  fn: scenarioCheckout },
  { weight: 3,  fn: scenarioReviews },
  { weight: 2,  fn: scenarioDeliveryZones },
  { weight: 0,  fn: scenarioClientApi },   // requires Telegram init_data
];

function pickScenario() {
  const total = SCENARIO_DISPATCH.reduce((s, d) => s + d.weight, 0);
  let r = Math.random() * total;
  for (const d of SCENARIO_DISPATCH) {
    r -= d.weight;
    if (r <= 0) return d.fn;
  }
  return SCENARIO_DISPATCH[0].fn;
}

// Simulate one virtual user's lifecycle
async function simulateUser(userId, phaseName) {
  const thinkTime = 1000 + Math.random() * 3000; // 1-4s between actions
  const actionsInSession = 3 + Math.floor(Math.random() * 8); // 3-10 actions per session

  for (let i = 0; i < actionsInSession && running; i++) {
    const scenario = pickScenario();
    await scenario();

    // Think time between actions
    if (i < actionsInSession - 1) {
      await sleep(thinkTime * (0.5 + Math.random()));
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Phase runner ───────────────────────────────────────────────────────────
async function runPhase(phase) {
  console.log(`\n▶ Phase: ${phase.name} — ${phase.users} users, ${phase.duration}s`);

  const phaseStart = performance.now();
  const phaseRequestsBefore = totalRequests;
  const phaseErrorsBefore = totalErrors;
  const phaseTimes = [];

  activeUsers = phase.users;
  peakConcurrent = Math.max(peakConcurrent, activeUsers);

  const users = [];
  for (let i = 0; i < phase.users; i++) {
    users.push(simulateUser(i, phase.name));
    // Stagger startup by 100ms per user to simulate ramp
    if (i % 10 === 9) await sleep(50);
  }

  // Wait for phase duration or all users done
  const deadline = performance.now() + phase.duration * 1000;
  await Promise.race([
    Promise.allSettled(users),
    sleep(phase.duration * 1000),
  ]);

  const elapsed = (performance.now() - phaseStart) / 1000;
  const phaseReqs = totalRequests - phaseRequestsBefore;
  const phaseErrs = totalErrors - phaseErrorsBefore;

  const phaseResult = {
    name: phase.name,
    targetUsers: phase.users,
    durationSec: Math.round(elapsed),
    requests: phaseReqs,
    errors: phaseErrs,
    rps: Math.round(phaseReqs / elapsed),
    errorRate: phaseReqs > 0 ? ((phaseErrs / phaseReqs) * 100).toFixed(2) : '0',
  };

  results.phases.push(phaseResult);
  console.log(`  ✓ ${phaseReqs} requests, ${phaseErrs} errors, ${phaseResult.rps} req/s, ${phaseResult.errorRate}% error rate`);
}

// ─── Report generator ───────────────────────────────────────────────────────
function generateReport() {
  const endTime = new Date().toISOString();
  const duration = (allResponseTimes.length > 0)
    ? ((performance.now() - performance.getEntriesByType('mark')[0]?.startTime || performance.now()) / 1000)
    : 0;

  // Calculate stats
  const sorted = [...allResponseTimes].sort((a, b) => a - b);
  const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const max = sorted[sorted.length - 1] || 0;
  const min = sorted[0] || 0;

  results.summary = {
    totalRequests,
    totalErrors,
    totalSuccess,
    errorRate: totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(2) : '0',
    successRate: totalRequests > 0 ? ((totalSuccess / totalRequests) * 100).toFixed(2) : '0',
    avgResponseMs: Math.round(avg),
    p50Ms: Math.round(p50),
    p90Ms: Math.round(p90),
    p95Ms: Math.round(p95),
    p99Ms: Math.round(p99),
    maxMs: Math.round(max),
    minMs: Math.round(min),
    peakConcurrent,
    rps: totalRequests > 0 ? Math.round(totalRequests / (duration || 1)) : 0,
  };

  // Endpoint breakdown
  const epReport = {};
  for (const [name, ep] of Object.entries(results.endpoints)) {
    const epSorted = [...ep.times].sort((a, b) => a - b);
    epReport[name] = {
      requests: ep.count,
      errors: ep.errors,
      avgMs: Math.round(ep.totalTime / ep.count),
      minMs: Math.round(ep.minTime),
      maxMs: Math.round(ep.maxTime),
      p50Ms: Math.round(epSorted[Math.floor(epSorted.length * 0.5)] || 0),
      p95Ms: Math.round(epSorted[Math.floor(epSorted.length * 0.95)] || 0),
      statusCodes: ep.statusCodes,
      totalSizeKB: Math.round(ep.totalSize / 1024),
    };
  }

  // Save JSON
  results.endTime = endTime;
  results.endpoints = epReport;
  fs.writeFileSync(
    path.join(import.meta.dirname, 'results.json'),
    JSON.stringify(results, null, 2)
  );

  // Generate Markdown report
  const md = generateMarkdown(results, epReport);
  fs.writeFileSync(path.join(import.meta.dirname, 'report.md'), md);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  LOAD TEST COMPLETE');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total requests:  ${totalRequests}`);
  console.log(`  Total errors:    ${totalErrors} (${results.summary.errorRate}%)`);
  console.log(`  Avg response:    ${results.summary.avgResponseMs}ms`);
  console.log(`  P95 response:    ${results.summary.p95Ms}ms`);
  console.log(`  P99 response:    ${results.summary.p99Ms}ms`);
  console.log(`  Max response:    ${results.summary.maxMs}ms`);
  console.log(`  Peak concurrent: ${peakConcurrent}`);
  console.log(`  RPS:             ${results.summary.rps}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Report: loadtest/report.md`);
  console.log(`  Data:   loadtest/results.json`);
}

function generateMarkdown(results, epReport) {
  const s = results.summary;
  const lines = [];

  lines.push('# KUPI Shop — Load Test Report');
  lines.push(`\n**Date:** ${results.startTime} → ${results.endTime}`);
  lines.push(`**Target:** 1000 concurrent users`);
  lines.push(`**Backend:** Supabase (PostgreSQL + Edge Functions)\n`);

  // Executive Summary
  lines.push('## Executive Summary\n');
  const maxUsers = CONFIG.PHASES.find(p => p.name === 'peak')?.users || 1000;
  const passed = parseFloat(s.errorRate) < CONFIG.THRESHOLDS.max_error_rate_pct && parseFloat(s.successRate) >= CONFIG.THRESHOLDS.min_success_rate_pct;
  lines.push(`| Metric | Value | Status |`);
  lines.push(`|--------|-------|--------|`);
  lines.push(`| Max concurrent users | ${maxUsers} | ✅ |`);
  lines.push(`| Total requests | ${s.totalRequests} | ✅ |`);
  lines.push(`| Error rate | ${s.errorRate}% | ${parseFloat(s.errorRate) < 5 ? '✅' : '❌'} |`);
  lines.push(`| Success rate | ${s.successRate}% | ${parseFloat(s.successRate) >= 95 ? '✅' : '❌'} |`);
  lines.push(`| Avg response time | ${s.avgResponseMs}ms | ${s.avgResponseMs < 1000 ? '✅' : s.avgResponseMs < 2000 ? '⚠️' : '❌'} |`);
  lines.push(`| P50 response time | ${s.p50Ms}ms | ${s.p50Ms < 500 ? '✅' : '⚠️'} |`);
  lines.push(`| P95 response time | ${s.p95Ms}ms | ${s.p95Ms < 1500 ? '✅' : s.p95Ms < 3000 ? '⚠️' : '❌'} |`);
  lines.push(`| P99 response time | ${s.p99Ms}ms | ${s.p99Ms < 3000 ? '✅' : '❌'} |`);
  lines.push(`| Max response time | ${s.maxMs}ms | ${s.maxMs < 5000 ? '✅' : '❌'} |`);
  lines.push(`| Peak RPS | ${s.rps} | ℹ️ |`);
  lines.push(`| Peak concurrent | ${s.peakConcurrent} | ℹ️ |`);
  lines.push('');

  // Overall verdict
  lines.push(`### Verdict: ${passed ? '✅ PASS — System can handle ~1000 concurrent users' : '❌ FAIL — System has issues at scale'}\n`);

  // Phase breakdown
  lines.push('## Phase Breakdown\n');
  lines.push('| Phase | Users | Duration | Requests | Errors | RPS | Error Rate |');
  lines.push('|-------|-------|----------|----------|--------|-----|------------|');
  for (const p of results.phases) {
    lines.push(`| ${p.name} | ${p.targetUsers} | ${p.durationSec}s | ${p.requests} | ${p.errors} | ${p.rps} | ${p.errorRate}% |`);
  }
  lines.push('');

  // Endpoint performance
  lines.push('## Endpoint Performance\n');
  lines.push('| Endpoint | Requests | Errors | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Status Codes |');
  lines.push('|----------|----------|--------|----------|----------|----------|----------|--------------|');
  const sortedEps = Object.entries(epReport).sort((a, b) => b[1].requests - a[1].requests);
  for (const [name, ep] of sortedEps) {
    const codes = Object.entries(ep.statusCodes).map(([c, n]) => `${c}:${n}`).join(', ');
    lines.push(`| ${name} | ${ep.requests} | ${ep.errors} | ${ep.avgMs} | ${ep.p50Ms} | ${ep.p95Ms} | ${ep.maxMs} | ${codes} |`);
  }
  lines.push('');

  // Slow queries (>1s)
  lines.push('## Slow Queries (>1s)\n');
  const slowEps = sortedEps.filter(([_, ep]) => ep.p95Ms > 1000 || ep.maxMs > 2000);
  if (slowEps.length > 0) {
    lines.push('| Endpoint | P95 (ms) | Max (ms) | Impact |');
    lines.push('|----------|----------|----------|--------|');
    for (const [name, ep] of slowEps) {
      const impact = ep.maxMs > 3000 ? '🔴 Critical' : ep.maxMs > 2000 ? '🟡 Warning' : '🟢 Minor';
      lines.push(`| ${name} | ${ep.p95Ms} | ${ep.maxMs} | ${impact} |`);
    }
  } else {
    lines.push('No slow queries detected.\n');
  }
  lines.push('');

  // Error analysis
  lines.push('## Error Analysis\n');
  const errorEndpoints = sortedEps.filter(([_, ep]) => ep.errors > 0);
  if (errorEndpoints.length > 0) {
    lines.push('| Endpoint | Errors | Error Rate | Most Common Status |');
    lines.push('|----------|--------|------------|-------------------|');
    for (const [name, ep] of errorEndpoints) {
      const topStatus = Object.entries(ep.statusCodes).sort((a, b) => b[1] - a[1])[0];
      const rate = ((ep.errors / ep.requests) * 100).toFixed(1);
      lines.push(`| ${name} | ${ep.errors} | ${rate}% | ${topStatus[0]} (${topStatus[1]}x) |`);
    }
  } else {
    lines.push('No errors detected.\n');
  }
  lines.push('');

  // Specific errors
  if (results.errors.length > 0) {
    lines.push('## Error Log (sample)\n');
    const sample = results.errors.slice(0, 20);
    lines.push('| Time | Endpoint | Error |');
    lines.push('|------|----------|-------|');
    for (const err of sample) {
      lines.push(`| ${err.time} | ${err.endpoint} | ${err.error} |`);
    }
    if (results.errors.length > 20) {
      lines.push(`\n... and ${results.errors.length - 20} more errors`);
    }
    lines.push('');
  }

  // Bottleneck analysis
  lines.push('## Bottleneck Analysis\n');
  const bottlenecks = [];

  // Check for slow endpoints
  for (const [name, ep] of sortedEps) {
    if (ep.p95Ms > 2000) bottlenecks.push(`**${name}**: P95 latency ${ep.p95Ms}ms is critically high`);
    else if (ep.p95Ms > 1000) bottlenecks.push(`**${name}**: P95 latency ${ep.p95Ms}ms should be optimized`);
    if (ep.errors > 0 && (ep.errors / ep.requests) > 0.05) {
      bottlenecks.push(`**${name}**: ${((ep.errors / ep.requests) * 100).toFixed(1)}% error rate exceeds threshold`);
    }
  }

  // Check for throughput degradation
  const phases = results.phases;
  for (let i = 1; i < phases.length; i++) {
    if (phases[i].rps < phases[i-1].rps * 0.7 && phases[i].targetUsers >= phases[i-1].targetUsers) {
      bottlenecks.push(`**Throughput drop**: RPS dropped from ${phases[i-1].rps} to ${phases[i].rps} when scaling from ${phases[i-1].targetUsers} to ${phases[i].targetUsers} users`);
    }
  }

  if (bottlenecks.length > 0) {
    for (const b of bottlenecks) {
      lines.push(`- ${b}`);
    }
  } else {
    lines.push('No significant bottlenecks detected.');
  }
  lines.push('');

  // Recommendations
  lines.push('## Recommendations\n');
  lines.push('### Critical');
  lines.push('');
  if (s.p95Ms > 2000) {
    lines.push('1. **Optimize slow queries** — P95 response time exceeds 2s. Add database indexes for frequently queried columns:');
    lines.push('   ```sql');
    lines.push('   CREATE INDEX IF NOT EXISTS idx_products_active_created ON products(is_active, created_at DESC);');
    lines.push('   CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);');
    lines.push('   CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id) WHERE is_active = true;');
    lines.push('   CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, is_approved);');
    lines.push('   CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(telegram_user_id, created_at DESC);');
    lines.push('   ```');
  }
  lines.push('');
  lines.push('### High Priority');
  lines.push('');
  lines.push('1. **Enable Supabase connection pooling** — Use PgBouncer for high-concurrency scenarios');
  lines.push('2. **Add Redis caching layer** — Cache frequently-read data (products, categories, banners) for 30-60s');
  lines.push('3. **Implement CDN for static assets** — Product images should be served via CDN (Cloudflare/CloudFront)');
  lines.push('4. **Add database read replicas** — Offload read-heavy queries to replicas');
  lines.push('');
  lines.push('### Medium Priority');
  lines.push('');
  lines.push('1. **Optimize Edge Function cold starts** — Keep functions warm with scheduled invocations');
  lines.push('2. **Add response compression** — Enable gzip/brotli at the CDN level');
  lines.push('3. **Implement pagination caching** — Cache paginated product lists on the client');
  lines.push('4. **Add rate limiting** — Prevent abuse and ensure fair resource allocation');
  lines.push('');
  lines.push('### Low Priority');
  lines.push('');
  lines.push('1. **Database connection monitoring** — Add pg_stat_statements for query analysis');
  lines.push('2. **APM integration** — Add Sentry or Datadog for production monitoring');
  lines.push('3. **Auto-scaling rules** — Configure Supabase scaling based on connection count');
  lines.push('');

  // Supabase-specific notes
  lines.push('## Supabase-Specific Notes\n');
  lines.push('- **Free tier**: 500MB database, 1GB file storage, 500K Edge Function invocations/month');
  lines.push('- **Pro tier** ($25/mo): 8GB database, 100GB storage, 2M invocations — recommended for production');
  lines.push('- **Connection limits**: Free=60, Pro=200, Team=400 — critical for 1000 concurrent users');
  lines.push('- **Edge Function timeout**: 15s max — checkout/payment must complete within this');
  lines.push('- **RLS overhead**: Row Level Security adds ~5-15ms per query — consider service_role for internal calls');
  lines.push('');

  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  KUPI Shop — Load Test                                 ║');
  console.log('║  Target: 1000 concurrent users                         ║');
  console.log('║  Backend: Supabase                                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Quick connectivity check
  console.log('\n🔌 Checking connectivity...');
  try {
    const start = performance.now();
    const res = await httpRequest(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?select=id&limit=1`
    );
    const elapsed = Math.round(performance.now() - start);
    console.log(`  ✅ Connected (${elapsed}ms, status ${res.status})`);
    if (res.status !== 200) {
      console.log(`  ⚠️  Response: ${res.body.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`  ❌ Connection failed: ${e.message}`);
    console.log('  Cannot reach Supabase. Aborting test.');
    process.exit(1);
  }

  // Run phases
  performance.mark('test-start');
  for (const phase of CONFIG.PHASES) {
    if (!running) break;
    await runPhase(phase);
  }
  performance.mark('test-end');

  // Generate report
  generateReport();
}

main().catch(console.error);
