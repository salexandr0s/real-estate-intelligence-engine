
# agents.md

## SYSTEM INSTRUCTION FILE FOR CODING AGENTS

This repository contains a production system for real-estate intelligence, not a demo app.

Every change must preserve the following non-negotiable rules.

---

## 1. Non-negotiable rules

1. **Do not merge scraping and normalization logic.**
   - Scrapers output source-shaped raw DTOs only.
   - Canonical mapping happens in the normalization layer only.

2. **Do not write directly from a scraper into canonical listing tables.**
   - Scrapers write to `scrape_runs`, `raw_listings`, and raw artifacts only.

3. **Every source must be isolated.**
   - No shared selectors.
   - No source-specific branching in unrelated modules.

4. **Raw data preservation is mandatory.**
   - Never discard raw payloads because “the normalized data is enough”.
   - If a parser fails, preserve the raw snapshot and diagnostics.

5. **Idempotency is mandatory.**
   - Re-running a crawl must not create duplicate canonical listings.
   - Re-normalizing the same raw snapshot must not create duplicate versions.
   - Re-sending alerts for the same event must be prevented by dedupe keys.

6. **Strong typing is mandatory.**
   - TypeScript `strict` mode on.
   - No `any` in production paths.
   - Public DTOs must be validated.

7. **Explainability beats hidden magic.**
   - Scores must be decomposable.
   - Filters must be inspectable.
   - Normalization must expose warnings and provenance.

8. **The macOS app is a client, not the ingestion engine.**
   - Do not move core backend logic into the app layer.

9. **No silent fallback behavior for critical data.**
   - If district inference is weak, store `NULL` + warning.
   - If price is non-numeric, store `NULL`, not zero.

10. **Never optimize prematurely by introducing new infrastructure without need.**
    - PostgreSQL + Redis + object storage are the baseline.
    - Add search engines or streaming platforms only with a written reason.

---

## 2. Coding standards

## 2.1 TypeScript backend
- `strict: true`
- exhaustive `switch` handling
- prefer discriminated unions for job/result state
- validate inbound DTOs with Zod or equivalent
- return typed result objects instead of throwing for expected domain failures
- centralize error classes
- parameterized SQL only
- no ORM-generated “magic” queries for performance-critical search paths

## 2.2 SQL
- migrations must be forward-applied and reviewed
- add indexes with every new search path
- no schema change without an explanation of read/write impact
- avoid function-wrapped predicates on indexed columns
- do not use `OFFSET` pagination on large tables
- preserve immutable history where intended

## 2.3 Swift
- no business logic in SwiftUI views
- networking code lives in service/repository layer
- use generated API types when possible
- store secrets/tokens in Keychain
- keep native UX first; do not recreate a web app inside Swift

## 2.4 Logging
- structured logs only
- include correlation identifiers
- never log secrets
- never dump full raw HTML to standard logs
- large debug artifacts belong in object storage

---

## 3. Data handling rules

## 3.1 Raw data
- raw payload is the audit source
- preserve parser version on raw capture
- preserve response status and headers when relevant
- keep artifact pointers stable

## 3.2 Canonical data
- canonical fields must be deterministic from raw + normalization version
- derived fields must be reproducible
- `content_fingerprint` must only include business-relevant fields

## 3.3 History
- `listing_versions` is immutable
- do not update historical normalized snapshots in place
- append a new version when business-relevant content changes

## 3.4 Scoring
- scoring logic must be versioned
- weights and breakpoints must be explicit constants or config
- store explanation payloads
- do not hide negative keyword penalties

## 3.5 Filters
- persist both JSON criteria and flattened columns
- keep filter semantics stable across UI/API/background matching
- reject invalid ranges before persistence

## 3.6 Alerts
- every alert requires a deterministic dedupe key
- alert rows are stateful records, not ephemeral messages
- do not notify users based on duplicate raw observations alone

---

## 4. Required architecture boundaries

### 4.1 Scraper core
Owns:
- Playwright runtime
- request plans
- retries
- rate limiting
- browser context handling
- raw DTO extraction

Does not own:
- district inference
- canonical price parsing policy
- scoring
- user filters

### 4.2 Source package
Owns:
- selectors
- cookie flow for that source
- source DTOs
- pagination logic
- source key derivation

Does not own:
- shared queue logic
- canonical schema
- API contracts

### 4.3 Normalization package
Owns:
- canonical DTO
- source mapper modules
- district normalization
- field coercion
- versioning decision helpers

Does not own:
- browser behavior
- alert delivery

### 4.4 Scoring package
Owns:
- baseline lookup
- scoring formula
- keyword lexicon
- explanation payload

Does not own:
- listing persistence aside from score writes
- filter persistence

### 4.5 API package
Owns:
- OpenAPI contract
- auth
- request validation
- read models
- mutation endpoints

Does not own:
- direct scraper execution logic

---

## 5. Anti-patterns to avoid

1. **Putting CSS selectors in generic utility modules**
2. **Parsing canonical fields inside Playwright page objects**
3. **Embedding SQL strings inside Swift views**
4. **Using floating-point for money**
5. **Using text search without indexes**
6. **Relying on offset pagination**
7. **Treating missing fields as zero/false by default**
8. **Changing score logic without bumping score version**
9. **Storing only current listing state with no history**
10. **Silently swallowing scraper failures**
11. **Retrying blocked pages aggressively**
12. **Using a single “misc JSON blob” instead of typed columns for important filters**
13. **Adding source 2 before source 1 is stable**
14. **Introducing cross-source dedupe before source-local correctness is proven**
15. **Letting the desktop app be the only always-on execution environment**

---

## 6. Expectations for extensibility

When adding a new feature, ask:

- does this belong in core, source, normalization, scoring, API, or app?
- is the change source-agnostic or source-specific?
- can this be versioned?
- can this be replayed from raw/history later?
- will this still work when source 2 and source 3 are added?

### New source expectation
A new source should require mostly:

- one new source package
- one new source mapper
- tests
- configuration

It should **not** require rewriting the schema or app.

### New filter expectation
A new filter type should require:

- criteria contract extension
- validation
- flattened column or explicit decision not to flatten
- matching logic
- index review
- UI editor support

### New score feature expectation
A new score feature should require:

- feature definition
- explanation field
- score version bump
- replay plan
- regression examples

---

## 7. Testing expectations

## 7.1 Minimum for scraper changes
- unit tests for URL/key logic
- fixture tests for parser behavior
- at least one unavailable/challenge fixture
- no live-only testing as the sole proof of correctness

## 7.2 Minimum for normalization changes
- deterministic fixture-based mapping tests
- malformed/missing field tests
- district inference tests
- idempotency test

## 7.3 Minimum for filter changes
- validation tests
- SQL generation tests
- reverse-match tests
- performance/index review for new predicates

## 7.4 Minimum for scoring changes
- score regression tests on representative listings
- explanation payload tests
- version bump test
- baseline fallback tests

## 7.5 Minimum for Swift changes
- view model tests
- API decoding tests
- local cache behavior tests for critical flows

---

## 8. Performance expectations

- design every query with an index path in mind
- optimize for `listing_status = 'active'` as the hot path
- keep list views on current-state tables
- keep heavy raw payloads out of hot interactive read paths
- avoid N+1 queries in API handlers
- persist `listings.current_score` for common sort paths
- use cursor pagination for large result sets

---

## 9. Operational expectations

- every background job has a clear retry policy
- every failure class is visible in logs/metrics
- sources can be disabled independently
- canary runs must exist for each enabled source
- backup restore must be testable
- a source health regression must not stay silent

---

## 10. Security and secrets

- secrets never belong in the repo
- use environment variables or secret manager
- store app tokens in Keychain
- encrypt object storage where supported
- do not expose raw artifacts publicly
- never log authorization headers or cookies

---

## 11. Change-management rules

Before merging a change, the agent must answer:

1. which layer owns this change?
2. what data shape changes?
3. what migration or version bump is needed?
4. what indexes are affected?
5. what replay/backfill is needed?
6. what tests prove it works?
7. how can it fail in production?
8. what metrics/logs show that failure?

If those answers are not clear, the change is not ready.

---

## 12. Definition of good code in this repo

Good code in this repo is:

- deterministic
- typed
- replayable
- source-isolated
- observable
- index-aware
- idempotent
- easy to debug
- hard to misuse

If a change makes the system more clever but less traceable, reject it.
