#!/usr/bin/env node
/**
 * Minimal dependency-free load/stress tester.
 *
 * Usage:
 *   node scripts/load-test.mjs [baseUrl] [concurrency] [totalRequests]
 *
 * Examples:
 *   node scripts/load-test.mjs                                          # defaults: localhost, 100c × 1000 total
 *   node scripts/load-test.mjs https://cadieux.in 100 1000              # live site, 100 concurrent, 1000 total
 *   node scripts/load-test.mjs http://localhost:3000 200 5000           # production build locally
 *
 * What it does:
 *   - Picks a weighted random route from a realistic traffic mix.
 *   - Holds up to `concurrency` in-flight at all times until `totalRequests` completes.
 *   - Reports: p50 / p95 / p99 latency, throughput, status-code histogram,
 *     per-route breakdown, and any error lines.
 *
 * Caveats:
 *   - This is not a substitute for a real tool like k6 — no scripted user
 *     sessions, no think-time, no sustained soak. Use it as a smoke test.
 *   - Running against localhost only exercises your laptop; real capacity
 *     on Vercel is determined by Vercel's edge network, not this script.
 */

const base = process.argv[2] || "http://localhost:3000";
const concurrency = parseInt(process.argv[3] || "100", 10);
const total = parseInt(process.argv[4] || "1000", 10);

// Weighted traffic mix — what a typical visitor session looks like.
const routes = [
  { path: "/",                       weight: 25 },
  { path: "/shop",                   weight: 20 },
  { path: "/shop/multigrain",        weight: 15 },
  { path: "/shop/plain",             weight: 15 },
  { path: "/shop/multigrain/reports", weight: 5 },
  { path: "/shop/plain/reports",      weight: 5 },
  { path: "/cart",                   weight: 5 },
  { path: "/blogs",                  weight: 5 },
  { path: "/making",                 weight: 5 },
];
const weightTotal = routes.reduce((a, r) => a + r.weight, 0);
const pickRoute = () => {
  let r = Math.random() * weightTotal;
  for (const route of routes) {
    r -= route.weight;
    if (r <= 0) return route.path;
  }
  return routes[0].path;
};

const perRoute = new Map();
const statuses = new Map();
const latencies = [];
const errors = [];

let completed = 0;
let inFlight = 0;
let started = 0;
const startedAt = Date.now();

const makeRequest = async () => {
  const path = pickRoute();
  const url = base + path;
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: "follow" });
    await res.text(); // drain body
    const dt = performance.now() - t0;
    latencies.push(dt);
    statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
    const rs = perRoute.get(path) || { count: 0, ok: 0, errors: 0, totalMs: 0 };
    rs.count++;
    rs.totalMs += dt;
    if (res.ok) rs.ok++; else rs.errors++;
    perRoute.set(path, rs);
  } catch (err) {
    errors.push(`${path}: ${err.message}`);
    const rs = perRoute.get(path) || { count: 0, ok: 0, errors: 0, totalMs: 0 };
    rs.count++;
    rs.errors++;
    perRoute.set(path, rs);
  }
};

const run = async () => {
  console.log(`Target: ${base}`);
  console.log(`Concurrency: ${concurrency}  Total: ${total}\n`);
  await new Promise((resolve) => {
    const pump = () => {
      while (inFlight < concurrency && started < total) {
        started++;
        inFlight++;
        makeRequest().finally(() => {
          inFlight--;
          completed++;
          if (completed % Math.max(1, Math.floor(total / 10)) === 0) {
            process.stdout.write(`  ${completed}/${total}\n`);
          }
          if (completed === total) resolve();
          else pump();
        });
      }
    };
    pump();
  });

  const elapsed = (Date.now() - startedAt) / 1000;
  latencies.sort((a, b) => a - b);
  const p = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] || 0;

  console.log("\n── Summary ──");
  console.log(`Elapsed:     ${elapsed.toFixed(2)}s`);
  console.log(`Throughput:  ${(completed / elapsed).toFixed(1)} req/s`);
  console.log(`Latency p50: ${p(0.5).toFixed(0)}ms   p95: ${p(0.95).toFixed(0)}ms   p99: ${p(0.99).toFixed(0)}ms`);
  console.log(`Statuses:    ${[...statuses.entries()].map(([s, n]) => `${s}:${n}`).join("  ")}`);
  if (errors.length) {
    console.log(`Errors:      ${errors.length}`);
    const uniq = [...new Set(errors)].slice(0, 5);
    uniq.forEach((e) => console.log(`             - ${e}`));
  } else {
    console.log(`Errors:      0`);
  }

  console.log("\n── Per-route ──");
  const rows = [...perRoute.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [path, s] of rows) {
    const avg = s.count ? s.totalMs / s.count : 0;
    const errPct = s.count ? ((s.errors / s.count) * 100).toFixed(1) : "0.0";
    console.log(
      `${path.padEnd(30)} ${String(s.count).padStart(5)} reqs   ` +
      `avg ${avg.toFixed(0)}ms   err ${errPct}%`
    );
  }

  process.exit(errors.length ? 1 : 0);
};

run();
