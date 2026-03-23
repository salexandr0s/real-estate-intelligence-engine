# Data Sources

This document tells the agent which external data sources are worth integrating for the Vienna-only product, how they should be used, and what should be rejected.

The agent must still verify current access methods, schemas, and licenses before implementation.

---

# Source selection principles

## Use official/public sources first

Priority order:

1. official Vienna / Austrian public sources
2. official fee-based or controlled sources when justified
3. high-quality secondary sources only when official sources are missing or too weak
4. scraping/manual sources only when necessary and lawful

## For each source, verify

- freshness
- granularity
- access method
- licensing/commercial-use constraints
- joinability to listings/buildings
- maintenance burden
- whether it should influence scoring or display only

## Important product rule

Some context layers are valuable only as display/risk context.
Do not force every source into the scoring engine.

---

# Recommended source matrix

## 1. Transit access

### Recommended source

Wiener Linien Open Data

### Why

This is the strongest official Vienna mobility context source.
It is high-value for investors and easy to explain.

### Likely usage

- nearest stop
- stop counts in radius
- line category availability
- optional travel-time accessibility caches later

### Access pattern

- official open-data feeds / APIs / files

### Join strategy

- spatial join by listing coordinates

### Store as

- stop entities
- precomputed nearest-stop or accessibility summary per listing/building if helpful

### Product usage

- display
- filters
- light score contribution if transparent

### Recommendation

**Recommended for production**

---

## 2. Parks and green space

### Recommended source

Vienna OGD park / green-space layers

### Why

Simple, intuitive, lawful, useful.

### Likely usage

- nearest park
- park count in radius
- green-space proximity badge

### Join strategy

- spatial join / nearest-neighbor

### Product usage

- display
- filters
- light score contribution if transparent

### Recommendation

**Recommended for production**

---

## 3. Schools and kindergartens

### Recommended source

Vienna OGD school/kindergarten layers

### Why

Official, easy to integrate, useful for family-oriented investor analysis without drifting into protected-trait territory.

### Likely usage

- nearest school/kindergarten
- counts within radius

### Join strategy

- spatial join / nearest-neighbor

### Product usage

- display
- filters
- optionally user-personalized weighting, but avoid hidden generic score inflation

### Recommendation

**Recommended for production**

---

## 4. Building age / typology

### Recommended source

Vienna building info layer(s), especially `GEBAEUDEINFOOGD` or successor equivalents verified at implementation time.

### Why

This is one of the highest-leverage data additions because it supports:

- richer listing analysis,
- stronger building context,
- better comp logic,
- legal-rent assessment.

### Join strategy

- address/building match from geocoded listings

### Product usage

- display
- risk/context
- legal-rent input
- light score contribution only if transparent and robust

### Recommendation

**Highest-priority official enrichment source**

---

## 5. District and micro-location price context

### Recommended sources

Primary:

- internal listing corpus and internal baselines

Secondary:

- official district-level transaction averages from Statistik Austria or similar official releases

### Why

The internal corpus is best for current asking/rent market context.
Official district averages are useful as a coarse anchor, not as a direct valuation engine.

### Join strategy

- `district_no`
- area bucket
- time period

### Product usage

- analysis context
- display
- sanity check

### Recommendation

**Recommended**

### Warning

Do not present district-level transaction averages as direct comparable evidence.

---

## 6. Noise exposure

### Recommended source

Official Vienna strategic noise map layers

### Why

Useful risk/context information, especially for investor due diligence.

### Join strategy

- spatial join to noise classification polygons/raster classes

### Product usage

- display-only risk panel
- optional filter

### Recommendation

**Recommended, display-only**

### Warning

Do not turn this into a hyper-precise unit-level acoustic truth claim.

---

## 7. Climate / heat exposure

### Recommended source

Official Vienna climate analysis / urban heat / cold-air planning layers

### Why

Valuable Vienna-specific micro-location context.
Increasingly relevant for livability and long-term asset quality.

### Join strategy

- spatial join to climate class polygons

### Product usage

- display-only risk/context
- optional filter

### Recommendation

**Recommended**

---

## 8. Flood / natural hazard risk

### Recommended source

HORA or official Austrian hazard lookup sources, subject to implementation-time access verification.

### Why

Potentially useful for risk context.

### Join strategy

- geocode lookup
- spatial join if bulk data access is available

### Product usage

- display-only risk panel
- optional filter if quality is sufficient

### Recommendation

**Recommended cautiously**

### Warning

Verify bulk access terms and integration practicality before committing.

---

## 9. Amenities / walkability context

### Recommended sources

Priority:

- Vienna OGD POI layers where available

Fallback:

- OpenStreetMap / Overpass / curated internal POI source

### Why

Useful for transparent contextual counts and distances.

### Join strategy

- spatial counts/distances by category

### Product usage

- display
- filters
- map overlays

### Recommendation

**Recommended**

### Warning

Avoid a single black-box “walkability” score unless its construction is transparent and stable.

---

## 10. Zoning and development signals

### Recommended sources

- official Vienna zoning / land-use / planning layers
- existing internal curated `wien_developments` style store if present

### Why

Useful for forward-looking context.
Can explain upcoming area changes without pretending certainty.

### Join strategy

- spatial join for zoning
- curated project proximity for known developments

### Product usage

- display
- internal analytics
- optional filters later

### Recommendation

**Recommended, but avoid over-scoring**

---

## 11. Air quality

### Recommended source

Official air monitoring network / Umweltbundesamt data

### Why

Useful context, but usually too coarse for exact property scoring.

### Join strategy

- nearest representative station
- district-level proxy only if clearly disclosed

### Product usage

- display-only context/risk

### Recommendation

**Recommended display-only**

---

# Sources to use carefully or later

## 12. Grundbuch / fee-based official property verification

### Why valuable

Potentially high-confidence legal/building verification.

### Why not core-first

- fee-based,
- operationally heavier,
- may require manual or premium workflow,
- not ideal as a baseline dependency for all listings.

### Recommendation

**Recommended for premium/manual verification later**

---

# Sources to reject for now

## 13. Crime / “safety score”

### Status

Reject for this phase.

### Why

Unless implementation-time research finds a verified, official, sufficiently granular, production-usable Vienna crime dataset, this should not be used for property-level scoring or filtering.

### Product rule

Do not invent a neighborhood safety score from:

- coarse district reports,
- news articles,
- non-official summaries,
- sparse police statistics,
- social media or anecdotal reports.

### Safer replacement

Use neutral, explainable context such as:

- transit,
- parks,
- schools,
- public services,
- lighting/streetscape proxies only if official and relevant,
- noise/climate/flood risk,
- nearby amenity density.

---

## 14. Protected-trait or proxy demographic datasets

### Status

Explicitly reject.

### Includes

- ethnicity
- nationality share
- religion
- immigrant concentration
- name-origin proxies
- any proxy-demographic score

### Why

Compliance risk and not appropriate for product use.

---

# Data storage recommendations

## Overlay storage approach

For reusable context layers, prefer dedicated normalized tables such as:

- `poi_points`
- `school_points`
- `park_polygons`
- `noise_zones`
- `climate_zones`
- `building_facts`
- `zoning_areas`

If the repo already has a generic geospatial overlay pattern, use that instead of inventing many ad hoc tables.

## Listing-level derived context

For fast UI and analysis usage, it may be worth storing per-listing or per-building derived summaries such as:

- nearest transit summary
- nearest park summary
- counts of amenities in radius
- noise/climate/flood flags

But only do this if query latency or complexity requires it.
Otherwise compute on read.

## Provenance fields

For each imported dataset or enrichment result, persist:

- `source_name`
- `source_version` or dataset revision when possible
- `source_updated_at`
- `ingested_at`
- `confidence`

---

# Scoring usage policy

## Safe to influence score lightly

Only if transparent and well-supported:

- transit access
- green-space access
- building age/typology where clearly beneficial and explainable
- internal price/rent context

## Better as display-only or risk-only

- noise
- air quality
- flood risk
- climate/heat
- zoning/development

## Never use in score

- protected traits or proxies
- unsupported crime/safety proxies
- coarse national macro price indices as listing-level truth

---

# Implementation-time verification checklist for every source

Before integrating any dataset, the agent must answer:

1. Is this source official?
2. Is commercial/product reuse allowed?
3. What is the update cadence?
4. What is the geographic granularity?
5. Can it be joined robustly to listings/buildings?
6. Is it better as score input or display-only context?
7. What is the operational burden to keep it fresh?
8. What should happen when the source is unavailable or stale?

If these answers are weak, the source should be display-only, deferred, or rejected.
