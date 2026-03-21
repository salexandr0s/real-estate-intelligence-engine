# Success Criteria: KPIs and SLOs

## Freshness

| Metric | Target | Measurement |
|--------|--------|-------------|
| High-priority crawl lag | < 20 minutes | Time from listing publication on source to `raw_listings.first_seen_at` |
| Discovery-to-detail lag | < 5 minutes | Time from discovery extraction to detail page fetch |

Freshness is bounded by the crawl interval (15 min for willhaben). The SLO accounts for interval + queue wait + page load time.

## Reliability

| Metric | Target | Measurement |
|--------|--------|-------------|
| Crawl success rate | > 95% per source | `scrape_runs` where `status IN ('succeeded', 'partial')` / total runs, per day |
| Parse success rate | > 90% for detail pages | `raw_listings` where `extraction_status = 'captured'` / total attempts |
| Zero-run gap | < 2 hours | Maximum time between successful runs per source |

A `partial` run (some pages succeeded, some failed) counts as a success for this SLO. Only `failed` and `cancelled` runs count against it.

## Alert Lag

| Metric | Target | Measurement |
|--------|--------|-------------|
| Scoring-to-alert lag | < 2 minutes | `alerts.matched_at` minus `listings.last_scored_at` |
| End-to-end alert lag | < 25 minutes | Time from listing publication to in-app alert delivery |

End-to-end = crawl interval + discovery + detail + normalization + scoring + alert matching.

## API Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| Listing search p95 latency | < 300 ms | Fastify response time for `GET /v1/listings` with common filters |
| Listing detail p95 latency | < 100 ms | Fastify response time for `GET /v1/listings/{id}` |
| Filter save p95 latency | < 200 ms | Fastify response time for `POST /v1/filters` |

## Data Quality

| Metric | Target | Measurement |
|--------|--------|-------------|
| Completeness score | > 60% mean | `listings.completeness_score` averaged across active listings |
| District resolution rate | > 80% | Active Vienna listings where `district_no IS NOT NULL` / total active Vienna listings |
| Deduplication accuracy | > 99% | No duplicate canonical listings from the same source for the same property |

## Operational Health

| Metric | Target | Measurement |
|--------|--------|-------------|
| Source availability | No source `blocked` > 24h | `sources.health_status` monitoring |
| Queue depth | Detail queue < 500 jobs | BullMQ queue length for `crawl.detail` |
| Raw snapshot dedup rate | > 30% | `raw_listings` where `observation_count > 1` / total rows (indicates stable content detection) |

## When to Measure

- **Phase 3 (first source live)**: Freshness, reliability, data quality
- **Phase 5 (API live)**: API performance
- **Phase 6 (alerts live)**: Alert lag
- **Phase 8+ (multi-source)**: All metrics across all sources

## Escalation Thresholds

| Condition | Action |
|-----------|--------|
| Crawl success < 80% for 4 hours | Investigate source health, check for blocks |
| Parse success < 70% for 2 hours | Check for DOM/schema changes, review failure artifacts |
| Source blocked > 6 hours | Review anti-bot policy, adjust rate/jitter |
| Queue depth > 1000 | Check worker health, consider temporary pause |
