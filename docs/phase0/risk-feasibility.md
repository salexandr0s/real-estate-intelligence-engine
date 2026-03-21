# Per-Source Risk & Feasibility Assessment

## Operating Principles

All sources are accessed under the following constraints:

- **Public pages only** — search result pages and public detail pages
- **No authentication** — no login, API keys, or behind-paywall content
- **Conservative rate limits** — 8–15 RPM per source, single concurrent connection
- **Real browser** — Playwright with honest Chromium user-agent
- **No CAPTCHA solving** — back off on detection
- **Cookie consent** — dismiss banner properly, never circumvent
- **Jittered delays** — 2–7 seconds between requests

---

## willhaben.at

### Technical Risk: LOW

| Factor | Rating | Notes |
|--------|--------|-------|
| DOM stability | LOW risk | Data from `__NEXT_DATA__` JSON, not CSS selectors |
| Anti-bot posture | MODERATE | Blocks automated HTTP clients (robots.txt unreachable via fetch). Cookie banner required. Light fingerprinting likely. |
| ID stability | HIGH | Numeric IDs from `advertDetails.id`, persistent |
| Cookie consent | Required | Banner must be dismissed before page renders fully |
| Pagination | Stable | Query params `?page=N&rows=25`, predictable |
| Incremental discovery | Yes | Sort by newest (`sort=1`) for fresh-first crawling |

### Legal / Compliance Risk: LOW-MODERATE

| Check | Finding |
|-------|---------|
| robots.txt | **Could not fetch** — site blocks automated HTTP clients. Anti-bot WAF intercepts non-browser requests. Manual browser check recommended before first production crawl. |
| Entry points | Public search and detail pages only. No authenticated endpoints. |
| Authentication | None required |
| Rate policy | 10 RPM, 1 concurrent, 2–7s jitter — conservative |

**Note**: The inability to fetch robots.txt via automated tools is itself evidence of anti-bot measures, not a legal blocker. The site serves public listings that are indexed by search engines. Manual verification of robots.txt in a real browser should be performed before the first production crawl.

### Feasibility: HIGH

Recommended as first source. Richest structured data of all candidates. `__NEXT_DATA__` extraction avoids DOM fragility. Three fixture types already saved and tested.

---

## ImmobilienScout24.at

### Technical Risk: LOW

| Factor | Rating | Notes |
|--------|--------|-------|
| DOM stability | LOW risk | JSON-LD structured data in `<script>` tags |
| Anti-bot posture | MODERATE | Similar to willhaben — may use fingerprinting |
| ID stability | HIGH | Numeric expose IDs in URL path |
| Cookie consent | Likely required | EU compliance banner expected |
| Pagination | Stable | Path-based: `/seite-{N}` |
| Incremental discovery | Likely | Sort options available |

### Legal / Compliance Risk: LOW

| Check | Finding |
|-------|---------|
| robots.txt | Only blocks `MJ12bot` and `AhrefsBot` from `/expose`. **No restrictions for general crawlers.** Our search path `/regional/wien/wien/immobilien` is fully allowed. Detail path `/expose/{id}` is allowed for `*` user-agent. |
| Crawl-delay | None specified |
| Entry points | Public search and detail pages only |
| Authentication | None required |
| Rate policy | 8 RPM, 1 concurrent, 2–7s jitter — most conservative |

### Feasibility: HIGH

Strong second source. JSON-LD extraction is a web standard, making the parser resilient. robots.txt is permissive for our use case.

---

## wohnnet.at

### Technical Risk: MEDIUM

| Factor | Rating | Notes |
|--------|--------|-------|
| DOM stability | MEDIUM risk | CSS selector-based extraction (`.realty-result`), vulnerable to redesigns |
| Anti-bot posture | LOW | robots.txt has no restrictions at all |
| ID stability | MEDIUM | Numeric IDs from URL, format may change on redesign |
| Cookie consent | Unknown | To be verified |
| Pagination | Stable | Query param `?seite=N` |
| Incremental discovery | Unknown | Sort options to be verified |

### Legal / Compliance Risk: VERY LOW

| Check | Finding |
|-------|---------|
| robots.txt | **Completely open.** `User-agent: *` with no Disallow rules. Sitemaps published. Contact: office@wohnnet.at. |
| Crawl-delay | None specified |
| Entry points | Public search and detail pages |
| Authentication | None required |
| Rate policy | 15 RPM, 1 concurrent, 2–7s jitter |

### Feasibility: HIGH

Most permissive robots.txt of all sources. Main risk is DOM-based extraction fragility, which requires selector maintenance on redesigns.

---

## derstandard.at Immobilien

### Technical Risk: MEDIUM

| Factor | Rating | Notes |
|--------|--------|-------|
| DOM stability | MEDIUM risk | CSS selector-based extraction |
| Anti-bot posture | MODERATE | Blocks 9 named bots entirely (Bytespider, Yandex, Ahrefs, Semrush, etc.) |
| ID stability | MEDIUM | Numeric IDs from URL path |
| Cookie consent | Likely required | Major Austrian media site, strict EU compliance |
| Pagination | Stable | Query param `?page=N` |

### Legal / Compliance Risk: LOW

| Check | Finding |
|-------|---------|
| robots.txt | Blocks 9 named SEO/scraper bots. For `*` (all others): **Allow `/`**. Only disallows internal API endpoints (`/immosearch/getsearchresultcount`, `/trackevent/settrackingevent`). Our search path `/immobiliensuche/i/kaufen/wohnung/wien` is explicitly allowed. |
| Crawl-delay | None specified |
| Entry points | Public search and detail pages |
| Authentication | None required |
| Rate policy | 12 RPM, 1 concurrent, 2–7s jitter |

### Feasibility: MEDIUM-HIGH

robots.txt is permissive for non-blacklisted bots. The named bot blocks suggest active monitoring — our conservative rate and real browser approach should avoid triggering. DOM-based extraction carries maintenance risk.

---

## findmyhome.at

### Technical Risk: MEDIUM

| Factor | Rating | Notes |
|--------|--------|-------|
| DOM stability | MEDIUM risk | Discovery uses DOM (`h3.obj_list`), detail uses JSON-LD |
| Anti-bot posture | LOW | Simple site, no evidence of aggressive measures |
| ID stability | MEDIUM | Numeric IDs from URL |
| Cookie consent | Likely minimal | Smaller site |
| Pagination | Stable | Query param `?seite=N` |

### Legal / Compliance Risk: LOW

| Check | Finding |
|-------|---------|
| robots.txt | Disallows legacy/internal paths only: `/languages/`, `/selfmade/`, `/templates/`, `/immobilien.php/`, `/eigentum.php/`, `/eigentum/`, `/Laurenz/`, `/service/`, `/functions/`, print/PDF generation. **Our search path `/immobiliensuche` is NOT disallowed.** Detail pages are allowed. |
| Sitemap | Published at `/smaps/sitemap.xml` |
| Crawl-delay | None specified |
| Entry points | Public search and detail pages |
| Rate policy | 15 RPM, 1 concurrent, 2–7s jitter |

### Feasibility: MEDIUM

Smaller inventory but clean compliance profile. JSON-LD on detail pages is a strength. Discovery DOM parsing adds maintenance overhead.

---

## RE/MAX Austria

### Technical Risk: MEDIUM

| Factor | Rating | Notes |
|--------|--------|-------|
| DOM stability | MEDIUM risk | CSS selector-based (`.property-card`) |
| Anti-bot posture | UNKNOWN | robots.txt returned empty/unreachable |
| ID stability | MEDIUM | Alphanumeric IDs from URL slugs |
| Cookie consent | Likely required | Professional brokerage site |
| Pagination | Stable | Query param `?page=N` |

### Legal / Compliance Risk: MODERATE (INCOMPLETE)

| Check | Finding |
|-------|---------|
| robots.txt | **Could not retrieve** — empty response. Either no robots.txt exists or the server blocks non-browser requests. Manual verification required. |
| Entry points | Public search and detail pages |
| Authentication | None required |
| Rate policy | 10 RPM, 1 concurrent, 2–7s jitter |

**Note**: Absence of robots.txt is not a prohibition — it implies default allow. However, brokerage sites may have ToS restrictions on automated data collection. Manual review of remax.at AGB recommended.

### Feasibility: MEDIUM

Brokerage data is typically well-structured. Unknown compliance profile is the main risk factor — manual ToS review needed before enabling.

---

## openimmo.at (DISABLED)

### Technical Risk: NOT ASSESSABLE

Site is offline as of 2026-03-21. DNS resolves to 217.160.0.8 (IONOS hosting) but ECONNREFUSED on HTTP.

### Legal / Compliance Risk: NOT ASSESSABLE

Cannot check robots.txt or ToS.

### Feasibility: INFEASIBLE (for v1)

Excluded from v1 scope. Re-evaluate if site comes back online.

---

## Summary Matrix

| Source | Technical Risk | Legal Risk | Feasibility | robots.txt Status |
|--------|---------------|------------|-------------|-------------------|
| willhaben | LOW | LOW-MODERATE | **HIGH** | Blocked (WAF) — manual check needed |
| immoscout24 | LOW | LOW | **HIGH** | Permissive — no general restrictions |
| wohnnet | MEDIUM | VERY LOW | **HIGH** | Fully open |
| derstandard | MEDIUM | LOW | **MEDIUM-HIGH** | Named bots blocked; `*` allowed |
| findmyhome | MEDIUM | LOW | **MEDIUM** | Legacy paths blocked only |
| remax | MEDIUM | MODERATE | **MEDIUM** | Empty/unreachable — manual check needed |
| openimmo | N/A | N/A | **INFEASIBLE** | Offline |

## Open Actions

1. **willhaben**: Manually verify robots.txt in a real browser before first production crawl
2. **remax**: Manually verify robots.txt and review AGB/ToS before enabling
3. **All sources**: Review Impressum/AGB pages for explicit automation prohibitions (deferred to source onboarding phase)
