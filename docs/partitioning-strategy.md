# Partitioning Strategy

## Current State

- **Single PostgreSQL instance**, no table partitioning.
- All tables use standard (non-partitioned) storage.
- This is appropriate for the current data volume.

## Trigger Conditions

Partitioning should be evaluated when either threshold is reached:

| Table           | Trigger Threshold | Current Estimate |
| --------------- | ----------------- | ---------------- |
| `raw_listings`  | > 10M rows        | < 100K           |
| `listings`      | > 1M rows         | < 50K            |

## Strategy

### `raw_listings` — Range Partition by `created_at` (Monthly)

`raw_listings` grows fastest because every scrape observation creates or updates a row. Monthly range partitions keep each partition manageable and enable efficient archival.

```sql
-- Convert to partitioned table (requires migration)
CREATE TABLE raw_listings (
  -- ... existing columns ...
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE raw_listings_2026_01
  PARTITION OF raw_listings
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE raw_listings_2026_02
  PARTITION OF raw_listings
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- ... and so on
```

### `listings` — Keep Unpartitioned

`listings` holds only the current canonical state of each property. It grows much more slowly (one row per unique listing) and should remain unpartitioned unless it exceeds 1M rows.

### Archival Policy

- `raw_listings` partitions older than **1 year** should be moved to cold storage.
- Cold storage partitions can be detached and stored as compressed dumps:

```sql
-- Detach old partition
ALTER TABLE raw_listings DETACH PARTITION raw_listings_2025_01;

-- Export and compress
pg_dump -t raw_listings_2025_01 | gzip > backups/raw_listings_2025_01.sql.gz

-- Drop after confirming backup
DROP TABLE raw_listings_2025_01;
```

### Index Considerations

- Partition-local indexes are created automatically when the parent table has indexes.
- The existing unique constraint on `(source_id, source_listing_key, content_sha256)` works with range partitioning since `created_at` is included in the partition key.
- Query performance improves because partition pruning skips irrelevant months.

## Implementation Notes

1. Migration must be planned carefully — converting an existing table to partitioned requires recreating the table.
2. Use `pg_partman` extension for automatic partition creation and maintenance if available.
3. Test the migration on a staging copy of the database before running in production.
4. Monitor partition sizes monthly and adjust the strategy if growth patterns change.
