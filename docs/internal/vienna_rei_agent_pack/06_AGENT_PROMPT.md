You are acting as a principal engineer, product strategist, data architect, and real-estate intelligence engineer.

You are working inside the repository:
- `salexandr0s/real-estate-intelligence-engine`

Mode:
- implementation mode,
- repo-first,
- evidence-based,
- Vienna-only,
- no shallow generic advice,
- do not invent a parallel system unless strictly necessary.

Your mission is to execute the next serious product phase for the Vienna Real Estate Intelligence Engine.

You must use the attached markdown documents as your operating brief:

1. `01_REPO_TRUTH_AND_PRODUCT_DIRECTION.md`
2. `02_BUILDPLAN.md`
3. `03_FEATURE_SPECS.md`
4. `04_DATA_SOURCES.md`
5. `05_CHECKLIST.md`

They are located in docs/internal/vienna_rei_agent_pack/

## Critical rules

1. Trust code over docs.
   - Re-inspect the repository before making changes.
   - If any brief document conflicts with code, trust code and adjust.
   - Record all important drift you discover.

2. Respect the existing architecture.
   - Extend the existing ingestion / normalization / scoring / filtering / alerting / API / macOS flow.
   - Prefer adding packages/modules/routes/workers inside the current architecture.
   - Do not spin up a parallel “analysis service” or separate app unless absolutely necessary.

3. Vienna-only.
   - Optimize for Vienna.
   - Do not generalize for all of Austria.
   - Do not build multi-country abstractions in this phase.

4. Product/compliance constraints.
   - Do NOT implement ethnicity/nationality/religion/name-origin/proxy-demographic features.
   - Do NOT implement immigrant-concentration logic.
   - Do NOT create a fake neighborhood safety score from weak or coarse crime data.
   - Use only neutral, lawful, explainable context layers.

5. No fake precision.
   - Expose confidence, provenance, fallback level, thin-sample warnings, and unknown states.
   - Keep market-rent and legal-rent separate.

6. Be incremental.
   - Ship in phases.
   - Keep the system working after each phase.
   - Add tests and migration discipline as you go.

## Implementation priorities

Execute in this order unless the repo truth strongly forces a change:

### Priority 1
- unify listing search, filter-test, and live alert semantics
- harden source parser resilience and source-health reporting
- expose geocode provenance and baseline provenance
- fix Vienna context freshness/parity and remove misleading wording

### Priority 2
- build Listing Analysis page/API
- implement market-rent estimation with explicit fallback/sample/confidence
- enrich building facts from official Vienna sources where practical

### Priority 3
- implement legal-rent / rent-regulation assessment v1
- implement document ingestion + extraction + viewer v1

## Expected work process

### Phase 0 — Re-audit and truth sync
Before changing code:
- inspect root `package.json`
- inspect root `schema.sql`
- inspect migrations
- inspect `apps/api/*`
- inspect `apps/worker-scraper/*`
- inspect `apps/worker-processing/*`
- inspect `apps/macos/*`
- inspect `packages/*`
- inspect `scripts/*`
- inspect `tests/*`
- inspect `.github/workflows/*`
- produce a concise truth-sync note

### Phase 1 — Search/filter/alert truth
Goal:
- one keyword semantics contract across listing search, filter test, and live alerts
- alert match explanations
- cluster-aware dedupe where possible

### Phase 2 — Source resilience
Goal:
- fixture-based parser tests for active sources
- canary crawl / source health visibility
- degraded-source handling

### Phase 3 — Provenance hardening
Goal:
- geocode source/confidence/precision fields
- baseline sample/fallback/freshness metadata
- UI/API exposure of these truths

### Phase 4 — Vienna context parity
Goal:
- API-backed context source of truth where practical
- neutral wording cleanup
- freshness/source metadata

### Phase 5 — Listing Analysis page
Goal:
- one-click investor analysis for a listing
- comparable sale/rent context
- market-rent estimate
- assumptions, missing-data warnings, risk/upside flags
- legal-rent summary kept separate

### Phase 6 — Building facts
Goal:
- building-level enrichment store
- building match confidence
- stronger foundation for legal-rent logic

### Phase 7 — Legal-rent assessment
Goal:
- auditable rules engine with strong/weak/unknown signal separation
- conservative output states
- no false legal certainty

### Phase 8 — Document ingestion and viewer
Goal:
- detect attachment URLs during scraping
- persist and dedupe docs
- native PDF extraction first
- OCR only when necessary
- extracted facts with provenance
- Documents tab in listing detail

## Output expectations

As you work, produce concrete implementation artifacts such as:

- migrations
- schema changes
- package/module additions
- worker additions
- API route changes
- macOS view/view-model changes
- tests
- updated internal docs

## Technical expectations

### Search/filter/alert truth
You must verify whether:
- keyword logic diverges between listing search and filter test,
- live alert matching uses a different path,
- search vector usage is inconsistent,
- dedupe is too source-specific rather than property/cluster-aware.

If divergence exists, unify it.

### Market-rent estimation
Use the existing internal corpus.
Prefer:
- nearby similar rent listings first,
- district fallback second,
- broad fallback only when necessary.

Must expose:
- sample size,
- fallback level,
- confidence,
- assumptions.

### Legal-rent logic
This must remain a separate rules layer.
Outputs should include:
- likely capped,
- likely uncapped,
- likely capped but missing critical proof,
- unclear,
- needs human/legal review.

Do not collapse into one “fair rent” number.

### Document pipeline
Use:
1. native PDF extraction first,
2. OCR only if needed,
3. floorplan-specific extraction only when worth it.

Every extracted fact must retain provenance.

## Data-source expectations

Prioritize official Vienna/Austria sources for:
- transit,
- parks/green space,
- schools/kindergartens,
- building facts,
- climate/noise/flood context,
- district-level transaction anchors.

Before integrating any external source, verify:
- license/commercial reuse,
- freshness,
- granularity,
- joinability,
- maintenance burden,
- whether it belongs in scoring or display-only context.

## Non-goals

Do not spend this phase on:
- Austria-wide expansion,
- general-purpose AI copilot polish,
- non-essential rebrands or visual overhauls,
- heavyweight new infrastructure unless repo evidence strongly demands it.

## Done criteria

This phase is done when:
- search/filter/alert truth is unified,
- parser/source health is materially stronger,
- geocode/baseline provenance is visible,
- Vienna context is cleaner and more defensible,
- listing detail now includes a real Analysis surface,
- market-rent estimation is transparent,
- legal-rent assessment exists as an auditable separate layer,
- documents are first-class objects with extraction provenance,
- tests and migrations cover the new capabilities,
- the implementation still feels like one coherent product rather than bolted-on side systems.

---

# Work Completed — Implementation Log

_Last updated: 2026-03-23_

## Phase 0 — Repo Truth Sync (DONE)

Audit confirmed:
- 12 existing migrations, 7 source adapters, 3-stage ingestion pipeline
- Keyword divergence: search uses SQL ILIKE; reverse-match uses JS `String.includes()`
- `search_vector` GIN index exists in schema but unused by any query
- Reverse-match skips POI proximity + location score filters
- Baselines have `findBaselineWithFallback()` with 4-level cascade but fallback level not exposed to API
- Geocoding stores `geocode_precision` (6 levels) but not source or confidence
- Canary worker + stale-check worker existed but were feature-gated

## Phase 1 — Search/Filter/Alert Unification (DONE)

### What was built
- **Shared keyword matching contract** in `packages/contracts/src/keyword-match.ts` — single source of truth for keyword semantics (case-insensitive substring, ILIKE-equivalent escaping)
- **Unified reverse-match** — `packages/db/src/queries/user-filters.ts:filterByKeywords()` now delegates to shared `passesKeywordFilter()`
- **Re-export** in `packages/filtering/src/compiler/keyword-match.ts` preserves `@rei/filtering` API surface
- **Alert match explanations** — `AlertMatchReasons` type in contracts, `match_reasons_json JSONB` column via migration 013, populated in `score-and-alert.ts:buildMatchReasons()`
- **Cluster-aware dedup** — `cluster_fingerprint CHAR(64)` column + index via migration 013, `existsForCluster()` query, dedup check before alert creation in `score-and-alert.ts`
- **Pipeline factory** extended to pass filter criteria through for match reason building + cluster deps wired
- **API exposure** — `matchReasons` included in alerts list and detail responses

### Files created
- `packages/contracts/src/keyword-match.ts`
- `packages/filtering/src/compiler/keyword-match.ts`
- `packages/db/migrations/013-alert-match-reasons.sql`
- `tests/unit/keyword-equivalence.test.ts` (43 tests)

### Files modified
- `packages/contracts/src/alerts.ts` — `AlertMatchReasons`, extended `AlertCreate`/`AlertRow`
- `packages/contracts/src/index.ts` — exports
- `packages/db/src/queries/alerts.ts` — new fields + `existsForCluster()`
- `packages/db/src/queries/user-filters.ts` — shared keyword import
- `packages/filtering/src/index.ts` — re-exports
- `packages/ingestion/src/score-and-alert.ts` — match reasons, cluster dedup, extended deps
- `apps/worker-processing/src/pipeline-factory.ts` — passes filter criteria + cluster deps
- `apps/api/src/routes/alerts.ts` — `matchReasons` in response

### Known remaining gap
- `search_vector` GIN index exists but is not used by any query path (low priority)

## Phase 2 — Source Resilience (DONE)

### What was built
- **Canary enabled by default** — `packages/config/src/index.ts` defaults `SCRAPER_CANARY_ENABLED` to `true`
- **Canary history endpoint** — `GET /v1/sources/:code/canary-history` in `apps/api/src/routes/sources.ts`
- **Source health enrichment** — `GET /v1/sources` response includes `healthSummary` with `lastCanary` and `recentSuccessRate`
- **Success rate query** — `packages/db/src/queries/scrape-runs.ts:getRecentSuccessRate()`
- **Canary results query** — `packages/db/src/queries/canary-results.ts:findBySourceCode()`

### Files modified
- `packages/config/src/index.ts`
- `apps/api/src/routes/sources.ts`
- `apps/api/src/schemas.ts`
- `packages/db/src/queries/canary-results.ts`
- `packages/db/src/queries/scrape-runs.ts`
- `packages/db/src/index.ts`

### Known remaining gap
- No automatic health_status update based on consecutive canary failures (auto-degradation)
- All 7 sources have pre-existing fixture-based parser tests

## Phase 3 — Provenance Hardening (DONE)

### What was built
- **Migration 014** — adds `geocode_source TEXT`, `geocode_updated_at TIMESTAMPTZ` to listings; adds `baseline_fallback_level TEXT`, `baseline_sample_size INT`, `baseline_freshness_hours NUMERIC` to listing_scores
- **Geocode source tracking** — geocoding worker sets `geocode_source` parameter when updating coordinates
- **Baseline provenance** — `ScoreResult` extended with `baselineFallbackLevel`, `baselineSampleSize`, `baselineFreshnessHours`; populated in `score-and-alert.ts` before score persistence
- **API exposure** — `geocodeSource` in listing detail; baseline provenance in score data

### Files created
- `packages/db/migrations/014-geocode-provenance.sql`

### Files modified
- `packages/contracts/src/scoring.ts` — baseline provenance fields on `ScoreResult`
- `packages/contracts/src/domain.ts` — `geocodeSource` on listing types
- `packages/db/src/queries/listings.ts` — new geocode fields
- `packages/db/src/queries/listing-scores.ts` — baseline provenance persistence
- `packages/ingestion/src/score-and-alert.ts` — populates baseline provenance
- `apps/worker-processing/src/workers/geocoding-worker.ts` — sets geocode_source
- `apps/api/src/routes/listings.ts` — exposes provenance

## Phase 4 — Vienna Context Parity (DONE)

### What was built
- **Neutral wording** — `POICategoryGroup.emergencyServices` replaces "Safety" with "Emergency Services" for police/fire station POIs
- **API-backed context** — POI data served via API (`GET /v1/listings/:id/pois`), not client-bundled
- **Source health freshness** — `GET /v1/sources` includes `healthSummary` with `lastCanary`, `recentSuccessRate`

## Phase 5 — Listing Analysis Page (DONE)

### What was built
- **New `@rei/analysis` package** with market-rent estimation, investor metrics, risk/upside flags, confidence model
- **Analysis types** in `packages/contracts/src/analysis.ts` — `ListingAnalysis`, `MarketContext`, `MarketRentEstimate`, `InvestorMetrics`, `ComparableEntry`, `BuildingContext`, `LegalRentSummary`, `AnalysisConfidence`
- **Tiered comparable queries** in `packages/db/src/queries/comparables.ts` — `findNearbyComparables()` (Tier 1: 500m radius, geocode-quality-gated) and `findDistrictComparables()` (Tier 2)
- **Analysis API endpoint** — `GET /v1/listings/:id/analysis` in `apps/api/src/routes/analysis.ts` (400+ lines, fully integrated)
- **Market-rent estimation** — trimmed median €/sqm, percentile bands, confidence from sample size + fallback level
- **Investor metrics** — gross yield, price-to-rent, sensitivity bands with assumptions
- **Risk/upside flags** — expanded inputs: legal-rent status, comp sample size, outdoor space (balcony/terrace/garden), transit proximity, condition category
- **Building facts integration** — spatial lookup via `buildingFacts.findNearestBuilding()` in analysis endpoint (lines 68-89), extracts year_built/typology/unitCount from factsJson
- **Legal-rent integration** — `assessLegalRent()` called with building facts, text hints, subsidized status, building match confidence (lines 236-281)
- **Confidence model** — `computeAnalysisConfidence()` degrades on: coarse geocode (-20/-30), thin/missing sale comps (-10/-15), missing rent comps (-10), unresolved building (-10), missing living area/rooms/year built (-5/-10)
- **Enriched comparables** — each comp includes `matchReason`, `recencyDays`, `areaSimilarityPct`, `roomDiff` (lines 131-151)

### Files created
- `packages/analysis/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/analysis/src/market-rent.ts`
- `packages/analysis/src/investor-metrics.ts`
- `packages/analysis/src/risk-flags.ts`
- `packages/analysis/src/confidence.ts`
- `packages/analysis/src/index.ts`
- `packages/analysis/src/__tests__/market-rent.test.ts`
- `packages/analysis/src/__tests__/investor-metrics.test.ts`
- `packages/analysis/src/__tests__/risk-flags.test.ts`
- `packages/analysis/src/__tests__/confidence.test.ts`
- `packages/contracts/src/analysis.ts`
- `packages/db/src/queries/comparables.ts`
- `apps/api/src/routes/analysis.ts`

## Phase 6 — Building Facts (DONE)

### What was built
- **Migration 015** — `building_facts` table with `building_key`, `source_name`, `source_record_id`, `address_text`, `lat/lon`, `match_confidence`, `facts_json`, provenance; `building_fact_id` + `building_match_confidence` on listings
- **Query module** — `packages/db/src/queries/building-facts.ts` with `upsertBuildingFact()`, `findById()`, `findByBuildingKey()`, `findNearestBuilding()` (spatial Haversine, configurable radius)
- **Analysis integration** — analysis endpoint performs spatial building lookup and populates `buildingContext` when match confidence is acceptable
- **Import script** — `scripts/import-building-facts.ts` reads Vienna OGD GeoJSON, normalizes building keys, handles Point/Polygon/MultiPolygon geometries via centroid, upserts via `buildingFacts.upsertBuildingFact()`
- **npm script** — `"import:buildings"` in root package.json

### Files created
- `packages/db/migrations/015-building-facts.sql`
- `packages/db/src/queries/building-facts.ts`
- `scripts/import-building-facts.ts`

## Phase 7 — Legal-Rent Assessment (DONE)

### What was built
- **`@rei/legal-rent` package** with conservative rules engine
- **Rules engine** — `assessLegalRent()` with 5 output states (`likely_capped`, `likely_uncapped`, `likely_capped_missing_critical_proof`, `unclear`, `needs_human_legal_review`), strong/weak/missing signal separation, conservative decision tree (post-2001 → exempt, pre-1945 → full MRG, 1945-2001 → subsidy-dependent, no-year → unclear)
- **Migration 016** — `legal_rent_assessments` table with status, regime_candidate, confidence, signals, missing facts, indicative band, disclaimer
- **Query module** — `upsertAssessment()`, `findByListingId()`
- **Analysis integration** — analysis endpoint calls `assessLegalRent()` with building facts (official year_built preferred), subsidized status inferred from building typology, text hints from title/description, building match confidence
- **31 table-driven tests** in `packages/legal-rent/src/__tests__/rules-engine.test.ts` covering all 5 states, signal classification, boundaries, output structure, disclaimer

### Files created
- `packages/legal-rent/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/legal-rent/src/rules-engine.ts`
- `packages/legal-rent/src/index.ts`
- `packages/legal-rent/src/__tests__/rules-engine.test.ts`
- `packages/db/migrations/016-legal-rent.sql`
- `packages/db/src/queries/legal-rent.ts`

## Phase 8 — Document Ingestion (DONE)

### What was built
- **Migration 017** — `listing_documents`, `document_extractions`, `document_fact_spans` tables with full provenance fields
- **Query module** — `packages/db/src/queries/documents.ts` with `upsertDocument()`, `findByListingId()`, `updateStatus()`, `findPendingDocuments()`, `findFactsByDocumentId()`, `insertExtraction()`, `insertFactSpan()`
- **`@rei/documents` package** — `extractPdfText()` (regex-based PDF text extraction) and `parseRealEstateFacts()` (20+ German real estate regex patterns)
- **Full document worker** — `apps/worker-processing/src/workers/document-worker.ts` (214 lines): fetch → download → SHA-256 hash → PDF detect → text extract → fact parse → persist extraction + fact spans → status update
- **Document API routes** — `GET /v1/listings/:id/documents` and `GET /v1/documents/:id/facts` in `apps/api/src/routes/documents.ts`
- **Attachment URL detection** — `extractAttachmentUrls()` in willhaben + immoscout24 detail parsers, detects PDF/document links
- **Detail worker integration** — `enqueueAttachmentDocuments()` in `apps/worker-scraper/src/workers/detail-worker.ts`, upserts listing_documents rows and enqueues DOCUMENT_PROCESSING jobs
- **Graceful shutdown** — document worker added to shutdown sequence in `apps/worker-processing/src/main.ts`

### Files created
- `packages/db/migrations/017-documents.sql`
- `packages/db/src/queries/documents.ts`
- `packages/documents/package.json`, `tsconfig.json`
- `packages/documents/src/pdf-extractor.ts`
- `packages/documents/src/fact-parser.ts`
- `packages/documents/src/index.ts`
- `packages/documents/src/__tests__/fact-parser.test.ts`
- `packages/documents/src/__tests__/pdf-extractor.test.ts`
- `apps/worker-processing/src/workers/document-worker.ts`
- `apps/api/src/routes/documents.ts`

## macOS SwiftUI UI (DONE)

### What was built
- **Analysis model** — `Analysis.swift` with 11 nested Codable structs matching `GET /v1/listings/:id/analysis`
- **Analysis section** — `AnalysisSection.swift` (407 lines) with 9 card types: confidence badge, market rent, investor metrics, building context, sale comparables, legal-rent assessment, risk flags, upside flags, missing data, assumptions
- **Document model** — `Document.swift` with `ListingDocument` + `DocumentFact`
- **Documents section** — `DocumentsSection.swift` with expandable per-document facts, lazy loading, type icons, status badges, open-in-browser links
- **Geocode badge** — `GeocodeBadge.swift` mapping precision → label/color, displayed in `ListingDetailsSection` as "Location Accuracy"
- **Alert match reasons** — `AlertMatchReasons` struct in `APIAlertResponse.swift`, `MatchReasonsView` in `AlertInspectorContent.swift` showing keyword tags, district match, threshold badges
- **Geocode source** — `geocodeSource: String?` on `Listing.swift` + `APIListingResponse.swift`
- **API endpoints** — `.getAnalysis`, `.getDocuments`, `.getDocumentFacts` in `APIEndpoints.swift`
- **Client methods** — `fetchAnalysis()`, `fetchDocuments()`, `fetchDocumentFacts()` in `APIClient.swift`
- **ListingDetailView** — analysis section, documents section, and all async loaders wired

### Files created
- `apps/macos/ImmoRadar/Models/Analysis.swift`
- `apps/macos/ImmoRadar/Models/Document.swift`
- `apps/macos/ImmoRadar/Features/Listings/AnalysisSection.swift`
- `apps/macos/ImmoRadar/Features/Listings/DocumentsSection.swift`
- `apps/macos/ImmoRadar/DesignSystem/GeocodeBadge.swift`

## Backfill Scripts (DONE)

### What was built
- **Building facts import** — `scripts/import-building-facts.ts` reads Vienna OGD GeoJSON, handles Point/Polygon/MultiPolygon, normalizes building keys, upserts via DB queries
- **Geocode provenance backfill** — `scripts/backfill-geocode-provenance.ts` sets `geocode_source` from `geocode_precision` for existing listings, supports `--dry-run`
- **Document backfill** — `scripts/backfill-documents.ts` scans `raw_listings` payloads for document URLs, upserts into `listing_documents`, supports `--dry-run` and `--limit`

## Summary

| Phase | Status | Accepted Deferrals |
|-------|--------|--------------------|
| 0 — Truth Sync | DONE | — |
| 1 — Search/Filter/Alert | DONE | `search_vector` GIN index unused (low priority) |
| 2 — Source Resilience | DONE | Auto-degradation on consecutive canary failures (deferred) |
| 3 — Provenance | DONE | — |
| 4 — Vienna Context | DONE | Priority 2 overlays (noise/climate/flood/zoning) deferred to later phase |
| 5 — Analysis Page | DONE | — |
| 6 — Building Facts | DONE | — |
| 7 — Legal-Rent | DONE | — |
| 8 — Documents | DONE | OCR fallback + floorplan classification deferred |

## Migrations created
- `013-alert-match-reasons.sql` — alert match_reasons_json + cluster_fingerprint
- `014-geocode-provenance.sql` — geocode_source/updated_at + baseline provenance on scores
- `015-building-facts.sql` — building_facts table + listing FK
- `016-legal-rent.sql` — legal_rent_assessments table
- `017-documents.sql` — listing_documents + document_extractions + document_fact_spans

## New packages created
- `@rei/analysis` — market-rent estimation, investor metrics, risk/upside flags, confidence model
- `@rei/legal-rent` — conservative MRG rules engine
- `@rei/documents` — PDF text extraction, German real estate fact parsing

## Tests added
- `tests/unit/keyword-equivalence.test.ts` — 43 tests proving JS/SQL keyword parity
- `packages/legal-rent/src/__tests__/rules-engine.test.ts` — 31 table-driven tests
- `packages/analysis/src/__tests__/*.test.ts` — market-rent, investor-metrics, risk-flags, confidence
- `packages/documents/src/__tests__/*.test.ts` — fact-parser, pdf-extractor
