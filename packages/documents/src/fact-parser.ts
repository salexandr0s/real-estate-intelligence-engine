/**
 * Extract structured real estate facts from German-language text.
 *
 * Targets common Austrian real estate terminology found in exposé PDFs,
 * listing descriptions, and building data sheets.
 */

export interface FactExtraction {
  factType: string;
  factValue: string;
  confidence: 'high' | 'medium' | 'low';
  sourceSnippet: string;
}

interface FactPattern {
  factType: string;
  pattern: RegExp;
  /** Index of the capture group containing the value */
  valueGroup: number;
  confidence: 'high' | 'medium' | 'low';
}

const FACT_PATTERNS: FactPattern[] = [
  // Rent / Miete
  {
    factType: 'rent',
    pattern: /Miete:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'rent',
    pattern: /Gesamtmiete:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'rent',
    pattern: /Nettomiete:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Purchase price
  {
    factType: 'purchase_price',
    pattern: /Kaufpreis:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Area / Fläche
  {
    factType: 'living_area',
    pattern: /Wohnfläche:?\s*([\d.,]+)\s*m²/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'usable_area',
    pattern: /Nutzfläche:?\s*([\d.,]+)\s*m²/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'area',
    pattern: /Fläche:?\s*([\d.,]+)\s*m²/gi,
    valueGroup: 1,
    confidence: 'medium',
  },
  {
    factType: 'area',
    pattern: /Grundfläche:?\s*([\d.,]+)\s*m²/gi,
    valueGroup: 1,
    confidence: 'medium',
  },
  // Rooms / Zimmer
  {
    factType: 'rooms',
    pattern: /(\d+)\s*Zimmer/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'rooms',
    pattern: /Zimmer:?\s*(\d+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Floor / Stock
  {
    factType: 'floor',
    pattern: /(\d+)\.\s*(?:Stock|OG|Etage)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'floor',
    pattern: /(?:Stock|OG|Etage):?\s*(\d+)/gi,
    valueGroup: 1,
    confidence: 'medium',
  },
  {
    factType: 'floor',
    pattern: /Erdgeschoss|EG/gi,
    valueGroup: 0,
    confidence: 'high',
  },
  {
    factType: 'floor',
    pattern: /Dachgeschoss|DG/gi,
    valueGroup: 0,
    confidence: 'high',
  },
  // Building year / Baujahr
  {
    factType: 'building_year',
    pattern: /Baujahr:?\s*(\d{4})/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Energy / HWB
  {
    factType: 'energy_hwb',
    pattern: /HWB:?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'energy_class',
    pattern: /Energieklasse:?\s*([A-G][+]*)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Operating costs / Betriebskosten
  {
    factType: 'operating_costs',
    pattern: /Betriebskosten:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'operating_costs',
    pattern: /BK:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'medium',
  },
  // Heating / Heizung
  {
    factType: 'heating',
    pattern:
      /Heizung:?\s*(Gas|Fernwärme|Zentral(?:heizung)?|Elektro|Fußbodenheizung|Pellets?|Wärmepumpe)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Condition / Zustand
  {
    factType: 'condition',
    pattern: /Zustand:?\s*(Erstbezug|Neubau|saniert|renoviert|gepflegt|renovierungsbedürftig)/gi,
    valueGroup: 1,
    confidence: 'medium',
  },
  // Balcony / Loggia
  {
    factType: 'balcony',
    pattern: /Balkon:?\s*([\d.,]+)\s*m²/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  {
    factType: 'loggia',
    pattern: /Loggia:?\s*([\d.,]+)\s*m²/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Deposit / Kaution
  {
    factType: 'deposit',
    pattern: /Kaution:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'high',
  },
  // Commission / Provision
  {
    factType: 'commission',
    pattern: /Provision:?\s*€?\s*([\d.,]+)/gi,
    valueGroup: 1,
    confidence: 'medium',
  },
  {
    factType: 'commission_free',
    pattern: /provisionsfrei/gi,
    valueGroup: 0,
    confidence: 'high',
  },
];

/** Maximum characters around a match to include in sourceSnippet */
const SNIPPET_CONTEXT = 40;

/**
 * Parse German real estate facts from a text string.
 * Returns all matched facts with confidence levels and source snippets.
 */
export function parseRealEstateFacts(text: string): FactExtraction[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const results: FactExtraction[] = [];
  const seen = new Set<string>();

  for (const factPattern of FACT_PATTERNS) {
    // Reset regex lastIndex for global patterns
    factPattern.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = factPattern.pattern.exec(text)) !== null) {
      const value =
        factPattern.valueGroup === 0 ? (match[0] ?? '') : (match[factPattern.valueGroup] ?? '');

      // Deduplicate: same fact type + value
      const dedupeKey = `${factPattern.factType}:${value.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Build source snippet with surrounding context
      const start = Math.max(0, match.index - SNIPPET_CONTEXT);
      const end = Math.min(text.length, match.index + match[0].length + SNIPPET_CONTEXT);
      const sourceSnippet = text.slice(start, end).replace(/\s+/g, ' ').trim();

      results.push({
        factType: factPattern.factType,
        factValue: value.trim(),
        confidence: factPattern.confidence,
        sourceSnippet,
      });
    }
  }

  return results;
}
