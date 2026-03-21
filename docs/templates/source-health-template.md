# Source Health: {source_name}

## Health Indicators

| Metric                          | SLO       | Notes                                    |
| ------------------------------- | --------- | ---------------------------------------- |
| Crawl success rate              | > {X}%    | Percentage of runs with status `succeeded` or `partial` |
| Parse success rate              | > {X}%    | Percentage of detail pages with `extraction_status = 'captured'` |
| Expected listings per discovery | {N}--{M}  | Per run, based on `rows` x `maxPages`    |
| Max acceptable block rate       | < {X}%    | Percentage of requests returning 403/429 |
| Max acceptable captcha rate     | < {X}%    | `captcha_count / pages_fetched` ratio    |

## Monitoring

### Scrape run status

```sql
-- Recent run outcomes for this source
SELECT status, COUNT(*), MAX(finished_at)
FROM scrape_runs
WHERE source_id = (SELECT id FROM sources WHERE code = '{source_code}')
  AND scheduled_at > NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY COUNT(*) DESC;
```

```sql
-- Last 10 runs with metrics
SELECT run_uuid, status, pages_fetched, listings_discovered,
       raw_snapshots_created, http_4xx, captcha_count,
       started_at, finished_at
FROM scrape_runs
WHERE source_id = (SELECT id FROM sources WHERE code = '{source_code}')
ORDER BY scheduled_at DESC
LIMIT 10;
```

### Source health status

```sql
-- Current health status
SELECT code, health_status, last_successful_run_at, rate_limit_rpm,
       crawl_interval_minutes, is_active
FROM sources
WHERE code = '{source_code}';
```

Health status values: `healthy`, `degraded`, `blocked`, `disabled`, `unknown`.

Updated via `sources.updateHealthStatus(id, status, lastSuccessfulRunAt?)`.

### Circuit breaker state

The circuit breaker is in-memory per worker process (`SourceCircuitBreaker`).

- **closed**: Normal operation, requests flow
- **open**: 5 consecutive failures reached, requests blocked until cooldown (300s) expires
- **half_open**: Cooldown elapsed, single probe request allowed

Check worker logs for circuit breaker state transitions:
```
circuit_breaker_opened source={source_code} failures=5
circuit_breaker_half_open source={source_code}
circuit_breaker_closed source={source_code}
```

## Degradation Signals

| Signal | Detection | Severity |
| ------ | --------- | -------- |
| Fewer listings than expected | `listings_discovered` consistently below {N} | Warning |
| Rising 4xx rate | `http_4xx / pages_fetched` > {X}% over 3+ runs | Warning |
| Increasing captcha count | `captcha_count > 0` on multiple runs | Critical |
| Empty discovery pages | `listings_discovered = 0` with `http_2xx > 0` | Critical |
| Parse failures rising | `extraction_status = 'parse_failed'` rate increasing | Warning |
| Circuit breaker opening repeatedly | Opens 3+ times in 24 hours | Critical |
| Stale listings growing | Active listings not seen in 7+ days increasing | Warning |

## Recovery Procedures

### Cooldown and retry

Two independent cooldown timers apply:

- **Block cooldown** (`SCRAPER_COOLDOWN_AFTER_BLOCK_MS`): 900,000ms (15 min). Prevents any requests to the source after a block is detected.
- **Circuit breaker cooldown**: 300,000ms (5 min). After 5 consecutive failures, blocks requests until cooldown expires.

Recovery sequence:

1. Both cooldown timers must expire before the source accepts requests
2. Circuit breaker enters `half_open` — next scheduled run sends a single probe request
3. If probe succeeds: circuit closes, normal operation resumes
4. If probe fails: circuit reopens for another cooldown period
5. After 3 failed recoveries: escalate — reduce rate limits or disable source

### Fixture comparison

1. Capture fresh HTML: `npx tsx scripts/capture-site-html.ts --source {source_code}`
2. Diff against existing fixtures in `packages/source-{source_code}/src/fixtures/`
3. Identify structural changes (DOM, JSON schema, selectors)
4. Update extraction logic and fixtures as needed

### Parser update workflow

1. Capture fresh fixtures from live site
2. Update extraction logic in `packages/source-{source_code}/src/`
3. Update parser tests to match new structure
4. Bump `parserVersion` in the adapter
5. Run `npm run test:unit -- --filter source-{source_code}`
6. Deploy and trigger a manual scrape run to verify
7. Monitor first 3 scheduled runs for stability
