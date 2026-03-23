# Feature Specs

This document gives implementation-grade feature specifications for the highest-value additions to the current Vienna-only product.

---

# 1. Listing Analysis Page

## Objective

When a user opens a single listing, the product should provide a trustworthy investor-grade analysis surface rather than just raw listing details.

## Product principles

- must be built on top of existing listing detail and API architecture,
- must show what is known vs inferred vs unknown,
- must separate market-rent and legal-rent,
- must not fabricate precision,
- must be understandable at a glance.

## Recommended UX placement

Inside the existing listing detail flow, add a new tab/section:

- `Overview`
- `Analysis`
- `Documents`
- `History` or equivalent existing section

## Required sections

### 1. Cleaned listing summary

Fields:

- canonical title
- current asking price
- current price per sqm
- operation type
- property type
- source and last seen
- source confidence / raw source link

### 2. Normalized property facts

Fields:

- living/usable area
- rooms
- floor
- building age if known
- condition
- heating type
- operating costs
- outdoor space flags
- energy performance fields
- parking/elevator if available

Every fact should have a confidence/provenance tier.

### 3. Location context summary

Fields:

- district and district confidence
- geocode precision / provenance
- nearest transit access
- nearby parks/green space
- nearby schools/kindergartens
- climate/noise/flood flags when available

### 4. Market sale context

Show:

- nearby or similar current sale listings,
- district price context,
- current ask-price context,
- sample/fallback disclosure.

### 5. Market-rent estimate

Show:

- estimated monthly market-rent range,
- central estimate,
- confidence,
- sample size,
- fallback level,
- whether estimate is based on direct comps or district fallback.

### 6. Investor metrics

Show:

- gross yield,
- annualized price-to-rent,
- sensitivity low/base/high,
- optional estimated rent multiple.

### 7. Risk flags

Examples:

- likely regulated / capped risk
- thin comp set
- low-confidence geocode
- high noise exposure
- flood/heat exposure
- missing fees
- missing building age
- attachment suggests conflicting facts

### 8. Upside flags

Examples:

- below current district ask context
- strong transit access
- balcony/terrace/garden
- good building condition
- strong rent-demand indicators from comp density

### 9. Assumptions and missing-data warnings

Must clearly state:

- what was inferred,
- what is missing,
- what is only weakly supported,
- what was derived from documents,
- what requires legal review.

### 10. Legal-rent summary panel

A compact summary with link to full legal-rent section.
Must not be merged into market-rent.

## API contract suggestion

```json
{
  "listing_id": "...",
  "summary": {},
  "facts": [],
  "location_context": {},
  "market_sale_context": {},
  "market_rent_context": {},
  "investor_metrics": {},
  "risk_flags": [],
  "upside_flags": [],
  "assumptions": [],
  "missing_data": [],
  "confidence": {},
  "legal_rent_summary": {}
}
```

## Matching/comparables rules

### Sale comparables

Prefer:

- same property type,
- same district or nearby radius,
- similar area bucket,
- similar room count,
- recent/current listings,
- deduped by cluster/fingerprint.

### Rent comparables

Use a tier system:

- Tier 1: nearby, high-similarity, recent, good geocode
- Tier 2: district-level, similar size/rooms
- Tier 3: district baseline fallback

## Confidence model

The analysis confidence should degrade when:

- geocode is coarse,
- sample size is thin,
- key facts are missing,
- building match is unresolved,
- all rent logic uses broad fallback.

## Acceptance criteria

- one-click analysis view exists,
- output is explainable and non-opaque,
- market-rent and legal-rent are clearly separated,
- provenance and uncertainty are visible.

---

# 2. Market-Rent Estimation Spec

## Objective

Estimate an achievable market rent range from the existing internal corpus and contextual baselines.

## Product rule

This is **market-rent estimation**, not legal-rent estimation.
It should answer: “what would the market likely ask/support?”
It should not answer: “what is legally permitted?”

## Data sources

Primary:

- internal rent listing corpus from existing ingestion pipeline

Secondary:

- district-level official statistical context if useful as a coarse anchor

## Method

### Comp pool

Use only Vienna rent listings.
Exclude:

- stale or inactive data where possible,
- likely duplicate listings,
- low-confidence locations if better options exist.

### Similarity features

- operation type = rent
- property type
- area
- rooms
- district or nearby geography
- listing recency
- optionally building age/condition if those facts exist with confidence

### Estimation outputs

- `estimate_low`
- `estimate_mid`
- `estimate_high`
- `eur_per_sqm_mid`
- `sample_size`
- `fallback_level`
- `confidence`

### Estimation approach

- compute trimmed median €/sqm on comp set
- derive band from spread / percentiles
- multiply by target area
- optionally adjust modestly for features like balcony, top floor, condition if robust enough

### Fallback levels

- direct nearby comps
- same district comps
- district baseline
- city-wide coarse fallback

Always show which fallback was used.

## Acceptance criteria

- no hidden fallback,
- no single-number false precision,
- sample size and spread are explicit.

---

# 3. Legal-Rent / Rent-Regulation Assessment Spec

## Objective

Provide an auditable preliminary assessment of whether the listing is likely under a regulated/capped regime in Vienna, and whether an indicative legal-rent band can be shown.

## Product rule

This is a **rules engine**, not a legal opinion.

## Output states

- `likely_capped`
- `likely_uncapped`
- `likely_capped_missing_critical_proof`
- `unclear`
- `needs_human_legal_review`

## Required evidence classes

### Strong signals

Examples:

- building age / permit-era evidence
- building-level official facts
- official subsidy/funding indicators where available
- number of objects if verified
- contract duration if verified
- usable area if verified
- exceptional size thresholds if relevant and supported

### Weak signals

Examples:

- portal text such as “Altbau”, “Neubau”, “Dachgeschoss”, “gefördert”
- document phrasing that hints at regime but does not prove it
- inferred building period from external overlays

### Missing critical facts

Examples:

- uncertain building identification
- unknown permit era
- unknown subsidy/funding status
- unclear special exceptions
- unclear tenancy/contract details

## Data model suggestion

```json
{
  "status": "likely_capped",
  "regime_candidate": "richtwert",
  "confidence": "medium",
  "strong_signals": [],
  "weak_signals": [],
  "missing_facts": [],
  "review_required": true,
  "indicative_legal_rent_band": null,
  "disclaimer": "..."
}
```

## Decision framework

1. Resolve building with confidence.
2. Determine whether strong evidence suggests old-stock / full-MRG candidate.
3. Evaluate carve-outs / exceptions / special regimes.
4. Decide regime candidate.
5. Only compute an indicative legal band when critical facts are sufficiently verified.
6. Otherwise return conservative status plus missing facts.

## UI requirement

The legal-rent section must explicitly separate:

- strong legal-rule signals,
- weak supporting signals,
- unknown/missing facts,
- why review is required.

## Acceptance criteria

- no opaque legal-rent score,
- no false certainty,
- output is auditable and readable.

---

# 4. Document Ingestion and Viewer Spec

## Objective

Turn attached exposés, floorplans, brochures, PDFs, and other listing documents into a first-class evidence layer.

## Product principles

- document handling should reuse the existing raw artifact/storage architecture,
- native PDF text extraction first,
- OCR only when necessary,
- extracted facts must carry provenance,
- viewer must connect extracted facts back to pages/spans.

## Document types

- exposé / brochure
- floorplan
- energy certificate
- cost sheet
- ownership / legal note document if exposed
- other attachment

## Core flows

### 1. Detection

During detail scrape, detect:

- document URL
- document label/title
- page context on source site
- probable type

### 2. Persistence

Store:

- URL
- checksum
- MIME type
- size
- storage key
- status
- first seen / last seen
- document type

### 3. Extraction

Pipeline order:

1. native PDF text extractor
2. OCR fallback only if text layer missing or unusable
3. specialized floorplan extraction/classification when appropriate

### 4. Structured fact extraction

Potential fields:

- rent and fees
- area
- rooms
- floor
- outdoor space
- operating costs
- heating type
- energy certificate metrics
- building year
- renovation/condition notes
- tenancy/legal notes

### 5. Viewer

The user should be able to:

- open a document list from listing detail,
- see preview/thumbnail,
- open document viewer,
- jump to a page highlighted by an extracted fact,
- see extracted facts grouped by confidence.

## Data model suggestion

- `listing_documents`
- `document_extractions`
- `document_fact_spans`

## Provenance requirement

Every extracted fact must retain:

- source document id,
- page number,
- extractor type,
- confidence,
- source snippet/span pointer.

## Acceptance criteria

- documents are first-class entities,
- extracted facts are searchable and explainable,
- OCR is not the default path.

---

# 5. Building Facts Enrichment Spec

## Objective

Create a stronger building-level context layer for Vienna listings to support better analysis and legal-rent logic.

## What it should provide

Where possible:

- building age / period
- building typology
- building identifier or external reference
- match confidence
- source provenance
- freshness timestamp

## Data model suggestion

`building_facts`

Suggested fields:

- `id`
- `building_key`
- `source_name`
- `source_record_id`
- `address_text`
- `lat`
- `lon`
- `match_confidence`
- `facts_json`
- `source_updated_at`
- `ingested_at`

## Matching logic

Use the geocoded listing plus address normalization to attempt a building-level match.
Do not overstate match certainty.

## Acceptance criteria

- building facts are visible when credible,
- unresolved building matches remain explicit,
- legal-rent layer can consume this store.

---

# 6. Neutral Vienna Context Overlay Spec

## Objective

Add high-value, lawful, explainable Vienna context layers.

## Approved priority overlays

### Priority 1

- transit access
- parks / green space
- schools / kindergartens
- building age / typology
- district and micro-location price context

### Priority 2

- noise
- climate/heat
- flood risk
- zoning/development signals
- amenities / walkability counts

## Product rule

These overlays should primarily inform:

- listing detail context,
- Listing Analysis,
- filters,
- map layers,
- internal analytics.

Do not convert everything into one opaque neighborhood score.

## Explicitly rejected for this phase

- ethnicity/nationality proxies
- name-origin profiling
- “immigrant concentration” logic
- unsupported micro safety score

## Acceptance criteria

- overlays are transparent and sourceable,
- user can see exact context facts rather than one black-box score.
