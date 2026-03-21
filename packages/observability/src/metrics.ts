// ── Prometheus Metrics ──────────────────────────────────────────────────────

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Scraper metrics

export const scrapeRunsTotal = new Counter({
  name: 'rei_scrape_runs_total',
  help: 'Total scrape runs by source and status',
  labelNames: ['source', 'status'] as const,
  registers: [registry],
});

export const scrapePagesTotal = new Counter({
  name: 'rei_scrape_pages_total',
  help: 'Total pages fetched by source',
  labelNames: ['source'] as const,
  registers: [registry],
});

export const scrapeListingsDiscovered = new Counter({
  name: 'rei_scrape_listings_discovered_total',
  help: 'Total listings discovered by source',
  labelNames: ['source'] as const,
  registers: [registry],
});

export const scrapeErrorsTotal = new Counter({
  name: 'rei_scrape_errors_total',
  help: 'Scrape errors by source and error class',
  labelNames: ['source', 'error_class'] as const,
  registers: [registry],
});

// Normalization metrics

export const normalizationTotal = new Counter({
  name: 'rei_normalization_total',
  help: 'Normalization operations by outcome',
  labelNames: ['source', 'outcome'] as const, // 'created', 'updated', 'unchanged', 'failed'
  registers: [registry],
});

// Raw snapshot metrics (used by pipeline instrumentation)

export const rawSnapshotRate = new Counter({
  name: 'rei_raw_snapshots_total',
  help: 'Raw snapshots created',
  labelNames: ['source'] as const,
  registers: [registry],
});

// Version creation metrics (used by pipeline instrumentation)

export const versionCreationRate = new Counter({
  name: 'rei_versions_created_total',
  help: 'Listing versions created',
  labelNames: ['source', 'reason'] as const,
  registers: [registry],
});

// Scoring metrics

export const scoringDuration = new Histogram({
  name: 'rei_scoring_duration_seconds',
  help: 'Time to score a listing',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
  registers: [registry],
});

// Alert metrics

export const alertsCreatedTotal = new Counter({
  name: 'rei_alerts_created_total',
  help: 'Alerts created by type',
  labelNames: ['alert_type'] as const,
  registers: [registry],
});

export const alertLagSeconds = new Histogram({
  name: 'rei_alert_lag_seconds',
  help: 'Time from listing score to alert creation',
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

// API metrics

export const apiRequestDuration = new Histogram({
  name: 'rei_api_request_duration_seconds',
  help: 'API request duration by route and method',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

// Queue metrics

export const queueDepth = new Gauge({
  name: 'rei_queue_depth',
  help: 'Current queue depth by queue name',
  labelNames: ['queue'] as const,
  registers: [registry],
});

// Source health

export const sourceHealthGauge = new Gauge({
  name: 'rei_source_health',
  help: 'Source health status (1=healthy, 0.5=degraded, 0=blocked/disabled)',
  labelNames: ['source'] as const,
  registers: [registry],
});
