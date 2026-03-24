import type { KeywordEntry } from '@immoradar/contracts';

export const KEYWORD_LEXICON: KeywordEntry[] = [
  // Quality keywords
  { term: 'provisionsfrei', category: 'quality', weight: 8 },
  { term: 'lift', category: 'quality', weight: 4 },
  { term: 'balkon', category: 'quality', weight: 4 },
  { term: 'terrasse', category: 'quality', weight: 6 },
  { term: 'hofruhelage', category: 'quality', weight: 6 },
  { term: 'u-bahn', category: 'quality', weight: 5 },
  { term: 'saniert', category: 'quality', weight: 6 },
  { term: 'renoviert', category: 'quality', weight: 5 },
  { term: 'hell', category: 'quality', weight: 3 },
  { term: 'ruhig', category: 'quality', weight: 3 },
  { term: 'garten', category: 'quality', weight: 5 },

  // Risk keywords
  { term: 'unbefristet vermietet', category: 'risk', weight: 20 },
  { term: 'baurecht', category: 'risk', weight: 20 },
  { term: 'wohnrecht', category: 'risk', weight: 20 },
  { term: 'schimmel', category: 'risk', weight: 25 },
  { term: 'feuchtigkeit', category: 'risk', weight: 20 },
  { term: 'souterrain', category: 'risk', weight: 8 },
  { term: 'kellergeschoss', category: 'risk', weight: 8 },

  // Opportunity keywords
  { term: 'sanierungsbedürftig', category: 'opportunity', weight: 0 },
  { term: 'renovierungsbedürftig', category: 'opportunity', weight: 0 },
  { term: 'bastlerhit', category: 'opportunity', weight: 0 },
  { term: 'ausbaufähig', category: 'opportunity', weight: 0 },
];

function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

export function matchKeywords(text: string): {
  positive: KeywordEntry[];
  negative: KeywordEntry[];
  opportunity: KeywordEntry[];
} {
  const normalized = normalizeForMatching(text);
  const original = text.toLowerCase();
  const combined = `${original} ${normalized}`;

  const positive: KeywordEntry[] = [];
  const negative: KeywordEntry[] = [];
  const opportunity: KeywordEntry[] = [];

  for (const entry of KEYWORD_LEXICON) {
    const termNorm = normalizeForMatching(entry.term);
    if (combined.includes(entry.term) || combined.includes(termNorm)) {
      if (entry.category === 'quality') positive.push(entry);
      else if (entry.category === 'risk') negative.push(entry);
      else if (entry.category === 'opportunity') opportunity.push(entry);
    }
  }

  return { positive, negative, opportunity };
}
