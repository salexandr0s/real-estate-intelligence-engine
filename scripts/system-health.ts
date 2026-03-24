#!/usr/bin/env npx tsx
/**
 * System health check script.
 *
 * Queries database for key health metrics and reports warnings.
 *
 * Usage:
 *   npx tsx scripts/system-health.ts
 */

import { loadConfig } from '@immoradar/config';
import { query, closePool } from '@immoradar/db';

interface HealthCheck {
  name: string;
  value: string;
  status: 'ok' | 'warn' | 'error';
}

async function main(): Promise<void> {
  loadConfig();
  const checks: HealthCheck[] = [];

  // 1. Active listing count
  const [{ count: listingCount }] = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM listings WHERE listing_status = 'active'`,
  );
  checks.push({
    name: 'Active listings',
    value: listingCount!,
    status: Number(listingCount) > 0 ? 'ok' : 'warn',
  });

  // 2. Scored listing count
  const [{ count: scoredCount }] = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM listings WHERE current_score IS NOT NULL`,
  );
  checks.push({
    name: 'Scored listings',
    value: scoredCount!,
    status: Number(scoredCount) > 0 ? 'ok' : 'warn',
  });

  // 3. Last successful scrape run
  const lastRuns = await query<{ finished_at: Date; status: string }>(
    `SELECT finished_at, status FROM scrape_runs
     WHERE status = 'succeeded'
     ORDER BY finished_at DESC LIMIT 1`,
  );
  if (lastRuns.length > 0) {
    const hoursAgo = (Date.now() - new Date(lastRuns[0]!.finished_at).getTime()) / 3600000;
    checks.push({
      name: 'Last successful scrape',
      value: `${Math.round(hoursAgo * 10) / 10}h ago`,
      status: hoursAgo < 2 ? 'ok' : hoursAgo < 6 ? 'warn' : 'error',
    });
  } else {
    checks.push({ name: 'Last successful scrape', value: 'never', status: 'error' });
  }

  // 4. Baseline count
  const [{ count: baselineCount }] = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM market_baselines`,
  );
  checks.push({
    name: 'Market baselines',
    value: baselineCount!,
    status: Number(baselineCount) > 0 ? 'ok' : 'warn',
  });

  // 4b. Baseline freshness
  const [{ latest: latestBaseline }] = await query<{ latest: Date | null }>(
    `SELECT MAX(baseline_date) AS latest FROM market_baselines`,
  );
  if (latestBaseline) {
    const hoursAgo = (Date.now() - new Date(latestBaseline).getTime()) / 3600000;
    checks.push({
      name: 'Baseline freshness',
      value: `${Math.round(hoursAgo * 10) / 10}h ago`,
      status: hoursAgo < 2 ? 'ok' : hoursAgo < 4 ? 'warn' : 'error',
    });
  } else {
    checks.push({ name: 'Baseline freshness', value: 'no baselines', status: 'error' });
  }

  // 5. Pending alerts
  const [{ count: alertCount }] = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM alerts WHERE status = 'queued'`,
  );
  checks.push({
    name: 'Queued alerts',
    value: alertCount!,
    status: 'ok',
  });

  // 6. Stale listings (not seen in 7+ days)
  const [{ count: staleCount }] = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM listings
     WHERE listing_status = 'active'
       AND last_seen_at < NOW() - INTERVAL '7 days'`,
  );
  checks.push({
    name: 'Stale listings (7+ days)',
    value: staleCount!,
    status: Number(staleCount) === 0 ? 'ok' : 'warn',
  });

  // 7. Source health
  const sourcesResult = await query<{ code: string; health_status: string }>(
    `SELECT code, health_status FROM sources WHERE is_active = true`,
  );
  for (const src of sourcesResult) {
    checks.push({
      name: `Source: ${src.code}`,
      value: src.health_status,
      status:
        src.health_status === 'healthy'
          ? 'ok'
          : src.health_status === 'degraded'
            ? 'warn'
            : 'error',
    });
  }

  // Print report
  console.log('\n=== System Health Report ===\n');
  const maxName = Math.max(...checks.map((c) => c.name.length));
  for (const check of checks) {
    const icon = check.status === 'ok' ? '[OK]' : check.status === 'warn' ? '[!!]' : '[XX]';
    console.log(`  ${icon} ${check.name.padEnd(maxName + 2)} ${check.value}`);
  }

  const hasErrors = checks.some((c) => c.status === 'error');
  const hasWarnings = checks.some((c) => c.status === 'warn');
  console.log(`\nOverall: ${hasErrors ? 'UNHEALTHY' : hasWarnings ? 'WARNINGS' : 'HEALTHY'}\n`);

  await closePool();
  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error('Health check failed:', err);
  process.exit(1);
});
