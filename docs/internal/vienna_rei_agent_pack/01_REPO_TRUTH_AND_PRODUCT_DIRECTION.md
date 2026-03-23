# Repo Truth and Product Direction

## Purpose

This document gives the implementation agent a code-first understanding of the current product and the strategic direction for the next phase.

The agent must verify the repo again before changing anything. If code and this document conflict, trust code and update the implementation plan accordingly.

---

# 1. Product reality

The repository is already a real system, not a stub.

It contains a working pipeline for:

- multi-source scraping,
- raw artifact persistence,
- normalization into a canonical listing model,
- geocoding and Vienna district logic,
- scoring and market baselines,
- filter matching and alerting,
- Fastify API surfaces,
- a real macOS client,
- operational backfill/replay/reparse tooling.

This means the next phase should **not** invent a separate intelligence stack.
It should deepen the existing ingestion → normalization → enrichment → scoring → filtering → alerting → API → macOS flow.

---

# 2. Current-state truth by area

## 2.1 Scraping and ingestion

### Real

The repo contains a queue/worker scraping system with source adapters for major Austrian/Vienna-relevant portals.
Expected touchpoints include:

- `apps/worker-scraper/src/discovery-worker.ts`
- `apps/worker-scraper/src/detail-worker.ts`
- `packages/scraper-core/src/adapter-registry.ts`
- `packages/source-willhaben/*`
- `packages/source-immoscout24/*`
- `packages/source-wohnnet/*`
- `packages/source-derstandard/*`
- `packages/source-findmyhome/*`
- `packages/source-remax/*`
- `packages/source-openimmo/*`

### Direction

Do not replace the source pipeline.
Instead:

- harden selectors,
- improve fixture coverage,
- add canaries,
- add source-health reporting,
- improve artifact capture around parse failures.

### Main weakness

Source resilience and maintenance discipline are not yet strong enough for investor-grade trust.

---

## 2.2 Raw persistence and provenance

### Real

The schema already supports raw ingest and scrape-run traceability.
Expected touchpoints include:

- `schema.sql`
- `scrape_runs`
- `raw_listings`

The detail scraping path already stores raw source evidence such as HTML and object-storage keys for artifacts.

### Direction

Re-use this existing evidence backbone for:

- document ingestion,
- extraction provenance,
- reparse/recovery,
- auditability of normalized facts.

### Main weakness

The raw evidence backbone exists, but the product does not yet surface enough of that provenance to the user.

---

## 2.3 Canonical listing model

### Real

The repo already has a serious canonical model with current-state and historical/versioned listing storage.
Expected touchpoints include:

- `schema.sql`
- `listings`
- `listing_versions`
- completeness/current score fields
- status/history fields
- cross-source fingerprint logic in ingestion

### Direction

Keep `listings` as the main current-state object.
Keep `listing_versions` as history.
Add enrichment and evidence fields rather than inventing parallel “analysis listing” entities.

### Main weakness

The listing model is still thin on several investor-important facts:

- heating type,
- operating costs,
- energy fields,
- build year,
- condition/renovation detail,
- outdoor space detail,
- tenancy/legal notes,
- stronger building identity.

---

## 2.4 Geocoding and Vienna location logic

### Real

Geocoding is more advanced than it may look from the UI.
The repo contains Vienna-aware location logic, including district/postal/station heuristics and district validation.
Expected touchpoints include:

- `packages/geocoding/src/geocoder.ts`
- pipeline wiring in ingestion/processing
- district enrichment fields on listing records

### Direction

Do not rebuild geocoding from scratch.
Instead:

- expose geocode provenance,
- expose confidence and coordinate precision,
- improve building/address resolution,
- make downstream analysis aware of geocode confidence.

### Main weakness

The system likely knows whether a location is exact vs inferred vs coarse, but the product does not explain this clearly enough.

---

## 2.5 Search, filtering, and alerts

### Real

The repo already includes:

- structured listing queries,
- saved filters,
- filter testing,
- alert generation,
- alert dedupe,
- search vector support.

Expected touchpoints include:

- `packages/filtering/src/compiler/build-search-query.ts`
- `packages/db/src/queries/listings.ts`
- `packages/db/src/queries/user-filters.ts`
- `apps/api/src/routes/filters.ts`
- `alerts`
- `user_filters`
- `listings.search_vector`

### Direction

The highest-value immediate improvement is to make these semantics identical across:

- listing search,
- filter test,
- live alert matching,
- any future analysis/comparable matching paths.

### Main weakness

There appears to be a risk that search/filter semantics are not fully unified.
That is a trust problem.
A user must never experience:

- “this matched in filter test but not in live alerts”, or
- “this appears in listings search but would not match my saved filter”.

---

## 2.6 Scoring and market baselines

### Real

The repo already has working scoring and baseline logic.
Expected touchpoints include:

- scoring package(s)
- `market_baselines`
- `scripts/compute-baselines.ts`
- score explanation routes/UI

### Direction

Keep the current score system, but make it more honest and more explainable.
Specifically:

- expose sample size,
- expose fallback level,
- expose freshness/window,
- label baselines as listing-ask market context rather than transaction truth.

### Main weakness

Baselines are useful, but they can look more precise than they really are if built from asking-price inventory with thin samples.

---

## 2.7 API

### Real

The Fastify API is already substantive.
Expected route areas include:

- listings
- filters
- alerts
- watchlist
- analytics
- POIs
- developments
- health
- metrics
- feedback
- dead-letter/admin-like routes

### Direction

Extend the existing API.
Do not create a separate analysis service for this phase.
New surfaces should be added as first-class routes under the current API app.

### Main weakness

The API lacks several high-value investor endpoints:

- listing analysis,
- comparables,
- document list/detail,
- legal-rent assessment,
- richer provenance fields.

---

## 2.8 macOS client

### Real

The macOS app is already a meaningful product surface.
Expected areas include:

- dashboard
- listings
- listing detail
- alerts
- analytics
- watchlist
- settings

It also appears to ship Vienna-specific local resources for map/context surfaces.

### Direction

Keep the current app and extend it.
The next phase should add:

- `Analysis` tab/section in listing detail,
- `Documents` tab/section,
- explicit location/provenance badges,
- legal-rent card,
- better context panels.

### Main weakness

The app currently undersurfaces evidence and overstates some context surfaces.
Anything labeled like “Safety” should be replaced unless a verified official micro-granular data source exists.

---

## 2.9 Operational tooling

### Real

The repo already has strong operator tooling.
Expected scripts include capabilities like:

- replay,
- reparse,
- rescore,
- geocode-missing,
- build-clusters,
- canary-crawl,
- backfill-source,
- data-quality reporting,
- compute baselines.

### Direction

Promote these from operator convenience tools into a more explicit quality-control system.

### Main weakness

The tools are strong, but some quality gates appear to remain manual rather than scheduled/thresholded.

---

## 2.10 Documents and attachments

### Real

The raw scraping path appears capable of storing source artifacts.

### Missing / weak

A first-class document subsystem does not appear to exist yet.
That likely means no fully implemented:

- `listing_documents` table,
- document metadata model,
- PDF fetch/extract pipeline,
- searchable extracted text,
- thumbnails/previews,
- built-in viewer,
- fact-level extraction provenance,
- floorplan extraction strategy.

### Direction

This is one of the most valuable next systems to build, because it upgrades listing intelligence from portal text to evidence-backed facts.

---

# 3. Repo drift and truth warnings

## 3.1 Root schema drift

The root `schema.sql` should not be assumed to be the sole truth source.
The agent must inspect migrations and the live code expectations.
If later migrations add columns/entities not reflected in root schema, treat the migrations + code as the more current truth.

## 3.2 Stale docs

Any repo docs such as `BUILD_INIT_REPORT.md` may lag behind the codebase.
Use them only as context, not as truth.

## 3.3 Copilot/assistant surfaces

If Copilot or assistant UI/API references exist but the backing implementation/package is missing or incomplete, classify that feature as scaffold/broken rather than delivered.
Do not prioritize polishing it in this phase.

---

# 4. Product direction for the next phase

## 4.1 Core repositioning

Treat the current product as:

**a Vienna asking-market intelligence engine with strong ingestion and triage foundations**

The next goal is to turn it into:

**a Vienna investor analysis system with document-backed facts, transparent rent-market estimation, and auditable legal-rent assessment**

## 4.2 What to improve before net-new expansion

Prioritize these before adding flashy features:

1. search/filter/alert truthfulness
2. parser resilience and source health
3. geocode/baseline provenance
4. POI/context parity and wording cleanup

## 4.3 Best next systems to add

After the trust-hardening phase, the best next systems are:

1. Listing Analysis page
2. Building facts enrichment
3. Legal-rent/rent-regulation assessment
4. Document ingestion and viewer

## 4.4 Vienna-only product stance

Do not generalize for:

- all of Austria,
- Germany,
- multi-country abstractions,
- generic real estate SaaS positioning.

The product advantage should come from:

- Vienna district logic,
- Vienna open data,
- Vienna mobility/context,
- Vienna legal-rent/regulatory reality,
- Vienna building facts,
- Vienna investor workflows.

---

# 5. Compliance and product-safety guardrails

The implementation agent must not add:

- ethnicity/nationality/religion/name-origin inference,
- “immigrant concentration” logic,
- demographic or protected-trait neighborhood profiling,
- proxy ranking/filtering/scoring of that type,
- a fake safety score built on weak or coarse crime signals.

Allowed context categories include neutral, lawful, explainable measures such as:

- transit access,
- park access,
- school proximity,
- noise exposure,
- air quality,
- flood/climate risk,
- zoning/development context,
- building age/typology,
- nearby amenities.

---

# 6. What success looks like after this phase

At the end of the next implementation phase, a user should be able to click one Vienna listing and see:

- a cleaned, normalized property summary,
- explicit geocode confidence,
- neighborhood/context overlays,
- comparable sale/rent context,
- market-rent estimate with sample size and fallback disclosure,
- legal-rent/regulation assessment kept separate,
- key risk flags and missing-data warnings,
- linked documents such as exposés and floorplans,
- extracted document facts with provenance,
- a simple investor view like gross yield and price-to-rent,
- a trustworthy explanation of what is known, inferred, weak, or unknown.

That is the correct direction for the repo.
