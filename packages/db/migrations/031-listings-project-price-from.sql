-- Migration 031: Mark developer projects and keep their "from" price
--
-- A developer project lists several units under one listing. Its page gives
-- only the cheapest unit's price ("ab 389.000 €") and ranges for area and
-- rooms, so the immoscout24 parser leaves price, area and rooms empty. Up to
-- parser version 3 it kept the "from" price in attributesRaw.priceFromRaw,
-- which normalization dropped. The app showed these listings blank, and
-- scoring rated them on location alone.
--
-- listings.is_project now marks a project, and listings.price_from_eur_cents
-- holds its "from" price, which is never an asking price. Scoring skips
-- projects.
--
-- Backfill: parser version 3 stored a "from" price either from the Expose
-- record, only for a project, or from the visible price. estateTypeRaw comes
-- only from the Expose record, so a raw row with both is a project. Projects
-- lose the scores computed without a price or an area; score history stays.

SET LOCAL statement_timeout = 0;

-- Rollback: ALTER TABLE listings DROP COLUMN IF EXISTS price_from_eur_cents,
--   DROP COLUMN IF EXISTS is_project;
--   (once no code reads or writes them, per rule 1)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'listings'
      AND column_name = 'is_project'
  ) THEN
    ALTER TABLE listings
      ADD COLUMN is_project BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN price_from_eur_cents BIGINT
        CONSTRAINT listings_price_from_eur_cents_check
        CHECK (price_from_eur_cents IS NULL OR price_from_eur_cents > 0);

    -- Backfill only with the new columns, so a rerun can't undo a later normalization.
    WITH from_prices AS (
      SELECT l.id,
             CASE WHEN rl.raw_payload ? 'priceFromRaw'
               THEN rl.raw_payload->>'priceFromRaw'
               ELSE rl.raw_payload->'attributesRaw'->>'priceFromRaw'
             END AS price_from,
             CASE WHEN rl.raw_payload ? 'isProjectRaw'
               THEN rl.raw_payload->'isProjectRaw' = 'true'::jsonb
               ELSE (rl.raw_payload->>'estateTypeRaw') IS NOT NULL
                 AND rl.raw_payload->'attributesRaw'->>'priceFromRaw' IS NOT NULL
             END AS is_project
      FROM listings l
      JOIN sources s ON s.id = l.source_id
      JOIN raw_listings rl ON rl.id = l.current_raw_listing_id
      WHERE s.code = 'immoscout24'
        AND (rl.raw_payload->'attributesRaw'->>'priceFromRaw' IS NOT NULL
          OR rl.raw_payload->>'priceFromRaw' IS NOT NULL
          OR rl.raw_payload->'isProjectRaw' = 'true'::jsonb)
    )
    UPDATE listings l
    SET is_project = f.is_project,
        -- Whole euros or two decimals, as the parser writes them. Anything else stays empty
        -- until the next detail fetch.
        price_from_eur_cents = CASE
          WHEN length(f.price_from) <= 18 AND f.price_from ~ '^[0-9]+(\.[0-9]{1,2})?$'
            THEN CASE WHEN f.price_from::numeric > 0
              AND f.price_from::numeric * 100 <= 9007199254740991
              THEN round(f.price_from::numeric * 100)::bigint END
        END,
        current_score = CASE WHEN f.is_project THEN NULL ELSE l.current_score END,
        last_scored_at = CASE WHEN f.is_project THEN NULL ELSE l.last_scored_at END
    FROM from_prices f
    WHERE l.id = f.id;
  END IF;
END $$;
