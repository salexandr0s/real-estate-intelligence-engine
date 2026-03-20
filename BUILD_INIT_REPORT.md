# Build Initialization Report

## Summary

Production foundation initialized for the Real Estate Intelligence Engine.
**159 files created** across 14 TypeScript packages/apps and 1 Swift macOS app.
**108 tests pass** covering normalization, scoring, filtering, ingestion deduplication, and scraper parsing.

---

## What Was Implemented

### Phase B — Repository Structure
- npm workspace monorepo with Turbo build orchestration
- TypeScript strict mode across all packages
- Vitest test runner with global configuration
- Prettier code formatting
- Project CLAUDE.md with development commands
- Docker Compose for local PostgreSQL, Redis, MinIO

### Phase C — Backend Foundation
- **@rei/config** — Environment-based configuration loading for all services
- **@rei/observability** — Structured JSON logging with correlation IDs, error taxonomy (AppError, ValidationError, NotFoundError, etc.)
- **@rei/contracts** — Shared TypeScript types for all domain entities, scraper interfaces, normalization DTOs, filtering, scoring, alerts, and API contracts

### Phase D — Database Layer
- **@rei/db** — Complete database package with:
  - Migration runner tracking applied migrations in `_migrations` table
  - Migration file: `001-initial-schema.sql` (canonical schema.sql)
  - Typed `pg` connection pool with transaction support
  - Query modules for: sources, scrape_runs, raw_listings, listings (with search), listing_versions, user_filters (with reverse-match), alerts, market_baselines
  - Seed script: default user + willhaben source
  - Listing search uses SARGable predicates matching schema indexes

### Phase E — Scraper Core
- **@rei/scraper-core** — Reusable scraping framework with:
  - SourceAdapter interface contract
  - Per-domain rate limiter (token bucket)
  - Retry with exponential backoff and jitter
  - Error classification (transient_network, soft_anti_bot, parse_failure, terminal_page)
  - Source circuit breaker (closed/open/half_open states)
  - Content hashing (SHA-256, deterministic JSON sort)
  - Artifact writer interface for HTML/screenshot persistence
  - Jittered delay utilities for anti-bot pacing
  - Scrape run context with metrics tracking

### Phase F — First Source Module
- **@rei/source-willhaben** — Willhaben.at source adapter with:
  - Full SourceAdapter implementation
  - Discovery page parser (extracts listing cards from HTML)
  - Detail page parser (extracts all fields from structured attributes + JSON-LD)
  - Availability detection (available/removed/sold/blocked)
  - URL canonicalization and source key derivation
  - 3 fixture HTML files (discovery, detail, sold)
  - 9 parser tests using fixtures

### Phase G — Normalization Layer
- **@rei/normalization** — Complete normalization pipeline with:
  - EUR price parsing (handles €299.000, 299.000,00, etc.)
  - SQM and rooms parsing with European number format support
  - Boolean coercion from German text (ja/nein/vorhanden/ohne)
  - Vienna district lookup from postal codes, names, aliases
  - Property type mapping (German → canonical enum)
  - Completeness scoring (0-100 weighted)
  - Content fingerprinting (SHA-256 of business-relevant fields)
  - Willhaben-specific mapper
  - Base normalizer with provenance tracking and warnings

### Phase H — Ingestion Flow
- **@rei/ingestion** — End-to-end pipeline with:
  - IngestRawListing: raw snapshot persistence with idempotent upsert
  - NormalizeAndUpsert: normalization + change detection + version creation
  - ScoreAndAlert: scoring + filter reverse-match + alert creation
  - FullIngestionPipeline: orchestrates all three stages

### Phase I — Filtering Engine
- **@rei/filtering** — Filter engine with:
  - Filter compilation (EUR→cents, dedupe districts, normalize keywords)
  - Filter validation (range checks, valid districts/types, non-negative prices)
  - Listing search query builder (parameterized SQL, cursor pagination, 5 sort modes)
  - Reverse-match query builder (find filters matching a listing)
  - SQL matches the pattern from filtering_engine.md with all indexes

### Phase J — Scoring Engine
- **@rei/scoring** — Full scoring implementation with:
  - District price score (piecewise linear, 40 at baseline, 100 at 20%+ below)
  - Undervaluation score with sample-size confidence multiplier
  - Keyword signal score with quality/risk/opportunity categories
  - Renovation-needed rule (+10 if bucket discount ≥7%, -10 if <3%)
  - Time-on-market score with freshness + context adjustments
  - Confidence score (completeness, baseline, source, location)
  - Weighted final score: 0.40 × district + 0.25 × undervaluation + 0.15 × keyword + 0.10 × time + 0.10 × confidence
  - SCORE_VERSION = 1, versioned for replay

### Phase K — Alerting Foundation
- **@rei/alerts** — Alert matching and deduplication with:
  - matchListingToFilters: generates AlertCreate records with dedupe keys
  - shouldCreateAlert: prevents duplicate alerts, requires meaningful changes
  - Alert title/body generation in German
  - Support for new_match, price_drop, score_upgrade, status_change types

### Phase L — Swift macOS App
- **apps/macos** — Native SwiftUI macOS app with:
  - NavigationSplitView with sidebar navigation
  - Dashboard, Listings, Filters, Alerts, Sources, Settings screens
  - Table-based listings view with score/price/size/district columns
  - Listing detail view with score breakdown
  - Filter editor with district/price/size/type/keyword controls
  - API client (actor-based) with bearer token auth
  - Score indicator and status badge components
  - EUR price formatter
  - MenuBarExtra for unread alert count
  - Keyboard shortcuts (Cmd+1-5)
  - Mock data for standalone launch
  - 21 Swift source files

### Phase M — DevEx
- docker-compose.local.yml for PostgreSQL + Redis + MinIO
- dev-setup.sh and dev-start.sh scripts
- example.env with all configuration variables
- vitest.config.ts with global test setup

---

## What Was Already Present
- All documentation files (architecture.md, buildplan.md, scrapers.md, normalization.md, filtering_engine.md, scoring_engine.md, api.md, infra.md, agents.md, checklist.md, folder_structure.md)
- schema.sql (used as-is for migration)
- example.env (used as reference for config)
- No existing code

---

## What Changed in Docs
- No documentation changes required. Implementation follows the documented architecture faithfully.

---

## Deliberately Deferred
1. **BullMQ queue integration** — Queue infrastructure is designed but worker apps use placeholder entrypoints. Full queue setup requires Redis running.
2. **Live Playwright scraping** — Source adapter supports fixtures; live browser automation deferred to Phase 3 (first production source).
3. **Object storage integration** — Artifact writer interface exists; actual S3/MinIO upload deferred.
4. **OpenAPI spec generation** — API routes exist; formal OpenAPI YAML deferred.
5. **Swift generated API client** — App uses manual API client; generated client from OpenAPI deferred.
6. **CI/CD pipeline** — No GitHub Actions workflow yet.
7. **OpenTelemetry/metrics** — Logger exists; OTEL integration deferred.
8. **Email/webhook alert delivery** — In-app alerts work; external channels deferred.
9. **Market baseline computation job** — Schema and lookup exist; periodic baseline SQL job deferred.
10. **Second source adapter** — Source template structure exists; actual second source deferred per buildplan.

---

## Known Risks
1. **Selector maintenance** — willhaben.at selectors are realistic estimates; live site may differ.
2. **Anti-bot tuning** — Rate limits and delays are configured but untested against live sources.
3. **Cold-start scoring** — Scoring works but baselines will be empty until enough listings are collected.
4. **Single-user auth** — Bearer token auth is simple; not production-hardened for multi-user.

---

## Test Coverage

| Test File | Tests | Coverage Area |
|---|---|---|
| normalization-coerce.test.ts | 18 | EUR price, SQM, rooms, boolean, whitespace parsing |
| district-lookup.test.ts | 21 | Postal code inference, name matching, contradiction handling |
| scoring.test.ts | 20 | All 5 score components, worked example from docs |
| filtering.test.ts | 29 | Filter compilation, validation, query param generation |
| ingestion-dedupe.test.ts | 11 | Content hashing, fingerprinting, version detection, deduplication |
| parser.test.ts | 9 | Willhaben discovery/detail/sold page parsing from fixtures |
| **Total** | **108** | |

---

## Next Recommended Milestone

**Milestone B: First Production Source** (Phases 3-4 from buildplan)

1. Install Playwright and implement live browser automation in scraper-core
2. Set up BullMQ queues and wire up worker-scraper
3. Test willhaben adapter against live site, fix selectors
4. Run first scrape → raw_listings → normalize → listings pipeline end-to-end
5. Implement market baseline computation job
6. Wire up scoring and alert matching in worker-processing
7. Connect Swift app to live API instead of mock data

The foundation is ready for this work. Adding a new source requires only a new `packages/source-*` package following the willhaben pattern.
