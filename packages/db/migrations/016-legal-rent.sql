-- Migration 016: Legal-rent / rent-regulation assessment
--
-- Conservative, auditable assessment of whether a listing is subject
-- to rent regulation under Austrian tenancy law (MRG).
-- This is a SEPARATE layer from market-rent estimation.

CREATE TABLE IF NOT EXISTS legal_rent_assessments (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES listings(id),

  -- Assessment status
  status TEXT NOT NULL,                          -- likely_capped, likely_uncapped, likely_capped_missing_critical_proof, unclear, needs_human_legal_review
  regime_candidate TEXT,                         -- full_mrg, partial_mrg, wrg, exempt, unknown
  confidence TEXT NOT NULL DEFAULT 'low',         -- high, medium, low

  -- Signal breakdown
  strong_signals JSONB NOT NULL DEFAULT '[]',    -- verified facts supporting the assessment
  weak_signals JSONB NOT NULL DEFAULT '[]',      -- inferred or portal-hint-based indicators
  missing_facts JSONB NOT NULL DEFAULT '[]',     -- critical facts not yet verified

  -- Output
  review_required BOOLEAN NOT NULL DEFAULT TRUE,
  indicative_band_low_eur_cents BIGINT,          -- only when critical facts sufficiently proven
  indicative_band_high_eur_cents BIGINT,
  disclaimer TEXT NOT NULL DEFAULT 'Automated preliminary assessment, not legal advice',

  -- Provenance
  building_fact_id BIGINT REFERENCES building_facts(id),
  assessment_version INT NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_rent_listing
  ON legal_rent_assessments (listing_id);

CREATE INDEX IF NOT EXISTS idx_legal_rent_status
  ON legal_rent_assessments (status);

COMMENT ON TABLE legal_rent_assessments IS
  'Auditable rent-regulation assessment — always separate from market-rent';
COMMENT ON COLUMN legal_rent_assessments.status IS
  'Conservative assessment status: likely_capped | likely_uncapped | likely_capped_missing_critical_proof | unclear | needs_human_legal_review';
