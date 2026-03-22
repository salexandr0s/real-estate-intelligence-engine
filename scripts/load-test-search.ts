#!/usr/bin/env npx tsx
/**
 * Load test for the listing search endpoint.
 * Usage: npx tsx scripts/load-test-search.ts [--concurrency 5] [--requests 100] [--base-url http://localhost:8080]
 */

interface CliArgs {
  concurrency: number;
  requests: number;
  baseUrl: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let concurrency = 5;
  let requests = 100;
  let baseUrl = 'http://localhost:8080';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[i + 1]!, 10);
      i++;
    }
    if (args[i] === '--requests' && args[i + 1]) {
      requests = parseInt(args[i + 1]!, 10);
      i++;
    }
    if (args[i] === '--base-url' && args[i + 1]) {
      baseUrl = args[i + 1]!;
      i++;
    }
  }

  return { concurrency, requests, baseUrl };
}

// ── Random filter parameter generators ──────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDistricts(): number[] {
  const count = randomInt(1, 5);
  const districts = new Set<number>();
  while (districts.size < count) {
    districts.add(randomInt(1, 23));
  }
  return [...districts];
}

const PROPERTY_TYPES = ['apartment', 'house', 'land', 'commercial', 'parking', 'other'];
const SORT_OPTIONS = ['score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc'];

function buildRandomQueryParams(): URLSearchParams {
  const params = new URLSearchParams();

  // Randomly include each filter parameter
  if (Math.random() > 0.3) {
    params.set('districts', randomDistricts().join(','));
  }
  if (Math.random() > 0.5) {
    const types = PROPERTY_TYPES.slice(0, randomInt(1, 3));
    params.set('propertyTypes', types.join(','));
  }
  if (Math.random() > 0.4) {
    params.set('minPriceEur', String(randomInt(50000, 200000)));
    params.set('maxPriceEur', String(randomInt(300000, 1500000)));
  }
  if (Math.random() > 0.5) {
    params.set('minAreaSqm', String(randomInt(30, 60)));
    params.set('maxAreaSqm', String(randomInt(80, 200)));
  }
  if (Math.random() > 0.6) {
    params.set('minRooms', String(randomInt(1, 2)));
    params.set('maxRooms', String(randomInt(3, 6)));
  }
  if (Math.random() > 0.7) {
    params.set('minScore', String(randomInt(40, 70)));
  }

  const sortOption = SORT_OPTIONS[randomInt(0, SORT_OPTIONS.length - 1)];
  if (sortOption) {
    params.set('sortBy', sortOption);
  }

  params.set('limit', String(randomInt(10, 50)));

  return params;
}

// ── Request execution ───────────────────────────────────────────────────────

interface RequestResult {
  durationMs: number;
  status: number;
  ok: boolean;
}

async function sendRequest(baseUrl: string): Promise<RequestResult> {
  const params = buildRandomQueryParams();
  const url = `${baseUrl}/v1/listings?${params.toString()}`;
  const start = performance.now();

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env['REI_API_TOKEN'] ?? 'test-token'}`,
      },
      signal: AbortSignal.timeout(30000),
    });

    const durationMs = performance.now() - start;
    // Consume the body to ensure the full response is received
    await response.text();

    return { durationMs, status: response.status, ok: response.ok };
  } catch {
    const durationMs = performance.now() - start;
    return { durationMs, status: 0, ok: false };
  }
}

// ── Percentile calculation ──────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { concurrency, requests, baseUrl } = parseArgs();

  console.log(`Load test: ${requests} requests, concurrency ${concurrency}`);
  console.log(`Target: ${baseUrl}/v1/listings`);
  console.log('');

  const results: RequestResult[] = [];
  let completed = 0;

  // Worker function — pulls from a shared counter
  async function worker(): Promise<void> {
    while (completed < requests) {
      const current = completed++;
      if (current >= requests) break;

      const result = await sendRequest(baseUrl);
      results.push(result);

      if (results.length % 10 === 0) {
        process.stdout.write(`\r  Progress: ${results.length}/${requests}`);
      }
    }
  }

  const startTime = performance.now();
  const workers = Array.from({ length: Math.min(concurrency, requests) }, () => worker());
  await Promise.all(workers);
  const totalDurationMs = performance.now() - startTime;

  console.log(`\r  Progress: ${results.length}/${requests}`);
  console.log('');

  // ── Compute statistics ──────────────────────────────────────────────────

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const errorCount = results.filter((r) => !r.ok).length;
  const successCount = results.length - errorCount;

  const statusCounts = new Map<number, number>();
  for (const r of results) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }

  // ── Report ────────────────────────────────────────────────────────────────

  console.log('=== Load Test Results ===');
  console.log('');
  console.log(`Total requests:    ${results.length}`);
  console.log(`Successful:        ${successCount}`);
  console.log(`Failed:            ${errorCount}`);
  console.log(`Error rate:        ${((errorCount / results.length) * 100).toFixed(1)}%`);
  console.log(`Total duration:    ${(totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`Throughput:        ${(results.length / (totalDurationMs / 1000)).toFixed(1)} req/s`);
  console.log('');
  console.log('Response times:');
  console.log(`  p50:             ${percentile(durations, 50).toFixed(0)}ms`);
  console.log(`  p95:             ${percentile(durations, 95).toFixed(0)}ms`);
  console.log(`  p99:             ${percentile(durations, 99).toFixed(0)}ms`);
  console.log(`  min:             ${(durations[0] ?? 0).toFixed(0)}ms`);
  console.log(`  max:             ${(durations[durations.length - 1] ?? 0).toFixed(0)}ms`);
  console.log('');
  console.log('Status codes:');
  for (const [status, count] of [...statusCounts.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${status || 'timeout/error'}:  ${count}`);
  }
}

void main();
