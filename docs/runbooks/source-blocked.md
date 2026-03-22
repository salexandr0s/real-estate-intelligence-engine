# Runbook: Source Blocked

When a source actively blocks the scraper with HTTP 403/429 or captcha challenges.

## Symptoms

- HTTP 403 or 429 responses on requests
- Circuit breaker opens after consecutive failures
- `health_status = 'blocked'` in the sources table
- `captcha_count` or `http_4xx` metrics spike in scrape runs
- Worker logs show `soft_anti_bot` or `hard_block` error classifications

## Detection

```sql
-- Check source health status
SELECT code, health_status, is_active, updated_at
  FROM sources WHERE code = '<source_code>';

-- Review recent scrape runs for block signals
SELECT id, started_at, status, error_code,
       http_2xx, http_4xx, http_5xx, captcha_count
  FROM scrape_runs
  WHERE source_id = (SELECT id FROM sources WHERE code = '<source_code>')
  ORDER BY started_at DESC
  LIMIT 5;
```

## Resolution

1. **Wait for cooldown**: Default block cooldown is 15 minutes (`SCRAPER_COOLDOWN_AFTER_BLOCK_MS`). Do not trigger manual runs during cooldown.
2. **Check robots.txt**: Visit the source site's `/robots.txt` for policy changes.
3. **Reduce rate limit**: Lower `rate_limit_rpm` (e.g., 10 to 6) and increase jitter delays.
4. **Rotate user-agent**: Verify the user-agent pool in `browser-pool.ts` is current.
5. **Verify cookie consent flow**: Ensure the cookie dismissal selectors still work.
6. **If IP-based block**: Wait longer (1-2 hours) for IP reputation to recover. If persistent, investigate proxy rotation.
7. **Circuit breaker recovery**: After cooldown, the circuit breaker enters `half_open` state. The next scheduled run sends a single probe request to determine recovery.

## Verification

1. After cooldown expires, confirm a single-page canary succeeds:
   ```bash
   npx tsx scripts/scrape-and-ingest.ts --source <source_code> --pages 1
   ```
2. Confirm the circuit breaker closes (probe request returns HTTP 2xx)
3. Confirm `health_status` transitions away from `'blocked'`
4. Monitor the next 3 scheduled runs for sustained success
