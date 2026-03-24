# Source Runbook: {source_name}

## Source Profile

| Field              | Value               |
| ------------------ | ------------------- |
| Code               | `{source_code}`     |
| Base URL           | `{base_url}`        |
| Scrape mode        | `{browser\|http\|api\|feed}` |
| Rate limit         | {N} RPM             |
| Concurrency        | {N}                 |
| Crawl interval     | {N} minutes         |
| Max pages per run  | {N}                 |
| Parser version     | {N}                 |
| Legal status       | `{approved\|review_required\|disabled}` |

## Normal Operation

- **Crawl cadence**: Every {N} minutes, triggered by scheduler
- **Expected volume**: {N}--{M} listings per discovery run
- **Success rate threshold**: > {X}% of pages return HTTP 2xx
- **Parse success threshold**: > {X}% of detail pages produce a valid capture
- **Typical run duration**: {N}--{M} seconds

## Common Failure Modes

### Cookie consent changed

- **Symptoms**: All pages return content but extraction yields zero listings. Cookie banner overlays page content.
- **Detection**: `listings_discovered = 0` on a run that completed with `http_2xx > 0`. Parse failures in logs referencing missing selectors.
- **Resolution**:
  1. Capture a fresh page: `npx tsx scripts/capture-site-html.ts --source {source_code}`
  2. Inspect the cookie banner HTML for new selectors
  3. Update selectors in `packages/scraper-core/src/browser/cookie-consent.ts`
  4. Run parser tests to verify extraction still works
  5. Deploy and trigger a manual scrape run

### Selector breakage (DOM change)

- **Symptoms**: Parse failures on pages that return HTTP 200. Extraction produces null/empty fields that were previously populated.
- **Detection**: Rising `parse_failure` error class in circuit breaker. `extraction_status = 'parse_failed'` on new raw_listings rows.
- **Resolution**:
  1. Capture fresh fixtures: `npx tsx scripts/capture-site-html.ts --source {source_code}`
  2. Diff old vs new fixture HTML to identify structural changes
  3. Update extraction logic in `packages/source-{source_code}/src/discovery.ts` and/or `detail.ts`
  4. Update fixture files and parser tests
  5. Bump `parserVersion` in the adapter
  6. Deploy and verify with a manual run

### Anti-bot block (403/429)

- **Symptoms**: HTTP 403 or 429 responses. Circuit breaker opens. `captcha_count` or `http_4xx` metrics spike.
- **Detection**: `scrape_runs.status = 'rate_limited'` or `'failed'`. `sources.health_status` transitions to `'blocked'`.
- **Resolution**:
  1. Stop manual triggers — let the cooldown timer expire (`SCRAPER_COOLDOWN_AFTER_BLOCK_MS`)
  2. Check if the block is IP-based or behavioral
  3. If behavioral: increase jitter delays, reduce `rate_limit_rpm`, reduce `maxPages`
  4. If IP-based: wait longer or investigate proxy options
  5. After cooldown, the circuit breaker enters `half_open` — a single probe request determines recovery
  6. Monitor the next scheduled run for success

### Site unavailable

- **Symptoms**: HTTP 5xx responses or connection timeouts. `transient_network` errors in circuit breaker.
- **Detection**: `http_5xx` metric spikes. `scrape_runs.status = 'failed'` with `error_code` indicating network error.
- **Resolution**:
  1. Verify the site is actually down (check manually in a browser)
  2. If site-wide outage: wait for recovery — the scheduler will retry on next interval
  3. If persistent (> 1 hour): set `sources.health_status = 'degraded'`
  4. If extended (> 24 hours): set `sources.is_active = false` and investigate

### Pagination change

- **Symptoms**: Discovery runs return only page 1 results. `pages_fetched = 1` consistently. Listings count drops.
- **Detection**: `listings_discovered` drops below expected range across multiple runs.
- **Resolution**:
  1. Capture a fresh discovery page fixture
  2. Check if URL parameters changed (page numbering, rows, sort)
  3. Check if pagination is now infinite-scroll or AJAX-based
  4. Update `buildDiscoveryRequests()` in the adapter
  5. Update parser tests with new pagination behavior

## Escalation

| Condition | Action |
| --------- | ------ |
| Circuit breaker opens 3+ times in 24 hours | Reduce `rate_limit_rpm` and `maxPages`, investigate root cause |
| Parse success rate drops below 50% | Disable source (`is_active = false`), update parser |
| New consent/privacy framework detected | Update cookie consent selectors before re-enabling |
| Rate limit hit on every run for 6+ hours | Set `is_active = false`, adjust timing parameters |
| Site terms of service change | Set `legal_status = 'disabled'`, review compliance |

## Fixture Update Procedure

1. **Capture fresh HTML**:
   ```bash
   npx tsx scripts/capture-site-html.ts --source {source_code}
   ```
   Output lands in `/tmp/immoradar-captures/{source_code}/`.

2. **Review the captured HTML** for structural changes vs existing fixtures.

3. **Replace fixture files** in `packages/source-{source_code}/src/fixtures/`:
   - `discovery-page.html` — a representative search results page
   - `detail-page.html` — a standard active listing
   - `detail-sold.html` — a sold/removed listing (if applicable)

4. **Update parser tests** in `packages/source-{source_code}/src/tests/parser.test.ts` to match any new field values or structure.

5. **Run tests**: `npm run test:unit -- --filter source-{source_code}`

6. **Bump `parserVersion`** in the adapter if extraction logic changed.
