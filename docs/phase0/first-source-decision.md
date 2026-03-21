# First Source Decision

## Decision: willhaben.at

willhaben is the first source to take to production quality.

## Evaluation Matrix

| Criterion | willhaben | immoscout24 | wohnnet | derstandard | findmyhome | remax |
|-----------|-----------|-------------|---------|-------------|------------|-------|
| Public discovery pages | YES | YES | YES | YES | YES | YES |
| Public detail pages | YES | YES | YES | YES | YES | YES |
| Stable listing IDs | HIGH | HIGH | MEDIUM | MEDIUM | MEDIUM | MEDIUM |
| Structured data | `__NEXT_DATA__` JSON | JSON-LD | DOM only | DOM + JSON | JSON-LD | DOM only |
| Vienna coverage | HIGH | HIGH | MEDIUM | MEDIUM | LOW-MEDIUM | MEDIUM |
| Field completeness | HIGH | MEDIUM-HIGH | MEDIUM | MEDIUM | MEDIUM | MEDIUM |
| Anti-bot severity | MODERATE | MODERATE | LOW | MODERATE | LOW | UNKNOWN |
| Parser maturity | 3 fixtures, 9 tests | Implemented | Implemented | Implemented | Implemented | Implemented |
| robots.txt | Blocked (WAF) | Permissive | Fully open | Named bots blocked | Legacy paths only | Empty |

## Why willhaben

1. **Richest structured data** — `__NEXT_DATA__` JSON contains full listing attributes as structured objects, avoiding DOM selector fragility entirely
2. **Highest Vienna coverage** — largest Austrian classifieds portal with comprehensive apartment listings across all 23 districts
3. **Stable numeric IDs** — `advertDetails.id` provides persistent, predictable identifiers for deduplication
4. **Most mature parser** — 3 fixture types (discovery, detail, sold) with 9 passing tests
5. **Best field completeness** — coordinates, operating costs, free areas (balcony/terrace/garden), energy data consistently present

## Risks

- **Moderate anti-bot posture** — blocks automated HTTP clients, cookie banner required. Mitigated by: real Playwright browser, conservative rate (10 RPM), jittered delays (2–7s).
- **robots.txt unverifiable via automation** — requires manual browser check before first production crawl.

## Execution Order for Remaining Sources

| Order | Source | Rationale | When |
|-------|--------|-----------|------|
| 2nd | immoscout24 | JSON-LD extraction, high coverage | After willhaben stable (Phase 8) |
| 3rd | wohnnet | Open robots.txt, low anti-bot | After immoscout24 |
| 4th | derstandard | Newspaper classifieds, supplement | Expansion phase |
| 5th | findmyhome | Quality listings, smaller inventory | Expansion phase |
| 6th | remax | Brokerage listings, needs ToS review | Expansion phase |
| — | openimmo | Site offline, excluded from v1 | Re-evaluate when site returns |

## Pre-Production Checklist for willhaben

- [ ] Manually verify robots.txt in a real browser
- [ ] Review AGB/Nutzungsbedingungen for automation prohibitions
- [ ] Run canary crawl (1 page discovery + 3 detail pages) successfully
- [ ] Verify raw snapshot idempotency (duplicate run produces no new rows)
- [ ] Confirm failure artifacts captured on simulated error
- [ ] Set `legal_status = 'approved'` in database after compliance check passes
