

4. Best Improvements to Existing Features

Area	What is good already	What is weak / incomplete	Best ROI improvement	Exact repo touchpoints
Source coverage and scraper resilience	Real workers, real adapters, artifact capture, replay scripts	Selector fragility, anti-bot risk, weak OpenImmo, no proven parser-regression harness	Add fixture-based parser tests per source + scheduled canary crawl + auto-pause degraded source	apps/worker-scraper/src/discovery-worker.ts, detail-worker.ts, packages/source-*, scripts/canary-crawl.ts, tests/integration/*  
Normalization gaps and provenance quality	Canonical pipeline, versioning, completeness/current score	Missing structured facts like heating, opex, energy cert, build year, furnishing, condition; field provenance not exposed	Add normalized fact provenance and richer extracted attributes before any “AI” layer	packages/ingestion/src/pipeline.ts, packages/normalization/*, schema.sql listings / listing_versions  
District / address / coordinate quality	Vienna-specific geocoder is a real strength	Users cannot easily tell exact vs inferred vs coarse	Add geocode_source, geocode_confidence, coordinate_precision, district_confidence; show them in API/UI	packages/geocoding/src/geocoder.ts, packages/db/src/queries/listings.ts, listing-detail location UI
Search/filter UX and alert truthfulness	Structured filters, saved filters, filter test, alerts	Search semantics are likely inconsistent across listing search, filter test, and live matching; search_vector is under-leveraged	Unify all keyword logic on one DB/compiler path and return match explanations	packages/filtering/src/compiler/build-search-query.ts, packages/db/src/queries/listings.ts, packages/db/src/queries/user-filters.ts, apps/api/src/routes/filters.ts  
Baseline computation quality and freshness	Baselines are real and wired into scoring/explanations	Ask-price only; freshness/sample/fallback not surfaced; no verified scheduler in .github/workflows/*	Keep the current architecture, but add baseline metadata and explicit ask-data caveats	market_baselines, scripts/compute-baselines.ts, scoring package, .github/workflows/*  
Score explainability and trust	Score explanation route/UI already exists	It still risks false precision when baselines are thin or geocode is coarse	Add confidence penalties and input/fallback provenance to explanation payload	apps/api/src/routes/listings.ts, scoring package, macOS score breakdown UI
Alert quality and dedupe	Alerts are real, dedupe key exists, unread and SSE flows exist	Cross-source duplicates may still create noise if cluster identity is not used in dedupe	Make dedupe cluster-aware and expose why the alert matched	alerts table, findMatchingFilters, alerts routes, cluster data
Listing detail UX	Existing detail view already shows score, versions, context, cluster-ish surfaces	No dedicated analysis surface, no docs, no assumptions panel, no missing-data warnings	Add Analysis and Documents tabs inside existing listing detail	apps/macos listing detail surfaces, listings API routes
API completeness	Good operational surface already exists	No first-class analysis, legal-rent, document routes; no explicit contract for provenance/confidence	Extend current Fastify API instead of inventing new services	apps/api/src/routes/*
macOS app gaps	Real app with useful operator flow	POIs/developments partly local; faux “Safety”; no docs/legal-rent/analysis; Copilot gap	Move context to server-backed parity, neutralize wording, add analysis/docs, hide Copilot until real	apps/macos resources and listing detail/settings files
Testing gaps	Unit/integration/load-test scripts exist	Source parser regression, document extraction, legal-rent rule tests, and macOS CI are missing	Add fixture contracts for parsers + table-driven legal tests + macOS build in CI	tests/unit, tests/integration, .github/workflows/ci.yml
Data quality monitoring and recoverability	Reparse/replay/backfill/build-clusters/geocode-missing are real strengths	Not clearly thresholded/automated; quality findings may stay manual	Promote DQ metrics to first-class operational gates	scripts/data-quality-report.ts, replay/reparse/backfill scripts, health/metrics route

Highest-ROI order

The best ROI sequence is not new features first. It is: search/filter truthfulness, parser resilience, provenance surfacing, and POI/server parity first. Those four upgrades increase trust across everything already present. They also directly de-risk the later Listing Analysis, rent-market, legal-rent, and documents work.

What blocks accurate investor use today

The biggest blockers are: ask-price baselines that can look valuation-grade when they are not; missing geocode precision cues; lack of document-backed facts; lack of a clear market-rent vs legal-rent separation; and alert/search semantics that can undermine trust if a saved filter tests differently than it matches live.  

⸻

5. Best New Features for the Vienna Product

A. Neutral neighborhood/context overlays worth adding

Overlay	Best source choice	Production realism	Join / storage	Affect score or display only?	Best UX surface	Verdict
Transit access	Wiener Linien Open Data stops/monitoring/routing datasets	Strong	Spatial join to nearest stop(s), travel-time cache by listing/building	Light score + display + filters	Listing detail, Analysis page, filters, map layer	Add now  
Parks / green space	Vienna park/green OGD layers	Strong	Spatial join to nearest park + green area within radius	Light score + display + filters	Listing detail, Analysis page, map layer	Add now  
Schools / kindergartens	Official Vienna school/kindergarten OGD	Strong	Nearest point / counts within radii	Mostly display + filters; score only if user explicitly values it	Listing detail, filters, map layer	Add now, but neutral  
Universities	I did not verify a strong dedicated official campus OGD layer in this audit	Moderate/weak	Curated points only	Display only	Map layer / detail	Optional later
Noise	Official strategic noise maps	Real but coarse and slow-changing	Spatial join to noise class polygon/raster	Display/risk flag only	Risk panel, map layer	Add, display-only  
Air quality	Vienna/UBA station data	Real but station-level, not parcel-level	Nearest representative station / district	Display only	Risk/context panel	Add, display-only  
Flood / natural hazard	HORA	Public and useful, but bulk/API/terms need checking	Address/coords → hazard lookup	Display/risk flag only	Risk panel, map layer	Add cautiously  
Climate / heat	Vienna climate analysis / cold-air planning maps	Valuable and Vienna-specific	Spatial join to climate class	Display/risk flag; maybe light penalty if clearly explainable	Risk panel, map layer	Add  
Building age / typology	GEBAEUDEINFOOGD	High-value production candidate	Address/building spatial join; persist in building_facts	Score lightly + display + legal-rent inputs	Listing detail, Analysis page, legal panel	Highest-value new data feature  
Zoning / development signals	Official zoning/generalized land-use + repo’s curated wien_developments	Real but mixed	Spatial join + curated project store	Display / internal analytics, not heavy score	Map layer, detail, internal analytics	Add carefully  
Amenities / walkability	Vienna OGD POIs first; OSM second if gaps	Real	Counts/distances by category/radius	Display + filters, avoid opaque score	Listing detail, filters, map layer	Add, but transparent  
District and micro-location price context	Internal micro-baselines + Statistik Austria district transaction averages	Real, with clear limits	district_no + size bucket + internal comp pool	Display + analysis; score only cautiously	Analysis page, detail	Add  
Crime / “safety score”	No verified suitable official micro-granular open dataset	Weak	No robust join	Should not score	Avoid	Reject  

B. The best net-new product features, in order

The three most valuable net-new features are:
	1.	Listing Analysis page: this is the missing synthesis layer over assets the repo already has.
	2.	Building facts + legal-rent assessment: this creates Vienna-specific defensibility.
	3.	Document ingestion + viewer: this upgrades facts from portal text to evidence-backed intelligence.

Those are better investments than expanding geography, building Copilot, or inventing a proprietary “neighborhood score.”  

⸻

6. Detailed Plan for the Listing Analysis Page

What it should be

Build a dedicated Listing Analysis surface for one listing/property. Do not make it a separate parallel product. Add it as a new tab/section inside the current listing-detail flow and expose it from the existing API. The repo already has the right primitives: listing detail, score explanation, versions/history, location context, and cluster-ish data.

What it should output

Section	What it shows	How it should be produced
Cleaned listing summary	Canonical title, source, last seen, asking price, normalized summary	Existing listing + normalization pipeline
Normalized property facts	Type, sqm, rooms, floor, condition, outdoor space, heating, fees, build year, energy fields	Existing normalized fields plus future document/building enrichments
Location/context summary	District, geocode confidence, transit, parks, schools, noise/heat/flood flags	Geocoder + Vienna overlays
Comparables	Similar nearby/current internal sale comps and rent comps	Internal listing corpus, deduped by cluster/fingerprint
Estimated market rent	Rent range, central estimate, confidence, sample size, fallback level	Internal rent corpus + rent baselines
Sale-value context	Coarse district transaction context and current asking-market context	Statistik Austria district averages + internal ask baselines
Risk flags	Thin comps, likely regulated, high noise, flood/heat exposure, missing data, coarse geocode	Rule layer
Upside flags	Transit+park access, below ask baseline, balcony, better-than-typical layout, strong demand area	Rule layer
Investor view	Gross yield, price-to-rent, rent sensitivity low/base/high	Formula layer
Assumptions / missing-data warnings	Explicit what is inferred, missing, weakly supported, or document-backed	Provenance layer
Legal-rent panel	Separate regime/risk assessment	Separate rules engine, not mixed into market-rent

Critical product rule

Do not collapse market-rent estimation and legal-rent/regulatory assessment into one number. They are different questions and will diverge precisely on the properties where investors care most. The Vienna legal context around Altbau/full MRG/Richtwert, subsidized stock, special cases, and fixed-term deductions is too material to hide behind a single “fair rent” number.  

Market-rent estimation logic

Use a tiered, auditable comp method built on the existing listing corpus.

Primary comp pool
	•	Internal Vienna rent listings where operation_type='rent'.
	•	Deduped using listing_clusters and/or cross_source_fingerprint.
	•	Exclude stale or low-confidence location rows when possible.  

Tiering
	•	T1: within ~800m, same property type, area ±15%, rooms ±1, recent, good geocode.
	•	T2: same district, area ±20%, rooms ±1, recent.
	•	T3: district-level rent baseline / city fallback if thin data.

Estimation
	•	Use trimmed median €/sqm and an interquartile band.
	•	Confidence should be a function of sample size, geocode quality, recency, feature-match completeness, and spread.
	•	Show the actual sample size, geographic fallback used, and whether the result is based on direct comps or coarse fallback.

Official data role
The official rent data I verified is macro/statistical, not listing-grade comparable data. Use it only as a sanity anchor, not as the comp engine. Statistik Austria’s publicly visible rent figures are broad averages; they are not a Vienna property-level comparable source.  

Comparables logic

Show two comp buckets:
	•	Market sale comps: internal nearby/similar sale listings, deduped.
	•	Market rent comps: internal nearby/similar rent listings, deduped.

Then add a third context bucket:
	•	District transaction anchor: Statistik Austria district + size-category average transaction context, clearly labeled as coarse district-level context, not direct comp evidence.  

Each comparable should show:
	•	source
	•	distance
	•	area / rooms / price
	•	age of listing
	•	cluster dedupe status
	•	why it matched

Investor view

Keep this simple and honest:
	•	Gross yield = annualized market-rent estimate / ask price
	•	Price-to-rent = ask price / annualized market-rent estimate
	•	Sensitivity = low / base / high rent scenarios

Do not show a fake “net yield” unless operating costs, reserve burden, vacancy, and financing assumptions are materially known.

Recommended implementation

API
	•	Add GET /v1/listings/:id/analysis
	•	Optionally later GET /v1/listings/:id/comparables

Repo touchpoints
	•	apps/api/src/routes/listings.ts or new analysis.ts
	•	packages/db/src/queries/listings.ts
	•	cluster queries + baseline queries + POI/development queries
	•	macOS listing-detail flow (ListingDetailView.swift + new ListingAnalysisView.swift)

Data strategy
Compute on read first. Only add cached snapshots if performance requires it. This respects the current architecture and avoids inventing a parallel analytics service.

⸻

7. Detailed Plan for Rent-Regulation / Rent-Cap Assessment

Product stance

This should be an auditable rules layer, not an opaque score and not a legal opinion generator. The product should answer:
	•	what strong legal-rule signals are present,
	•	what weak heuristics suggest,
	•	what is missing,
	•	and whether a human/legal review is required.

The output states should be
	•	Likely capped
	•	Likely uncapped
	•	Likely capped but missing critical proof
	•	Unclear
	•	Needs human/legal review

Required inputs

Signal class	Examples	How to treat it
Strong legal-rule signals	Building permit year/date, number of rental units, condo status, subsidy/funding status, attic conversion status, contract term, usable area, equipment standard/category	Can drive regime classification
Weak heuristic signals	“Altbau”, “Neubau”, “Dachgeschossausbau”, “gefördert” in listing text, building-age overlay, photo clues	Supportive only; never enough for certainty
Unknown / unverifiable	No permit date, unclear subsidy status, missing contract facts, unclear unit history	Force conservative output

The rule logic

The official Vienna guidance is clear enough to design a rules engine, but not enough to pretend certainty from thin portal data. Vienna’s Mietenrechner guidance and the city’s Richtwert references point to key scope logic around older buildings, number of units, old condo stock, subsidized/funded stock, and related caveats. AK Wien also highlights major exceptions such as some luxury flats over 130 m² and the 25% fixed-term discount.  

Recommended decision tree
	1.	Resolve the building confidently
	•	If address/building cannot be resolved with high confidence, return unclear.
	2.	Determine building age / stock type
	•	If strong evidence indicates pre-1 July 1953 permit and the building has more than two rental objects, that is a strong Altbau/full-MRG candidate.
	•	If strong evidence indicates old condo stock (per the Vienna guidance), that can also point toward a capped regime.
	•	If the listing appears to be newer stock, later-created unit, or otherwise outside classic Altbau conditions, do not default to capped.  
	3.	Check special regimes / exceptions
	•	Subsidized/funded buildings
	•	Attic conversions / later-created units
	•	Condo-specific exceptions
	•	130 m² / high-end cases that may push toward angemessener Mietzins
	•	Business/other non-standard use cases  
	4.	Determine regime candidate
	•	likely_richtwert_capped
	•	likely_angemessen
	•	likely_free_rent
	•	unclear
	5.	Only compute an indicative legal-rent band when critical facts are proven
	•	If the property is a strong Richtwert candidate and critical facts are present, compute an indicative legal band.
	•	If fixed-term is known, apply the 25% discount.
	•	If critical facts like funding status, exact scope, or usable area/equipment standard are missing, do not give a final-looking legal-rent figure. Return likely capped but missing critical proof instead.  

Confidence scoring
	•	High: multiple strong signals, no critical conflicts, building resolved confidently
	•	Medium: one or two strong signals plus supporting heuristics, some missing facts
	•	Low: mostly heuristic, major critical facts missing

What the output payload should contain
	•	regime_candidate
	•	status
	•	confidence
	•	strong_signals[]
	•	weak_signals[]
	•	missing_facts[]
	•	review_required
	•	indicative_legal_rent_band only when warranted
	•	disclaimer

Data sources

Use these in descending order of trust:
	1.	Official building facts / geodata such as GEBAEUDEINFOOGD for building context.  
	2.	Official Vienna rent-rule guidance / calculators as reference/QA, not necessarily as a production API until access/terms are confirmed.  
	3.	Paid Grundbuch / Grundstücksdatenbank checks for analyst/manual or premium verification, because they are official but fee-based and operationally heavier.  
	4.	Listing text / documents / photos only as weak signals.

Recommended repo implementation

New data model
	•	building_facts
	•	legal_rent_assessments
	•	listing_assumption_overrides (optional, for analyst review)

Touchpoints
	•	new rules module in packages/*
	•	API route in apps/api
	•	macOS Legal Rent card within Listing Analysis / listing detail
	•	enrichment worker using existing address/geocode pipeline

This should sit beside the current scoring system, not inside it. Legal-rent assessment is a separate evidence product, not a numeric opportunity factor.

⸻

8. Detailed Plan for Document Ingestion + Viewer

Current truth

The repo already stores raw HTML plus screenshot/HAR/object references for scraped listings, which is a good foundation. But I did not verify a first-class listing-documents subsystem: no dedicated listing_documents table in the audited schema, no document extraction pipeline, no searchable extracted text, and no built-in document viewer surface.  

What to build

Build a proper document subsystem on top of the existing artifact/storage model.

Step 1: Detect and persist attachment URLs

Extend each source detail parser to emit:
	•	attachment URL
	•	guessed type (expose, floorplan, energy_certificate, brochure, cost_sheet, other)
	•	title/label from page
	•	source page provenance
	•	first-seen timestamp

Step 2: Download and version them

Store:
	•	canonical URL
	•	checksum
	•	MIME type
	•	file size
	•	storage key
	•	first seen / last seen
	•	fetch status
	•	page count when known

Use checksum-based dedupe so the same expose/floorplan found on multiple refreshes is not reprocessed.

Step 3: Extract text and structure

Use a staged pipeline:
	1.	Native PDF text extraction first
	•	Cheap
	•	Fast
	•	Highest ROI for exposés/cost sheets/energy docs
	2.	OCR only when necessary
	•	Trigger only when the PDF/image has no usable text layer or text density is near zero
	3.	Targeted floorplan handling
	•	Only classify a file as a floorplan after MIME/content heuristics
	•	Then run higher-cost extraction for rooms, area callouts, balcony/terrace hints, and layout labels

Step 4: Extract structured fields

Field	Likely source	Best extraction path
Rent and fees	exposé / cost sheet	native text first
Usable / living area	exposé / floorplan	text first, floorplan fallback
Rooms	exposé / floorplan	text + targeted floorplan
Floor	exposé	native text
Balcony / terrace / garden	exposé / floorplan	text, then floorplan clues
Operating costs	cost sheet / exposé	native text
Heating type	exposé / energy doc	native text
Energy certificate data	energy certificate PDF	native text
Building year	exposé / building facts	text + external building facts
Condition / renovation notes	exposé	text extraction + rules
Reserve fund / maintenance clues	brochures / ownership docs where available	text extraction
Legal / tenancy notes	expose/contract-like docs if present	text extraction

Step 5: Store provenance

Every extracted fact should carry:
	•	document id
	•	page number
	•	extractor type (pdf_text, ocr, floorplan_vision)
	•	confidence
	•	text span / snippet pointer

That matters because the same field may exist in portal text, document text, and official building facts, and the product must decide which source wins.

Step 6: Make it searchable and visible

Add:
	•	full-text search on extracted text
	•	document list in listing detail
	•	thumbnails/previews
	•	open-in-viewer
	•	“facts found in documents” badges
	•	link-back from extracted fact to the exact document/page

Recommended schema
	•	listing_documents
	•	document_extractions
	•	document_fact_spans

Recommended repo touchpoints
	•	source detail parsers in packages/source-*
	•	apps/worker-scraper/src/detail-worker.ts
	•	new document-processing job/worker in existing worker architecture
	•	packages/db
	•	new document API routes in apps/api
	•	macOS ListingDetailView → new Documents tab

Costs and failure modes
	•	Native PDF extraction: low cost, high value
	•	OCR: medium/high cost, brittle, last resort
	•	Floorplan vision: highest cost, use only on floorplans
	•	Failure modes: broken temporary URLs, giant files, duplicate docs, malformed PDFs, poor scans, multilingual layouts

The key product decision here is simple: prefer native PDF extraction first, use OCR only when necessary. That is the right cost/quality trade-off for this repo.

⸻

9. Data-Source Acquisition Matrix

Vienna OGD is a strong foundation. The city states its OGD is publicly reusable and ViennaGIS content is available under CC BY 4.0 with attribution. Wiener Linien’s open data is also published for reuse with attribution and commercially usable. OSM is available under ODbL. Grundbuch/Grundstücksdatenbank access is official but fee-based. Dataset-specific license checks still matter, because not every public layer is equal.  

Feature	Data source	Official vs secondary	Access method	Vienna coverage	Granularity	Update frequency	License/commercial-use constraints	Reliability	Join-key strategy	Expected cleaning/normalization effort	Recommended or rejected	Why
Transit access	Wiener Linien Open Data	Official	API + file download	Full Vienna	Stop / line / realtime event	Realtime + ongoing dataset refresh	Reuse with attribution; commercial use supported	High	Spatial join to nearest stops; optional travel-time cache	Medium	Recommended production	Best official mobility context for Vienna.  
Parks / green space	Vienna park/green OGD layers	Official	WFS/WMS/file download	Full Vienna	Polygon / point	Periodic	Vienna OGD attribution terms	High	Spatial join and nearest distance	Low-Medium	Recommended production	Simple, explainable, high user value.  
Schools / kindergartens	Vienna SCHULEOGD / KINDERGARTENOGD	Official	WFS/WMS	Full Vienna	Point	Periodic	Vienna OGD attribution terms	High	Nearest distance + counts in radii	Low	Recommended production/display	Official, easy to maintain, transparent.  
Universities	No strong dedicated official campus OGD verified in this audit	Secondary / mixed	Manual / OSM / curated	Vienna	Point	Variable	ODbL or source-specific	Medium	Nearest campus point	Low-Medium	Recommended display-only or postpone	Schools are stronger than universities as a verified official layer here.
Noise	Vienna strategic noise maps	Official	Official map/layer download	Full Vienna	Area / raster-like class	Multi-year cycle	Official public use; check layer-specific terms	Medium	Spatial join	Medium	Recommended display-only	Useful risk context, too coarse/slow for core score.  
Air quality	Vienna air network + Umweltbundesamt	Official	Web data / reports / downloads	Vienna via stations	Station-level	Hourly	Official public data	Medium	Nearest representative station / district mapping	Medium	Recommended display-only	Too coarse for property scoring, good for context.  
Flood / natural hazard	HORA	Official	Web portal; bulk access not verified	Austria incl. Vienna	Area / hazard lookup	Periodic	Terms/access for bulk production need checking	Medium	Geocode/parcel lookup	Medium-High	Recommended display/manual only	Valuable first-information layer, but bulk production integration needs more verification.  
Climate / heat	Vienna climate analysis / cold-air maps	Official	Official maps / storymaps / geodata	Vienna	Area class	Multi-year	Official public use	Medium-High	Spatial join	Medium	Recommended display/risk	Strong Vienna-specific risk/context signal.  
Building age / typology	GEBAEUDEINFOOGD	Official	WFS/WMS	Full Vienna	Building-level	Periodic	Vienna OGD attribution terms	High	Address/building spatial join	Medium	Recommended production	High leverage for legal-rent, building context, and confidence.  
Zoning / development signals	MA21/generalized land-use layers + repo-curated developments	Official + internal curated	WFS/WMS + manual	Vienna	Polygon / project point	Periodic/manual	Official layers under OGD terms; curated internal dataset needs provenance	Medium	Spatial join + curated project keys	Medium	Recommended display/internal analytics	Good context; do not over-score project rumors.  
Amenities / walkability	Vienna OGD POIs + OSM fallback	Mixed	WFS/WMS + OSM/Overpass	Vienna	Point	Periodic / variable	Vienna OGD + ODbL	Medium-High	Category counts/distances	Medium	Recommended display/filter	Use transparent counts/distances, not one opaque index.  
District / micro-price context	Statistik Austria district transaction averages	Official	Web/file/manual ingest	Vienna districts	District + size bucket	Updated publication cycle	Public statistical use; verify reuse specifics per dataset	High	district_no + size bucket	Low	Recommended coarse display only	Good anchor, too coarse for direct valuation.  
Macro price context	OeNB residential index (WOHI)	Official	Web/download	National / macro	Index	Quarterly	Public, but statistical-purpose index	High	Time-period only	Low	Rejected for per-property valuation; optional macro display only	Too coarse and too easy to misuse.
Legal-rent verification	Grundbuch / Grundstücksdatenbank	Official, fee-based	Paid query/manual	Austria incl. Vienna	Parcel / register entry	Current	Fee-based, operational burden	High	Address/parcel/manual match	Medium-High	Recommended analyst/manual/premium only	Strong signals, but not open, cheap, or low-friction.  
Crime / “safety”	Public PKS / reports / articles	Official but coarse	Reports/articles	Vienna	Broad city/district	Periodic	Public info	Low for property use	No robust property-level join	Low	Rejected	I did not verify a public official micro-granular dataset suitable for property scoring.  


⸻

10. Required Schema / API / UI / Worker Changes

Feature	Exact repo touchpoints	Schema / migration changes	API changes	macOS UI changes	Jobs / backfill / tests
Search/filter/alert unification	packages/filtering/src/compiler/build-search-query.ts, packages/db/src/queries/listings.ts, packages/db/src/queries/user-filters.ts, apps/api/src/routes/filters.ts, listings routes	Ensure search_vector is the live source of keyword truth; add filter-match explanation fields if needed	Make /v1/listings, filter-test, and live matcher share one semantics contract	Show exact match reasons in filter test and alerts	Add equivalence tests: search vs filter-test vs live matcher; reindex if needed  
Geocode + baseline provenance	packages/geocoding/src/geocoder.ts, scoring package, listings/score routes, listing-detail/score SwiftUI surfaces	Add geocode_source, geocode_confidence, coordinate_precision, district_confidence; extend baseline metadata with sample/fallback/window fields	Expose provenance on listing detail + score explanation endpoints	Add badges for geocode precision and baseline sample/fallback	Backfill via geocode-missing, recompute baselines, rescore; add unit tests for geocode confidence mapping
Vienna context parity	scripts/fetch-vienna-pois.ts, POI/development queries/routes, local macOS POI/development stores/resources	Add source_updated_at/freshness metadata to context tables if missing	Tighten /v1/pois/nearby and development endpoints as source of truth	Remove faux “Safety”; replace with neutral Nearby Services/Public Services/Context labels	Schedule fetches; add freshness/DQ checks; add client tests for parity with API
Listing Analysis page	listings routes + DB queries + cluster/baseline/context queries; macOS listing detail	Optionally add listing_analysis_snapshots; preferably extend current tables first	Add GET /v1/listings/:id/analysis	Add ListingAnalysisView.swift as tab/section inside listing detail	Build comps/rent-baseline queries; add endpoint snapshot tests
Building facts + legal-rent rules	new rules/building-facts module under packages/*; API; listing detail/analysis	Add building_facts, legal_rent_assessments, optional listing_assumption_overrides	Add legal-rent fields into analysis or GET /v1/listings/:id/legal-rent	Add Legal Rent card with strong/weak/unknown breakdown	Add enrichment job by address/building join; table-driven legal rule tests
Document ingestion + viewer	source detail parsers, detail-worker.ts, new document worker, DB, new routes, macOS detail view	Add listing_documents, document_extractions, document_fact_spans	Add docs list/detail/download endpoints	Add Documents tab with preview, thumbnails, page jump, extracted-facts highlights	Add document download/extract/thumbnail jobs; backfill doc URLs from old HTML; add PDF/OCR tests
Source health + parser regression	source adapters, worker-scraper, canary script, metrics	Optional source_health_snapshots table if metrics only is insufficient	Add source health/admin endpoints only if operators need them	Admin-only source health panel later	Add canary schedule, parser fixtures, degraded-source metrics

Rollout order
	1.	Search/filter/alert unification
	2.	Geocode/baseline provenance
	3.	POI/development parity and wording cleanup
	4.	Listing Analysis page v1
	5.	Building facts enrichment
	6.	Legal-rent rules v1
	7.	Documents viewer + extraction

That order is intentionally incremental and reuses the current ingestion/normalization/scoring/API/macOS boundaries instead of inventing new infrastructure.

⸻

11. Risks, Compliance Notes, and Things to Avoid

Risk / thing to avoid	Why	Safer replacement
Protected-trait or proxy housing features	Not allowed and high compliance risk	Use neutral context like transit, parks, noise, climate, building facts
Crime / “safety score”	I did not verify a suitable official micro-granular Vienna crime dataset	Use neutral service proximity + noise/climate/public-service context instead  
One opaque “fair rent” number	Market rent and legal rent are different questions in Vienna	Separate Market Rent and Legal-Rent panels  
Treating ask baselines as valuation truth	Current baselines are built from listings, not transactions	Label them as asking-market context; pair with district transaction anchors  
Pretending coarse geocodes are exact	False precision poisons trust	Surface geocode precision and confidence badges
OCR-everything pipeline	High cost, brittle, unnecessary for many native PDFs	Native PDF extraction first; OCR only when text layer is absent
Austria-wide abstraction now	Dilutes product focus and data advantage	Deepen Vienna-first context, legal logic, and overlays
Copilot before evidence quality	Current Copilot appears scaffolded and the evidence layer is still incomplete	Build analysis/provenance/documents first
Using OeNB WOHI as listing-level valuation input	It is a macro/statistical index, not a listing-level valuation engine	Use only as macro context if at all

One more licensing caution: Vienna OGD is broadly reusable, but production ingestion should still record the dataset-specific license/version/source string per overlay. Do not assume every public-looking page has the same reuse terms just because it is on a city domain.  

⸻

12. Final Recommended Roadmap

NOW

Item	Why it matters / why now	User / investor value	Technical leverage	Effort	Dependencies	Confidence
Unify search, filter-test, and live alert semantics	Trust is damaged if a filter tests differently than it matches live; current paths look inconsistent	Immediate trust gain in core workflow	Reuses existing query/compiler/indexing	M	None	High
Add parser fixtures, canaries, and source health gating	Scraper resilience is the foundation for every downstream feature	Fewer silent data regressions	Builds directly on worker/adapters/artifacts	M	None	High  
Expose geocode and baseline provenance; fix schema drift	Current system knows more than it tells the user, and schema drift raises maintenance risk	Higher trust, less false precision	Makes existing score/detail surfaces more honest	M	Migration discipline	High  
Move Vienna context to server-backed freshness and neutral wording	Current POI/dev context is useful but partly local and the “Safety” framing is too strong	Better listing context without compliance risk	Reuses current POI/dev routes and app surfaces	M	Context refresh jobs	High  
Add macOS build/test coverage to CI	The product surface is real; it deserves real CI	Fewer broken investor/operator builds	Low complexity, high leverage	S	CI update	High

NEXT

Item	Why it matters / why now	User / investor value	Technical leverage	Effort	Dependencies	Confidence
Listing Analysis page v1	This is the missing synthesis layer over features already present	Converts raw listing detail into investor-readable analysis	Reuses listings, scores, clusters, baselines, context	M-L	NOW items above	High
Rent-market estimation + comparables	Investor decisions need a rent view, not just a sale ask view	Gross yield and price-to-rent become meaningful	Extends existing market_baselines and comp queries	M	Analysis page + cluster quality	Medium-High
Building facts enrichment	High leverage for context and regulation	Improves legal, risk, and factual trust	Vienna-specific differentiator	M	Geocode quality	High  
Legal-rent assessment v1	Vienna-specific defensibility and investor value	Separates legal risk from market opportunity	Rules-based, explainable layer	L	Building facts + analysis page	Medium-High  
Document ingestion + viewer v1	Converts fragile portal text into evidence-backed facts	Major trust upgrade on individual deals	Reuses current artifact storage/workers	L	Listing Analysis page helpful but not mandatory	High

LATER

Item	Why it matters / why later	User / investor value	Technical leverage	Effort	Dependencies	Confidence
Advanced Vienna overlays: noise, flood, heat, zoning filters	Valuable, but less urgent than trust/provenance/docs/legal logic	Better micro-location risk/context	Fits the same context architecture	M-L	Context layer stabilized	Medium
Analyst/premium verification path via fee-based registers	Strong extra signal, but operationally heavier and costlier	Higher-confidence premium/legal workflows	Good add-on after legal-rent v1	M	Legal-rent v1 + ops design	Medium  
Copilot / conversational assistant	Not worth prioritizing before evidence layer is trustworthy and complete	Limited until analysis/docs/legal surfaces are mature	Can sit on top later	L	Analysis + docs + provenance	High that it should wait

Final recommendation

Treat the current product as a Vienna asking-market intelligence engine with strong ingestion and triage foundations. The next phase should not be “more sources” or “AI.” It should be trust hardening first, then analysis + building facts + legal-rent + documents. That sequence fits the repo’s real architecture, strengthens the existing product instead of forking it, and creates actual Vienna-specific differentiation.