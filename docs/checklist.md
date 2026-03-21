
# checklist.md

## 0. Product and source discovery

- [x] Confirm initial operating mode: Mac mini daemon (see `docs/phase0/deployment-decision.md`)
- [x] Confirm first source to onboard: willhaben (see `docs/phase0/first-source-decision.md`)
- [x] Confirm initial target market: Vienna apartments for sale
- [x] Confirm high-priority districts: all 23 Vienna districts
- [x] Confirm allowed source entry points: public search + detail pages only
- [x] Review robots/terms/compliance status for each planned source (see `docs/phase0/risk-feasibility.md`)
- [x] Document per-source crawl risk (see `docs/phase0/risk-feasibility.md`)
- [x] Define success metrics for freshness, reliability, and alert lag (see `docs/phase0/kpi-slo.md`)
- [x] Define supported property types for v1: apartment, house, land, commercial, parking, other
- [x] Define canonical operation types for v1: sale, rent

---

## 1. Repository and engineering foundation

- [x] Create monorepo layout
- [x] Enable strict TypeScript configuration
- [x] Configure linting
- [x] Configure formatting
- [x] Configure unit test runner
- [x] Configure integration test runner
- [x] Add Git hooks or CI enforcement
- [x] Add migration tooling
- [x] Add shared config package
- [x] Add shared contracts package
- [x] Add API package skeleton
- [x] Add scraper-core package skeleton
- [x] Add normalization package skeleton
- [x] Add scoring package skeleton
- [x] Add alerting package skeleton
- [x] Add Swift macOS app project
- [x] Add CI pipeline for lint/test/build
- [x] Add artifact retention for failed test snapshots

---

## 2. Infrastructure

### Database and storage
- [x] Provision PostgreSQL
- [x] Provision Redis
- [x] Provision object storage bucket(s)
- [x] Define bucket prefixes for html/screenshots/har
- [x] Configure backup policy for PostgreSQL
- [x] Configure backup verification job
- [x] Configure object storage lifecycle policy

### Secrets and configuration
- [x] Define environment variable contract
- [x] Configure secret storage strategy
- [x] Set up local `.env` loading
- [ ] Set up production secrets loading

### Observability
- [x] Add structured logging
- [ ] Add metrics endpoint
- [ ] Add tracing/OpenTelemetry
- [x] Add error tracking
- [x] Add health/readiness endpoints

---

## 3. Database schema

### Core tables
- [x] Implement `app_users`
- [x] Implement `sources`
- [x] Implement `scrape_runs`
- [x] Implement `raw_listings`
- [x] Implement `listings`
- [x] Implement `listing_versions`
- [x] Implement `market_baselines`
- [x] Implement `listing_scores`
- [x] Implement `user_filters`
- [x] Implement `alerts`

### Constraints and triggers
- [x] Add `updated_at` trigger function
- [x] Add table-level `updated_at` triggers
- [x] Add idempotency unique constraints
- [x] Add range validation constraints
- [x] Add status enum-like checks
- [x] Add postal code validation
- [x] Add latitude/longitude validation

### Indexes
- [x] Add active listing filter index
- [x] Add district + price partial index
- [x] Add district + area partial index
- [x] Add score sort partial index
- [x] Add source + last seen index
- [x] Add search vector index
- [x] Add raw listing dedupe index
- [x] Add scrape run status/time indexes
- [x] Add user filter active index
- [x] Add user filter districts GIN index
- [x] Add user filter property types GIN index
- [x] Add alert scheduling index
- [x] Add market baseline lookup index

### Migration quality
- [x] Test migrations from empty database
- [x] Test rolling forward on seeded database
- [ ] Test rollback plan or compensating migration strategy
- [x] Document destructive migration rules

---

## 4. Scraper core

### Browser runtime
- [x] Implement Playwright browser pool (`apps/worker-scraper/src/browser-pool.ts`)
- [x] Implement browser context factory (`createScrapeContext()`)
- [x] Set locale to `de-AT` (`DEFAULT_BROWSER_CONTEXT_CONFIG`)
- [x] Set timezone to `Europe/Vienna` (`DEFAULT_BROWSER_CONTEXT_CONFIG`)
- [x] Add viewport rotation strategy (`VIEWPORT_POOL` + `pickRandomViewport()`)
- [x] Add user-agent rotation strategy (`USER_AGENT_POOL` + `pickRandomUserAgent()`)
- [x] Add headless/headful toggle (`PLAYWRIGHT_HEADLESS` env var)
- [x] Add browser/context recycle policy (per-job context lifecycle)

### Request execution
- [x] Implement request plan abstraction (`RequestPlan` in contracts)
- [x] Implement navigation timeout defaults (30s in workers)
- [x] Implement wait condition helpers (`waitForSelector` in RequestPlan)
- [x] Implement request interception policy (`setupRequestInterception()`)
- [x] Implement cookie-consent helper (`dismissCookieConsent()` per source)
- [x] Implement page artifact capture helpers (`ArtifactWriter` with gzip)

### Reliability
- [x] Implement retry classification (`classifyScraperError()` — 5 categories)
- [x] Implement exponential backoff with jitter (`withRetry()`)
- [x] Implement per-source concurrency limits (concurrency: 1 in workers)
- [x] Implement per-source request-rate limits (`PerDomainRateLimiter`)
- [x] Implement block/captcha signal detection (`soft_anti_bot` classification)
- [x] Implement source circuit breaker (`SourceCircuitBreaker`)
- [x] Implement dead-letter handling (BullMQ default dead-letter)

### Persistence integration
- [x] Create scrape run at job start (scheduler + CLI)
- [x] Update scrape run counters while crawling (`ScrapeRunContext`)
- [x] Close scrape run with final status (`scrapeRuns.finish()`)
- [x] Persist raw snapshot metadata (`upsertRawSnapshot()`)
- [x] Persist raw artifact pointers (HTML + screenshot storage keys wired)
- [x] Update observation count on duplicate raw snapshot (ON CONFLICT)
- [x] Keep raw writes idempotent (unique constraint on source_id + key + hash)

### Diagnostics
- [x] Capture screenshot on parse failure (detail worker catch block)
- [x] Capture HTML on parse failure (detail worker catch block)
- [ ] Capture HAR when configured (deferred to Phase 9)
- [x] Log source/job correlation IDs (in all workers)
- [x] Expose scrape metrics (`ScrapeRunContext.getMetrics()`)

---

## 5. Source template and source onboarding

- [x] Create reusable source package template
- [x] Define `SourceAdapter` interface
- [x] Define source DTO conventions
- [x] Define selector file convention
- [x] Define fixture storage convention
- [x] Define source runbook template
- [x] Define source health documentation template

### First source (willhaben)
- [x] Implement discovery page extraction (`packages/source-willhaben/src/discovery.ts`)
- [x] Implement detail page extraction (`packages/source-willhaben/src/detail.ts`)
- [x] Implement canonical URL normalization (`WillhabenAdapter.canonicalizeUrl()`)
- [x] Implement source-local listing key derivation (`WillhabenAdapter.deriveSourceListingKey()`)
- [x] Implement unavailable/removed detection (`detectDetailAvailability()`)
- [x] Implement cookie flow for source (`dismissCookieConsent()` with willhaben selectors)
- [x] Tune delays for source (10 RPM, 2–7s jitter)
- [x] Tune concurrency for source (1 concurrent)
- [x] Save representative fixtures (3: discovery, detail, sold)
- [x] Add parser tests from fixtures (9 tests passing)
- [ ] Add canary crawl for source
- [x] Write source runbook

### Second source
- [ ] Repeat source template flow
- [ ] Verify no schema rewrite needed
- [ ] Verify shared normalization abstractions are sufficient
- [ ] Compare field coverage vs first source
- [ ] Tune anti-bot policy separately

---

## 6. Raw data handling

- [x] Define raw DTO contract (`RawListingUpsert`, `RawListingRow` in contracts)
- [x] Preserve response headers/status (`responseStatus`, `responseHeaders` fields)
- [x] Preserve extraction status (`extractionStatus` column)
- [x] Preserve parser version (`parserVersion` column)
- [x] Preserve canonical URL and detail URL (`canonicalUrl`, `detailUrl` columns)
- [x] Preserve discovery URL where relevant (`discoveryUrl` column)
- [x] Preserve full raw payload JSON (`rawPayload` JSONB column)
- [x] Preserve HTML artifact pointer (`bodyStorageKey` / `htmlStorageKey`)
- [x] Preserve screenshot artifact pointer (`screenshotStorageKey`)
- [ ] Preserve HAR artifact pointer (deferred to Phase 9)
- [x] Compute raw content checksum (`computeContentHash()` → `contentSha256`)
- [x] Verify re-observation updates `last_seen_at` (ON CONFLICT clause)
- [x] Verify identical raw snapshot does not duplicate row (unique constraint)
- [x] Verify changed raw snapshot creates new row (different hash = new row)

---

## 7. Normalization engine

### Contracts and validation
- [x] Define canonical listing DTO
- [x] Define source DTO validators
- [x] Add normalization version constant
- [x] Add provenance/warning structure
- [x] Add normalization failure handling path

### Field coercion
- [x] Normalize whitespace
- [x] Normalize Unicode
- [x] Parse EUR prices to cents
- [x] Parse m² values to numeric
- [x] Parse rooms to decimal
- [x] Parse booleans from text/icons
- [x] Parse year built
- [x] Parse floor label/number
- [x] Parse amenity flags

### Location normalization
- [x] Normalize city names (`base-mapper.ts` — `normalizeWhitespace()`)
- [x] Normalize postal code (`base-mapper.ts` — `.trim()` + postal code validation)
- [x] Normalize street/house number (`base-mapper.ts` — `normalizeWhitespace()`)
- [x] Normalize address display (`base-mapper.ts` — `buildAddressDisplay()`)
- [x] Implement Vienna district lookup table
- [x] Implement district alias matching
- [x] Implement district number text matching
- [x] Implement postal code district inference
- [x] Implement contradiction warnings
- [x] Implement geocode precision model

### Derived fields
- [x] Compute price per sqm (`base-mapper.ts` + `normalize-and-upsert.ts`)
- [x] Compute completeness score
- [x] Compute content fingerprint
- [x] Compute cross-source fingerprint candidate (`computeCrossSourceFingerprint()` in fingerprint.ts)
- [x] Attach normalized payload overflow fields (`normalizedPayload` with provenance)

### Persistence
- [x] Upsert current `listings` row (`listings.ts:206-354` — ON CONFLICT upsert)
- [x] Append `listing_versions` row on meaningful change (`listing-versions.ts:75-105`)
- [x] Avoid version bump on non-business changes (fingerprint comparison in `normalize-and-upsert.ts`)
- [x] Track first seen / last seen (`first_seen_at` on insert, `last_seen_at` on both)
- [x] Track price change timestamp (`last_price_change_at` CASE in upsert SQL)
- [x] Track content change timestamp (`last_content_change_at` CASE in upsert SQL)
- [x] Track status change timestamp (`last_status_change_at` CASE in upsert SQL)
- [x] Handle relist/reactivation cases (infrastructure: `relist_detected` version reason + scoring penalty)

### Quality checks
- [x] Missing required identity fields fail safely (`base-mapper.ts:248-260`)
- [x] Malformed non-critical fields become `NULL` + warning (all `coerce.ts` parsers)
- [x] No impossible numeric values survive (validators reject negative/out-of-range)
- [x] Idempotent normalization test passes (`ingestion-dedupe.test.ts`)
- [x] Replay normalization test passes (`tests/unit/normalization-replay.test.ts`)

---

## 8. Listing lifecycle and status handling

- [x] Define canonical listing statuses (`domain.ts` — active, inactive, sold, rented, withdrawn, expired, unknown)
- [x] Map source availability states to canonical statuses (`mapRawStatusToCanonical()` in base-mapper)
- [x] Implement removed/not-found handling (maps to 'withdrawn' status)
- [x] Implement sold/rented detection where available (maps 'sold'/'verkauft' → 'sold', etc.)
- [x] Implement missing-from-discovery inactivity rule (`scripts/mark-stale-listings.ts`)
- [x] Implement reactivation rule (inactive→active triggers `relist_detected` in normalize-and-upsert)
- [x] Implement relist detection heuristic backlog item (same as reactivation)
- [x] Add lifecycle transition tests (`tests/unit/listing-lifecycle.test.ts`)

---

## 9. Scoring engine

### Baselines
- [x] Define area bucket logic (`scoring.ts:62-71` — 7 buckets)
- [x] Define room bucket logic (`scoring.ts:73-80` — 5 buckets)
- [x] Implement baseline SQL/materialization job (`baseline-worker.ts`)
- [x] Implement outlier clipping (10% trimmed mean in baseline worker)
- [x] Implement minimum sample thresholds (min 3 samples per bucket)
- [x] Implement fallback hierarchy (`findBaselineWithFallback()` — 4-level cascade)
- [x] Persist `market_baselines` (`upsertBaseline()` with ON CONFLICT)
- [x] Add baseline regression tests (`tests/unit/scoring-baselines.test.ts`)

### Feature extraction
- [x] Compute district discount percentage (`score-engine.ts:16-19`)
- [x] Compute bucket discount percentage (`score-engine.ts:21-23`)
- [x] Implement keyword lexicon
- [x] Normalize keyword matching with umlaut support
- [x] Implement renovation-needed rule
- [x] Implement risk keyword penalties
- [x] Implement freshness/time-on-market calculation
- [x] Implement relist penalty hook (`score-engine.ts:41-48`)
- [x] Implement confidence score inputs (`confidence.ts` — 4 factors)

### Score calculation
- [x] Implement component scores `0..100`
- [x] Implement weighted final score
- [x] Clamp and round final score
- [x] Persist `listing_scores` (`listing-scores.ts:49-85`)
- [x] Update `listings.current_score` (`listings.ts:491-505`)
- [x] Store explanation JSON (`listing-scores.ts:82` — JSONB column)
- [x] Store matched positive keywords (`listing-scores.ts:80`)
- [x] Store matched negative keywords (`listing-scores.ts:81`)
- [x] Add score versioning (`SCORE_VERSION = 1` in `score-engine.ts`)
- [x] Add rescore command (`scripts/rescore-listings.ts`)
- [ ] Add score regression fixture tests

### UI/analytics support
- [x] Expose score explanation via API (`GET /v1/listings/:id/score-explanation`)
- [x] Expose district baselines via API (`GET /v1/analytics/baselines`)
- [ ] Add high-score listing view
- [ ] Add score distribution analytics
- [ ] Add district comparison analytics

---

## 10. Filtering engine

### Filter contract
- [x] Define filter DTO
- [x] Define JSON schema/Zod schema (`schemas.ts:125-150`)
- [x] Define canonical property type values (`schemas.ts:24`)
- [x] Define district filter values (`validate-filter.ts:29-31` — 1-23)
- [x] Define sort options (`schemas.ts:25` — 5 modes)
- [x] Define alert frequency options (`schemas.ts:27`)
- [x] Add validation for min/max ranges (`validate-filter.ts:11-19`, `schemas.ts` refine)
- [x] Add normalization for keyword arrays (`compile-filter.ts:31-38`)

### Persistence
- [x] Store `criteria_json` (`user-filters.ts:115`)
- [x] Store flattened columns (`user-filters.ts:96-114`)
- [x] Store alert channels (`user-filters.ts:114`)
- [x] Store sort preference (`user-filters.ts:112`)
- [x] Store active/inactive state (`user-filters.ts:136-139`)

### Interactive query path
- [x] Build typed query compiler
- [x] Generate parameterized SQL
- [x] Support price min/max (parameterized query $4, $5)
- [x] Support area min/max (parameterized query $6, $7)
- [x] Support district array (ANY($3) predicate)
- [x] Support property type array (ANY($2) predicate)
- [x] Support rooms min/max (parameterized query $8, $9)
- [x] Support score threshold (parameterized query $10)
- [x] Support required keywords (ILIKE predicates in search query)
- [x] Support excluded keywords (NOT EXISTS predicate in search query)
- [x] Support sort by score/newest/price/sqm (`getSortConfig()` — 5 modes)
- [x] Implement cursor pagination (encoded cursor with overflow detection)
- [ ] Add query plan/index review

### Reverse-match path
- [x] Implement candidate filter SQL
- [x] Implement keyword post-filtering (TypeScript post-filter in `findMatchingFilters()`)
- [ ] Implement match logging
- [x] Update `last_evaluated_at` (`updateEvaluatedAt()` in user-filters)
- [x] Update `last_match_at` (`updateMatchedAt()` in user-filters)
- [ ] Add reverse-match tests

### UX
- [x] Add filter editor in macOS app (`FiltersView.swift` with FilterDraft sheet)
- [x] Add filter preview/test endpoint (`POST /v1/filters/:id/test`)
- [x] Add saved filter list screen (`FiltersView.swift`)
- [x] Add filter enable/disable toggle (active toggle in FiltersView)

---

## 11. Alerts

### Core logic
- [x] Define alert types
- [x] Define alert channels
- [x] Define dedupe key format
- [x] Create alert row on first match (`score-and-alert.ts:174-199`)
- [x] Create alert row on score upgrade (`determineAlertType()` with scoreImproved flag)
- [x] Create alert row on price drop (`score-and-alert.ts:220`)
- [x] Suppress duplicate alerts for same event (ON CONFLICT DO NOTHING on dedupe_key)
- [x] Implement alert status transitions (`alerts.ts:132-149`)
- [ ] Implement alert retry policy for delivery

### Delivery
- [x] In-app alerts feed (`GET /v1/alerts`)
- [ ] SSE or WebSocket updates
- [ ] Local macOS notifications
- [ ] Optional email delivery
- [ ] Optional webhook delivery
- [x] Alert open/read/dismiss actions (`PATCH /v1/alerts/:id`)

### Persistence and UI
- [x] Alerts list endpoint (`GET /v1/alerts`)
- [x] Alert detail endpoint or payload (full payload in responses)
- [x] Unread count endpoint (`GET /v1/alerts/unread-count`)
- [x] Alert screen in macOS app (`AlertsView.swift` + `AlertsViewModel.swift`)
- [x] Menu bar unread indicator (`MenuBarLabel.swift` + `MenuBarContent.swift`)
- [x] Alert dedupe integration tests (`ingestion-dedupe.test.ts:198-203`)

---

## 12. API layer

### Contract
- [ ] Define OpenAPI spec
- [ ] Generate TypeScript server types
- [ ] Generate Swift client types
- [x] Version API under `/v1` (all routes use `/v1/` prefix)

### Endpoints
- [x] `GET /v1/listings`
- [x] `GET /v1/listings/{id}`
- [x] `GET /v1/filters`
- [x] `POST /v1/filters`
- [x] `GET /v1/filters/{id}`
- [x] `PATCH /v1/filters/{id}`
- [x] `DELETE /v1/filters/{id}`
- [x] `POST /v1/filters/{id}/test`
- [x] `GET /v1/alerts`
- [x] `PATCH /v1/alerts/{id}`
- [x] `GET /v1/sources`
- [x] `GET /v1/scrape-runs`
- [x] `POST /v1/scrape-runs`
- [x] `GET /v1/analytics/baselines`
- [x] `GET /v1/listings/{id}/score-explanation`
- [ ] `GET /v1/stream/alerts`

### API quality
- [x] Add auth middleware (`auth.ts` — bearer token with constant-time comparison)
- [x] Add request validation (Zod schemas + `parseOrThrow()`)
- [x] Add typed error responses (`error-handler.ts` — AppError, ValidationError, NotFoundError)
- [x] Add cursor pagination helpers (cursor encode/decode in `listings.ts`)
- [x] Add rate limits if exposed remotely (`@fastify/rate-limit` in `main.ts`)
- [ ] Add endpoint integration tests

---

## 13. Native macOS app

### Foundation
- [x] Create SwiftUI app shell
- [x] Add navigation split view
- [x] Add API client integration
- [x] Add Keychain token storage (`KeychainHelper.swift`)
- [ ] Add local cache layer
- [ ] Add background refresh behavior

### Screens
- [x] Dashboard (`DashboardView.swift`)
- [x] Listings list (`ListingsView.swift` + `ListingsTable.swift`)
- [x] Listing detail (`ListingDetailView.swift`)
- [x] Saved filters (`FiltersView.swift` + `FiltersViewModel.swift`)
- [x] Alerts (`AlertsView.swift` + `AlertsViewModel.swift`)
- [x] Sources health (`SourcesView.swift` + `SourcesViewModel.swift`)
- [ ] Analytics
- [x] Settings (`SettingsView.swift`)

### Listings UX
- [x] Search field (`.searchable()` in ListingsView)
- [x] Table columns for price/size/district/score (`ListingsTable.swift`)
- [x] Sort controls (`sortOrder` with `KeyPathComparator`)
- [ ] Cursor pagination / infinite load
- [x] Open source URL action (`ListingActionsSection.swift`)
- [x] Score explanation pane (`ListingScoreSection.swift` + `ScoreBreakdownView.swift`)
- [ ] Price history view (placeholder)
- [ ] Alert match badges

### Filters UX
- [x] Create filter flow (FiltersView new filter sheet)
- [x] Edit filter flow (FiltersView edit sheet via FilterDraft)
- [ ] Test filter flow
- [x] Enable/disable filter (active toggle in FiltersView)
- [ ] Duplicate filter
- [x] Delete filter (swipe-to-delete in FiltersView)

### Alerts UX
- [x] Alert list (AlertsView with status filter)
- [x] Unread indicator (blue dot badge in AlertsView)
- [x] Mark read/opened (context menu in AlertsView)
- [ ] Open linked listing
- [x] MenuBarExtra summary (`MenuBarContent.swift`)
- [ ] System notification action

### Native polish
- [x] Keyboard shortcuts (Cmd+1–6, Cmd+R)
- [x] Command menu entries (`navigationCommands` + `viewCommands`)
- [x] Searchable integration (`.searchable()`)
- [x] Inspector/sidebar behavior (`NavigationSplitView` + `.inspector()`)
- [x] Native table selection behavior (`Table` with selection binding)
- [x] Dark mode support (system colors throughout)
- [ ] Empty/error states

---

## 14. Observability and operations

### Metrics
- [x] Crawl success rate by source (`rei_crawl_success_total` in app-metrics.ts)
- [x] Parse success rate by source (`rei_parse_success_total` in app-metrics.ts)
- [x] Block/captcha rate (`rei_block_captcha_total` in app-metrics.ts)
- [x] Raw snapshot rate (`rei_raw_snapshots_total`, wired in pipeline-factory)
- [x] Normalization rate (`rei_normalizations_total`, wired in pipeline-factory)
- [x] Version creation rate (`rei_versions_created_total`, wired in pipeline-factory)
- [x] Score latency (`rei_score_duration_seconds`, wired in pipeline-factory)
- [x] Alert lag (`rei_alert_lag_seconds`, wired in pipeline-factory)
- [x] API latency (`rei_api_request_duration_seconds`, onResponse hook in main.ts)
- [x] App sync latency (`GET /metrics` endpoint serves all metrics for monitoring)

### Logging
- [x] Correlation IDs in every job (scrapeRunId, jobId in log contexts)
- [x] Structured logs in JSON (`formatLog()` in observability)
- [x] Log redaction rules (`redactLogContext()` — secrets, emails, large values)
- [x] Separate warning/error classes (`OperationalWarning`, `TransientError`, `FatalError`)
- [x] Large artifact references instead of inline dumps (truncation at 500 chars in `redactLogContext()`)

### Dashboards
- [ ] Source health dashboard
- [ ] Queue depth dashboard
- [ ] API performance dashboard
- [ ] Alert delivery dashboard
- [ ] Baseline/scoring dashboard

### Runbooks
- [ ] Source degraded runbook
- [ ] Source blocked runbook
- [ ] Parser breakage runbook
- [ ] Queue stuck runbook
- [ ] Backup restore runbook
- [ ] Release rollback runbook

---

## 15. Security and compliance

- [ ] Secrets removed from source control
- [ ] Environment secret loading verified
- [ ] Object storage access policy restricted
- [ ] Keychain storage for app secrets
- [ ] Auth token rotation path defined
- [ ] No raw HTML in standard logs
- [ ] Legal review recorded for enabled sources
- [ ] Public/private artifact access policy documented

---

## 16. Performance and scale

- [ ] Verify active listing queries use intended indexes
- [ ] Verify filter queries remain sub-second on realistic data
- [ ] Verify score sorting does not require heavy joins
- [ ] Verify reverse matching cost on changed listing path
- [ ] Verify raw tables do not affect hot query paths
- [ ] Define archival/retention policy for artifacts
- [ ] Define partitioning strategy if data volume grows
- [ ] Add load test for listing search endpoint
- [x] Add crawl concurrency tuning doc

---

## 17. Data quality and replay

- [ ] Add normalization replay command
- [ ] Add score replay command
- [ ] Add raw snapshot reparse command
- [ ] Add backfill command for source history
- [ ] Add data quality report for missing critical fields
- [ ] Add district inference audit report
- [ ] Add outlier listing report
- [ ] Add duplicate candidate report

---

## 18. Multi-source expansion

- [ ] Confirm source 1 stable before source 2 rollout
- [ ] Add source 2 package
- [ ] Add source 2 tests and fixtures
- [ ] Compare source 1 and source 2 canonical coverage
- [ ] Verify filters behave identically across sources
- [ ] Verify scoring uses canonical fields only
- [ ] Add source-level quality dashboard
- [ ] Document onboarding checklist for source 3+

---

## 19. Future hooks

- [ ] Geocoding queue placeholder
- [ ] Cross-source duplicate clustering placeholder
- [ ] Investor feedback capture placeholder
- [ ] ML feature export placeholder
- [ ] CSV/XLSX export placeholder
- [ ] Webhook integration placeholder
- [ ] District trend analytics placeholder

---

## 20. Release gates

### Before first production source
- [ ] Schema stable
- [ ] Raw persistence stable
- [ ] Failure artifacts working
- [ ] Runbooks drafted

### Before public/internal app usage
- [ ] Listing search stable
- [ ] Filters save/load stable
- [ ] Alerts dedupe stable
- [ ] Source health visible

### Before trusting score in decisions
- [ ] Baselines populated
- [ ] Score explanation visible
- [ ] Regression tests passing
- [ ] Confidence score implemented
- [ ] Investor reviewed examples manually

### Before adding source 2
- [ ] Source 1 uptime acceptable
- [ ] No cross-layer leakage from source-specific logic
- [ ] Onboarding template proven
- [ ] Alerting/scoring unaffected by new source

---

## 21. Done definition for the whole system

- [ ] At least one Austrian source crawls continuously
- [ ] Raw data is preserved and replayable
- [ ] Canonical listings are queryable by investor criteria
- [ ] Filters support Vienna district/price/size/property type constraints
- [ ] Scores rank opportunities with explanation
- [ ] Alerts notify on new matching listings
- [ ] Swift macOS app feels native and reliable
- [ ] The system is extensible to additional sources without redesign
