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

Minutes between scheduled discovery runs. The schedule uses the larger of this value and `SCRAPER_MIN_CRAWL_INTERVAL_MINUTES`, rounded up to 1, 2, 3, 4, 6, 8, 12 or 24 hours so runs stay evenly spaced across midnight, at a minute derived from the source code. Anything longer than a day runs daily. With the default floor of 180, a source set to 15 and a source set to 180 both run every 3 hours.

| Source     | Default | Current |
| ---------- | ------- | ------- |
| (global)   | 30      | --      |
| willhaben  | --      | 15      |

```sql
UPDATE sources SET crawl_interval_minutes = 30 WHERE code = 'willhaben';
```

`PATCH /v1/sources/:id` applies a new interval at once. A change made in SQL applies the next time the scraper starts.

### Concurrency

Every queue runs one job at a time (`WORKER_CONCURRENCY` in `packages/scraper-core/src/queues/queue-factory.ts`), and no setting raises it. The API returns the `concurrency_limit` column, but no worker reads it.

### Max pages per run: `config.crawlProfile.maxPages`

Most list pages one run fetches for this source, stored in the `config` JSONB column. `SCRAPER_MAX_PAGES_PER_RUN` caps it, and a source without this key uses the cap.

```sql
UPDATE sources
SET config = jsonb_set(config, '{crawlProfile,maxPages}', '3')
WHERE code = 'willhaben';
```

## Global Environment Variables

These apply to all sources and are set via environment variables.

| Variable                             | Default | Description                                                  |
| ------------------------------------ | ------- | ------------------------------------------------------------ |
| `SCRAPER_MIN_CRAWL_INTERVAL_MINUTES` | `180`   | Shortest time between two scheduled crawls of a source; schedules run at most hourly |
| `SCRAPER_MAX_PAGES_PER_RUN`          | `60`    | Most list pages one run fetches                              |
| `SCRAPER_DETAIL_BUDGET_PER_RUN`      | `40`    | Most detail pages one run queues                             |
| `SCRAPER_DETAIL_REFRESH_DAYS`        | `30`    | Age at which a listing's detail page gets fetched again      |
| `SCRAPER_ARTIFACT_RETENTION_DAYS`    | `7`     | Days to keep failure HTML and screenshots                    |
| `CANARY_WORKER_ENABLED`              | `false` | Runs the canary worker on a schedule; `npm run canary` works either way |

**Delay functions** (in `packages/scraper-core/src/browser/delay.ts`):

These use fixed ranges:

- `pageNavigationDelay()`: 2000--7000ms
- `interactionDelay()`: 500--1500ms

## Circuit Breaker

The circuit breaker (`SourceCircuitBreaker`) lives in memory, one per scraper process, shared by the discovery and detail workers. While it is open, discovery stops paging and detail jobs wait in the delayed set until it lets traffic through.

| Parameter          | Value    | Description                        |
| ------------------ | -------- | ---------------------------------- |
| Failure threshold  | 5        | Consecutive failures to open       |
| Cooldown duration  | 300,000ms | Time in open state before probe (5 min) |

**States**: `closed` → `open` (after 5 failures) → `half_open` (after cooldown) → `closed` (on probe success) or back to `open` (on probe failure).

**Error classes that increment the counter**: `transient_network`, `soft_anti_bot`, `unknown`. The `terminal_page` class (404/410) and the `parse_failure` class do not increment, and they leave an open or half-open circuit as it was. `openUntil(sourceCode)` returns when an open circuit next lets traffic through (epoch milliseconds), or null when it lets traffic through now.

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

1. **Wait for cooldown**: The circuit breaker cooldown (5 min) must elapse.

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
