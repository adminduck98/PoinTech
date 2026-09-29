// ─── Load Test Configuration ────────────────────────────────────────────────
// KUPI Shop — 1000 concurrent users load test

// The target comes from the environment, with no default.
//
// These two values used to be hard-coded to the production project. The anon
// key is public by design, so that was not a leak — the problem is the default:
// this script ramps to 1000 concurrent users, and a committed production URL
// means the obvious way to run it is straight at the live shop. Requiring the
// variables makes choosing the target a deliberate act.
const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(
      `\n${name} is not set.\n\n` +
      `  Point the load test at a target explicitly, e.g.\n` +
      `    SUPABASE_URL=https://<project>.supabase.co \\\n` +
      `    SUPABASE_ANON_KEY=<anon key> \\\n` +
      `    node loadtest/test.js\n`
    );
    process.exit(1);
  }
  return value;
};

export const CONFIG = {
  // Supabase
  SUPABASE_URL: required('SUPABASE_URL'),
  ANON_KEY: required('SUPABASE_ANON_KEY'),

  // Test phases
  PHASES: [
    { name: 'warmup',     users: 50,   duration: 30 },   // 30s warmup
    { name: 'ramp-up',    users: 200,  duration: 30 },   // ramp to 200
    { name: 'steady-200', users: 200,  duration: 60 },   // hold 200 for 60s
    { name: 'ramp-up-2',  users: 500,  duration: 30 },   // ramp to 500
    { name: 'steady-500', users: 500,  duration: 60 },   // hold 500 for 60s
    { name: 'ramp-up-3',  users: 1000, duration: 30 },   // ramp to 1000
    { name: 'peak',       users: 1000, duration: 60 },   // hold 1000 for 60s
    { name: 'cooldown',   users: 50,   duration: 15 },   // cooldown
  ],

  // Scenario weights (probability distribution)
  SCENARIOS: {
    browse_catalog:   0.30,  // 30% — just browse
    view_product:     0.25,  // 25% — open product detail
    search:           0.15,  // 15% — search products
    add_to_cart:      0.10,  // 10% — add to cart
    checkout:         0.05,  // 5%  — place order (now deployed)
    view_orders:      0.05,  // 5%  — view order history
    view_favorites:   0.05,  // 5%  — view favorites
    view_profile:     0.00,  // 0%  — not implemented
    client_api:       0.05,  // 5%  — client API calls (now deployed)
  },

  // Thresholds
  THRESHOLDS: {
    max_response_time_ms: 3000,     // fail if > 3s
    max_error_rate_pct:  5.0,       // fail if > 5% errors
    min_success_rate_pct: 95.0,     // must have > 95% success
  },
};
