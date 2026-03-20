
# scoring_engine.md

## 1. Goal

The scoring engine ranks listings on a **0–100 opportunity scale** so the investor can prioritize review order.

The score is not a valuation model. It is a **decision-support ranking** that answers:

> “Which listings look unusually attractive for my investment thesis right now?”

The score must be:

- explainable
- reproducible
- versioned
- replayable
- resistant to outliers
- usable with imperfect scraped data

---

## 2. Design principles

1. **Explainability over black-box cleverness**
   - Every score must be decomposable into sub-scores and evidence.

2. **Market-relative, not absolute**
   - A 300k apartment may be cheap in one district and expensive in another.
   - Compare the listing to relevant district / bucket baselines.

3. **Opportunity and risk both matter**
   - `sanierungsbedürftig` can be opportunity or risk depending on discount.
   - Time on market can indicate hidden problems, not only freshness.

4. **Confidence matters**
   - A missing area or ambiguous district should lower trust in the score.

5. **Version the formula**
   - `score_version` must be stored so historical scores can be reproduced after rule changes.

---

## 3. Inputs

The scoring engine consumes:

- canonical listing current state from `listings`
- immutable snapshot from `listing_versions`
- market baselines from `market_baselines`
- source health / reliability context
- keyword lexicons
- historical listing observations for time-on-market and price-change context

Required fields for meaningful scoring:

- `property_type`
- `operation_type`
- `city`
- `district_no` or a reliable fallback
- `list_price_eur_cents`
- effective area (`living_area_sqm` or `usable_area_sqm`)

If these are missing, the engine should still emit a score, but confidence must be lower.

---

## 4. Score composition

Recommended overall formula:

```text
overall_score =
  0.40 * district_price_score +
  0.25 * undervaluation_score +
  0.15 * keyword_signal_score +
  0.10 * time_on_market_score +
  0.10 * confidence_score
```

Each component is normalized to `0..100`.

Final result:

```text
overall_score = round(clamp(0, 100, overall_score), 2)
```

### Why these weights

- **district_price_score (40%)**: the biggest signal; coarse market mispricing matters most
- **undervaluation_score (25%)**: confirms whether the listing also looks cheap in a tighter peer group
- **keyword_signal_score (15%)**: useful, but text is noisy
- **time_on_market_score (10%)**: helps surface freshness and stale traps
- **confidence_score (10%)**: prevents over-trusting weak data

---

## 5. Baseline computation

## 5.1 Baseline sources
Use rolling market snapshots derived from your own normalized listings.

For v1, the baseline is based on **asking prices**, not closed transaction prices.

That is acceptable for ranking relative opportunities inside the same scraped market, but the system should clearly label it as an **ask-price baseline**.

## 5.2 Baseline windows
Recommended default window:

- trailing 90 days of observed active listings
- keep only latest active version per listing within the window
- optionally include recently inactive listings for stability if they were active during the window

## 5.3 Outlier clipping
Before computing medians:

- calculate p05 and p95 within the baseline cohort
- exclude observations outside that band
- require a minimum sample size after clipping

This prevents obviously distorted medians.

## 5.4 Baseline buckets
Compute baselines by:

- `district_no`
- `operation_type`
- `property_type`
- `area_bucket`
- `room_bucket`

### Suggested area buckets
- `<40`
- `40-49.99`
- `50-59.99`
- `60-79.99`
- `80-99.99`
- `100-149.99`
- `150+`

### Suggested room buckets
- `1`
- `2`
- `3`
- `4`
- `5+`
- `unknown`

## 5.5 Fallback hierarchy
Use the strictest valid cohort first, then fall back.

1. `district + property_type + area_bucket + room_bucket`
2. `district + property_type + area_bucket`
3. `district + property_type`
4. `city + property_type + area_bucket`
5. `city + property_type`

Every fallback step should reduce confidence.

---

## 6. Example SQL for baseline creation

```sql
WITH base AS (
  SELECT
    l.id,
    l.city,
    l.district_no,
    l.operation_type,
    l.property_type,
    CASE
      WHEN l.living_area_sqm < 40 THEN '<40'
      WHEN l.living_area_sqm < 50 THEN '40-49.99'
      WHEN l.living_area_sqm < 60 THEN '50-59.99'
      WHEN l.living_area_sqm < 80 THEN '60-79.99'
      WHEN l.living_area_sqm < 100 THEN '80-99.99'
      WHEN l.living_area_sqm < 150 THEN '100-149.99'
      ELSE '150+'
    END AS area_bucket,
    CASE
      WHEN l.rooms IS NULL THEN 'unknown'
      WHEN l.rooms < 1.5 THEN '1'
      WHEN l.rooms < 2.5 THEN '2'
      WHEN l.rooms < 3.5 THEN '3'
      WHEN l.rooms < 4.5 THEN '4'
      ELSE '5+'
    END AS room_bucket,
    l.price_per_sqm_eur
  FROM listings l
  WHERE l.listing_status = 'active'
    AND l.city IN ('Wien', 'Vienna')
    AND l.price_per_sqm_eur IS NOT NULL
    AND l.last_seen_at >= NOW() - INTERVAL '90 days'
),
banded AS (
  SELECT
    b.*,
    percentile_cont(0.05) WITHIN GROUP (ORDER BY price_per_sqm_eur)
      OVER (PARTITION BY district_no, operation_type, property_type, area_bucket, room_bucket) AS p05,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY price_per_sqm_eur)
      OVER (PARTITION BY district_no, operation_type, property_type, area_bucket, room_bucket) AS p95
  FROM base b
)
SELECT
  CURRENT_DATE AS baseline_date,
  city,
  district_no,
  operation_type,
  property_type,
  area_bucket,
  room_bucket,
  COUNT(*) AS sample_size,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_sqm_eur) AS median_ppsqm_eur,
  AVG(price_per_sqm_eur) AS trimmed_mean_ppsqm_eur,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY price_per_sqm_eur) AS p25_ppsqm_eur,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY price_per_sqm_eur) AS p75_ppsqm_eur,
  stddev_pop(price_per_sqm_eur) AS stddev_ppsqm_eur
FROM banded
WHERE price_per_sqm_eur BETWEEN p05 AND p95
GROUP BY city, district_no, operation_type, property_type, area_bucket, room_bucket;
```

---

## 7. Component 1 — price_per_m² vs district average

## 7.1 Definition

```text
district_discount_pct =
  (district_baseline_ppsqm - listing_ppsqm) / district_baseline_ppsqm
```

Positive values mean the listing is cheaper than the district baseline.

### Example
- district baseline: `€6,100 / m²`
- listing: `€5,200 / m²`
- discount = `(6100 - 5200) / 6100 = 14.75%`

## 7.2 Mapping to score

Use piecewise linear scoring:

| Discount vs district baseline | district_price_score |
|---:|---:|
| 20% or more below baseline | 100 |
| 15% below baseline | 92 |
| 10% below baseline | 80 |
| 5% below baseline | 65 |
| at baseline | 40 |
| 5% above baseline | 20 |
| 15% above baseline or worse | 0 |

Interpolate linearly between breakpoints.

### Why the score is 40 at baseline, not 50
A listing exactly at the district baseline is not a clear “deal”. It should remain viable, but not preferred.

---

## 8. Component 2 — undervaluation detection

District averages are coarse. This component asks:

> “Is the listing also cheap relative to more similar peer listings?”

## 8.1 Definition

```text
bucket_discount_pct =
  (bucket_baseline_ppsqm - listing_ppsqm) / bucket_baseline_ppsqm
```

Where the bucket baseline uses:

- same district if possible
- same property type
- similar area bucket
- similar room bucket

## 8.2 Mapping to score

| Discount vs bucket baseline | undervaluation_score_base |
|---:|---:|
| 15% or more below | 100 |
| 10% below | 80 |
| 5% below | 60 |
| at baseline | 35 |
| 5% above | 15 |
| 10% above or worse | 0 |

Interpolate linearly.

## 8.3 Sample-size confidence factor
Apply a confidence multiplier based on bucket sample size.

| Sample size | multiplier |
|---:|---:|
| 20+ | 1.00 |
| 10–19 | 0.85 |
| 5–9 | 0.65 |
| <5 | use fallback cohort |

Then:

```text
undervaluation_score = undervaluation_score_base * sample_multiplier
```

## 8.4 Why separate this from district score
A district can contain wide variation:

- micro-locations
- top floor / garden differences
- large vs small units
- luxury vs basic finish

A listing that is cheap vs district, but not cheap vs comparable units, is less interesting.

---

## 9. Component 3 — keyword signals

This component turns title/description text into structured signals.

The goal is not generic sentiment. The goal is **investment relevance**.

## 9.1 Categories

### Positive quality keywords
These suggest desirable attributes with limited downside.

Examples:

- `provisionsfrei`
- `hofruhelage`
- `u-bahn-nähe`
- `lift`
- `balkon`
- `terrasse`
- `saniert`
- `renoviert`
- `hell`
- `gute raumaufteilung`

### Opportunity keywords
These may signal value-add potential if the discount is sufficient.

Examples:

- `sanierungsbedürftig`
- `renovierungsbedürftig`
- `bastlerhit`
- `sanierungschance`
- `renovierungschance`
- `ausbaufähig`

### Risk keywords
These often imply hidden cost, legal complication, or liquidity risk.

Examples:

- `unbefristet vermietet`
- `baurecht`
- `wohnrecht`
- `schimmel`
- `feuchtigkeit`
- `souterrain`
- `reparaturbedürftig`
- `sanierung ausständig`
- `ohne lift` (especially upper floors)
- `abbruchreif`

## 9.2 Renovation-needed rule
Do **not** blindly reward renovation-needed language.

Recommended logic:

```text
if renovation keyword present and bucket_discount_pct >= 7%:
    renovation_adjustment = +10
else if renovation keyword present and bucket_discount_pct between 3% and 7%:
    renovation_adjustment = 0
else if renovation keyword present:
    renovation_adjustment = -10
```

Reasoning:

- renovation opportunity is only attractive if pricing already compensates for likely capex and execution risk

## 9.3 Keyword point model
Start from neutral `50` and adjust.

Example weights:

### Quality bonuses
- `provisionsfrei` +8
- `lift` +4
- `balkon` +4
- `terrasse` +6
- `hofruhelage` +6
- `u-bahn-nähe` +5
- `saniert` +6

### Risk penalties
- `unbefristet vermietet` -20
- `baurecht` -20
- `wohnrecht` -20
- `schimmel` -25
- `feuchtigkeit` -20
- `souterrain` -8
- `reparaturbedürftig` -10

### Opportunity adjustment
- renovation-needed rule from above

Final keyword score:

```text
keyword_signal_score =
  clamp(0, 100, 50 + quality_bonus + opportunity_adjustment - risk_penalty)
```

## 9.4 Implementation notes
- lexicon must be versioned
- matching should be case-insensitive
- normalize umlauts and ASCII equivalents
- allow phrase matches and token matches
- store matched positive/negative keywords in `listing_scores`

---

## 10. Component 4 — time on market

Time on market is useful, but only if interpreted carefully.

## 10.1 Effective days on market
Primary definition:

```text
effective_days_on_market = now - listing.first_seen_at
```

### Relist correction
If the same source appears to have re-listed the same property after a short disappearance window, carry forward the older age when confidence is high.

Simple heuristic for later phases:

- same source
- same address or cross-source fingerprint
- area difference within 3%
- price difference within 5%
- reappears within 30 days

## 10.2 Score mapping

Base freshness table:

| Effective days on market | Base score |
|---:|---:|
| 0–1 | 95 |
| 2–3 | 90 |
| 4–7 | 80 |
| 8–14 | 65 |
| 15–30 | 50 |
| 31–60 | 35 |
| 61–90 | 25 |
| >90 | 20 |

Then adjust:

- if `days > 45` and `district_discount_pct < 3%`: `-15`
- if `days > 90` and `district_discount_pct <= 0`: `-20`
- if price dropped by at least 3% in the last 14 days: `+10`
- if relist detected: `-10`

Finally:

```text
time_on_market_score = clamp(0, 100, base + adjustments)
```

## 10.3 Why this matters
Fresh, discounted listings are urgent. Old, barely discounted listings often imply:

- hidden defects
- bad micro-location
- legal/structural issues
- unrealistic seller expectations

---

## 11. Component 5 — confidence score

This component answers:

> “How much should I trust the score?”

## 11.1 Inputs

- completeness score
- baseline sample confidence
- location confidence
- source reliability
- presence of required scoring fields

## 11.2 Suggested formula

```text
confidence_score =
  0.50 * completeness_score
  + 0.25 * baseline_confidence
  + 0.15 * source_reliability
  + 0.10 * location_confidence
```

Where each input is `0..100`.

### Baseline confidence examples
- district+bucket sample >= 20 -> 100
- district only fallback -> 80
- city-wide fallback -> 60
- no reliable baseline -> 20

### Location confidence examples
- source coordinates exact -> 100
- explicit postal + district text consistent -> 90
- postal-only inference -> 75
- weak text inference only -> 40

### Source reliability examples
Derived from source health / parse stability:

- healthy, low parse errors -> 95
- degraded -> 70
- blocked/churning selectors -> 40

---

## 12. Full score algorithm

## 12.1 Pseudocode

```ts
function scoreListing(input: ScoreInput): ScoreResult {
  const listingPpsqm = input.pricePerSqmEur;
  const districtBaseline = input.districtBaselinePpsqmEur;
  const bucketBaseline = input.bucketBaselinePpsqmEur;

  const districtDiscountPct =
    districtBaseline ? (districtBaseline - listingPpsqm) / districtBaseline : null;

  const bucketDiscountPct =
    bucketBaseline ? (bucketBaseline - listingPpsqm) / bucketBaseline : null;

  const districtPriceScore = mapDistrictDiscountToScore(districtDiscountPct);
  const undervaluationScore = mapBucketDiscountToScore(
    bucketDiscountPct,
    input.bucketSampleSize
  );
  const keywordSignalScore = computeKeywordSignalScore(
    input.matchedKeywords,
    bucketDiscountPct
  );
  const timeOnMarketScore = computeTimeOnMarketScore(
    input.effectiveDaysOnMarket,
    districtDiscountPct,
    input.recentPriceDropPct,
    input.relistDetected
  );
  const confidenceScore = computeConfidenceScore(input);

  const overallScore =
    0.40 * districtPriceScore +
    0.25 * undervaluationScore +
    0.15 * keywordSignalScore +
    0.10 * timeOnMarketScore +
    0.10 * confidenceScore;

  return {
    overallScore: round(clamp(overallScore, 0, 100), 2),
    districtPriceScore,
    undervaluationScore,
    keywordSignalScore,
    timeOnMarketScore,
    confidenceScore,
    districtDiscountPct,
    bucketDiscountPct
  };
}
```

---

## 13. Worked example

### Listing
- district: `1020`
- type: `apartment`
- price: `€299,000`
- living area: `58.4 m²`
- listing ppsqm: `€5,119.86 / m²`
- keywords: `sanierungsbedürftig`, `provisionsfrei`
- days on market: `2`

### Baselines
- district baseline: `€6,050 / m²`
- bucket baseline: `€5,700 / m²`
- bucket sample size: `24`

### Discounts
- district discount: `(6050 - 5119.86) / 6050 = 15.37%`
- bucket discount: `(5700 - 5119.86) / 5700 = 10.18%`

### Sub-scores
- district price score: ~`93`
- undervaluation score: ~`80`
- keyword signal score:
  - neutral `50`
  - `provisionsfrei` `+8`
  - `sanierungsbedürftig` with >7% bucket discount `+10`
  - total `68`
- time on market score: `90`
- confidence score: `88`

### Final
```text
overall =
  0.40*93 + 0.25*80 + 0.15*68 + 0.10*90 + 0.10*88
= 37.2 + 20 + 10.2 + 9 + 8.8
= 85.2
```

Final score: **85.20**

Interpretation: strong candidate worth immediate review.

---

## 14. Cold-start strategy

The scoring engine will be weakest when historical data is thin.

Use phased calibration:

### Phase A — bootstrap
- use current active-listing medians only
- lower confidence
- display “beta” score explanations internally

### Phase B — stable self-built baselines
- after several weeks of data, use rolling 90-day baselines
- enable alert thresholds that rely on score

### Phase C — enriched baselines
- add optional transaction data, geospatial features, or investor feedback model

---

## 15. Persistence model

Every scored listing version should write:

- `listing_scores` row
- `listings.current_score`
- `listings.last_scored_at`

Store explanation JSON like:

```json
{
  "scoreVersion": 1,
  "listingPpsqmEur": 5119.86,
  "districtBaselinePpsqmEur": 6050.0,
  "bucketBaselinePpsqmEur": 5700.0,
  "districtDiscountPct": 0.1537,
  "bucketDiscountPct": 0.1018,
  "matchedPositiveKeywords": ["provisionsfrei"],
  "matchedNegativeKeywords": [],
  "matchedOpportunityKeywords": ["sanierungsbedürftig"],
  "effectiveDaysOnMarket": 2,
  "recentPriceDropPct": 0,
  "confidenceInputs": {
    "completenessScore": 86,
    "baselineConfidence": 100,
    "sourceReliability": 95,
    "locationConfidence": 90
  }
}
```

This is what the macOS app should render in the explanation pane.

---

## 16. Recalculation and versioning

## 16.1 When to rescore
Rescore when:

- a new `listing_versions` row is created
- a market baseline is refreshed
- keyword lexicon changes
- score formula version changes

## 16.2 How to version
Increment `score_version` whenever:

- breakpoints change
- weights change
- keyword weights change
- confidence logic changes
- time-on-market logic changes

Do not silently overwrite the meaning of old scores.

---

## 17. Guardrails

## 17.1 Never treat the score as truth
The score is a triage mechanism, not a buy/no-buy decision.

## 17.2 Penalize uncertainty
Ambiguous location, missing price, or poor sample quality should visibly lower confidence.

## 17.3 Keep negative keywords strong
Words such as `baurecht`, `wohnrecht`, or `unbefristet vermietet` can materially change investment value. Do not let a cheap ppsqm overwhelm those risks.

## 17.4 Avoid over-optimizing to one source
The formula should use canonical fields, not site-specific quirks.

---

## 18. Final recommendation

Use a **versioned, explainable weighted score** built from:

- `price_per_m² vs district baseline`
- `micro-bucket undervaluation confirmation`
- `keyword opportunity/risk signals`
- `time on market`
- `confidence`

That produces a practical and trustworthy `0–100` ranking without pretending to be a black-box valuation model.
