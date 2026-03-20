
# checklist.md

## 0. Product and source discovery

- [ ] Confirm initial operating mode: local Mac mini daemon or remote host
- [ ] Confirm first source to onboard
- [ ] Confirm initial target market: Vienna apartments for sale
- [ ] Confirm high-priority districts
- [ ] Confirm allowed source entry points
- [ ] Review robots/terms/compliance status for each planned source
- [ ] Document per-source crawl risk
- [ ] Define success metrics for freshness, reliability, and alert lag
- [ ] Define supported property types for v1
- [ ] Define canonical operation types for v1

---

## 1. Repository and engineering foundation

- [x] Create monorepo layout
- [x] Enable strict TypeScript configuration
- [ ] Configure linting
- [x] Configure formatting
- [x] Configure unit test runner
- [ ] Configure integration test runner
- [ ] Add Git hooks or CI enforcement
- [x] Add migration tooling
- [x] Add shared config package
- [x] Add shared contracts package
- [x] Add API package skeleton
- [x] Add scraper-core package skeleton
- [x] Add normalization package skeleton
- [x] Add scoring package skeleton
- [x] Add alerting package skeleton
- [x] Add Swift macOS app project
- [ ] Add CI pipeline for lint/test/build
- [ ] Add artifact retention for failed test snapshots

---

## 2. Infrastructure

### Database and storage
- [x] Provision PostgreSQL
- [x] Provision Redis
- [x] Provision object storage bucket(s)
- [x] Define bucket prefixes for html/screenshots/har
- [ ] Configure backup policy for PostgreSQL
- [ ] Configure backup verification job
- [ ] Configure object storage lifecycle policy

### Secrets and configuration
- [x] Define environment variable contract
- [ ] Configure secret storage strategy
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
- [ ] Add active listing filter index
- [ ] Add district + price partial index
- [ ] Add district + area partial index
- [ ] Add score sort partial index
- [ ] Add source + last seen index
- [ ] Add search vector index
- [ ] Add raw listing dedupe index
- [ ] Add scrape run status/time indexes
- [ ] Add user filter active index
- [ ] Add user filter districts GIN index
- [ ] Add user filter property types GIN index
- [ ] Add alert scheduling index
- [ ] Add market baseline lookup index

### Migration quality
- [ ] Test migrations from empty database
- [ ] Test rolling forward on seeded database
- [ ] Test rollback plan or compensating migration strategy
- [ ] Document destructive migration rules

---

## 4. Scraper core

### Browser runtime
- [ ] Implement Playwright browser pool
- [ ] Implement browser context factory
- [ ] Set locale to `de-AT`
- [ ] Set timezone to `Europe/Vienna`
- [ ] Add viewport rotation strategy
- [ ] Add user-agent rotation strategy
- [ ] Add headless/headful toggle
- [ ] Add browser/context recycle policy

### Request execution
- [ ] Implement request plan abstraction
- [ ] Implement navigation timeout defaults
- [ ] Implement wait condition helpers
- [ ] Implement request interception policy
- [ ] Implement cookie-consent helper
- [ ] Implement page artifact capture helpers

### Reliability
- [ ] Implement retry classification
- [ ] Implement exponential backoff with jitter
- [ ] Implement per-source concurrency limits
- [ ] Implement per-source request-rate limits
- [ ] Implement block/captcha signal detection
- [ ] Implement source circuit breaker
- [ ] Implement dead-letter handling

### Persistence integration
- [ ] Create scrape run at job start
- [ ] Update scrape run counters while crawling
- [ ] Close scrape run with final status
- [ ] Persist raw snapshot metadata
- [ ] Persist raw artifact pointers
- [ ] Update observation count on duplicate raw snapshot
- [ ] Keep raw writes idempotent

### Diagnostics
- [ ] Capture screenshot on parse failure
- [ ] Capture HTML on parse failure
- [ ] Capture HAR when configured
- [ ] Log source/job correlation IDs
- [ ] Expose scrape metrics

---

## 5. Source template and source onboarding

- [x] Create reusable source package template
- [x] Define `SourceAdapter` interface
- [x] Define source DTO conventions
- [x] Define selector file convention
- [x] Define fixture storage convention
- [ ] Define source runbook template
- [ ] Define source health documentation template

### First source
- [ ] Implement discovery page extraction
- [ ] Implement detail page extraction
- [ ] Implement canonical URL normalization
- [ ] Implement source-local listing key derivation
- [ ] Implement unavailable/removed detection
- [ ] Implement cookie flow for source
- [ ] Tune delays for source
- [ ] Tune concurrency for source
- [ ] Save representative fixtures
- [ ] Add parser tests from fixtures
- [ ] Add canary crawl for source
- [ ] Write source runbook

### Second source
- [ ] Repeat source template flow
- [ ] Verify no schema rewrite needed
- [ ] Verify shared normalization abstractions are sufficient
- [ ] Compare field coverage vs first source
- [ ] Tune anti-bot policy separately

---

## 6. Raw data handling

- [ ] Define raw DTO contract
- [ ] Preserve response headers/status
- [ ] Preserve extraction status
- [ ] Preserve parser version
- [ ] Preserve canonical URL and detail URL
- [ ] Preserve discovery URL where relevant
- [ ] Preserve full raw payload JSON
- [ ] Preserve HTML artifact pointer
- [ ] Preserve screenshot artifact pointer
- [ ] Preserve HAR artifact pointer
- [ ] Compute raw content checksum
- [ ] Verify re-observation updates `last_seen_at`
- [ ] Verify identical raw snapshot does not duplicate row
- [ ] Verify changed raw snapshot creates new row

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
- [ ] Normalize city names
- [ ] Normalize postal code
- [ ] Normalize street/house number
- [ ] Normalize address display
- [x] Implement Vienna district lookup table
- [x] Implement district alias matching
- [x] Implement district number text matching
- [x] Implement postal code district inference
- [x] Implement contradiction warnings
- [x] Implement geocode precision model

### Derived fields
- [ ] Compute price per sqm
- [x] Compute completeness score
- [x] Compute content fingerprint
- [ ] Compute cross-source fingerprint candidate
- [ ] Attach normalized payload overflow fields

### Persistence
- [ ] Upsert current `listings` row
- [ ] Append `listing_versions` row on meaningful change
- [ ] Avoid version bump on non-business changes
- [ ] Track first seen / last seen
- [ ] Track price change timestamp
- [ ] Track content change timestamp
- [ ] Track status change timestamp
- [ ] Handle relist/reactivation cases

### Quality checks
- [ ] Missing required identity fields fail safely
- [ ] Malformed non-critical fields become `NULL` + warning
- [ ] No impossible numeric values survive
- [ ] Idempotent normalization test passes
- [ ] Replay normalization test passes

---

## 8. Listing lifecycle and status handling

- [ ] Define canonical listing statuses
- [ ] Map source availability states to canonical statuses
- [ ] Implement removed/not-found handling
- [ ] Implement sold/rented detection where available
- [ ] Implement missing-from-discovery inactivity rule
- [ ] Implement reactivation rule
- [ ] Implement relist detection heuristic backlog item
- [ ] Add lifecycle transition tests

---

## 9. Scoring engine

### Baselines
- [ ] Define area bucket logic
- [ ] Define room bucket logic
- [ ] Implement baseline SQL/materialization job
- [ ] Implement outlier clipping
- [ ] Implement minimum sample thresholds
- [ ] Implement fallback hierarchy
- [ ] Persist `market_baselines`
- [ ] Add baseline regression tests

### Feature extraction
- [ ] Compute district discount percentage
- [ ] Compute bucket discount percentage
- [x] Implement keyword lexicon
- [x] Normalize keyword matching with umlaut support
- [x] Implement renovation-needed rule
- [x] Implement risk keyword penalties
- [x] Implement freshness/time-on-market calculation
- [ ] Implement relist penalty hook
- [ ] Implement confidence score inputs

### Score calculation
- [x] Implement component scores `0..100`
- [x] Implement weighted final score
- [x] Clamp and round final score
- [ ] Persist `listing_scores`
- [ ] Update `listings.current_score`
- [ ] Store explanation JSON
- [ ] Store matched positive keywords
- [ ] Store matched negative keywords
- [ ] Add score versioning
- [ ] Add rescore command
- [ ] Add score regression fixture tests

### UI/analytics support
- [ ] Expose score explanation via API
- [ ] Expose district baselines via API
- [ ] Add high-score listing view
- [ ] Add score distribution analytics
- [ ] Add district comparison analytics

---

## 10. Filtering engine

### Filter contract
- [x] Define filter DTO
- [ ] Define JSON schema/Zod schema
- [ ] Define canonical property type values
- [ ] Define district filter values
- [ ] Define sort options
- [ ] Define alert frequency options
- [ ] Add validation for min/max ranges
- [ ] Add normalization for keyword arrays

### Persistence
- [ ] Store `criteria_json`
- [ ] Store flattened columns
- [ ] Store alert channels
- [ ] Store sort preference
- [ ] Store active/inactive state

### Interactive query path
- [x] Build typed query compiler
- [x] Generate parameterized SQL
- [ ] Support price min/max
- [ ] Support area min/max
- [ ] Support district array
- [ ] Support property type array
- [ ] Support rooms min/max
- [ ] Support score threshold
- [ ] Support required keywords
- [ ] Support excluded keywords
- [ ] Support sort by score/newest/price/sqm
- [ ] Implement cursor pagination
- [ ] Add query plan/index review

### Reverse-match path
- [x] Implement candidate filter SQL
- [ ] Implement keyword post-filtering
- [ ] Implement match logging
- [ ] Update `last_evaluated_at`
- [ ] Update `last_match_at`
- [ ] Add reverse-match tests

### UX
- [ ] Add filter editor in macOS app
- [ ] Add filter preview/test endpoint
- [ ] Add saved filter list screen
- [ ] Add filter enable/disable toggle

---

## 11. Alerts

### Core logic
- [x] Define alert types
- [x] Define alert channels
- [x] Define dedupe key format
- [ ] Create alert row on first match
- [ ] Create alert row on score upgrade
- [ ] Create alert row on price drop
- [ ] Suppress duplicate alerts for same event
- [ ] Implement alert status transitions
- [ ] Implement alert retry policy for delivery

### Delivery
- [ ] In-app alerts feed
- [ ] SSE or WebSocket updates
- [ ] Local macOS notifications
- [ ] Optional email delivery
- [ ] Optional webhook delivery
- [ ] Alert open/read/dismiss actions

### Persistence and UI
- [ ] Alerts list endpoint
- [ ] Alert detail endpoint or payload
- [ ] Unread count endpoint
- [ ] Alert screen in macOS app
- [ ] Menu bar unread indicator
- [ ] Alert dedupe integration tests

---

## 12. API layer

### Contract
- [ ] Define OpenAPI spec
- [ ] Generate TypeScript server types
- [ ] Generate Swift client types
- [ ] Version API under `/v1`

### Endpoints
- [ ] `GET /v1/listings`
- [ ] `GET /v1/listings/{id}`
- [ ] `GET /v1/filters`
- [ ] `POST /v1/filters`
- [ ] `GET /v1/filters/{id}`
- [ ] `PATCH /v1/filters/{id}`
- [ ] `DELETE /v1/filters/{id}`
- [ ] `POST /v1/filters/{id}/test`
- [ ] `GET /v1/alerts`
- [ ] `PATCH /v1/alerts/{id}`
- [ ] `GET /v1/sources`
- [ ] `GET /v1/scrape-runs`
- [ ] `POST /v1/scrape-runs`
- [ ] `GET /v1/analytics/baselines`
- [ ] `GET /v1/listings/{id}/score-explanation`
- [ ] `GET /v1/stream/alerts`

### API quality
- [ ] Add auth middleware
- [ ] Add request validation
- [ ] Add typed error responses
- [ ] Add cursor pagination helpers
- [ ] Add rate limits if exposed remotely
- [ ] Add endpoint integration tests

---

## 13. Native macOS app

### Foundation
- [x] Create SwiftUI app shell
- [x] Add navigation split view
- [x] Add API client integration
- [ ] Add Keychain token storage
- [ ] Add local cache layer
- [ ] Add background refresh behavior

### Screens
- [ ] Dashboard
- [ ] Listings list
- [ ] Listing detail
- [ ] Saved filters
- [ ] Alerts
- [ ] Sources health
- [ ] Analytics
- [ ] Settings

### Listings UX
- [ ] Search field
- [ ] Table columns for price/size/district/score
- [ ] Sort controls
- [ ] Cursor pagination / infinite load
- [ ] Open source URL action
- [ ] Score explanation pane
- [ ] Price history view
- [ ] Alert match badges

### Filters UX
- [ ] Create filter flow
- [ ] Edit filter flow
- [ ] Test filter flow
- [ ] Enable/disable filter
- [ ] Duplicate filter
- [ ] Delete filter

### Alerts UX
- [ ] Alert list
- [ ] Unread indicator
- [ ] Mark read/opened
- [ ] Open linked listing
- [ ] MenuBarExtra summary
- [ ] System notification action

### Native polish
- [ ] Keyboard shortcuts
- [ ] Command menu entries
- [ ] Searchable integration
- [ ] Inspector/sidebar behavior
- [ ] Native table selection behavior
- [ ] Dark mode support
- [ ] Empty/error states

---

## 14. Observability and operations

### Metrics
- [ ] Crawl success rate by source
- [ ] Parse success rate by source
- [ ] Block/captcha rate
- [ ] Raw snapshot rate
- [ ] Normalization rate
- [ ] Version creation rate
- [ ] Score latency
- [ ] Alert lag
- [ ] API latency
- [ ] App sync latency

### Logging
- [ ] Correlation IDs in every job
- [ ] Structured logs in JSON
- [ ] Log redaction rules
- [ ] Separate warning/error classes
- [ ] Large artifact references instead of inline dumps

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
- [ ] Add crawl concurrency tuning doc

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
