# Build Plan

## Goal

Execute the next product phase for the Vienna ImmoRadar by strengthening trust in the existing system and then adding the highest-value investor features:

1. unified search/filter/alert truth,
2. source/parser resilience,
3. geocode and baseline provenance,
4. Vienna context parity,
5. Listing Analysis page,
6. building facts enrichment,
7. legal-rent assessment,
8. document ingestion and viewer.

This plan assumes the agent will inspect the live repo first and update details if drift exists.

---

# Phase 0 — Re-verify repo truth before changes

## Objective

Make sure implementation is grounded in the actual current code.

## Tasks

- inspect workspace/package structure from root `package.json`
- inspect root `schema.sql`
- inspect migrations and compare against root schema
- inspect route registration under `apps/api`
- inspect worker registration under `apps/worker-scraper` and `apps/worker-processing`
- inspect source adapters under `packages/source-*`
- inspect filtering, scoring, geocoding, and DB query packages
- inspect macOS listing-detail, analytics, alerts, map/context surfaces
- inspect `.github/workflows/*`
- inspect `scripts/*`
- inspect `tests/*`
- inspect any stale docs and mark conflicts

## Deliverable

A short truth-sync note inside the implementation PR or docs describing:

- anything that changed from this plan,
- which files are the real truth,
- what was stale.

## Acceptance criteria

- no code changes yet,
- repo truth validated,
- implementation scope adjusted only where evidence requires it.

---

# Phase 1 — Unify search, filter-test, and live alert semantics

## Why first

This is the highest-ROI trust fix.
A saved filter must behave the same everywhere.

## Goals

- one keyword/query truth path,
- one structured filter truth path,
- one explanation format for matches,
- cluster-aware alert dedupe.

## Repo touchpoints

Expected touchpoints:

- `packages/filtering/src/compiler/build-search-query.ts`
- `packages/db/src/queries/listings.ts`
- `packages/db/src/queries/user-filters.ts`
- `apps/api/src/routes/filters.ts`
- alert matching code in processing/API packages
- `schema.sql` for `alerts`, `user_filters`, `listings.search_vector`

## Tasks

### 1. Search semantics audit

- identify how free-text keyword search is compiled for listing search
- identify how saved filters compile keywords
- identify how live alert matching evaluates keywords
- identify any differences in tokenization, case-folding, stemming, AND/OR behavior, exclusion terms, phrase behavior, or keyword-source fields

### 2. Pick a canonical semantics contract

The contract should define:

- which listing fields contribute to keyword match,
- phrase behavior,
- include/exclude keyword behavior,
- whether multiple keywords are AND or OR,
- exact normalization rules.

### 3. Implement shared compiler/query path

- refactor all surfaces to use the same underlying builder or compiled query structure
- avoid duplicated keyword logic in separate layers

### 4. Add match explanations

Return structured reasons such as:

- matched keyword `altbau`
- matched district `1020`
- matched max price threshold
- excluded by keyword `befristet`

### 5. Improve alert dedupe

- dedupe by cluster/fingerprint when possible,
- preserve source-specific evidence without spamming multiple alerts for same underlying property.

## Schema changes

Potential additions:

- `alerts.match_reasons_json`
- `alerts.match_cluster_id`
- optional helper columns/indexes if needed for search performance

## API changes

- enrich filter-test response with explicit match reasons
- enrich alerts response with match explanation and cluster/dedupe metadata

## Tests

Add equivalence tests proving the same listing/filter pair behaves identically in:

- listing search
- filter-test endpoint
- live alert matching

## Acceptance criteria

- one semantics contract documented in code,
- filter test and live matching agree,
- alert noise reduced on cross-source duplicates,
- regression tests cover keyword behavior.

---

# Phase 2 — Source resilience and data-quality hardening

## Why now

No downstream intelligence layer matters if the source data silently rots.

## Goals

- fixture-based source parser regression coverage,
- scheduled canary crawling,
- source-health metrics,
- graceful degradation when a source breaks.

## Repo touchpoints

- `packages/source-*`
- `apps/worker-scraper/src/discovery-worker.ts`
- `apps/worker-scraper/src/detail-worker.ts`
- `scripts/canary-crawl.ts`
- `.github/workflows/*`
- `tests/integration/*`
- health/metrics routes in API

## Tasks

### 1. Source fixture corpus

For each live source:

- capture representative discovery pages,
- capture representative detail pages,
- include edge cases like missing fields, premium labels, alt layouts, attachments, inactive listings.

### 2. Parser contract tests

For each source parser, assert extraction of:

- source listing id,
- URL,
- title,
- price,
- area,
- rooms if present,
- operation type,
- address/location clues,
- attachment URLs if present.

### 3. Source health metrics

Track at least:

- recent discovery success rate,
- recent detail parse success rate,
- median extracted field completeness,
- rate of required-field failure,
- anti-bot errors,
- zero-results anomalies.

### 4. Graceful source degradation

If a source drops below a threshold:

- mark it degraded,
- suppress confidence in downstream source freshness,
- optionally auto-pause it,
- surface this in admin/operator reporting.

## Schema changes

Optional:

- `source_health_snapshots`

If you can keep this entirely in metrics + logs + quality reports, that is also acceptable.

## Tests

- parser fixtures for all major sources,
- canary test flow,
- degraded-source handling tests if implemented.

## Acceptance criteria

- every active source has fixture coverage,
- source breakages become visible quickly,
- degraded-source behavior is explicit rather than silent.

---

# Phase 3 — Geocode and baseline provenance

## Why now

The system already computes useful location and baseline intelligence, but the product needs to communicate its uncertainty.

## Goals

- expose geocode precision and provenance,
- expose baseline sample/fallback/freshness metadata,
- incorporate confidence into user-facing analysis.

## Repo touchpoints

- `packages/geocoding/src/geocoder.ts`
- ingestion/processing pipeline
- scoring package(s)
- `scripts/compute-baselines.ts`
- listing detail and score explanation API responses
- macOS listing detail/score UI

## Tasks

### 1. Geocode provenance model

Persist or standardize fields such as:

- `geocode_source`
- `geocode_confidence`
- `coordinate_precision`
- `district_confidence`
- `address_resolution_level`

### 2. Baseline provenance model

Expose metadata such as:

- baseline window,
- sample size,
- spatial level used,
- fallback chain used,
- freshness timestamp,
- whether baseline is ask-market-derived.

### 3. UI communication

Add visible badges or labels such as:

- exact source coordinates,
- inferred from address,
- district-level fallback,
- thin sample,
- coarse market context.

### 4. Score explanation integration

If score uses thin or fallback baselines, explain it.
Confidence should affect interpretation.

## Schema changes

Add or standardize columns in `listings` and baseline tables.

## API changes

- include provenance fields in listing detail
- include baseline metadata in score explanation or analysis response

## Tests

- geocode confidence mapping unit tests
- baseline explanation serialization tests
- API contract tests

## Acceptance criteria

- users can tell exact vs inferred vs coarse location,
- users can tell strong vs thin market baseline context,
- score explanation no longer implies false precision.

---

# Phase 4 — Vienna context parity and wording cleanup

## Why now

Context is valuable, but it should be server-backed, fresh, neutral, and clearly sourced.

## Goals

- make API the source of truth for Vienna context,
- reduce reliance on stale bundled client-only data,
- remove any misleading “Safety” framing,
- prepare overlays for Listing Analysis.

## Repo touchpoints

- POI/development fetch scripts under `scripts/*`
- POI/development API routes
- macOS local resource bundles and map/context panels
- DB tables for POIs/developments if present

## Tasks

### 1. Context inventory

Verify what is currently:

- fetched from server,
- bundled locally in macOS,
- cached,
- stale-prone.

### 2. Server-backed parity

Move as much as reasonable to API-backed context queries.
Preserve local fallbacks only where needed for offline/basic rendering.

### 3. Neutral wording cleanup

Replace any category names or labels that imply unsupported precision.
Examples:

- replace “Safety” with neutral service/context wording unless a verified dataset supports something more specific.

### 4. Freshness metadata

Expose:

- source name,
- source update timestamp,
- import timestamp,
- confidence / recency note where useful.

## Acceptance criteria

- context surfaces are neutral and defensible,
- data freshness is understandable,
- API and client are consistent.

---

# Phase 5 — Listing Analysis page v1

## Why now

This is the missing synthesis layer over the system’s existing capabilities.

## Goals

For a single listing, provide:

- cleaned listing summary,
- normalized facts,
- location/context summary,
- comparables,
- market-rent estimate,
- sale-value context,
- risk/upside flags,
- investor metrics,
- assumptions and missing-data warnings,
- legal-rent panel kept separate.

## Repo touchpoints

- listings API routes or new analysis route
- DB query packages
- scoring/baseline queries
- cluster queries
- POI/development queries
- macOS listing detail flow

## API design

Preferred initial endpoint:

- `GET /v1/listings/:id/analysis`

Optional later:

- `GET /v1/listings/:id/comparables`
- `GET /v1/listings/:id/legal-rent`

## Tasks

### 1. Analysis payload design

The payload should contain:

- `summary`
- `facts`
- `location_context`
- `market_sale_context`
- `market_rent_context`
- `investor_metrics`
- `risk_flags`
- `upside_flags`
- `assumptions`
- `missing_data`
- `confidence`
- `legal_rent_summary`

### 2. Market-rent estimation

Implement a tiered comp method using the internal rent listing corpus.
Use:

- nearby high-similarity rent listings first,
- district fallback second,
- broad fallback only when necessary.

Do not hide the fallback level.

### 3. Comparable explanation

For every comparable shown, expose:

- why it matched,
- distance,
- recency,
- size/room similarity,
- dedupe/cluster state.

### 4. Investor metrics

At minimum:

- gross yield,
- price-to-rent,
- sensitivity low/base/high.

No fake net yield without actual cost/occupancy assumptions.

## macOS UI

Add:

- `Analysis` tab or section inside listing detail
- cards for summary, rent market, sale context, risk, upside, assumptions, legal-rent summary

## Tests

- API contract tests for analysis endpoint
- comp selection unit tests
- rent-estimation fallback tests

## Acceptance criteria

- user can open a listing and get a coherent investor analysis,
- assumptions and uncertainty are explicit,
- market-rent and legal-rent remain separate.

---

# Phase 6 — Building facts enrichment

## Why now

Building facts are a high-leverage Vienna-specific enhancement and a prerequisite for strong legal-rent assessment.

## Goals

Enrich listings/buildings with official or high-quality building context such as:

- building age/period,
- building type/typology,
- building-level identifiers where possible,
- stronger district/building joins.

## Repo touchpoints

- new enrichment worker/module
- geocoding/building resolution logic
- DB schema
- listing detail / analysis UI

## Tasks

### 1. Add building-level store

Recommended entity:

- `building_facts`

It should support:

- external source identifiers,
- normalized building attributes,
- provenance,
- freshness,
- confidence.

### 2. Address/building join logic

Given a listing:

- resolve geocode,
- match to building object where possible,
- store match confidence,
- keep unresolved cases explicit.

### 3. Integrate into listing analysis

Show building facts only when confidence is acceptable.
Otherwise show unresolved/unknown.

## Tests

- building join tests
- building fact serialization tests

## Acceptance criteria

- building facts are visible in analysis/detail,
- uncertainty is explicit,
- foundation is ready for legal-rent rules.

---

# Phase 7 — Legal-rent / rent-regulation assessment v1

## Why now

This is a major Vienna-specific differentiator, but it must be auditable and careful.

## Goals

Build a rules engine that outputs:

- likely capped,
- likely uncapped,
- likely capped but missing critical proof,
- unclear,
- needs human/legal review.

## Repo touchpoints

- new rules package/module
- DB schema for assessments
- analysis or dedicated legal-rent API route
- macOS legal-rent card in listing detail/analysis

## Tasks

### 1. Assessment data model

Recommended tables/entities:

- `legal_rent_assessments`
- optional `listing_assumption_overrides`

Fields should include:

- regime candidate,
- status,
- confidence,
- strong signals,
- weak signals,
- missing facts,
- review required,
- indicative legal-rent band when warranted,
- disclaimer text.

### 2. Rules implementation

Use a conservative decision tree.
Only compute a legal-rent band when key facts are sufficiently proven.

### 3. Product framing

This is not legal advice.
It is an explainable preliminary assessment.

## Tests

- table-driven rule tests
- edge cases with missing facts
- output state tests

## Acceptance criteria

- no opaque legal-rent score,
- strong/weak/unknown signals are separated,
- product clearly communicates review-required cases.

---

# Phase 8 — Document ingestion and viewer v1

## Why now

This creates evidence-backed intelligence and improves factual completeness.

## Goals

- detect listing attachments,
- store documents and metadata,
- extract text,
- optionally OCR only when necessary,
- surface documents and extracted facts in product.

## Repo touchpoints

- source detail parsers under `packages/source-*`
- `apps/worker-scraper/src/detail-worker.ts`
- new document processing worker/module
- DB schema
- API document routes
- macOS listing detail Documents tab

## Tasks

### 1. Attachment detection

Extend detail parsing to capture:

- attachment/document URLs,
- labels/titles,
- guessed type,
- provenance from source page.

### 2. Document storage

Recommended tables:

- `listing_documents`
- `document_extractions`
- `document_fact_spans`

Store:

- checksum,
- MIME type,
- size,
- storage key,
- status,
- page count,
- first/last seen.

### 3. Extraction pipeline

Order of operations:

1. native PDF text extraction first,
2. OCR only when necessary,
3. targeted floorplan extraction only when classified as floorplan.

### 4. Fact extraction

Extract where possible:

- rent and fees,
- area,
- rooms,
- floor,
- balcony/terrace/garden,
- operating costs,
- heating type,
- energy certificate data,
- building year,
- condition notes,
- tenancy/legal notes.

### 5. Product integration

- Documents tab
- preview/thumbnail
- extracted fact badges
- link from fact back to document page/span

## Tests

- PDF extractor tests
- OCR fallback tests
- document parser tests
- API/viewer contract tests

## Acceptance criteria

- documents are persisted and visible,
- extracted facts carry provenance,
- OCR is used only when truly needed.

---

# Phase 9 — CI, observability, and rollout discipline

## Goals

- CI covers backend + macOS where feasible,
- data-quality checks are visible,
- rollout is incremental,
- backfill paths exist for new derived data.

## Tasks

- extend CI for backend packages and macOS build/test if practical
- add health/metrics exposure for source quality and new workers
- add backfills for:
  - geocode provenance fields,
  - building facts,
  - legal-rent assessments,
  - document detection from historical raw HTML,
  - analysis snapshot or derived caches if introduced.

## Rollout strategy

Ship behind feature flags where useful:

- analysis tab flag,
- legal-rent panel flag,
- documents tab flag,
- overlay-specific flags.

Do not hide truth-hardening improvements behind flags unless necessary.

---

# Horizon summary

## NOW

- search/filter/alert unification
- source resilience
- provenance hardening
- Vienna context parity
- CI/test improvements

## NEXT

- Listing Analysis page v1
- building facts enrichment
- legal-rent assessment v1
- documents viewer/extraction v1

## LATER

- additional overlays such as noise/flood/heat/zoning filters
- premium/manual verification workflows
- copilot/assistant polish after evidence layer is mature
