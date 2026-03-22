# Query Plan / Index Review

Review of indexes defined in `schema.sql` and how they support the main query paths.

## Index Inventory

### listings table

| Index | Columns | Type | Condition | Supports |
|-------|---------|------|-----------|----------|
| `idx_listings_active_core_filter` | `(operation_type, property_type, district_no, list_price_eur_cents, living_area_sqm, current_score DESC, first_seen_at DESC, id DESC)` | B-tree (partial) | `WHERE listing_status = 'active'` | Main listing search query |
| `idx_listings_active_district_price` | `(district_no, list_price_eur_cents, id DESC)` | B-tree (partial) | `WHERE listing_status = 'active'` | District + price range filters |
| `idx_listings_active_district_area` | `(district_no, living_area_sqm, id DESC)` | B-tree (partial) | `WHERE listing_status = 'active'` | District + area range filters |
| `idx_listings_active_score_seen` | `(current_score DESC, first_seen_at DESC, id DESC)` | B-tree (partial) | `WHERE listing_status = 'active'` | Score-sorted listing views, high-score endpoint |
| `idx_listings_active_status_seen` | `(listing_status, first_seen_at DESC, id DESC)` | B-tree | None | Status-based queries, stale listing detection |
| `idx_listings_source_last_seen` | `(source_id, last_seen_at DESC)` | B-tree | None | Source-specific freshness checks |
| `idx_listings_postal_code` | `(postal_code)` | B-tree (partial) | `WHERE postal_code IS NOT NULL` | Postal code lookups |
| `idx_listings_cross_source_fingerprint` | `(cross_source_fingerprint)` | B-tree (partial) | `WHERE cross_source_fingerprint IS NOT NULL` | Duplicate detection across sources |
| `idx_listings_search_vector` | `(search_vector)` | GIN | None | Full-text search on title + description |
| `uq_listings_source_key` | `(source_id, source_listing_key)` | Unique | None | Idempotent upsert conflict target |
| `uq_listings_uid` | `(listing_uid)` | Unique | None | UUID-based lookups |

### user_filters table

| Index | Columns | Type | Supports |
|-------|---------|------|----------|
| `idx_user_filters_user_active` | `(user_id, is_active, updated_at DESC)` | B-tree | User's active filters list |
| `idx_user_filters_active_core` | `(is_active, operation_type, max_price_eur_cents, min_area_sqm, min_score)` | B-tree | Reverse-match candidate filter query |
| `idx_user_filters_districts_gin` | `(districts)` | GIN | Array containment checks for district matching |
| `idx_user_filters_property_types_gin` | `(property_types)` | GIN | Array containment checks for property type matching |
| `idx_user_filters_required_keywords_gin` | `(required_keywords)` | GIN | Array containment checks for keyword matching |

### Other tables

| Table | Index | Supports |
|-------|-------|----------|
| `raw_listings` | `uq_raw_listings_source_key_hash` | Idempotent raw snapshot upsert |
| `raw_listings` | `idx_raw_listings_source_key_seen` | Latest raw snapshot lookup |
| `raw_listings` | `idx_raw_listings_last_scrape_run` | Run-specific snapshot queries |
| `raw_listings` | `idx_raw_listings_external_id` | External ID lookups |
| `raw_listings` | `idx_raw_listings_created_brin` | Time-range scans on raw data |
| `scrape_runs` | `idx_scrape_runs_source_scheduled` | Source crawl history |
| `scrape_runs` | `idx_scrape_runs_status_scheduled` | Queue/status-based queries |
| `scrape_runs` | `idx_scrape_runs_source_status_started` | Source + status + recency |
| `listing_versions` | `idx_listing_versions_listing_observed` | Version history for a listing |
| `listing_scores` | `idx_listing_scores_listing_scored` | Score history for a listing |
| `listing_scores` | `idx_listing_scores_overall` | Top-score queries |
| `market_baselines` | `idx_market_baselines_lookup` | Baseline lookup by dimensions |
| `alerts` | `uq_alerts_dedupe_channel` | Alert deduplication |
| `alerts` | `idx_alerts_user_status_scheduled` | User alert feed |
| `alerts` | `idx_alerts_filter_matched` | Filter match history |
| `alerts` | `idx_alerts_listing_matched` | Listing alert history |

## Main Listing Search Query Predicate-to-Index Mapping

The main search query (`packages/db/src/queries/listings.ts:searchListings` and `packages/filtering/src/compiler/build-search-query.ts:buildListingSearchQuery`) uses these WHERE predicates on active listings:

| Predicate | Column(s) | Covered By |
|-----------|-----------|------------|
| `listing_status = 'active'` | `listing_status` | Partial index condition on `idx_listings_active_core_filter`, `idx_listings_active_district_price`, `idx_listings_active_district_area`, `idx_listings_active_score_seen` |
| `operation_type = $1` | `operation_type` | Leading column of `idx_listings_active_core_filter` |
| `property_type = ANY($2)` | `property_type` | Second column of `idx_listings_active_core_filter` |
| `district_no = ANY($3)` | `district_no` | Third column of `idx_listings_active_core_filter`; also `idx_listings_active_district_price`, `idx_listings_active_district_area` |
| `list_price_eur_cents >= $4` / `<= $5` | `list_price_eur_cents` | Fourth column of `idx_listings_active_core_filter`; also `idx_listings_active_district_price` |
| `living_area_sqm >= $6` / `<= $7` | `living_area_sqm` | Fifth column of `idx_listings_active_core_filter`; also `idx_listings_active_district_area` |
| `rooms >= $8` / `<= $9` | `rooms` | Not directly indexed; filtered post-index scan |
| `current_score >= $10` | `current_score` | Sixth column of `idx_listings_active_core_filter`; also `idx_listings_active_score_seen` |
| Keyword ILIKE on title/description | `title`, `description` | Not indexed for ILIKE; full-text search available via `idx_listings_search_vector` (GIN) but the query uses ILIKE for flexibility |

## Key Observations

1. **`idx_listings_active_core_filter`** covers the most common filter combination: `(listing_status, operation_type, property_type)` as the leading columns, with district, price, area, and score as trailing columns. This is the primary index for the listing search endpoint.

2. **Partial indexes** (`idx_listings_active_district_price`, `idx_listings_active_district_area`) provide narrower, faster paths for district-scoped queries with price or area range filters.

3. **Score sort partial index** (`idx_listings_active_score_seen`) directly supports `ORDER BY current_score DESC, first_seen_at DESC, id DESC` for score-sorted views and the high-score endpoint. This avoids a sort step when the query can use this index.

4. **GIN indexes on user_filters** (`districts`, `property_types`, `required_keywords`) support the reverse-match path where a new listing is checked against all active filters. Array containment operators (`@>`, `&&`) can use these indexes.

5. **Keyword ILIKE predicates** in the search query cannot use B-tree indexes. For large datasets, consider migrating to `search_vector @@ to_tsquery()` full-text search which can use the GIN index `idx_listings_search_vector`.

6. **Rooms predicate** is not directly indexed. Since it is typically used in combination with other predicates that are indexed (district, price, area), the planner should filter rows efficiently after the index scan. If rooms-only queries become common, a dedicated index may be needed.

## Recommended Next Steps

- **Run `EXPLAIN ANALYZE`** on the main search query once production data exists to verify the planner uses the intended indexes.
- **Monitor** for sequential scans on the `listings` table via `pg_stat_user_tables.seq_scan`.
- **Check index usage** via `pg_stat_user_indexes.idx_scan` to confirm all indexes are actually used.
- **Consider partial index on rooms** if rooms-only filtering becomes a hot path.
- **Consider migrating keyword search** from ILIKE to tsvector full-text search for better performance at scale.
