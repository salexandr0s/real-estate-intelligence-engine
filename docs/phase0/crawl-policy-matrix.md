# Crawl Policy Matrix

## Per-Source Configuration

| Source | RPM | Concurrency | Jitter (s) | Interval (min) | Priority | Mode | Legal Status |
|--------|-----|-------------|------------|----------------|----------|------|-------------|
| willhaben | 10 | 1 | 2–7 | 15 | 10 | browser | approved* |
| immoscout24 | 8 | 1 | 2–7 | 30 | 20 | browser | review_required |
| wohnnet | 15 | 1 | 2–7 | 30 | 30 | browser | review_required |
| derstandard | 12 | 1 | 2–7 | 60 | 40 | browser | review_required |
| findmyhome | 15 | 1 | 2–7 | 60 | 50 | browser | review_required |
| remax | 10 | 1 | 2–7 | 60 | 60 | browser | review_required |
| openimmo | — | — | — | — | 999 | — | disabled |

*\*Pending manual robots.txt verification in a real browser.*

**Priority**: Lower number = higher priority. Determines scheduling order when multiple sources are due.

---

## Global Policies

### Rate Limiting
- Default RPM: 12 (per `@immoradar/config`)
- Default concurrency per source: 1
- Jitter range: 2000–7000 ms between page requests
- Maximum pages per discovery run: 5

### Block Detection & Response
- **Cooldown after block signal**: 15 minutes (900,000 ms)
- **Block signals**: HTTP 403, HTTP 429, CAPTCHA text in DOM, challenge page DOM
- **Circuit breaker**: Opens after repeated blocks; canary-only until recovery
- **Auto-disable**: Source set to `health_status = 'blocked'` after repeated failures

### Hard Rules
- Never access authenticated or behind-login content
- Never solve CAPTCHAs automatically
- Never bypass cookie consent — dismiss banner, don't circumvent
- Never exceed configured RPM
- Never run multiple concurrent sessions against the same source
- Respect `Crawl-delay` if specified in robots.txt (none currently)

---

## Crawl Profiles

### `vienna_buy_apartments` (Primary)

```json
{
  "operationType": "sale",
  "propertyType": "apartment",
  "regions": ["wien"],
  "maxPages": 5,
  "sortOrder": "published_desc"
}
```

- Targets all 23 Vienna districts
- Sort by newest to prioritize fresh listings
- 5 pages × 25 results = up to 125 listings per discovery run

### Future profiles (not yet active)
- `vienna_buy_houses` — houses for sale in Vienna
- `vienna_rent_apartments` — rental market monitoring
- `austria_buy_apartments` — broader geographic scope

---

## Effective Crawl Cadence

At the configured intervals:

| Source | Runs/day | Pages/day | Est. listings discovered/day |
|--------|----------|-----------|------------------------------|
| willhaben | 96 | 480 | ~2,400 (with heavy dedup) |
| immoscout24 | 48 | 240 | ~1,200 |
| wohnnet | 48 | 240 | ~1,200 |
| derstandard | 24 | 120 | ~600 |
| findmyhome | 24 | 120 | ~600 |
| remax | 24 | 120 | ~600 |

These are upper bounds — actual unique new listings will be much lower due to deduplication. Raw snapshot observation counts will track re-observation frequency.

---

## Configuration Source

These values are seeded in `packages/db/seeds/seed.ts` and stored in the `sources` table. Runtime changes via the database take effect on the next scheduled run. The config JSON column holds the crawl profile definition.
