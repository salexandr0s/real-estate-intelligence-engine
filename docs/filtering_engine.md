
# filtering_engine.md

## 1. Purpose

The filtering engine supports two distinct but related use cases:

1. **interactive search** in the macOS app
2. **background reverse matching** for alerts when a new or changed listing arrives

These should share the same filter semantics, but they do not have to use the same execution path.

---

## 2. Core design

## 2.1 Store filters twice: JSON + flattened columns

`user_filters` should keep:

- `criteria_json` — exact logical representation for portability and future extension
- flattened typed columns — for efficient SQL matching now

This gives:

- a stable app/backend contract
- easy future evolution
- performant SQL without JSON parsing on every request

### Example persisted filter

```json
{
  "operationType": "sale",
  "propertyTypes": ["apartment"],
  "districts": [2, 3],
  "maxPriceEur": 300000,
  "minLivingAreaSqm": 50,
  "minScore": 70,
  "includeKeywords": ["altbau"],
  "excludeKeywords": ["befristet", "baurecht"],
  "sortBy": "score_desc",
  "alertFrequency": "instant"
}
```

Flattened representation:

- `operation_type = 'sale'`
- `property_types = ['apartment']`
- `districts = [2,3]`
- `max_price_eur_cents = 30000000`
- `min_area_sqm = 50`
- `min_score = 70`

---

## 3. Filter semantics

## 3.1 Base dimensions
The engine must support at minimum:

- `operation_type`
- `property_types`
- `districts`
- `postal_codes`
- `min_price_eur_cents`
- `max_price_eur_cents`
- `min_area_sqm`
- `max_area_sqm`
- `min_rooms`
- `max_rooms`
- `min_score`
- `required_keywords`
- `excluded_keywords`

## 3.2 Null semantics
A null bound means “no constraint”.

Examples:

- `max_price_eur_cents = NULL` -> no maximum price
- `districts = []` -> any district
- `property_types = []` -> any property type

## 3.3 Keyword semantics
There are two kinds of keyword logic:

### Required keywords
Listing must match at least one or all configured required keywords.

Recommended v1 behavior:

- `required_keywords` means **any-of**
- if exact all-of is later needed, add explicit mode field

### Excluded keywords
Listing is rejected if any excluded keyword appears in title or description.

---

## 4. Query compilation

## 4.1 Why compile, not interpret ad hoc
Do not build query strings by hand in controllers.

Instead:

1. validate filter DTO
2. normalize values
3. compile to a typed internal query object
4. generate parameterized SQL from that object

### Internal compiled filter example

```ts
type CompiledFilter = {
  operationType?: "sale" | "rent";
  propertyTypes?: string[];
  districts?: number[];
  postalCodes?: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  minAreaSqm?: number;
  maxAreaSqm?: number;
  minRooms?: number;
  maxRooms?: number;
  minScore?: number;
  requiredKeywords?: string[];
  excludedKeywords?: string[];
  sortBy: "score_desc" | "newest" | "price_asc" | "price_desc" | "sqm_desc";
};
```

---

## 5. Interactive search path

The interactive path is listing-centric:

- query the `listings` table
- apply SARGable predicates
- join only when necessary
- use cursor pagination, not offset pagination
- sort by indexed columns where possible

## 5.1 Base interactive query

```sql
SELECT
  l.id,
  l.listing_uid,
  l.canonical_url,
  l.title,
  l.city,
  l.postal_code,
  l.district_no,
  l.property_type,
  l.list_price_eur_cents,
  l.living_area_sqm,
  l.rooms,
  l.price_per_sqm_eur,
  l.current_score,
  l.first_seen_at
FROM listings l
WHERE l.listing_status = 'active'
  AND ($1::text IS NULL OR l.operation_type = $1)
  AND (COALESCE(array_length($2::text[], 1), 0) = 0 OR l.property_type = ANY($2))
  AND (COALESCE(array_length($3::smallint[], 1), 0) = 0 OR l.district_no = ANY($3))
  AND ($4::bigint IS NULL OR l.list_price_eur_cents >= $4)
  AND ($5::bigint IS NULL OR l.list_price_eur_cents <= $5)
  AND ($6::numeric IS NULL OR l.living_area_sqm >= $6)
  AND ($7::numeric IS NULL OR l.living_area_sqm <= $7)
  AND ($8::numeric IS NULL OR l.rooms >= $8)
  AND ($9::numeric IS NULL OR l.rooms <= $9)
  AND ($10::numeric IS NULL OR l.current_score >= $10)
ORDER BY l.current_score DESC, l.first_seen_at DESC, l.id DESC
LIMIT $11;
```

### Example for Vienna purchase criteria

```sql
SELECT
  l.id,
  l.title,
  l.district_no,
  l.list_price_eur_cents,
  l.living_area_sqm,
  l.current_score
FROM listings l
WHERE l.listing_status = 'active'
  AND l.operation_type = 'sale'
  AND l.property_type = 'apartment'
  AND l.district_no = ANY(ARRAY[2, 3]::smallint[])
  AND l.list_price_eur_cents <= 30000000
  AND l.living_area_sqm >= 50
ORDER BY l.current_score DESC, l.first_seen_at DESC, l.id DESC
LIMIT 100;
```

---

## 6. Keyword filtering

## 6.1 Search vector strategy
Use the generated `search_vector` for broad text search. For filter keywords, use either:

- `search_vector @@ plainto_tsquery('german', ...)`
- or explicit `ILIKE` only for small/simple cases

Recommended v1:

- `search_vector` for required keywords
- exclusion still validated via text search or a derived lexeme list

### Example: required keyword
```sql
AND (
  COALESCE(array_length($12::text[], 1), 0) = 0
  OR l.search_vector @@ websearch_to_tsquery(
       'german',
       array_to_string($12::text[], ' OR ')
     )
)
```

### Example: excluded keyword
For excluded keywords, prefer a precompiled lexeme array or a generated search query. For simplicity in v1:

```sql
AND NOT (
  COALESCE(array_length($13::text[], 1), 0) > 0
  AND l.search_vector @@ websearch_to_tsquery(
        'german',
        array_to_string($13::text[], ' OR ')
      )
)
```

Be careful with stemming and phrase behavior. For critical negative keywords like `baurecht`, supplement with exact token checks in the scoring/validation layer if necessary.

---

## 7. Reverse-match path for alerts

Interactive search asks:

> “Which listings match this filter?”

Alerting asks:

> “Which filters match this listing?”

These are not the same access pattern.

## 7.1 Reverse-match query
When a new or changed listing arrives, find candidate filters with one SQL query.

```sql
SELECT uf.id, uf.user_id
FROM user_filters uf
WHERE uf.is_active = TRUE
  AND (uf.operation_type IS NULL OR uf.operation_type = $1)
  AND (COALESCE(array_length(uf.property_types, 1), 0) = 0 OR $2 = ANY(uf.property_types))
  AND (COALESCE(array_length(uf.districts, 1), 0) = 0 OR $3 = ANY(uf.districts))
  AND (uf.min_price_eur_cents IS NULL OR uf.min_price_eur_cents <= $4)
  AND (uf.max_price_eur_cents IS NULL OR uf.max_price_eur_cents >= $4)
  AND (uf.min_area_sqm IS NULL OR uf.min_area_sqm <= $5)
  AND (uf.max_area_sqm IS NULL OR uf.max_area_sqm >= $5)
  AND (uf.min_rooms IS NULL OR uf.min_rooms <= $6)
  AND (uf.max_rooms IS NULL OR uf.max_rooms >= $6)
  AND (uf.min_score IS NULL OR uf.min_score <= $7);
```

Parameters:

1. listing operation type
2. listing property type
3. listing district
4. listing price
5. listing living area
6. listing rooms
7. listing score

### 7.2 Two-step reverse matching
For scale and clarity, use a two-step approach:

1. **DB candidate filter selection** using typed columns
2. **application-side keyword check and final rule evaluation**

This keeps SQL fast while allowing more nuanced logic.

---

## 8. Filter storage model

## 8.1 Why not JSON-only
JSON-only filter storage is convenient but slow and brittle for production matching.

Problems:

- hard to index effectively for every predicate
- ugly SQL
- easy to introduce inconsistent semantics
- expensive reverse matching

## 8.2 Why not columns-only
Columns-only storage becomes rigid as filter features evolve.

Problems:

- hard to preserve the original contract
- brittle migrations for new optional logic
- harder to version

## 8.3 Recommended hybrid
Use both:

- JSON for contract fidelity and future evolution
- columns for performance and reverse matching

---

## 9. Performance considerations

## 9.1 Make predicates SARGable
Avoid wrapping indexed columns in functions inside `WHERE`.

Good:

```sql
l.list_price_eur_cents <= $1
```

Bad:

```sql
COALESCE(l.list_price_eur_cents, 999999999) <= $1
```

Good:

```sql
l.district_no = ANY($1)
```

Bad:

```sql
CAST(l.district_no AS TEXT) = ANY($1)
```

## 9.2 Query only active listings by default
Most UI and alert flows only care about active listings.

Use partial indexes on:

- active listing filters
- active listing sort paths

## 9.3 Use cursor pagination
Do not use `OFFSET` for large listing tables.

Recommended cursor:

- primary sort column
- `id` as tie-breaker

Example for `score_desc`:

```sql
AND (
  $cursor_score IS NULL
  OR (l.current_score, l.id) < ($cursor_score, $cursor_id)
)
ORDER BY l.current_score DESC, l.id DESC
LIMIT 100
```

## 9.4 Avoid joining score history for list views
Persist `listings.current_score` so common searches do not need to join `listing_scores`.

## 9.5 Keep reverse matching cheap
Reverse matching should operate on the changed listing only, not re-scan the full listing table.

---

## 10. Suggested indexes and why

The schema should already include these important paths.

### Listings
- active filter composite index
- district + price partial index
- district + area partial index
- score + first_seen partial index
- GIN index on `search_vector`

### User filters
- active core btree index
- GIN index on districts
- GIN index on property types
- GIN index on required keywords

### Alerts
- user/status/scheduled index
- filter/matched_at index
- listing/matched_at index

---

## 11. Filter validation rules

Validate before persistence.

### Price
- min <= max
- values must be non-negative
- normalize EUR -> cents once

### Area
- min <= max
- values must be positive if present

### Districts
- dedupe
- sort
- allow only supported values
- Vienna district filters should use district numbers rather than free-text names

### Property types
- allow only canonical values

### Keywords
- trim
- lowercase for matching
- dedupe
- reject empty strings

---

## 12. Filter evaluation order

When matching a listing against a filter:

1. status must be `active`
2. operation type
3. property type
4. district/postal constraints
5. price bounds
6. area bounds
7. room bounds
8. score threshold
9. keyword include/exclude
10. sort only after filtering

This short-circuits cheaply and consistently.

---

## 13. Alert dedupe and suppression

## 13.1 Dedupe key
Build a deterministic dedupe key such as:

```text
filter:{filter_id}:listing:{listing_id}:alert_type:{alert_type}:score_version:{score_version}
```

This prevents repeated alerts for the same event.

## 13.2 When to create a new alert
Create a new alert when:

- a listing matches a filter for the first time
- a matched listing drops price materially
- a matched listing score crosses a configured threshold
- a previously inactive listing reactivates and still matches

## 13.3 When not to create a new alert
Do not create a new alert when:

- only `last_seen_at` changed
- score changed but not enough to matter
- listing remains matched with no user-visible change
- duplicate raw snapshot was merely re-observed

---

## 14. API contract recommendation

Expose filter endpoints roughly as:

- `GET /v1/filters`
- `POST /v1/filters`
- `GET /v1/filters/:id`
- `PATCH /v1/filters/:id`
- `DELETE /v1/filters/:id`
- `POST /v1/filters/:id/test`
- `GET /v1/listings?...query params...`

### `POST /filters/:id/test`
This endpoint should return:

- compiled filter summary
- first page of matches
- total match count estimate
- warnings if criteria are too broad or too narrow

This is excellent UX for investor workflows.

---

## 15. Example: full SQL for target investor use case

### Business rule
- buy only
- apartments only
- 1020 or 1030
- price <= 300,000 EUR
- size >= 50 m²
- score >= 70
- newest high-score listings first

### SQL
```sql
SELECT
  l.id,
  l.title,
  l.district_no,
  l.list_price_eur_cents / 100.0 AS price_eur,
  l.living_area_sqm,
  l.price_per_sqm_eur,
  l.current_score,
  l.first_seen_at
FROM listings l
WHERE l.listing_status = 'active'
  AND l.operation_type = 'sale'
  AND l.property_type = 'apartment'
  AND l.district_no = ANY (ARRAY[2, 3]::smallint[])
  AND l.list_price_eur_cents <= 30000000
  AND l.living_area_sqm >= 50
  AND l.current_score >= 70
ORDER BY l.current_score DESC, l.first_seen_at DESC, l.id DESC
LIMIT 50;
```

---

## 16. Scaling path

The initial SQL approach is enough for one investor or a modest number of users.

If active filters grow into the tens of thousands or more, scale in this order:

1. keep DB candidate selection
2. partition reverse matching by operation/property type
3. cache active filters in worker memory
4. add in-memory inverted indexes for district/property type
5. keep final write path in PostgreSQL

Do **not** introduce search engines or rule engines prematurely.

---

## 17. Final recommendation

Implement filtering as a **hybrid typed rule engine on top of PostgreSQL**:

- filters stored as JSON + flattened columns
- interactive search runs against `listings`
- reverse matching runs against `user_filters`
- keyword logic handled carefully
- cursor pagination and partial indexes keep queries fast

That is the right balance of performance, maintainability, and extensibility.
