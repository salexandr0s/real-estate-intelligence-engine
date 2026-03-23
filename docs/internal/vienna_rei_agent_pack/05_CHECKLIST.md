# Implementation Checklist

This checklist is meant for execution tracking by the coding agent.

_Last updated: 2026-03-23_

---

# Phase 0 — Repo truth sync

- [x] Inspect root `package.json`
- [x] Inspect root `schema.sql`
- [x] Inspect all migrations and compare against root schema
- [x] Inspect `apps/api/*`
- [x] Inspect `apps/worker-scraper/*`
- [x] Inspect `apps/worker-processing/*`
- [x] Inspect `apps/macos/*`
- [x] Inspect `packages/*`
- [x] Inspect `scripts/*`
- [x] Inspect `tests/*`
- [x] Inspect `.github/workflows/*`
- [x] Identify stale docs or stale schema assumptions
- [x] Produce a short truth-sync note before implementation

---

# Phase 1 — Search / filter / alert truth

## Audit

- [x] Trace listing search keyword logic
- [x] Trace saved-filter keyword logic
- [x] Trace filter-test logic
- [x] Trace live alert matching logic
- [x] Identify any semantic drift

## Implementation

- [x] Define one canonical keyword semantics contract
- [x] Refactor all paths to use the same underlying compiler/query contract
- [x] Add match-reason payload structure
- [x] Make alert dedupe cluster-aware where possible

## Tests

- [x] Add equivalence tests for search vs filter-test vs live matching
- [x] Add alert dedupe regression tests

## Acceptance

- [x] Same filter behaves the same everywhere
- [x] Alerts explain why they matched
- [x] Duplicate cross-source alerts reduced

---

# Phase 2 — Source resilience and parser quality

## Fixtures and contracts

- [x] Create fixture set for Willhaben
- [x] Create fixture set for Immoscout24
- [x] Create fixture set for Wohnnet
- [x] Create fixture set for DerStandard
- [x] Create fixture set for FindMyHome
- [x] Create fixture set for Remax
- [x] Assess OpenImmo quality and decide improve/defer
- [x] Add parser contract tests for each active source

## Health monitoring

- [x] Add source health metrics
- [x] Add required-field failure metrics
- [x] Add zero-results anomaly detection
- [x] Add canary crawl schedule or script wiring
- [ ] Add degraded-source handling plan — _deferred: auto-degradation on consecutive failures_

## Acceptance

- [x] Every active source has fixture coverage
- [x] Breakages become visible quickly
- [x] Degraded sources do not fail silently

---

# Phase 3 — Geocode and baseline provenance

## Geocode

- [x] Audit existing geocode source/confidence fields
- [x] Add missing columns if needed
- [x] Standardize geocode provenance model
- [x] Backfill provenance for historical listings where possible

## Baselines

- [x] Audit baseline sample/fallback/freshness data
- [x] Add metadata fields if needed
- [x] Update compute-baselines flow to persist metadata
- [x] Update score explanation to expose metadata

## UI/API

- [x] Expose geocode precision in listing detail API
- [x] Expose baseline metadata in score/analysis API
- [x] Add UI badges/labels in macOS app

## Tests

- [x] Geocode provenance unit tests
- [x] Baseline metadata serialization tests
- [x] API contract tests

## Acceptance

- [x] Users can tell exact vs inferred vs coarse location
- [x] Users can tell strong vs thin baseline support

---

# Phase 4 — Vienna context parity and wording cleanup

## Inventory

- [x] Audit which context data is client-bundled vs API-backed
- [x] Audit freshness path for POIs/developments
- [x] Audit any unsupported "Safety" language

## Implementation

- [x] Make API the source of truth where practical
- [x] Add freshness/source metadata for context layers
- [x] Replace unsupported wording with neutral labels
- [x] Normalize category naming across client and API

## Acceptance

- [x] Context surfaces are defensible and neutral
- [x] Freshness is visible
- [x] Client and API agree on context data

---

# Phase 5 — Listing Analysis page

## API/data

- [x] Design `GET /v1/listings/:id/analysis`
- [x] Implement summary/facts/location context sections
- [x] Implement sale-context section
- [x] Implement market-rent section
- [x] Implement investor metrics
- [x] Implement assumptions/missing-data section
- [x] Add legal-rent summary slot

## Comparable/rent logic

- [x] Build sale comparable selection logic
- [x] Build rent comparable selection logic
- [x] Implement fallback levels
- [x] Expose sample size and confidence

## UI

- [x] Add `Analysis` tab or section in listing detail
- [x] Design cards for summary, rent, risks, upside, assumptions, legal-rent summary

## Tests

- [x] Analysis endpoint contract tests
- [x] Comparable selection tests
- [x] Rent estimate fallback tests

## Acceptance

- [x] Listing analysis is coherent and explainable
- [x] Market-rent and legal-rent remain separate

---

# Phase 6 — Building facts enrichment

## Data model

- [x] Add `building_facts` or equivalent entity
- [x] Add source/freshness/confidence fields

## Enrichment

- [x] Implement building-resolution logic from listing geocode/address
- [x] Persist match confidence
- [x] Surface building facts in analysis/detail

## Tests

- [x] Building-match tests
- [x] Building-facts API serialization tests

## Acceptance

- [x] Building facts are visible when credible
- [x] Unknown/unresolved remains explicit when not

---

# Phase 7 — Legal-rent assessment

## Rules engine

- [x] Define output states
- [x] Define strong-signal schema
- [x] Define weak-signal schema
- [x] Define missing-facts schema
- [x] Implement conservative decision tree
- [x] Add indicative legal-rent band only when sufficiently supported

## Data model/API

- [x] Add `legal_rent_assessments` or equivalent
- [x] Add API exposure via analysis or dedicated endpoint
- [x] Add disclaimers/review-required states

## UI

- [x] Add legal-rent card/section
- [x] Separate strong, weak, and unknown signals visually

## Tests

- [x] Table-driven legal-rules tests
- [x] Missing-facts edge-case tests
- [x] Output-state tests

## Acceptance

- [x] No false legal certainty
- [x] Output is auditable and understandable

---

# Phase 8 — Document ingestion and viewer

## Detection and storage

- [x] Extend source parsers to emit attachment URLs and labels
- [x] Add `listing_documents`
- [x] Add checksum-based dedupe
- [x] Add status/fetch metadata

## Extraction

- [x] Implement native PDF text extraction
- [ ] Add OCR fallback only when needed — _deferred: not needed until text-layer PDFs prove insufficient_
- [ ] Add floorplan classification path — _deferred to later phase_
- [x] Add structured fact extraction
- [x] Add fact provenance model

## Product

- [x] Add document list API
- [x] Add document detail/viewer API
- [x] Add `Documents` tab in listing detail
- [x] Show extracted facts with page/source linkage

## Tests

- [x] PDF extraction tests
- [ ] OCR fallback tests — _N/A: OCR deferred_
- [x] Fact extraction tests
- [x] Document API contract tests

## Acceptance

- [x] Documents are first-class product objects
- [x] Extracted facts carry provenance
- [x] OCR is used selectively, not by default

---

# Phase 9 — CI, backfills, and observability

## CI

- [x] Ensure backend package tests run in CI
- [ ] Add macOS build/test coverage if practical — _deferred_
- [x] Add parser fixture tests to CI

## Backfills

- [x] Backfill geocode provenance
- [x] Backfill building facts where possible
- [ ] Backfill legal-rent assessments after building enrichment — _deferred: requires building facts import to run first_
- [x] Backfill documents from historical raw HTML/detail artifacts

## Observability

- [x] Add health/metrics for new workers
- [ ] Add data-quality thresholds for new tables/features — _deferred_
- [ ] Add operator reporting for stale or failed enrichments — _deferred_

## Acceptance

- [x] New features are observable
- [x] Historical data can be upgraded without manual disaster work

---

# Final pre-merge review

- [x] Confirm Vienna-only scope remained intact
- [x] Confirm no protected-trait/proxy features were added
- [x] Confirm no unsupported safety score was introduced
- [x] Confirm market-rent and legal-rent remain separate
- [x] Confirm no heavy new infra was introduced without strong justification
- [x] Confirm new features use the existing architecture rather than a parallel system
- [x] Confirm docs/tests/migrations are consistent
