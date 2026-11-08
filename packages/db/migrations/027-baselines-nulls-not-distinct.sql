-- Migration 027: One city-wide market baseline per dimension and day
--
-- City-wide baselines have a NULL district_no, and uq_market_baselines_dim
-- treated NULLs as distinct, so upsertBaseline's ON CONFLICT never matched
-- them and every baseline run inserted new city-wide rows instead of updating
-- that day's rows. This deletes the extra copies and recreates the constraint
-- with NULLS NOT DISTINCT (PostgreSQL 15+). The ON CONFLICT column list in
-- upsertBaseline infers the new constraint unchanged.

-- Rollback: none needed. SET LOCAL ends with the runner's transaction.
SET LOCAL statement_timeout = 0;

-- Blocks baseline writes until the transaction ends, so a baseline run can't
-- insert a new copy between the delete and the new constraint.
-- Rollback: none needed. The lock ends with the transaction.
LOCK TABLE market_baselines IN SHARE ROW EXCLUSIVE MODE;

-- Keeps the highest id of each city-wide dimension: the day's last run, which
-- upsertBaseline would have updated in place had the constraint matched NULLs.
-- Rollback: not reversible, and nothing needs it back. The deleted rows are
--   superseded copies of the kept row, and no table references baseline ids.
DELETE FROM market_baselines
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY baseline_date, city, operation_type, property_type,
                     area_bucket, room_bucket, source_scope
        ORDER BY id DESC
      ) AS copy_no
    FROM market_baselines
    WHERE district_no IS NULL
  ) copies
  WHERE copy_no > 1
);

-- Rollback: ALTER TABLE market_baselines DROP CONSTRAINT IF EXISTS uq_market_baselines_dim;
--   ALTER TABLE market_baselines ADD CONSTRAINT uq_market_baselines_dim UNIQUE (
--     baseline_date, city, district_no, operation_type, property_type,
--     area_bucket, room_bucket, source_scope);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_index idx ON idx.indexrelid = con.conindid
    WHERE con.conrelid = 'market_baselines'::regclass
      AND con.conname = 'uq_market_baselines_dim'
      AND idx.indnullsnotdistinct
  ) THEN
    ALTER TABLE market_baselines DROP CONSTRAINT IF EXISTS uq_market_baselines_dim;
    ALTER TABLE market_baselines
      ADD CONSTRAINT uq_market_baselines_dim UNIQUE NULLS NOT DISTINCT (
        baseline_date, city, district_no, operation_type, property_type,
        area_bucket, room_bucket, source_scope
      );
  END IF;
END $$;
