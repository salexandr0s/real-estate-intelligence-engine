/**
 * Legal-rent rules engine tests.
 *
 * Table-driven tests covering all 5 output states, signal classification,
 * edge cases, and output structure.
 */
import { describe, it, expect } from 'vitest';
import { assessLegalRent } from '../rules-engine.js';
import type { AssessmentInput, LegalRentStatus, RegimeCandidate } from '../rules-engine.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    yearBuilt: null,
    yearBuiltSource: null,
    unitCount: null,
    isSubsidized: null,
    listingTextHints: [],
    livingAreaSqm: null,
    buildingMatchConfidence: null,
    ...overrides,
  };
}

// ── Rule 1: Post-2001 construction ─────────────────────────────────────────

describe('Post-2001 buildings', () => {
  it('official year post-2001 → likely_uncapped / exempt', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 2005,
        yearBuiltSource: 'official',
      }),
    );
    expect(result.status).toBe('likely_uncapped');
    expect(result.regimeCandidate).toBe('exempt');
    expect(result.confidence).toBe('medium');
    expect(result.reviewRequired).toBe(false);
  });

  it('listing-sourced year post-2001 → likely_capped_missing_critical_proof', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 2010,
        yearBuiltSource: 'listing',
      }),
    );
    expect(result.status).toBe('likely_capped_missing_critical_proof');
    expect(result.regimeCandidate).toBe('unknown');
    expect(result.confidence).toBe('low');
    expect(result.reviewRequired).toBe(true);
    expect(result.missingFacts).toContain(
      'Building year not from official source — cannot confirm exemption',
    );
  });

  it('inferred year post-2001 → likely_capped_missing_critical_proof', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 2020,
        yearBuiltSource: 'inferred',
      }),
    );
    expect(result.status).toBe('likely_capped_missing_critical_proof');
    expect(result.reviewRequired).toBe(true);
  });

  it('boundary year 2002 with official source → likely_uncapped', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 2002,
        yearBuiltSource: 'official',
      }),
    );
    expect(result.status).toBe('likely_uncapped');
  });
});

// ── Rule 2: Pre-1945 construction ──────────────────────────────────────────

describe('Pre-1945 buildings', () => {
  it('official year pre-1945 → likely_capped / full_mrg with strong signals', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1900,
        yearBuiltSource: 'official',
        buildingMatchConfidence: 'high',
      }),
    );
    expect(result.status).toBe('likely_capped');
    expect(result.regimeCandidate).toBe('full_mrg');
    expect(result.confidence).toBe('medium');
    expect(result.strongSignals.length).toBeGreaterThan(0);
    expect(result.reviewRequired).toBe(true); // always true for capped
  });

  it('listing-sourced year pre-1945 → likely_capped_missing_critical_proof', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1920,
        yearBuiltSource: 'listing',
      }),
    );
    expect(result.status).toBe('likely_capped_missing_critical_proof');
    expect(result.regimeCandidate).toBe('full_mrg');
    expect(result.confidence).toBe('low');
    // No strong signals since year is from listing (weak)
    expect(result.strongSignals.length).toBe(0);
    expect(result.weakSignals.length).toBeGreaterThan(0);
  });

  it('boundary year 1944 → pre-1945 rule', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1944,
        yearBuiltSource: 'official',
      }),
    );
    expect(result.regimeCandidate).toBe('full_mrg');
  });
});

// ── Rule 3: 1945-2001 "grey zone" ──────────────────────────────────────────

describe('1945-2001 buildings (grey zone)', () => {
  it('subsidized building in grey zone → likely_capped', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1970,
        yearBuiltSource: 'official',
        isSubsidized: true,
      }),
    );
    expect(result.status).toBe('likely_capped');
    expect(result.regimeCandidate).toBe('full_mrg');
    expect(result.confidence).toBe('medium');
    expect(result.strongSignals.some((s) => s.signal.includes('subsidies'))).toBe(true);
  });

  it('non-subsidized building in grey zone with few missing facts → needs_human_legal_review', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1980,
        yearBuiltSource: 'official',
        isSubsidized: false,
        buildingMatchConfidence: 'high',
        unitCount: 20,
      }),
    );
    // With official year + confirmed building + known units → only 1 missing fact (subsidy known=false, not null)
    expect(result.status).toBe('needs_human_legal_review');
    expect(result.regimeCandidate).toBe('unknown');
    expect(result.reviewRequired).toBe(true);
  });

  it('grey zone with many missing facts → unclear', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1960,
        yearBuiltSource: 'listing',
      }),
    );
    // yearBuilt from listing → weak signal; isSubsidized null → missing; buildingMatch null → missing; unitCount null → missing
    expect(result.status).toBe('unclear');
    expect(result.missingFacts.length).toBeGreaterThan(2);
  });

  it('boundary year 1945 → grey zone', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1945,
        yearBuiltSource: 'official',
        isSubsidized: true,
      }),
    );
    expect(result.status).toBe('likely_capped');
  });

  it('boundary year 2001 → grey zone', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 2001,
        yearBuiltSource: 'official',
        isSubsidized: false,
      }),
    );
    // 2001 is <= 2001, so grey zone, not post-2001
    expect(result.regimeCandidate).not.toBe('exempt');
  });
});

// ── Rule 4: No year built ──────────────────────────────────────────────────

describe('No year built', () => {
  it('no year at all → unclear', () => {
    const result = assessLegalRent(makeInput());
    expect(result.status).toBe('unclear');
    expect(result.regimeCandidate).toBe('unknown');
    expect(result.confidence).toBe('low');
    expect(result.reviewRequired).toBe(true);
    expect(result.missingFacts).toContain('Year of construction/building permit unknown');
  });

  it('no year but with text hints → still unclear but has weak signals', () => {
    const result = assessLegalRent(
      makeInput({
        listingTextHints: ['Schöne Altbauwohnung in Wien'],
      }),
    );
    expect(result.status).toBe('unclear');
    expect(result.weakSignals.some((s) => s.signal.includes('Altbau'))).toBe(true);
  });
});

// ── Signal classification ───────────────────────────────────────────────────

describe('Signal classification', () => {
  it('official year → strong signal', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1900,
        yearBuiltSource: 'official',
      }),
    );
    expect(result.strongSignals.some((s) => s.source === 'official_records')).toBe(true);
  });

  it('listing year → weak signal', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1900,
        yearBuiltSource: 'listing',
      }),
    );
    expect(result.weakSignals.some((s) => s.source === 'listing')).toBe(true);
  });

  it('subsidy true → strong signal', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1970,
        yearBuiltSource: 'official',
        isSubsidized: true,
      }),
    );
    expect(result.strongSignals.some((s) => s.signal.includes('subsidies'))).toBe(true);
  });

  it('subsidy null → missing fact', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1970,
        yearBuiltSource: 'official',
      }),
    );
    expect(result.missingFacts).toContain('Subsidy status unknown');
  });

  it('subsidy false → no signal, no missing', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1970,
        yearBuiltSource: 'official',
        isSubsidized: false,
      }),
    );
    expect(result.strongSignals.every((s) => !s.signal.includes('subsidies'))).toBe(true);
    expect(result.missingFacts.every((f) => !f.includes('Subsidy'))).toBe(true);
  });

  it('text hint "Altbau" → weak signal', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1900,
        yearBuiltSource: 'official',
        listingTextHints: ['Altbauwohnung'],
      }),
    );
    expect(result.weakSignals.some((s) => s.signal.includes('Altbau'))).toBe(true);
    expect(result.weakSignals.some((s) => s.source === 'listing_text')).toBe(true);
  });

  it('text hint "gefördert" → weak signal', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1970,
        yearBuiltSource: 'official',
        listingTextHints: ['geförderte Wohnung'],
      }),
    );
    expect(result.weakSignals.some((s) => s.signal.includes('subsidized'))).toBe(true);
  });

  it('text hint "Neubau" → weak signal', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 2010,
        yearBuiltSource: 'official',
        listingTextHints: ['Neubau Erstbezug'],
      }),
    );
    expect(result.weakSignals.some((s) => s.signal.includes('Neubau'))).toBe(true);
  });

  it('unknown building match → missing fact', () => {
    const result = assessLegalRent(
      makeInput({
        buildingMatchConfidence: 'unknown',
      }),
    );
    expect(result.missingFacts).toContain('Building identification not confirmed');
  });

  it('null building match → missing fact', () => {
    const result = assessLegalRent(makeInput());
    expect(result.missingFacts).toContain('Building identification not confirmed');
  });

  it('confirmed building match → no missing fact for building', () => {
    const result = assessLegalRent(
      makeInput({
        buildingMatchConfidence: 'high',
      }),
    );
    expect(result.missingFacts.every((f) => !f.includes('Building identification'))).toBe(true);
  });

  it('null unit count → missing fact', () => {
    const result = assessLegalRent(makeInput());
    expect(result.missingFacts).toContain('Number of units in building unknown');
  });
});

// ── Output structure ────────────────────────────────────────────────────────

describe('Output structure', () => {
  it('always includes disclaimer', () => {
    const result = assessLegalRent(makeInput());
    expect(result.disclaimer).toContain('not constitute legal advice');
    expect(result.disclaimer.length).toBeGreaterThan(50);
  });

  it('indicative bands are null by default', () => {
    const result = assessLegalRent(
      makeInput({
        yearBuilt: 1900,
        yearBuiltSource: 'official',
      }),
    );
    expect(result.indicativeBandLow).toBeNull();
    expect(result.indicativeBandHigh).toBeNull();
  });

  it('all status values are from the allowed set', () => {
    const allowed: LegalRentStatus[] = [
      'likely_capped',
      'likely_uncapped',
      'likely_capped_missing_critical_proof',
      'unclear',
      'needs_human_legal_review',
    ];

    const inputs: AssessmentInput[] = [
      makeInput({ yearBuilt: 1900, yearBuiltSource: 'official' }),
      makeInput({ yearBuilt: 2010, yearBuiltSource: 'official' }),
      makeInput({ yearBuilt: 2010, yearBuiltSource: 'listing' }),
      makeInput(),
      makeInput({
        yearBuilt: 1970,
        yearBuiltSource: 'official',
        isSubsidized: false,
        buildingMatchConfidence: 'high',
        unitCount: 10,
      }),
    ];

    for (const input of inputs) {
      const result = assessLegalRent(input);
      expect(allowed).toContain(result.status);
    }
  });

  it('all regime candidates are from the allowed set', () => {
    const allowed: RegimeCandidate[] = ['full_mrg', 'partial_mrg', 'wrg', 'exempt', 'unknown'];
    const result = assessLegalRent(makeInput({ yearBuilt: 1900, yearBuiltSource: 'official' }));
    expect(allowed).toContain(result.regimeCandidate);
  });

  it('signals arrays are always arrays', () => {
    const result = assessLegalRent(makeInput());
    expect(Array.isArray(result.strongSignals)).toBe(true);
    expect(Array.isArray(result.weakSignals)).toBe(true);
    expect(Array.isArray(result.missingFacts)).toBe(true);
  });
});
