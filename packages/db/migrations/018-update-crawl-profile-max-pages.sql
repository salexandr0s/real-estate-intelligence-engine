-- Migration 018: Update crawl profile to use maxPagesPerRun for dynamic pagination
--
-- The discovery worker now follows nextPagePlan from parsers instead of
-- iterating a fixed number of pre-built page plans. maxPagesPerRun is the
-- safety cap; parsers control actual stop via nextPagePlan: null.

UPDATE sources
SET config = jsonb_set(
  config,
  '{crawlProfile,maxPagesPerRun}',
  '100'
)
WHERE is_active = true
  AND config IS NOT NULL
  AND config->'crawlProfile' IS NOT NULL;

-- Remove the old maxPages key from crawlProfile (no longer used by worker)
UPDATE sources
SET config = config #- '{crawlProfile,maxPages}'
WHERE config->'crawlProfile'->'maxPages' IS NOT NULL;
