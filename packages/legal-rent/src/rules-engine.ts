/**
 * Legal-rent / rent-regulation assessment engine.
 *
 * Conservative decision tree that evaluates whether a rental listing
 * is likely subject to Austrian tenancy law rent caps (MRG).
 *
 * Output states:
 * - likely_capped: strong evidence building falls under full MRG
 * - likely_uncapped: strong evidence building is exempt
 * - likely_capped_missing_critical_proof: indicators suggest capped but key facts unverified
 * - unclear: insufficient data
 * - needs_human_legal_review: conflicting signals or edge case
 *
 * This is NOT legal advice. Always outputs a disclaimer.
 */

export type LegalRentStatus =
  | 'likely_capped'
  | 'likely_uncapped'
  | 'likely_capped_missing_critical_proof'
  | 'unclear'
  | 'needs_human_legal_review';

export type RegimeCandidate = 'full_mrg' | 'partial_mrg' | 'wrg' | 'exempt' | 'unknown';

export interface SignalEntry {
  type: 'strong' | 'weak';
  signal: string;
  source: string;
  value?: string | number | boolean;
}

export interface LegalRentAssessment {
  status: LegalRentStatus;
  regimeCandidate: RegimeCandidate;
  confidence: 'high' | 'medium' | 'low';
  strongSignals: SignalEntry[];
  weakSignals: SignalEntry[];
  missingFacts: string[];
  reviewRequired: boolean;
  indicativeBandLow: number | null;
  indicativeBandHigh: number | null;
  disclaimer: string;
}

export interface AssessmentInput {
  /** Year the building's construction permit was granted (from building facts or listing). */
  yearBuilt: number | null;
  /** Source of year_built: 'official' | 'listing' | 'inferred' */
  yearBuiltSource: string | null;
  /** Number of rental units in the building (from building facts). */
  unitCount: number | null;
  /** Whether the building received public subsidies (from building facts). */
  isSubsidized: boolean | null;
  /** Text hints from the listing (e.g., "Altbau", "gefördert", "Neubau"). */
  listingTextHints: string[];
  /** Listing area in sqm. */
  livingAreaSqm: number | null;
  /** Building match confidence. */
  buildingMatchConfidence: string | null;
}

const DISCLAIMER =
  'This is an automated preliminary assessment based on available data. ' +
  'It does not constitute legal advice. For definitive answers, consult a ' +
  'qualified Austrian tenancy law specialist (Mietrechtsexperte).';

/**
 * Run the conservative legal-rent assessment decision tree.
 */
export function assessLegalRent(input: AssessmentInput): LegalRentAssessment {
  const strongSignals: SignalEntry[] = [];
  const weakSignals: SignalEntry[] = [];
  const missingFacts: string[] = [];

  // 1. Building year assessment
  if (input.yearBuilt == null) {
    missingFacts.push('Year of construction/building permit unknown');
  } else if (input.yearBuiltSource === 'official') {
    strongSignals.push({
      type: 'strong',
      signal: `Building year: ${input.yearBuilt}`,
      source: 'official_records',
      value: input.yearBuilt,
    });
  } else {
    weakSignals.push({
      type: 'weak',
      signal: `Building year: ${input.yearBuilt} (from ${input.yearBuiltSource ?? 'listing'})`,
      source: input.yearBuiltSource ?? 'listing',
      value: input.yearBuilt,
    });
  }

  // 2. Subsidy assessment
  if (input.isSubsidized === true) {
    strongSignals.push({
      type: 'strong',
      signal: 'Building received public subsidies',
      source: 'official_records',
      value: true,
    });
  } else if (input.isSubsidized == null) {
    missingFacts.push('Subsidy status unknown');
  }

  // 3. Text hints (weak signals)
  for (const hint of input.listingTextHints) {
    const lower = hint.toLowerCase();
    if (lower.includes('altbau') || lower.includes('gründerzeit')) {
      weakSignals.push({
        type: 'weak',
        signal: 'Listing mentions "Altbau" / "Gründerzeit"',
        source: 'listing_text',
      });
    }
    if (lower.includes('gefördert') || lower.includes('gemeindebau')) {
      weakSignals.push({
        type: 'weak',
        signal: 'Listing mentions subsidized/social housing',
        source: 'listing_text',
      });
    }
    if (lower.includes('neubau') || lower.includes('erstbezug')) {
      weakSignals.push({
        type: 'weak',
        signal: 'Listing mentions "Neubau" / "Erstbezug"',
        source: 'listing_text',
      });
    }
  }

  // 4. Building match confidence
  if (input.buildingMatchConfidence == null || input.buildingMatchConfidence === 'unknown') {
    missingFacts.push('Building identification not confirmed');
  }

  // 5. Unit count
  if (input.unitCount == null) {
    missingFacts.push('Number of units in building unknown');
  }

  // ── Decision tree ─────────────────────────────────────────────────────

  // Rule 1: Post-2001 construction → likely exempt from full MRG
  if (input.yearBuilt != null && input.yearBuilt > 2001) {
    const isOfficialYear = input.yearBuiltSource === 'official';
    return {
      status: isOfficialYear ? 'likely_uncapped' : 'likely_capped_missing_critical_proof',
      regimeCandidate: isOfficialYear ? 'exempt' : 'unknown',
      confidence: isOfficialYear ? 'medium' : 'low',
      strongSignals,
      weakSignals,
      missingFacts: isOfficialYear
        ? missingFacts
        : [...missingFacts, 'Building year not from official source — cannot confirm exemption'],
      reviewRequired: !isOfficialYear,
      indicativeBandLow: null,
      indicativeBandHigh: null,
      disclaimer: DISCLAIMER,
    };
  }

  // Rule 2: Pre-1945 building → likely full MRG candidate
  if (input.yearBuilt != null && input.yearBuilt < 1945) {
    const hasStrongEvidence = strongSignals.length > 0;
    return {
      status: hasStrongEvidence ? 'likely_capped' : 'likely_capped_missing_critical_proof',
      regimeCandidate: 'full_mrg',
      confidence: hasStrongEvidence ? 'medium' : 'low',
      strongSignals,
      weakSignals,
      missingFacts,
      reviewRequired: true,
      indicativeBandLow: null,
      indicativeBandHigh: null,
      disclaimer: DISCLAIMER,
    };
  }

  // Rule 3: 1945-2001 — "grey zone", depends on subsidies and unit count
  if (input.yearBuilt != null && input.yearBuilt >= 1945 && input.yearBuilt <= 2001) {
    if (input.isSubsidized === true) {
      return {
        status: 'likely_capped',
        regimeCandidate: 'full_mrg',
        confidence: 'medium',
        strongSignals,
        weakSignals,
        missingFacts,
        reviewRequired: true,
        indicativeBandLow: null,
        indicativeBandHigh: null,
        disclaimer: DISCLAIMER,
      };
    }

    // Without subsidy info, unclear
    return {
      status: missingFacts.length <= 2 ? 'needs_human_legal_review' : 'unclear',
      regimeCandidate: 'unknown',
      confidence: 'low',
      strongSignals,
      weakSignals,
      missingFacts,
      reviewRequired: true,
      indicativeBandLow: null,
      indicativeBandHigh: null,
      disclaimer: DISCLAIMER,
    };
  }

  // Rule 4: No year built at all → unclear
  return {
    status: 'unclear',
    regimeCandidate: 'unknown',
    confidence: 'low',
    strongSignals,
    weakSignals,
    missingFacts,
    reviewRequired: true,
    indicativeBandLow: null,
    indicativeBandHigh: null,
    disclaimer: DISCLAIMER,
  };
}
