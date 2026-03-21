# Source Inventory

## Target Market

| Attribute | Value |
|-----------|-------|
| Country | Austria |
| City | Vienna (Wien) |
| Operation | Purchase (sale) |
| Property type | Apartment (Eigentumswohnung), primary |
| Districts | All 23 Vienna districts |
| Expansion path | Additional property types → rent → other Austrian cities |

## v1 Canonical Values

**Property types**: `apartment`, `house`, `land`, `commercial`, `parking`, `other`
**Operation types**: `sale`, `rent`

These are defined in `packages/contracts/src/domain.ts` and enforced via database CHECK constraints.

---

## Source Registry

### 1. willhaben.at

| Field | Value |
|-------|-------|
| Code | `willhaben` |
| Name | willhaben.at |
| Base URL | https://www.willhaben.at |
| Status | **ACTIVE** — first source for production onboarding |
| Parser version | 1 |

**Entry points**:
- Discovery: `/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?page={N}&rows=25&sort=1`
- Detail: `/iad/immobilien/d/eigentumswohnung/{slug}-{id}/` (public, no auth)

**Extraction method**: `__NEXT_DATA__` JSON hydration — Next.js embeds full listing data as JSON in a `<script>` tag. Rich structured data, minimal DOM dependency.

**ID strategy**: Numeric willhaben ID extracted from `advertDetails.id` in JSON or from the detail URL. Stable, persistent across page updates.

**Vienna coverage**: HIGH — largest Austrian classifieds portal, comprehensive apartment listings across all districts.

**Field completeness**: HIGH — price, living area, usable area, rooms, district, postal code, coordinates, images, operating costs, balcony/terrace/garden areas, year built, floor, condition, heating type.

**Fixtures**: 3 saved (discovery page, detail page, sold/unavailable page).

---

### 2. ImmobilienScout24.at

| Field | Value |
|-------|-------|
| Code | `immoscout24` |
| Name | ImmobilienScout24.at |
| Base URL | https://www.immobilienscout24.at |
| Status | **ACTIVE** — second source for onboarding |
| Parser version | 2 |

**Entry points**:
- Discovery: `/regional/wien/wien/immobilien` (page 1), `/regional/wien/wien/immobilien/seite-{N}` (subsequent)
- Detail: `/expose/{id}` (public, no auth)

**Extraction method**: JSON-LD structured data via `<script data-testid="collection-page-structured-data">` for discovery. Detail pages use JSON-LD `Apartment`/`RealEstateListing` schema with DOM fallbacks.

**ID strategy**: Numeric expose ID from URL path. Stable.

**Vienna coverage**: HIGH — major Austrian real estate portal with strong Vienna presence.

**Field completeness**: MEDIUM-HIGH — price, area, rooms, district, coordinates. Some fields (operating costs, balcony area) may be less consistently present than willhaben.

**Fixtures**: Parser implemented, fixtures to be saved from live crawls.

---

### 3. wohnnet.at

| Field | Value |
|-------|-------|
| Code | `wohnnet` |
| Name | wohnnet.at |
| Base URL | https://www.wohnnet.at |
| Status | **ACTIVE** — third source for onboarding |
| Parser version | 1 |

**Entry points**:
- Discovery: `/immobilien/eigentumswohnungen/wien?seite={N}`
- Detail: `/immobilien/angebot/{id}` (public, no auth)

**Extraction method**: DOM CSS selectors (`.realty-result` cards for discovery, detail DOM with microdata). No embedded JSON.

**ID strategy**: Numeric ID from detail URL path. Stability MEDIUM — depends on URL format consistency.

**Vienna coverage**: MEDIUM — established Austrian portal, good but not as comprehensive as willhaben.

**Field completeness**: MEDIUM — standard fields present, some extended attributes (energy certificate, operating costs) may be sparse.

**Fixtures**: Parser implemented, fixtures to be saved from live crawls.

---

### 4. derstandard.at Immobilien

| Field | Value |
|-------|-------|
| Code | `derstandard` |
| Name | derstandard.at Immobilien |
| Base URL | https://immobilien.derstandard.at |
| Status | **ACTIVE** — expansion source |
| Parser version | 2 |

**Entry points**:
- Discovery: `/immobiliensuche/i/kaufen/wohnung/wien?page={N}`
- Detail: `/detail/{id}` (public, no auth)

**Extraction method**: DOM CSS selectors (`.results-container a[href*="/detail/"]` for discovery, `#listing-detail-data` and surrounding DOM for detail). Some embedded JSON in detail pages.

**ID strategy**: Numeric ID from detail URL. Stability MEDIUM.

**Vienna coverage**: MEDIUM — newspaper classifieds section, decent Vienna coverage but smaller inventory than dedicated portals.

**Field completeness**: MEDIUM — core fields (price, area, rooms, location) present. Extended fields vary.

**Fixtures**: Parser implemented, fixtures to be saved from live crawls.

---

### 5. findmyhome.at

| Field | Value |
|-------|-------|
| Code | `findmyhome` |
| Name | findmyhome.at |
| Base URL | https://www.findmyhome.at |
| Status | **ACTIVE** — expansion source |
| Parser version | 2 |

**Entry points**:
- Discovery: `/immobiliensuche?seite={N}&region={region}`
- Detail: `/{numericId}` (public, no auth)

**Extraction method**: DOM selectors for discovery (`h3.obj_list` cards with Bootstrap grid). JSON-LD `Apartment` schema for detail pages.

**ID strategy**: Numeric ID from detail URL path. Stability MEDIUM.

**Vienna coverage**: LOW-MEDIUM — smaller portal, focused on quality listings. Fewer total listings but potentially higher-quality entries.

**Field completeness**: MEDIUM — JSON-LD provides structured data for detail pages. Discovery cards have limited fields.

**Fixtures**: Parser implemented, fixtures to be saved from live crawls.

---

### 6. RE/MAX Austria

| Field | Value |
|-------|-------|
| Code | `remax` |
| Name | RE/MAX Austria |
| Base URL | https://www.remax.at |
| Status | **ACTIVE** — expansion source |
| Parser version | 2 |

**Entry points**:
- Discovery: `/de/immobilien/immobilien-suchen?page={N}&type={propertyType}&region={region}`
- Detail: `/de/immobilien/{slug}-{id}` (public, no auth)

**Extraction method**: DOM CSS selectors (`.property-card` for discovery, detail page DOM with JSON fallbacks).

**ID strategy**: Alphanumeric ID from detail URL. Stability MEDIUM — depends on slug format consistency.

**Vienna coverage**: MEDIUM — RE/MAX is a major brokerage with consistent Vienna presence.

**Field completeness**: MEDIUM — standard listing fields, images, contact info. Brokerage-sourced data tends to be well-structured.

**Fixtures**: Parser implemented, fixtures to be saved from live crawls.

---

### 7. openimmo.at (DISABLED)

| Field | Value |
|-------|-------|
| Code | `openimmo` |
| Name | openimmo.at |
| Base URL | https://www.openimmo.at |
| Status | **DISABLED** — site inaccessible as of 2026-03-21 |
| Parser version | 1 |

**Current state**: DNS resolves but web server returns ECONNREFUSED. Site appears to be offline. Synthetic fixtures only.

**Action**: Excluded from v1 scope. Re-evaluate if site comes back online.

---

## Source Onboarding Order

| Priority | Source | Rationale |
|----------|--------|-----------|
| 1 | willhaben | Richest JSON data, highest coverage, stable IDs, most fixtures |
| 2 | immoscout24 | JSON-LD structured data, high coverage, web-standard extraction |
| 3 | wohnnet | Open robots.txt, low anti-bot, decent coverage |
| 4 | derstandard | Newspaper classifieds, good supplement |
| 5 | findmyhome | Smaller but quality listings |
| 6 | remax | Brokerage listings, consistent data |
| — | openimmo | Deferred (offline) |
