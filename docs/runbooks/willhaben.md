# Source Runbook: willhaben

## Source Profile

| Field              | Value                                      |
| ------------------ | ------------------------------------------ |
| Code               | `willhaben`                                |
| Base URL           | `https://www.willhaben.at`                 |
| Scrape mode        | `browser` (Playwright Chromium)            |
| Rate limit         | 10 RPM                                     |
| Concurrency        | 1                                          |
| Crawl interval     | 15 minutes                                 |
| Max pages per run  | 5                                          |
| Parser version     | 1                                          |
| Legal status       | `approved`                                 |

## Normal Operation

- **Crawl cadence**: Every 15 minutes, triggered by scheduler
- **Expected volume**: 25--125 listings per discovery run (25/page x 5 pages max)
- **Success rate threshold**: > 90% of pages return HTTP 2xx
- **Parse success threshold**: > 95% of detail pages produce a valid capture
- **Typical run duration**: 60--120 seconds (5 pages at 10 RPM with 2--7s jitter)

## Search URL and Pagination

**Discovery URL pattern**:
```
https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?page={N}&rows=25&sort=1
```

**Query parameters**:

| Param    | Value         | Notes                              |
| -------- | ------------- | ---------------------------------- |
| `page`   | 1-indexed int | Incremented per page               |
| `rows`   | `25`          | Fixed results per page             |
| `sort`   | `1`           | Published date descending          |
| `areaId` | e.g. `wien`   | Optional, from crawl profile regions |

**Pagination logic**: Continue to next page while `items.length > 0` and page count < `maxPages` (5). URL modified via regex replace on `page=\d+`.

**Wait condition**: `waitForSelector: '#__NEXT_DATA__'` with 5000ms timeout.

## Extraction Strategy

### `__NEXT_DATA__` JSON extraction

willhaben is a Next.js application. All listing data is embedded in a `<script id="__NEXT_DATA__">` tag as JSON.

**Regex**:
```javascript
/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
```

**Discovery page JSON path**:
```
props.pageProps.searchResult
  ├── rowsFound          (total listing estimate)
  ├── rowsReturned
  └── advertSummaryList.advertSummary[]
      ├── id             (listing ID)
      ├── description
      ├── advertStatus   { id, statusId }
      └── attributes.attribute[]
          ├── name       (e.g. "HEADING", "PRICE", "LOCATION")
          └── values[]   (string array)
```

**Detail page JSON path**:
```
props.pageProps
  ├── advertDetails
  │   ├── id, description, publishedDate, firstPublishedDate
  │   ├── advertStatus { id, statusId }
  │   ├── attributes.attribute[] (same format)
  │   ├── advertImageList.advertImage[] { mainImageUrl, referenceImageUrl }
  │   ├── advertContactDetails { contactName }
  │   └── advertAddressDetails { address, postcode, city }
  └── is404              (boolean, 404 detection)
```

**Key attributes extracted** (via `getAttr(attrs, 'NAME')`):

| Attribute                        | Maps to            | Notes                          |
| -------------------------------- | ------------------- | ------------------------------ |
| `HEADING`                        | `titleRaw`          | Fallback: `adDetails.description` |
| `DESCRIPTION` / `BODY_DYN`      | `descriptionRaw`    | HTML stripped to plain text    |
| `ESTATE_PRICE/PRICE_SUGGESTION`  | `priceRaw`          | Preferred price field          |
| `PRICE`                          | `priceRaw`          | Fallback                       |
| `ESTATE_SIZE/LIVING_AREA`        | `livingAreaRaw`     | Austrian decimal normalized    |
| `ESTATE_SIZE/USEABLE_AREA`       | `usableAreaRaw`     | Fallback: `ESTATE_SIZE`        |
| `NO_OF_ROOMS`                    | `roomsRaw`          | Preferred; fallback: `NUMBER_OF_ROOMS` |
| `LOCATION/ADDRESS_2`            | `addressRaw`        | Street-level address           |
| `LOCATION/ADDRESS_3` / `_4`     | `cityRaw`           | City name                      |
| `CONTACT/ADDRESS_POSTCODE`       | `postalCodeRaw`     |                                |
| `STATE`                          | `federalStateRaw`   |                                |
| `COORDINATES`                    | `latRaw`, `lonRaw`  | Format: `"lat, lon"` (split on comma) |
| `FLOOR`                          | `floorRaw`          |                                |
| `CONSTRUCTION_YEAR`              | `yearBuiltRaw`      |                                |
| `PROPERTY_TYPE`                  | `propertyTypeRaw`   |                                |
| `OWNAGETYPE`                     | `operationTypeRaw`  | `Kauf`/`Eigentum` -> sale, `Miet` -> rent; null defaults to `sale` |
| `HEATING`                        | `heatingTypeRaw`    |                                |
| `BUILDING_CONDITION`             | `conditionRaw`      |                                |
| `ENERGY_HWB_CLASS`               | `energyCertificateRaw` |                             |
| `FREE_AREA/FREE_AREA_TYPE`       | balcony/terrace/garden | Multi-value; paired with `FREE_AREA_AREA` |
| `COMMISSION`                     | `commissionRaw`     |                                |
| `OPERATING_COST`                 | `operatingCostRaw`  |                                |
| `ALL_IMAGE_URLS`                 | `images`            | Semicolon-separated; fallback for `advertImageList` |
| `CONTACT/NAME`                   | `contactName`       | Fallback: `CONTACT/COMPANYNAME` |
| `CONTACT/PHONE`                  | `contactPhone`      |                                |
| `SEO_URL`                        | Detail link path    | Discovery only; prefixed with `/iad/` |

**Austrian decimal normalization**: `"58,4"` → `"58.4"`, `"1.250,50"` → `"1250.50"` (dots are thousands separators, comma is decimal).

### What breaks if Next.js changes

- **`__NEXT_DATA__` tag removed or renamed**: Extraction returns empty results. The regex won't match.
- **JSON structure changed**: `props.pageProps.searchResult` path no longer valid. Parse succeeds but fields are null.
- **Attribute names changed**: Individual fields become null. Parser continues but data quality degrades.
- **Switch to React Server Components streaming**: `__NEXT_DATA__` may not be present in initial HTML. Would require waiting for hydration or intercepting API calls.

**Detection**: Any of these causes `listings_discovered = 0` or widespread `parse_failed` extraction status.

## Cookie Consent

**Selectors tried in order** (from `cookie-consent.ts`):

1. `button[data-testid="uc-accept-all-button"]` — Usercentrics CMP
2. `#didomi-notice-agree-button` — Didomi CMP
3. `button[id*="accept"]` — Generic accept button

**Generic fallbacks** (if source-specific selectors fail):
- `button:has-text("Alle akzeptieren")`
- `button:has-text("Akzeptieren")`
- `button:has-text("Zustimmen")`
- `button:has-text("Alle Cookies akzeptieren")`
- `button:has-text("Accept all")`
- `button:has-text("Accept")`
- `[id*="accept"][id*="cookie" i]`
- `[class*="accept"][class*="cookie" i]`

**Behavior**: Non-fatal. 3-second timeout per selector. Logs failure and continues scraping. Adds 500--1500ms interaction delay after successful click.

**Risk**: willhaben has changed CMP providers before (Usercentrics → Didomi). Monitor for new consent frameworks.

## Anti-Bot Behavior

willhaben **blocks automated HTTP requests** — a real browser with JavaScript execution is required. Key behaviors:

- **No HTTP-only scraping**: Simple `fetch`/`axios` requests return blocked or incomplete responses
- **Browser fingerprinting**: Viewport, user-agent, locale, and timezone are rotated to appear human
- **Rate sensitivity**: Aggressive crawling triggers 403/429 responses
- **Captcha/challenge detection**: Two layers — `classifyScraperError()` in `scraper-core` detects HTTP 403/429/503 and challenge page indicators (captcha, cloudflare, datadome, etc.); `detectDetailAvailability()` in `detail.ts` uses `/captcha|blocked|challenge/i` on raw HTML as a last-resort fallback

**Current mitigations**:
- Browser context: `de-AT` locale, `Europe/Vienna` timezone, randomized viewport (1366x768, 1920x1080, 1440x900, 1536x864) and user-agent
- Page navigation delay: 2000--7000ms jitter between requests
- Rate limiter: Token bucket at 10 RPM
- Request interception: Blocks analytics/tracking scripts (Google Analytics, Facebook Pixel, etc.)
- Cooldown after block: 900,000ms (15 minutes, `SCRAPER_COOLDOWN_AFTER_BLOCK_MS`)
- Circuit breaker cooldown: 300,000ms (5 minutes, separate from block cooldown)

## Common Failure Modes

### Cookie consent changed

- **Symptoms**: Pages load but extraction yields zero listings. Cookie overlay blocks content interaction.
- **Detection**: `listings_discovered = 0` on runs with `http_2xx > 0`.
- **Resolution**:
  1. `npx tsx scripts/capture-site-html.ts --source willhaben`
  2. Inspect banner HTML for new CMP selectors
  3. Update willhaben entry in `packages/scraper-core/src/browser/cookie-consent.ts`
  4. Run parser tests: `npm run test:unit -- --filter source-willhaben`

### `__NEXT_DATA__` structure changed

- **Symptoms**: Pages load successfully but all extracted fields are null. `extraction_status = 'parse_failed'`.
- **Detection**: `raw_snapshots_created = 0` despite `pages_fetched > 0`. Parser test failures.
- **Resolution**:
  1. Capture fresh fixtures
  2. Inspect `__NEXT_DATA__` JSON structure for path changes
  3. Update `discovery.ts` and `detail.ts` JSON traversal paths
  4. Update fixture files and tests
  5. Bump `parserVersion`

### Anti-bot block (403/429)

- **Symptoms**: HTTP 403/429 responses. Circuit breaker opens after 5 consecutive failures.
- **Detection**: `health_status` transitions to `'blocked'`. `captcha_count` or `http_4xx` spikes in scrape_runs.
- **Resolution**:
  1. Let cooldowns expire — block cooldown (15 min) and circuit breaker cooldown (5 min)
  2. Circuit breaker enters `half_open` — next scheduled run sends a single probe request
  3. If probe succeeds: circuit closes, normal operation resumes
  4. If probe fails: reduce `rate_limit_rpm` (e.g. 10 → 6), increase `crawl_interval_minutes`
  5. If persistent: investigate IP reputation or add proxy rotation

### Site unavailable

- **Symptoms**: Connection timeouts, DNS failures, HTTP 5xx.
- **Detection**: `transient_network` error class. `http_5xx` spikes.
- **Resolution**: Wait for site recovery. Scheduler retries on next interval. If extended (> 24h), set `is_active = false`.

### Pagination change

- **Symptoms**: Only page 1 results returned. `listings_discovered` consistently low.
- **Detection**: `pages_fetched = 1` across multiple runs.
- **Resolution**: Capture fresh discovery page, check if URL params or pagination mechanism changed, update `buildDiscoveryRequests()`.

## Escalation

| Condition | Action |
| --------- | ------ |
| Circuit breaker opens 3+ times in 24 hours | Reduce `rate_limit_rpm` to 6, `maxPages` to 3 |
| Parse success rate < 50% for 2+ hours | Set `is_active = false`, investigate `__NEXT_DATA__` changes |
| New CMP detected | Update cookie-consent.ts selectors |
| 403 on every request | Set `is_active = false`, investigate IP/behavioral block |
| willhaben terms of service change | Set `legal_status = 'disabled'`, review compliance |

## Fixture Files

**Location**: `packages/source-willhaben/src/fixtures/`

| File                  | Purpose                       | Key content                          |
| --------------------- | ----------------------------- | ------------------------------------ |
| `discovery-page.html` | Search results page           | 3 listings, `rowsFound: 500`, page 1 |
| `detail-page.html`    | Active listing detail         | ID 987654321, 3-Zimmer, EUR 299,000  |
| `detail-sold.html`    | Sold/removed listing          | `is404: true` flag                   |

**Parser test expectations** (from `parser.test.ts`):
- Discovery: 3 items, first ID 987654321, `totalEstimate = 500`
- Detail: `livingAreaRaw = "58.4"`, `roomsRaw = "3"`, `postalCodeRaw = "1020"`, `operationTypeRaw = "sale"`, 2 images
- Sold: detected as `not_found` status

## Fixture Update Procedure

1. **Capture fresh HTML**:
   ```bash
   npx tsx scripts/capture-site-html.ts --source willhaben
   ```
   Output: `/tmp/rei-captures/willhaben/`

2. **Compare** old vs new HTML structure, focusing on:
   - `__NEXT_DATA__` JSON schema changes
   - Attribute name additions/removals
   - Image URL format changes
   - Cookie consent banner changes

3. **Replace fixtures** in `packages/source-willhaben/src/fixtures/`

4. **Update test expectations** in `packages/source-willhaben/src/tests/parser.test.ts`

5. **Run tests**: `npm run test:unit -- --filter source-willhaben`

6. **Bump `parserVersion`** in `WillhabenAdapter` if extraction logic changed
