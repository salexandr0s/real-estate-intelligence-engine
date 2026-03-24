# Source 2 Verification: ImmobilienScout24.at

Verification date: 2026-03-22

## Summary

ImmobilienScout24.at (`immoscout24`) has been fully onboarded as source 2 using the same source template established by willhaben. No schema rewrites were needed. The shared normalization abstractions (base-mapper.ts) handle immoscout24 without modification. Scoring operates exclusively on canonical fields.

---

## 1. Adapter Verification

### `packages/source-immoscout24/src/adapter.ts`
- **Implements**: `SourceAdapter<Immoscout24DiscoveryItem, Immoscout24DetailDTO>` from `@immoradar/contracts`
- **sourceCode**: `'immoscout24'`
- **sourceName**: `'ImmobilienScout24.at'`
- **parserVersion**: `2`
- **Methods implemented**:
  - `buildDiscoveryRequests(profile)` -- paginated search URLs at `/regional/wien/wien/immobilien`
  - `extractDiscoveryPage(ctx)` -- delegates to `parseDiscoveryPage()` (JSON-LD CollectionPage parsing)
  - `buildDetailRequest(item)` -- builds `/expose/{exposeId}` URL with JSON-LD selector
  - `extractDetailPage(ctx)` -- delegates to `parseDetailPage()` (Product + RealEstateAgent JSON-LD)
  - `deriveSourceListingKey(detail)` -- returns `immoscout24:{id}`
  - `canonicalizeUrl(url)` -- strips query params, hash, and trailing slash
  - `detectAvailability(ctx)` -- delegates to `detectDetailAvailability()`

**Status**: PASS -- fully implements SourceAdapter contract.

### `packages/source-immoscout24/src/discovery.ts`
- Parses `<script data-testid="collection-page-structured-data">` tag containing CollectionPage JSON-LD
- Extracts expose IDs (24-char hex hashes) from listing URLs
- Parses Austrian decimal format for area (`65,20 m2` to `65.20`)
- Builds location from JSON-LD `mainEntity.address` (postalCode + addressLocality)
- Handles pagination via `/seite-N` path segment
- Returns `totalEstimate` from `numberOfItems` in CollectionPage

**Status**: PASS -- comprehensive discovery parsing with pagination.

### `packages/source-immoscout24/src/detail.ts`
- Parses multiple `application/ld+json` script blocks
- Extracts Product JSON-LD for price (offers.price), title (name), description, images
- Extracts RealEstateAgent JSON-LD for broker/contact name
- Falls back to `data-testid="primary-price"` for price extraction
- Parses description text for: living area, rooms, balcony area, floor, year built, address
- Derives Vienna district number from postal code (e.g., 1020 -> 2. Bezirk)
- Implements availability detection from Product.offers.availability and text markers

**Status**: PASS -- rich detail extraction with graceful fallbacks.

---

## 2. Fixtures and Tests

### Fixtures (`packages/source-immoscout24/src/fixtures/`)
- `discovery-page.html` -- 3 listings with CollectionPage JSON-LD + pagination
- `detail-page.html` -- full detail page with Product + RealEstateAgent JSON-LD
- `detail-sold.html` -- removed/not-found listing page

**Status**: PASS -- 3 representative fixtures matching the willhaben pattern.

### Tests (`packages/source-immoscout24/src/tests/parser.test.ts`)
- **Adapter tests** (5): metadata, URL canonicalization, key derivation, discovery requests, detail requests
- **Discovery tests** (8): JSON-LD extraction, hex hash ID extraction, Austrian decimal parsing, pagination, totalEstimate, empty/invalid graceful handling, sourceCode/discoveredAt
- **Detail tests** (8): Product JSON-LD extraction, agent name, address parsing, district derivation, balcony area, floor/year built, canonical URL, parse failure handling
- **Availability tests** (6): available, not_found, sold (JSON-LD), sold (text), unknown, blocked/captcha

**Total**: 27 test cases.

**Status**: PASS -- comprehensive parser test coverage.

---

## 3. Registry and Pipeline Integration

### Adapter Registry (`apps/worker-scraper/src/adapter-registry.ts`)
- `Immoscout24Adapter` imported from `@immoradar/source-immoscout24`
- Registered as `registry.set('immoscout24', new Immoscout24Adapter())`

**Status**: PASS -- registered alongside willhaben and 5 other sources.

### Pipeline Factory (`apps/worker-processing/src/pipeline-factory.ts`)
- `Immoscout24Mapper` imported from `@immoradar/normalization`
- Added to normalizers map: `['immoscout24', new Immoscout24Mapper()]`

**Status**: PASS -- normalization pipeline fully wired.

### Seed Data (`packages/db/seeds/seed.ts`)
- Source entry with code `'immoscout24'`
- Rate limit: **8 RPM** (vs willhaben: 10 RPM)
- Crawl interval: **30 minutes** (vs willhaben: 15 minutes)
- Priority: **20** (lower priority than willhaben at 10)
- Concurrency limit: **1**
- Parser version: **2**
- Legal status: `'review_required'` (vs willhaben: `'approved'`)
- Active: **true**

**Status**: PASS -- seeded with conservative anti-bot settings.

---

## 4. Schema Rewrite Assessment

**No schema rewrite was needed for source 2.**

The existing schema (tables: `sources`, `raw_listings`, `listings`, `listing_versions`, `listing_scores`, `market_baselines`, `user_filters`, `alerts`) handles immoscout24 data without any structural changes. All source-specific data is stored in:
- `raw_listings.raw_payload` (JSONB) -- preserves the full immoscout24 detail DTO
- `listings.normalized_payload` (JSONB) -- stores `immoscout24Id` and `immoscout24BrokerName` as overflow fields

The `sources.config` JSONB column accommodates immoscout24's crawl profile without schema changes.

---

## 5. Shared Normalization Abstractions

**The shared normalization abstractions are sufficient for immoscout24.**

`Immoscout24Mapper` extends `BaseSourceMapper` and overrides only `normalize()` to:
1. Enrich the raw payload with IS24-specific attribute mappings (floor, yearBuilt, heatingType, condition, energyCertificate from `attributesRaw`)
2. Call `super.normalize()` which handles all canonical field coercion
3. Add immoscout24-specific metadata to `normalizedPayload` (immoscout24Id, immoscout24BrokerName)
4. Fall back to IS24 estate type for property type inference if the base mapping produced `'other'`

The base mapper handles all common operations:
- Price parsing (EUR to cents)
- Area parsing (sqm)
- Room parsing
- Floor/year built parsing
- District resolution (Vienna postal code lookup)
- Content fingerprint computation
- Completeness score computation
- Listing status resolution

---

## 6. Field Coverage Comparison

| Field | willhaben | immoscout24 | Notes |
|---|---|---|---|
| Title | Yes (from attributes) | Yes (Product.name) | Both provide |
| Description | Yes (advert description) | Yes (Product.description, HTML stripped) | IS24 requires HTML stripping |
| Price | Yes (from attributes) | Yes (Product.offers.price, fallback to data-testid) | IS24 has fallback path |
| Living area | Yes (from attributes) | Yes (parsed from description text) | IS24 less structured |
| Usable area | Yes (from attributes) | No (null) | willhaben richer |
| Rooms | Yes (from attributes) | Yes (parsed from description: "N Zimmer") | |
| Address | Yes (advertAddressDetails) | Yes (parsed from description text) | IS24 less structured |
| Postal code | Yes (advertAddressDetails) | Yes (parsed from description / JSON-LD) | |
| District | Yes (derived from postal code) | Yes (derived from postal code) | Same mechanism |
| City | Yes (advertAddressDetails) | Yes (parsed from description / JSON-LD) | |
| Federal state | Yes (from attributes) | No (null) | willhaben richer |
| Street | Yes (advertAddressDetails) | Yes (parsed from description) | IS24 pattern-based |
| Floor | Yes (from attributes) | Yes (parsed: "N. Stock/OG") | IS24 text-based |
| Year built | Yes (from attributes) | Yes (parsed: "Baujahr YYYY") | IS24 text-based |
| Property type | Yes (from Objekttyp/category) | Yes (from estateTypeRaw, inferred) | |
| Operation type | Yes (from category path) | Yes (hardcoded 'sale' in DTO) | IS24 currently sale-only |
| Heating type | Yes (from attributes) | Partial (from attributesRaw if present) | |
| Condition | Yes (from attributes) | Partial (from attributesRaw if present) | |
| Energy certificate | Yes (from attributes) | Partial (from attributesRaw if present) | |
| Balcony area | Yes (from attributes) | Yes (parsed: "Balkon N m2") | |
| Terrace area | Yes (from attributes) | No (null) | willhaben richer |
| Garden area | Yes (from attributes) | No (null) | willhaben richer |
| Commission | Yes (from attributes) | No (null) | willhaben richer |
| Operating cost | Yes (from attributes) | No (null) | willhaben richer |
| Reserve fund | Yes (from attributes) | No (null) | willhaben richer |
| Latitude/Longitude | Yes (from attributes) | No (null) | willhaben richer |
| Images | Yes (advertImageList) | Yes (Product.image) | Both provide |
| Contact name | Yes (advertContactDetails) | Yes (RealEstateAgent.name) | |
| Broker name | Partial (via contact) | Yes (RealEstateAgent.name) | |
| External ID | willhabenId (numeric) | immoscout24Id (24-char hex) | Different ID formats |

**Summary**: willhaben provides richer structured data (18+ attribute keys). immoscout24 provides core fields through JSON-LD and description text parsing. Both produce valid canonical listings through the shared normalization pipeline. The completeness score accurately reflects the difference (immoscout24 listings will typically score lower on completeness).

---

## 7. Scoring Independence Verification

**Scoring uses only canonical fields -- no source-specific logic in score-engine.ts.**

The `ScoreInput` interface (from `@immoradar/contracts/scoring.ts`) uses exclusively canonical fields:
- `pricePerSqmEur`, `districtNo`, `operationType`, `propertyType` -- from canonical listing
- `livingAreaSqm`, `rooms`, `city` -- from canonical listing
- `title`, `description` -- from canonical listing
- `firstSeenAt`, `lastPriceChangeAt` -- from listing metadata
- `completenessScore`, `sourceHealthScore`, `locationConfidence` -- from normalization/pipeline
- `recentPriceDropPct`, `relistDetected` -- from version tracking

`score-engine.ts` references no source-specific code (confirmed: grep for `willhaben|immoscout24` in `packages/scoring/` returns zero matches). The scoring pipeline in `pipeline-factory.ts` calls `scoreListing()` uniformly for all sources.

---

## 8. Anti-Bot Configuration Differences

| Setting | willhaben | immoscout24 | Rationale |
|---|---|---|---|
| Rate limit (RPM) | 10 | 8 | IS24 more aggressive bot detection |
| Crawl interval | 15 min | 30 min | IS24 lower volume, conservative start |
| Concurrency limit | 1 | 1 | Same -- single browser context |
| Priority | 10 | 20 | willhaben is primary source |
| Legal status | approved | review_required | IS24 terms review pending |
| Wait timeout | 5s | 5s | Same |
| Discovery selector | `script[type="application/json"]` | `script[data-testid="collection-page-structured-data"]` | Source-specific |
| Detail selector | `script[type="application/json"]` | `script[type="application/ld+json"]` | Source-specific |

---

## 9. Conclusion

ImmobilienScout24.at is fully onboarded as source 2:
- Source isolation maintained (own package: `packages/source-immoscout24/`)
- Raw data preservation via standard raw_listings pipeline
- Idempotent writes via standard upsert mechanisms
- Strong typing throughout (SourceAdapter generic, typed DTOs)
- Separation of concerns maintained (scraping, normalization, scoring all decoupled)
- Anti-bot policy tuned independently (8 RPM, 30-min interval)
- 27 parser tests passing from 3 fixture files
- No schema changes required
- Shared normalization handles all field mapping
- Scoring is source-agnostic
