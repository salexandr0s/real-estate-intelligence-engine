
# api.md

## 1. API style

Use a **REST API with OpenAPI** as the contract source.

Reasons:

- easy Swift client generation
- explicit pagination and sorting
- simpler operational profile than GraphQL
- stable fit for listing/search/filter workflows
- easy caching and observability

Base path:

```text
/v1
```

Media type:

```text
application/json
```

Authentication:

- bearer token for remote deployments
- localhost token or loopback auth for local single-user deployments

---

## 2. Design rules

1. **The API serves canonical data only.**
   - raw scraping artifacts are operational/debug resources, not default client payload.

2. **Cursor pagination only for large collections.**
   - no offset pagination for listing feeds.

3. **All filters are explicit query parameters or JSON bodies.**
   - no implicit magic defaults beyond `listing_status=active` in listing search.

4. **Stable enums and field names.**
   - do not expose source-specific field names in public responses.

5. **Explanation endpoints exist for score transparency.**

---

## 3. Authentication

## 3.1 Bearer auth
```http
Authorization: Bearer <token>
```

## 3.2 Token storage
- macOS app stores token in Keychain
- server validates token via local auth table, OIDC, or static service token in single-user mode

## 3.3 Roles
Recommended initial roles:

- `owner`
- `viewer`

Single-user deployments can seed one `owner`.

---

## 4. Common response envelope

A simple consistent shape helps the app.

### Success
```json
{
  "data": {},
  "meta": {}
}
```

### Error
```json
{
  "error": {
    "code": "validation_error",
    "message": "maxPriceEur must be greater than or equal to minPriceEur",
    "details": {
      "field": "maxPriceEur"
    }
  }
}
```

### Cursor meta
```json
{
  "data": [...],
  "meta": {
    "nextCursor": "eyJzY29yZSI6ODUuMiwiaWQiOjEyMzQ1fQ==",
    "pageSize": 50
  }
}
```

---

## 5. Resource model

Primary resources:

- `listings`
- `filters`
- `alerts`
- `sources`
- `scrape-runs`
- `analytics`

Supporting concepts:

- score explanations
- district baselines
- source health

---

## 6. Listings endpoints

## 6.1 Search listings

```http
GET /v1/listings
```

### Query parameters
- `status` default `active`
- `operationType`
- `propertyTypes` comma-separated
- `districts` comma-separated district numbers
- `postalCodes` comma-separated
- `minPriceEur`
- `maxPriceEur`
- `minAreaSqm`
- `maxAreaSqm`
- `minRooms`
- `maxRooms`
- `minScore`
- `requiredKeywords`
- `excludedKeywords`
- `sortBy` = `score_desc|newest|price_asc|price_desc|sqm_desc`
- `limit`
- `cursor`

### Example
```http
GET /v1/listings?operationType=sale&propertyTypes=apartment&districts=2,3&maxPriceEur=300000&minAreaSqm=50&minScore=70&sortBy=score_desc&limit=50
```

### Response example
```json
{
  "data": [
    {
      "id": 12345,
      "listingUid": "8c891f71-0cbc-4d9a-a3b8-a1af4fd5f2ea",
      "sourceCode": "source-a",
      "title": "3-Zimmer Eigentumswohnung",
      "canonicalUrl": "https://source.example/listing/12345",
      "operationType": "sale",
      "propertyType": "apartment",
      "city": "Wien",
      "postalCode": "1020",
      "districtNo": 2,
      "districtName": "Leopoldstadt",
      "listPriceEur": 299000,
      "livingAreaSqm": 58.4,
      "rooms": 3,
      "pricePerSqmEur": 5119.86,
      "currentScore": 85.2,
      "firstSeenAt": "2026-03-20T10:05:00Z"
    }
  ],
  "meta": {
    "nextCursor": "..."
  }
}
```

## 6.2 Get listing detail

```http
GET /v1/listings/{id}
```

### Response
Includes:

- all canonical fields
- current score
- history summary
- source metadata
- latest alert state for the current user
- selected explanation summary

## 6.3 Get score explanation

```http
GET /v1/listings/{id}/score-explanation
```

### Response
```json
{
  "data": {
    "scoreVersion": 1,
    "overallScore": 85.2,
    "districtPriceScore": 93,
    "undervaluationScore": 80,
    "keywordSignalScore": 68,
    "timeOnMarketScore": 90,
    "confidenceScore": 88,
    "districtBaselinePpsqmEur": 6050,
    "bucketBaselinePpsqmEur": 5700,
    "discountToDistrictPct": 0.1537,
    "discountToBucketPct": 0.1018,
    "matchedPositiveKeywords": ["provisionsfrei"],
    "matchedNegativeKeywords": [],
    "explanation": {}
  }
}
```

## 6.4 Get listing history

```http
GET /v1/listings/{id}/history
```

Response should include:

- historical prices
- status changes
- version timestamps
- score history summary

This is useful for investor review even if not shown on the first app screen.

---

## 7. Filter endpoints

## 7.1 List filters
```http
GET /v1/filters
```

## 7.2 Create filter
```http
POST /v1/filters
```

### Request body
```json
{
  "name": "Vienna value apartments",
  "filterKind": "alert",
  "operationType": "sale",
  "propertyTypes": ["apartment"],
  "districts": [2, 3],
  "maxPriceEur": 300000,
  "minAreaSqm": 50,
  "minScore": 70,
  "requiredKeywords": [],
  "excludedKeywords": ["baurecht", "unbefristet vermietet"],
  "sortBy": "score_desc",
  "alertFrequency": "instant",
  "alertChannels": ["in_app"]
}
```

## 7.3 Get filter
```http
GET /v1/filters/{id}
```

## 7.4 Update filter
```http
PATCH /v1/filters/{id}
```

## 7.5 Delete filter
```http
DELETE /v1/filters/{id}
```

Soft delete or disable is preferred over hard delete if alert history should remain understandable.

## 7.6 Test filter
```http
POST /v1/filters/{id}/test
```

### Response should include
- normalized/compiled filter summary
- estimated match count
- sample top matches
- warnings about contradictory or overly broad criteria

Example:
```json
{
  "data": {
    "compiledFilter": {
      "operationType": "sale",
      "propertyTypes": ["apartment"],
      "districts": [2, 3],
      "maxPriceEurCents": 30000000,
      "minAreaSqm": 50
    },
    "matchCountEstimate": 37,
    "sampleMatches": []
  }
}
```

---

## 8. Alerts endpoints

## 8.1 List alerts
```http
GET /v1/alerts
```

### Query params
- `status`
- `limit`
- `cursor`
- `sortBy` — `age | district | price`
- `sortDirection` — `asc | desc`

## 8.2 Mark alert state
```http
PATCH /v1/alerts/{id}
```

### Request body example
```json
{
  "status": "opened"
}
```

## 8.3 Get unread count
```http
GET /v1/alerts/unread-count
```

### Response
```json
{
  "data": {
    "unreadCount": 7
  }
}
```

## 8.4 Live alert stream
```http
GET /v1/stream/alerts
```

Use SSE initially. Event payload examples:

- `alert.created`
- `alert.updated`
- `source.health_changed`

---

## 9. Sources endpoints

## 9.1 List sources
```http
GET /v1/sources
```

Response should include:

- source code
- display name
- active flag
- health status
- last successful run
- crawl interval
- last error summary if degraded

## 9.2 Update source config (owner only)
```http
PATCH /v1/sources/{id}
```

Example uses:

- enable/disable source
- adjust crawl interval
- change priority
- pause source under block conditions

---

## 10. Scrape runs endpoints

## 10.1 List scrape runs
```http
GET /v1/scrape-runs
```

### Query params
- `sourceCode`
- `status`
- `scope`
- `limit`
- `cursor`

## 10.2 Get scrape run detail
```http
GET /v1/scrape-runs/{id}
```

Include:

- counters
- status
- timestamps
- error summary
- artifact references if available

## 10.3 Trigger manual run
```http
POST /v1/scrape-runs
```

### Request body
```json
{
  "sourceCode": "source-a",
  "scope": "full",
  "triggerType": "manual",
  "seedName": "vienna_priority_buy_apartments"
}
```

This is for operator use in the macOS app’s Sources screen.

---

## 11. Analytics endpoints

## 11.1 Get market baselines
```http
GET /v1/analytics/baselines
```

### Query params
- `city`
- `districtNo`
- `operationType`
- `propertyType`
- `areaBucket`
- `roomBucket`
- `date`

## 11.2 Get district summary
```http
GET /v1/analytics/districts/{districtNo}/summary
```

Suggested payload:

- active listing count
- median ppsqm
- p25/p75
- average score
- fresh listing count (<= 7 days)
- price-drop count (last 30 days)

## 11.3 Get score distribution
```http
GET /v1/analytics/scores/distribution
```

Useful for calibration and UI histograms.

---

## 12. DTO design notes

## 12.1 Money
Expose money to clients as whole euro values plus cents precision when needed.

Recommended pattern:

```json
{
  "listPriceEur": 299000,
  "listPriceEurCents": 29900000
}
```

For table views the app can use the euro value. For exact calculations it can use cents.

## 12.2 Districts
Expose both:

- `districtNo`
- `districtName`

Do not force the client to map district numbers to human labels.

## 12.3 Score explanation
Keep the structured explanation payload available even if the list view uses only the numeric score.

---

## 13. Sorting and pagination

Supported sorts:

- `score_desc`
- `newest`
- `price_asc`
- `price_desc`
- `sqm_desc`

Cursor must encode the sort key and `id`.

Examples:

- `score_desc` -> `(current_score, id)`
- `newest` -> `(first_seen_at, id)`
- `price_asc` -> `(list_price_eur_cents, id)`

Never use page number + offset for the main listings feed.

---

## 14. Error codes

Suggested stable codes:

- `validation_error`
- `not_found`
- `unauthorized`
- `forbidden`
- `conflict`
- `rate_limited`
- `source_disabled`
- `bad_request`
- `internal_error`

The macOS app should map these to user-friendly messages.

---

## 15. Versioning policy

- break API compatibility only under a new major version path
- additive fields are allowed in v1
- never silently repurpose field meaning
- keep `scoreVersion` explicit in score payloads

---

## 16. Recommendation for implementation

- define the OpenAPI spec first
- generate server/client types
- keep handlers thin
- keep search logic in dedicated service/repository layer
- use parameterized SQL or typed query builder
- expose explanation endpoints early so the app can remain transparent

This API should be a stable contract between the always-on backend and the native macOS experience.
