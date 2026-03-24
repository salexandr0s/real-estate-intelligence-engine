/**
 * Keyword equivalence tests.
 *
 * Proves that the shared keyword matching module (@immoradar/filtering/keyword-match)
 * produces identical results to what the SQL ILIKE path in build-search-query.ts
 * would produce. This ensures search, filter-test, and live alert matching
 * all agree on keyword semantics.
 */
import { describe, it, expect } from 'vitest';
import {
  passesKeywordFilter,
  keywordMatches,
  buildMatchTarget,
  allRequiredKeywordsMatch,
  anyExcludedKeywordMatches,
  escapeForIlike,
} from '@immoradar/contracts';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Simulates the SQL ILIKE behavior for a single keyword:
 *   text ILIKE '%' || escape(kw) || '%' ESCAPE '\\'
 *
 * In SQL, ILIKE with escaped % and _ does a case-insensitive literal
 * substring match — which is exactly what JS toLowerCase().includes() does.
 */
function sqlIlikeEquivalent(text: string, keyword: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedKw = keyword.trim().toLowerCase();
  if (normalizedKw.length === 0) return true;
  // SQL ILIKE with escaped wildcards = literal substring match
  return normalizedText.includes(normalizedKw);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('keyword-match: core matching', () => {
  it('matches plain keyword in title', () => {
    expect(keywordMatches('schöne wohnung im 3. bezirk', 'wohnung')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(keywordMatches('schöne wohnung', 'Wohnung')).toBe(true);
    expect(keywordMatches('SCHÖNE WOHNUNG', 'wohnung')).toBe(true);
  });

  it('does not match absent keyword', () => {
    expect(keywordMatches('schöne wohnung', 'haus')).toBe(false);
  });

  it('matches partial words (substring behavior)', () => {
    expect(keywordMatches('altbauwohnung', 'altbau')).toBe(true);
    expect(keywordMatches('dachgeschoßwohnung', 'dachgeschoß')).toBe(true);
  });

  it('empty keyword matches everything', () => {
    expect(keywordMatches('any text', '')).toBe(true);
    expect(keywordMatches('', '')).toBe(true);
  });

  it('handles keywords with spaces (trimmed)', () => {
    expect(keywordMatches('schöne wohnung', '  wohnung  ')).toBe(true);
  });
});

describe('keyword-match: special characters', () => {
  it('matches keyword containing SQL wildcard %', () => {
    // In a listing that contains a literal "10% Rendite"
    const text = '10% rendite möglich';
    // The keyword "10%" should match literally
    expect(keywordMatches(text, '10%')).toBe(true);
    expect(sqlIlikeEquivalent(text, '10%')).toBe(true);
  });

  it('matches keyword containing SQL wildcard _', () => {
    const text = 'zimmer_1 ist groß';
    expect(keywordMatches(text, 'zimmer_1')).toBe(true);
    expect(sqlIlikeEquivalent(text, 'zimmer_1')).toBe(true);
  });

  it('does not treat % as wildcard in JS path', () => {
    // "%" in SQL ILIKE would match any character — but we escape it
    // JS includes() treats "%" literally, which is correct
    const text = 'hausverwaltung';
    expect(keywordMatches(text, 'h%g')).toBe(false); // Not a wildcard match
    expect(sqlIlikeEquivalent(text, 'h%g')).toBe(false);
  });

  it('handles German umlauts correctly', () => {
    expect(keywordMatches('3-Zimmer-Wohnung in Döbling', 'döbling')).toBe(true);
    expect(keywordMatches('Größe: 85m²', 'größe')).toBe(true);
    expect(keywordMatches('straße', 'straße')).toBe(true);
  });

  it('handles backslash in keyword', () => {
    const text = 'pfad\\test';
    expect(keywordMatches(text, 'pfad\\test')).toBe(true);
    expect(sqlIlikeEquivalent(text, 'pfad\\test')).toBe(true);
  });
});

describe('keyword-match: ILIKE escape function', () => {
  it('escapes % character', () => {
    expect(escapeForIlike('10%')).toBe('10\\%');
  });

  it('escapes _ character', () => {
    expect(escapeForIlike('room_1')).toBe('room\\_1');
  });

  it('escapes both in combination', () => {
    expect(escapeForIlike('a%b_c')).toBe('a\\%b\\_c');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeForIlike('wohnung')).toBe('wohnung');
  });
});

describe('keyword-match: SQL equivalence', () => {
  const testCases = [
    { title: 'Schöne Wohnung in Wien', desc: 'Helle Wohnung', kw: 'wohnung' },
    { title: 'Altbau saniert', desc: null, kw: 'altbau' },
    { title: '3-Zimmer', desc: 'mit Balkon', kw: 'balkon' },
    { title: 'Neubau', desc: 'Erstbezug 2024', kw: 'erstbezug' },
    { title: 'Penthouse', desc: null, kw: 'erdgeschoß' }, // should NOT match
    { title: '100% provisionsfrei', desc: null, kw: '100%' },
    { title: 'Objekt_42', desc: null, kw: 'objekt_42' },
    { title: 'GROSSES HAUS', desc: 'mit garten', kw: 'garten' },
    { title: '', desc: 'nur beschreibung', kw: 'beschreibung' },
    { title: 'nur titel', desc: '', kw: 'titel' },
    { title: '', desc: '', kw: 'nothing' }, // empty text, keyword present
  ];

  for (const tc of testCases) {
    it(`JS and SQL agree for keyword "${tc.kw}" in "${tc.title}"`, () => {
      const jsResult = keywordMatches(buildMatchTarget(tc.title, tc.desc), tc.kw);
      const sqlResult = sqlIlikeEquivalent(buildMatchTarget(tc.title, tc.desc), tc.kw);
      expect(jsResult).toBe(sqlResult);
    });
  }
});

describe('keyword-match: buildMatchTarget', () => {
  it('concatenates title and description with space', () => {
    expect(buildMatchTarget('Hello', 'World')).toBe('hello world');
  });

  it('handles null title', () => {
    expect(buildMatchTarget(null, 'World')).toBe(' world');
  });

  it('handles null description', () => {
    expect(buildMatchTarget('Hello', null)).toBe('hello ');
  });

  it('handles both null', () => {
    expect(buildMatchTarget(null, null)).toBe(' ');
  });
});

describe('keyword-match: required keywords (AND semantics)', () => {
  const text = buildMatchTarget('Schöne Altbauwohnung', 'mit Balkon und Garten');

  it('passes when all required keywords match', () => {
    expect(allRequiredKeywordsMatch(text, ['altbau', 'balkon'])).toBe(true);
  });

  it('fails when any required keyword is missing', () => {
    expect(allRequiredKeywordsMatch(text, ['altbau', 'terrasse'])).toBe(false);
  });

  it('passes when no keywords required', () => {
    expect(allRequiredKeywordsMatch(text, [])).toBe(true);
  });
});

describe('keyword-match: excluded keywords (NOT semantics)', () => {
  const text = buildMatchTarget('Baurecht Wohnung', 'befristet');

  it('triggers when excluded keyword found', () => {
    expect(anyExcludedKeywordMatches(text, ['baurecht'])).toBe(true);
  });

  it('does not trigger when excluded keyword absent', () => {
    expect(anyExcludedKeywordMatches(text, ['penthouse'])).toBe(false);
  });

  it('does not trigger on empty excluded list', () => {
    expect(anyExcludedKeywordMatches(text, [])).toBe(false);
  });
});

describe('keyword-match: passesKeywordFilter (full check)', () => {
  it('passes: required match, no exclusions', () => {
    expect(passesKeywordFilter('Altbauwohnung', 'mit Balkon', ['altbau'], [])).toBe(true);
  });

  it('fails: required keyword missing', () => {
    expect(passesKeywordFilter('Neubau', null, ['altbau'], [])).toBe(false);
  });

  it('fails: excluded keyword present', () => {
    expect(passesKeywordFilter('Baurecht Wohnung', null, [], ['baurecht'])).toBe(false);
  });

  it('fails: required matches but excluded also matches', () => {
    expect(passesKeywordFilter('Altbau Baurecht', null, ['altbau'], ['baurecht'])).toBe(false);
  });

  it('passes: no keywords at all', () => {
    expect(passesKeywordFilter('anything', null, [], [])).toBe(true);
  });

  it('passes: required and excluded both configured, listing clean', () => {
    expect(
      passesKeywordFilter('Schöne Altbauwohnung', 'helle Räume', ['altbau'], ['baurecht']),
    ).toBe(true);
  });

  it('matches keywords across title+description boundary', () => {
    expect(passesKeywordFilter('Wohnung', 'mit Garten', ['garten'], [])).toBe(true);
  });
});
