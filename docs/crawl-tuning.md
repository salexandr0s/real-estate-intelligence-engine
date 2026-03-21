# Crawl Concurrency Tuning

How to tune crawl parameters for the scraping infrastructure.

## Per-Source Parameters

These are stored in the `sources` table and can be adjusted per source.

### Rate limit: `rate_limit_rpm`

Requests per minute allowed for this source. Enforced by a token bucket rate limiter (`PerDomainRateLimiter`).

| Source     | Default | Current |
| ---------- | ------- | ------- |
| (global)   | 12      | --      |
| willhaben  | --      | 10      |

```sql
UPDATE sources SET rate_limit_rpm = 8 WHERE code = 'willhaben';
```

Lower values reduce block risk but increase crawl duration.

### Crawl interval: `crawl_interval_minutes`

Minutes between scheduled discovery runs. The scheduler compares `NOW() - last_successful_run_at` against this value.

| Source     | Default | Current |
| ---------- | ------- | ------- |
| (global)   | 30      | --      |
| willhaben  | --      | 15      |

```sql
UPDATE sources SET crawl_interval_minutes = 30 WHERE code = 'willhaben';
```

### Concurrency: `concurrency_limit`

Maximum concurrent browser contexts for this source. Currently all sources use 1.

```sql
UPDATE sources SET concurrency_limit = 1 WHERE code = 'willhaben';
```

### Max pages per run: `config.crawlProfile.maxPages`

Maximum discovery pages per crawl run. Stored in the `config` JSONB column.

| Source     | Default | Current |
| ---------- | ------- | ------- |
| (global)   | 3       | --      |
| willhaben  | --      | 5       |

```sql
UPDATE sources
SET config = jsonb_set(config, '{crawlProfile,maxPages}', '3')
WHERE code = 'willhaben';
```

## Global Environment Variables

These apply to all sources and are set via environment variables.

| Variable                          | Default   | Description                              |
| --------------------------------- | --------- | ---------------------------------------- |
| `SCRAPER_COOLDOWN_AFTER_BLOCK_MS`| `900000`  | Cooldown after a block is detected (15 min) |
| `SCRAPER_DEFAULT_RATE_LIMIT_RPM` | `12`      | Default RPM for sources without explicit config |
| `SCRAPER_DEFAULT_CONCURRENCY_PER_SOURCE` | `1` | Default concurrency per source        |
| `SCRAPER_CANARY_ENABLED`         | `true`    | Enable canary crawl probes               |
| `SCRAPER_JITTER_MIN_MS`          | `2000`    | Registered in config but not yet wired to delay functions |
| `SCRAPER_JITTER_MAX_MS`          | `7000`    | Registered in config but not yet wired to delay functions |

**Delay functions** (in `packages/scraper-core/src/browser/delay.ts`):

These currently use hardcoded ranges. The `SCRAPER_JITTER_*` env vars are defined in config but **not yet wired** to these functions — changing the env vars has no effect until the delay functions are updated to read from config.

- `pageNavigationDelay()`: 2000--7000ms (hardcoded)
- `interactionDelay()`: 500--1500ms (hardcoded)
- `cooldownDelay()`: 10,000--60,000ms (hardcoded)

## Circuit Breaker

The circuit breaker (`SourceCircuitBreaker`) is in-memory per worker process.

| Parameter          | Value    | Description                        |
| ------------------ | -------- | ---------------------------------- |
| Failure threshold  | 5        | Consecutive failures to open       |
| Cooldown duration  | 300,000ms | Time in open state before probe (5 min) |

**States**: `closed` → `open` (after 5 failures) → `half_open` (after cooldown) → `closed` (on probe success) or back to `open` (on probe failure).

**Error classes that increment the counter**: `transient_network`, `soft_anti_bot`, `parse_failure`, `unknown`. The `terminal_page` class (404/410) does not increment.

## Adding a New Crawl Profile

Crawl profiles are stored in `sources.config.crawlProfile` as JSONB.

```sql
INSERT INTO sources (code, name, base_url, scrape_mode, rate_limit_rpm,
  crawl_interval_minutes, concurrency_limit, config, is_active, legal_status)
VALUES (
  'new-source',
  'New Source',
  'https://new-source.at',
  'browser',
  10,
  30,
  1,
  '{"crawlProfile": {
    "operationType": "sale",
    "propertyType": "apartment",
    "regions": ["wien"],
    "maxPages": 3,
    "sortOrder": "published_desc"
  }}',
  true,
  'approved'
);
```

**CrawlProfile fields**:

| Field           | Type       | Description                            |
| --------------- | ---------- | -------------------------------------- |
| `operationType` | string     | `sale` or `rent`                       |
| `propertyType`  | string     | `apartment`, `house`, `land`, `commercial`, `parking`, `other` |
| `regions`       | string[]   | Source-specific region identifiers      |
| `districts`     | number[]   | Vienna district numbers (1--23)         |
| `maxPages`      | number     | Max discovery pages per run (default: 3) |
| `sortOrder`     | string     | Sort order for discovery (default: `published_desc`) |

## Temporarily Disabling a Source

**Option 1: Deactivate** (scheduler stops scheduling runs):
```sql
UPDATE sources SET is_active = false WHERE code = 'willhaben';
```

**Option 2: Legal disable** (marks source as legally restricted):
```sql
UPDATE sources SET legal_status = 'disabled' WHERE code = 'willhaben';
```

**Re-enable**:
```sql
UPDATE sources SET is_active = true WHERE code = 'willhaben';
-- or
UPDATE sources SET legal_status = 'approved' WHERE code = 'willhaben';
```

## Recovering from a Blocked State

1. **Wait for cooldown**: The `SCRAPER_COOLDOWN_AFTER_BLOCK_MS` (default 15 min) must elapse. The circuit breaker cooldown (5 min) must also elapse.

2. **Check circuit breaker state**: Look for `circuit_breaker_half_open` in worker logs. The next scheduled run will send a probe request.

3. **If probe succeeds**: Circuit closes, `health_status` returns to `healthy`, normal crawling resumes.

4. **If probe fails**: Circuit reopens. Consider:
   - Reducing `rate_limit_rpm` (e.g. 10 → 6)
   - Increasing `crawl_interval_minutes` (e.g. 15 → 60)
   - Reducing `maxPages` (e.g. 5 → 2)
   - Temporarily disabling the source

5. **After recovery**: Monitor 3+ successful runs, then gradually restore original parameters.

6. **Update health status** if needed:
   ```sql
   UPDATE sources SET health_status = 'healthy' WHERE code = 'willhaben';
   ```
