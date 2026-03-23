import { query } from '../client.js';

// ── Row types ───────────────────────────────────────────────────────────────

interface LegalRentDbRow {
  id: string;
  listing_id: string;
  status: string;
  regime_candidate: string | null;
  confidence: string;
  strong_signals: unknown[];
  weak_signals: unknown[];
  missing_facts: unknown[];
  review_required: boolean;
  indicative_band_low_eur_cents: string | null;
  indicative_band_high_eur_cents: string | null;
  disclaimer: string;
  building_fact_id: string | null;
  assessment_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface LegalRentAssessmentRow {
  id: number;
  listingId: number;
  status: string;
  regimeCandidate: string | null;
  confidence: string;
  strongSignals: unknown[];
  weakSignals: unknown[];
  missingFacts: unknown[];
  reviewRequired: boolean;
  indicativeBandLowEurCents: number | null;
  indicativeBandHighEurCents: number | null;
  disclaimer: string;
  buildingFactId: number | null;
  assessmentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

function toLegalRentRow(row: LegalRentDbRow): LegalRentAssessmentRow {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    status: row.status,
    regimeCandidate: row.regime_candidate,
    confidence: row.confidence,
    strongSignals: row.strong_signals,
    weakSignals: row.weak_signals,
    missingFacts: row.missing_facts,
    reviewRequired: row.review_required,
    indicativeBandLowEurCents:
      row.indicative_band_low_eur_cents != null ? Number(row.indicative_band_low_eur_cents) : null,
    indicativeBandHighEurCents:
      row.indicative_band_high_eur_cents != null
        ? Number(row.indicative_band_high_eur_cents)
        : null,
    disclaimer: row.disclaimer,
    buildingFactId: row.building_fact_id != null ? Number(row.building_fact_id) : null,
    assessmentVersion: row.assessment_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ────────────────────────────────────────────────────────────────

export interface CreateLegalRentInput {
  listingId: number;
  status: string;
  regimeCandidate?: string | null;
  confidence?: string;
  strongSignals?: unknown[];
  weakSignals?: unknown[];
  missingFacts?: unknown[];
  reviewRequired?: boolean;
  indicativeBandLowEurCents?: number | null;
  indicativeBandHighEurCents?: number | null;
  buildingFactId?: number | null;
}

export async function upsertAssessment(
  input: CreateLegalRentInput,
): Promise<LegalRentAssessmentRow> {
  const rows = await query<LegalRentDbRow>(
    `INSERT INTO legal_rent_assessments (
       listing_id, status, regime_candidate, confidence,
       strong_signals, weak_signals, missing_facts,
       review_required,
       indicative_band_low_eur_cents, indicative_band_high_eur_cents,
       building_fact_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (listing_id) DO UPDATE SET
       status = EXCLUDED.status,
       regime_candidate = EXCLUDED.regime_candidate,
       confidence = EXCLUDED.confidence,
       strong_signals = EXCLUDED.strong_signals,
       weak_signals = EXCLUDED.weak_signals,
       missing_facts = EXCLUDED.missing_facts,
       review_required = EXCLUDED.review_required,
       indicative_band_low_eur_cents = EXCLUDED.indicative_band_low_eur_cents,
       indicative_band_high_eur_cents = EXCLUDED.indicative_band_high_eur_cents,
       building_fact_id = EXCLUDED.building_fact_id,
       assessment_version = legal_rent_assessments.assessment_version + 1,
       updated_at = NOW()
     RETURNING *`,
    [
      input.listingId,
      input.status,
      input.regimeCandidate ?? null,
      input.confidence ?? 'low',
      JSON.stringify(input.strongSignals ?? []),
      JSON.stringify(input.weakSignals ?? []),
      JSON.stringify(input.missingFacts ?? []),
      input.reviewRequired ?? true,
      input.indicativeBandLowEurCents ?? null,
      input.indicativeBandHighEurCents ?? null,
      input.buildingFactId ?? null,
    ],
  );
  return toLegalRentRow(rows[0]!);
}

export async function findByListingId(listingId: number): Promise<LegalRentAssessmentRow | null> {
  const rows = await query<LegalRentDbRow>(
    `SELECT * FROM legal_rent_assessments
     WHERE listing_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [listingId],
  );
  return rows[0] ? toLegalRentRow(rows[0]) : null;
}
