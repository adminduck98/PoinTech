# KUPI Shop — Load Test Report

**Date:** 2026-07-08T16:50:36.102Z → 2026-07-08T16:55:34.456Z
**Target:** 1000 concurrent users
**Backend:** Supabase (PostgreSQL + Edge Functions)

## Executive Summary

| Metric | Value | Status |
|--------|-------|--------|
| Max concurrent users | 1000 | ✅ |
| Total requests | 33198 | ✅ |
| Error rate | 3.24% | ✅ |
| Success rate | 96.76% | ✅ |
| Avg response time | 404ms | ✅ |
| P50 response time | 376ms | ✅ |
| P95 response time | 635ms | ✅ |
| P99 response time | 1414ms | ✅ |
| Max response time | 3162ms | ✅ |
| Peak RPS | 112 | ℹ️ |
| Peak concurrent | 1000 | ℹ️ |

### Verdict: ✅ PASS — System can handle ~1000 concurrent users

## Phase Breakdown

| Phase | Users | Duration | Requests | Errors | RPS | Error Rate |
|-------|-------|----------|----------|--------|-----|------------|
| warmup | 50 | 30s | 441 | 12 | 15 | 2.72% |
| ramp-up | 200 | 31s | 1831 | 50 | 59 | 2.73% |
| steady-200 | 200 | 48s | 2018 | 57 | 42 | 2.82% |
| ramp-up-2 | 500 | 33s | 4501 | 162 | 136 | 3.60% |
| steady-500 | 500 | 48s | 4981 | 155 | 105 | 3.11% |
| ramp-up-3 | 1000 | 36s | 9312 | 344 | 262 | 3.69% |
| peak | 1000 | 56s | 9743 | 282 | 175 | 2.89% |
| cooldown | 50 | 15s | 371 | 13 | 24 | 3.50% |

## Endpoint Performance

| Endpoint | Requests | Errors | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Status Codes |
|----------|----------|--------|----------|----------|----------|----------|--------------|
| GET /products | 6468 | 0 | 425 | 381 | 681 | 3162 | 200:6468 |
| GET /products (slug) | 5288 | 0 | 413 | 377 | 676 | 2098 | 200:5288 |
| GET /product/:slug | 5286 | 0 | 381 | 374 | 421 | 2071 | 200:5286 |
| RPC increment_views | 5286 | 0 | 373 | 373 | 397 | 1680 | 204:5286 |
| GET /products (search) | 3275 | 0 | 416 | 377 | 674 | 2362 | 200:3275 |
| GET /products (cart) | 2150 | 0 | 409 | 376 | 653 | 1963 | 200:2150 |
| GET /categories | 1107 | 0 | 411 | 376 | 675 | 1859 | 200:1107 |
| POST /checkout | 1075 | 1075 | 404 | 376 | 654 | 1845 | 404:1075 |
| GET /banners | 1066 | 0 | 411 | 378 | 659 | 1952 | 200:1066 |
| GET /collections | 1065 | 0 | 417 | 377 | 666 | 2513 | 200:1065 |
| GET /reviews | 697 | 0 | 415 | 377 | 704 | 2388 | 200:697 |
| GET /delivery_zones | 435 | 0 | 423 | 382 | 664 | 1731 | 200:435 |

## Slow Queries (>1s)

| Endpoint | P95 (ms) | Max (ms) | Impact |
|----------|----------|----------|--------|
| GET /products | 681 | 3162 | 🔴 Critical |
| GET /products (slug) | 676 | 2098 | 🟡 Warning |
| GET /product/:slug | 421 | 2071 | 🟡 Warning |
| GET /products (search) | 674 | 2362 | 🟡 Warning |
| GET /collections | 666 | 2513 | 🟡 Warning |
| GET /reviews | 704 | 2388 | 🟡 Warning |

## Error Analysis

| Endpoint | Errors | Error Rate | Most Common Status |
|----------|--------|------------|-------------------|
| POST /checkout | 1075 | 100.0% | 404 (1075x) |

## Bottleneck Analysis

- **POST /checkout**: 100.0% error rate exceeds threshold
- **Throughput drop**: RPS dropped from 262 to 175 when scaling from 1000 to 1000 users

## Recommendations

### Critical


### High Priority

1. **Enable Supabase connection pooling** — Use PgBouncer for high-concurrency scenarios
2. **Add Redis caching layer** — Cache frequently-read data (products, categories, banners) for 30-60s
3. **Implement CDN for static assets** — Product images should be served via CDN (Cloudflare/CloudFront)
4. **Add database read replicas** — Offload read-heavy queries to replicas

### Medium Priority

1. **Optimize Edge Function cold starts** — Keep functions warm with scheduled invocations
2. **Add response compression** — Enable gzip/brotli at the CDN level
3. **Implement pagination caching** — Cache paginated product lists on the client
4. **Add rate limiting** — Prevent abuse and ensure fair resource allocation

### Low Priority

1. **Database connection monitoring** — Add pg_stat_statements for query analysis
2. **APM integration** — Add Sentry or Datadog for production monitoring
3. **Auto-scaling rules** — Configure Supabase scaling based on connection count

## Supabase-Specific Notes

- **Free tier**: 500MB database, 1GB file storage, 500K Edge Function invocations/month
- **Pro tier** ($25/mo): 8GB database, 100GB storage, 2M invocations — recommended for production
- **Connection limits**: Free=60, Pro=200, Team=400 — critical for 1000 concurrent users
- **Edge Function timeout**: 15s max — checkout/payment must complete within this
- **RLS overhead**: Row Level Security adds ~5-15ms per query — consider service_role for internal calls
