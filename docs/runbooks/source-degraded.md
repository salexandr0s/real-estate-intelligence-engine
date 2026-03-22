# Runbook: Source Degraded

When a source shows declining health but is not yet blocked.

## Symptoms

- Rising HTTP 4xx rate (above normal baseline)
- Fewer listings discovered per run than expected
- Completeness score dropping on newly ingested listings
- `health_status` is `'degraded'` or trending toward it

## Detection

```sql
-- Check source health status
SELECT code, health_status, is_active, updated_at
  FROM sources WHERE code = '<source_code>';

-- Review recent scrape runs for degradation signals
SELECT id, started_at, status,
       pages_fetched, listings_discovered,
       http_2xx, http_4xx, http_5xx, parse_failures
  FROM scrape_runs
  WHERE source_id = (SELECT id FROM sources WHERE code = '<source_code>')
  ORDER BY started_at DESC
  LIMIT 10;

-- Check completeness trend on recent raw listings
SELECT DATE(created_at), AVG(completeness_score), COUNT(*)
  FROM raw_listings
  WHERE source_id = (SELECT id FROM sources WHERE code = '<source_code>')
    AND created_at > NOW() - INTERVAL '3 days'
  GROUP BY 1 ORDER BY 1;
```

## Resolution

1. Review failure artifacts for the degraded runs (HTML captures, screenshots)
2. Check for DOM/structure changes on the source site
3. Capture fresh fixtures: `npx tsx scripts/capture-site-html.ts --source <source_code>`
4. Compare new fixtures against stored fixtures for structural drift
5. If selectors changed: update parser, bump `parserVersion`, update fixture files
6. If rate-related: reduce `rate_limit_rpm` or increase `crawl_interval_minutes`
7. If completeness dropping: check which fields are now returning null, update extraction

## Verification

1. Run a canary crawl: `npx tsx scripts/scrape-and-ingest.ts --source <source_code> --pages 1`
2. Confirm success rate > 95% on the canary run
3. Confirm listings discovered is within expected range
4. Monitor next 3 scheduled runs for sustained recovery
5. Confirm `health_status` returns to `'healthy'`
