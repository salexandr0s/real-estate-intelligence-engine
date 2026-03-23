/**
 * Tests for parseRealEstateFacts — German real estate fact extraction.
 *
 * Covers: individual fact types, multi-fact extraction from realistic
 * exposé text, deduplication, empty/garbage input, and output structure.
 */
import { describe, it, expect } from 'vitest';
import { parseRealEstateFacts } from '../fact-parser.js';
import type { FactExtraction } from '../fact-parser.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function findFact(facts: FactExtraction[], type: string): FactExtraction | undefined {
  return facts.find((f) => f.factType === type);
}

function findAllFacts(facts: FactExtraction[], type: string): FactExtraction[] {
  return facts.filter((f) => f.factType === type);
}

// ── Empty / garbage input ─────────────────────────────────────────────────

describe('empty and garbage input', () => {
  it('returns empty array for empty string', () => {
    expect(parseRealEstateFacts('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseRealEstateFacts('   \n\t  ')).toEqual([]);
  });

  it('returns empty array for unrelated English text', () => {
    const facts = parseRealEstateFacts(
      'The quick brown fox jumps over the lazy dog. Nothing to see here.',
    );
    expect(facts).toEqual([]);
  });

  it('returns empty array for random numbers without keywords', () => {
    const facts = parseRealEstateFacts('123 456 789 3.14 99.99');
    expect(facts).toEqual([]);
  });
});

// ── Output structure ──────────────────────────────────────────────────────

describe('output structure', () => {
  it('each fact has factType, factValue, confidence, and sourceSnippet', () => {
    const facts = parseRealEstateFacts('Kaufpreis: 350.000');
    expect(facts.length).toBeGreaterThanOrEqual(1);

    for (const fact of facts) {
      expect(fact).toHaveProperty('factType');
      expect(fact).toHaveProperty('factValue');
      expect(fact).toHaveProperty('confidence');
      expect(fact).toHaveProperty('sourceSnippet');
      expect(['high', 'medium', 'low']).toContain(fact.confidence);
      expect(typeof fact.factValue).toBe('string');
      expect(typeof fact.sourceSnippet).toBe('string');
    }
  });

  it('sourceSnippet includes surrounding context', () => {
    const text = 'Diese Wohnung hat eine Wohnfläche: 75,5 m² und liegt zentral.';
    const facts = parseRealEstateFacts(text);
    const area = findFact(facts, 'living_area');
    expect(area).toBeDefined();
    expect(area!.sourceSnippet).toContain('Wohnfläche');
    expect(area!.sourceSnippet).toContain('75,5');
  });
});

// ── Purchase price ────────────────────────────────────────────────────────

describe('purchase price (Kaufpreis)', () => {
  it('extracts plain Kaufpreis', () => {
    const facts = parseRealEstateFacts('Kaufpreis: 350.000');
    const price = findFact(facts, 'purchase_price');
    expect(price).toBeDefined();
    expect(price!.factValue).toBe('350.000');
    expect(price!.confidence).toBe('high');
  });

  it('extracts Kaufpreis with euro sign', () => {
    const facts = parseRealEstateFacts('Kaufpreis: € 425.000');
    const price = findFact(facts, 'purchase_price');
    expect(price).toBeDefined();
    expect(price!.factValue).toBe('425.000');
  });

  it('extracts Kaufpreis without colon', () => {
    const facts = parseRealEstateFacts('Kaufpreis 199.500');
    const price = findFact(facts, 'purchase_price');
    expect(price).toBeDefined();
    expect(price!.factValue).toBe('199.500');
  });
});

// ── Rent ──────────────────────────────────────────────────────────────────

describe('rent (Miete)', () => {
  it('extracts Miete', () => {
    const facts = parseRealEstateFacts('Miete: € 1.200,50');
    const rent = findFact(facts, 'rent');
    expect(rent).toBeDefined();
    expect(rent!.factValue).toBe('1.200,50');
    expect(rent!.confidence).toBe('high');
  });

  it('extracts Gesamtmiete', () => {
    const facts = parseRealEstateFacts('Gesamtmiete: 890,00');
    const rent = findFact(facts, 'rent');
    expect(rent).toBeDefined();
    expect(rent!.factValue).toBe('890,00');
  });

  it('extracts Nettomiete', () => {
    const facts = parseRealEstateFacts('Nettomiete: € 650');
    const rent = findFact(facts, 'rent');
    expect(rent).toBeDefined();
    expect(rent!.factValue).toBe('650');
  });
});

// ── Area ──────────────────────────────────────────────────────────────────

describe('area (Fläche)', () => {
  it('extracts Wohnfläche', () => {
    const facts = parseRealEstateFacts('Wohnfläche: 85,3 m²');
    const area = findFact(facts, 'living_area');
    expect(area).toBeDefined();
    expect(area!.factValue).toBe('85,3');
    expect(area!.confidence).toBe('high');
  });

  it('extracts Nutzfläche', () => {
    const facts = parseRealEstateFacts('Nutzfläche: 120 m²');
    const area = findFact(facts, 'usable_area');
    expect(area).toBeDefined();
    expect(area!.factValue).toBe('120');
  });

  it('extracts generic Fläche with medium confidence', () => {
    const facts = parseRealEstateFacts('Fläche: 60 m²');
    const area = findFact(facts, 'area');
    expect(area).toBeDefined();
    expect(area!.factValue).toBe('60');
    expect(area!.confidence).toBe('medium');
  });

  it('extracts Grundfläche', () => {
    const facts = parseRealEstateFacts('Grundfläche: 500 m²');
    const area = findFact(facts, 'area');
    expect(area).toBeDefined();
    expect(area!.factValue).toBe('500');
  });
});

// ── Rooms ─────────────────────────────────────────────────────────────────

describe('rooms (Zimmer)', () => {
  it('extracts "3 Zimmer" format', () => {
    const facts = parseRealEstateFacts('Schöne 3 Zimmer Wohnung');
    const rooms = findFact(facts, 'rooms');
    expect(rooms).toBeDefined();
    expect(rooms!.factValue).toBe('3');
    expect(rooms!.confidence).toBe('high');
  });

  it('extracts "Zimmer: 4" format', () => {
    const facts = parseRealEstateFacts('Zimmer: 4');
    const rooms = findFact(facts, 'rooms');
    expect(rooms).toBeDefined();
    expect(rooms!.factValue).toBe('4');
  });
});

// ── Floor ─────────────────────────────────────────────────────────────────

describe('floor (Stock/Etage)', () => {
  it('extracts "3. Stock" format', () => {
    const facts = parseRealEstateFacts('Lage: 3. Stock');
    const floor = findFact(facts, 'floor');
    expect(floor).toBeDefined();
    expect(floor!.factValue).toBe('3');
    expect(floor!.confidence).toBe('high');
  });

  it('extracts "2. OG" format', () => {
    const facts = parseRealEstateFacts('2. OG mit Aufzug');
    const floor = findFact(facts, 'floor');
    expect(floor).toBeDefined();
    expect(floor!.factValue).toBe('2');
  });

  it('extracts "5. Etage" format', () => {
    const facts = parseRealEstateFacts('5. Etage');
    const floor = findFact(facts, 'floor');
    expect(floor).toBeDefined();
    expect(floor!.factValue).toBe('5');
  });

  it('extracts Erdgeschoss as floor', () => {
    const facts = parseRealEstateFacts('Erdgeschoss mit Garten');
    const floor = findFact(facts, 'floor');
    expect(floor).toBeDefined();
    expect(floor!.factValue).toBe('Erdgeschoss');
    expect(floor!.confidence).toBe('high');
  });

  it('extracts EG abbreviation as floor', () => {
    const facts = parseRealEstateFacts('EG-Wohnung');
    const floor = findFact(facts, 'floor');
    expect(floor).toBeDefined();
    expect(floor!.factValue).toMatch(/EG/);
  });

  it('extracts Dachgeschoss as floor', () => {
    const facts = parseRealEstateFacts('Dachgeschoss mit Terrasse');
    const floor = findFact(facts, 'floor');
    expect(floor).toBeDefined();
    expect(floor!.factValue).toBe('Dachgeschoss');
  });

  it('extracts DG abbreviation as floor', () => {
    const facts = parseRealEstateFacts('DG-Wohnung');
    const floor = findFact(facts, 'floor');
    expect(floor).toBeDefined();
    expect(floor!.factValue).toMatch(/DG/);
  });
});

// ── Building year ─────────────────────────────────────────────────────────

describe('building year (Baujahr)', () => {
  it('extracts Baujahr', () => {
    const facts = parseRealEstateFacts('Baujahr: 1965');
    const year = findFact(facts, 'building_year');
    expect(year).toBeDefined();
    expect(year!.factValue).toBe('1965');
    expect(year!.confidence).toBe('high');
  });

  it('extracts Baujahr without colon', () => {
    const facts = parseRealEstateFacts('Baujahr 2020');
    const year = findFact(facts, 'building_year');
    expect(year).toBeDefined();
    expect(year!.factValue).toBe('2020');
  });
});

// ── Energy ────────────────────────────────────────────────────────────────

describe('energy data', () => {
  it('extracts HWB value', () => {
    const facts = parseRealEstateFacts('HWB: 45,2');
    const hwb = findFact(facts, 'energy_hwb');
    expect(hwb).toBeDefined();
    expect(hwb!.factValue).toBe('45,2');
    expect(hwb!.confidence).toBe('high');
  });

  it('extracts Energieklasse', () => {
    const facts = parseRealEstateFacts('Energieklasse: B');
    const cls = findFact(facts, 'energy_class');
    expect(cls).toBeDefined();
    expect(cls!.factValue).toBe('B');
    expect(cls!.confidence).toBe('high');
  });

  it('extracts Energieklasse with plus suffix', () => {
    const facts = parseRealEstateFacts('Energieklasse: A+');
    const cls = findFact(facts, 'energy_class');
    expect(cls).toBeDefined();
    expect(cls!.factValue).toBe('A+');
  });
});

// ── Operating costs ───────────────────────────────────────────────────────

describe('operating costs (Betriebskosten)', () => {
  it('extracts Betriebskosten', () => {
    const facts = parseRealEstateFacts('Betriebskosten: € 180,50');
    const bk = findFact(facts, 'operating_costs');
    expect(bk).toBeDefined();
    expect(bk!.factValue).toBe('180,50');
    expect(bk!.confidence).toBe('high');
  });

  it('extracts BK abbreviation with medium confidence', () => {
    const facts = parseRealEstateFacts('BK: 210');
    const bk = findFact(facts, 'operating_costs');
    expect(bk).toBeDefined();
    expect(bk!.factValue).toBe('210');
    expect(bk!.confidence).toBe('medium');
  });
});

// ── Heating ───────────────────────────────────────────────────────────────

describe('heating (Heizung)', () => {
  it.each([
    ['Gas', 'Gas'],
    ['Fernwärme', 'Fernwärme'],
    ['Zentralheizung', 'Zentralheizung'],
    ['Zentral', 'Zentral'],
    ['Elektro', 'Elektro'],
    ['Fußbodenheizung', 'Fußbodenheizung'],
    ['Pellets', 'Pellets'],
    ['Wärmepumpe', 'Wärmepumpe'],
  ])('extracts Heizung: %s', (heatingType, expected) => {
    const facts = parseRealEstateFacts(`Heizung: ${heatingType}`);
    const heating = findFact(facts, 'heating');
    expect(heating).toBeDefined();
    expect(heating!.factValue).toBe(expected);
    expect(heating!.confidence).toBe('high');
  });
});

// ── Condition ─────────────────────────────────────────────────────────────

describe('condition (Zustand)', () => {
  it.each(['Erstbezug', 'Neubau', 'saniert', 'renoviert', 'gepflegt', 'renovierungsbedürftig'])(
    'extracts Zustand: %s',
    (condition) => {
      const facts = parseRealEstateFacts(`Zustand: ${condition}`);
      const cond = findFact(facts, 'condition');
      expect(cond).toBeDefined();
      expect(cond!.factValue).toBe(condition);
      expect(cond!.confidence).toBe('medium');
    },
  );
});

// ── Outdoor spaces ────────────────────────────────────────────────────────

describe('outdoor spaces (Balkon/Loggia)', () => {
  it('extracts Balkon area', () => {
    const facts = parseRealEstateFacts('Balkon: 8,5 m²');
    const balcony = findFact(facts, 'balcony');
    expect(balcony).toBeDefined();
    expect(balcony!.factValue).toBe('8,5');
    expect(balcony!.confidence).toBe('high');
  });

  it('extracts Loggia area', () => {
    const facts = parseRealEstateFacts('Loggia: 12 m²');
    const loggia = findFact(facts, 'loggia');
    expect(loggia).toBeDefined();
    expect(loggia!.factValue).toBe('12');
  });
});

// ── Deposit ───────────────────────────────────────────────────────────────

describe('deposit (Kaution)', () => {
  it('extracts Kaution amount', () => {
    const facts = parseRealEstateFacts('Kaution: € 2.400');
    const deposit = findFact(facts, 'deposit');
    expect(deposit).toBeDefined();
    expect(deposit!.factValue).toBe('2.400');
    expect(deposit!.confidence).toBe('high');
  });
});

// ── Commission ────────────────────────────────────────────────────────────

describe('commission (Provision)', () => {
  it('extracts Provision amount with medium confidence', () => {
    const facts = parseRealEstateFacts('Provision: € 5.000');
    const commission = findFact(facts, 'commission');
    expect(commission).toBeDefined();
    expect(commission!.factValue).toBe('5.000');
    expect(commission!.confidence).toBe('medium');
  });

  it('extracts provisionsfrei', () => {
    const facts = parseRealEstateFacts('Diese Wohnung ist provisionsfrei!');
    const free = findFact(facts, 'commission_free');
    expect(free).toBeDefined();
    expect(free!.factValue).toBe('provisionsfrei');
    expect(free!.confidence).toBe('high');
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────

describe('deduplication', () => {
  it('deduplicates identical fact type + value pairs', () => {
    const text = 'Kaufpreis: 350.000 und nochmal Kaufpreis: 350.000';
    const facts = parseRealEstateFacts(text);
    const prices = findAllFacts(facts, 'purchase_price');
    expect(prices).toHaveLength(1);
  });

  it('keeps different values for the same fact type', () => {
    // Miete and Nettomiete both map to 'rent', with different values
    const text = 'Miete: 1.200 und Nettomiete: 800';
    const facts = parseRealEstateFacts(text);
    const rents = findAllFacts(facts, 'rent');
    expect(rents.length).toBe(2);
  });
});

// ── Multi-fact extraction from realistic exposé ───────────────────────────

describe('multi-fact extraction', () => {
  it('extracts multiple facts from a realistic Austrian exposé', () => {
    const expose = [
      'Traumhafte 3 Zimmer Wohnung im 3. Stock',
      'Wohnfläche: 75,5 m²',
      'Balkon: 6,2 m²',
      'Kaufpreis: € 289.000',
      'Betriebskosten: € 195,80',
      'Baujahr: 1972',
      'HWB: 78,5',
      'Energieklasse: C',
      'Heizung: Fernwärme',
      'Zustand: saniert',
      'Kaution: 3.000',
      'provisionsfrei',
    ].join('\n');

    const facts = parseRealEstateFacts(expose);

    // Verify we extracted all expected fact types
    expect(findFact(facts, 'rooms')).toBeDefined();
    expect(findFact(facts, 'rooms')!.factValue).toBe('3');

    expect(findFact(facts, 'floor')).toBeDefined();
    expect(findFact(facts, 'floor')!.factValue).toBe('3');

    expect(findFact(facts, 'living_area')).toBeDefined();
    expect(findFact(facts, 'living_area')!.factValue).toBe('75,5');

    expect(findFact(facts, 'balcony')).toBeDefined();
    expect(findFact(facts, 'balcony')!.factValue).toBe('6,2');

    expect(findFact(facts, 'purchase_price')).toBeDefined();
    expect(findFact(facts, 'purchase_price')!.factValue).toBe('289.000');

    expect(findFact(facts, 'operating_costs')).toBeDefined();
    expect(findFact(facts, 'operating_costs')!.factValue).toBe('195,80');

    expect(findFact(facts, 'building_year')).toBeDefined();
    expect(findFact(facts, 'building_year')!.factValue).toBe('1972');

    expect(findFact(facts, 'energy_hwb')).toBeDefined();
    expect(findFact(facts, 'energy_hwb')!.factValue).toBe('78,5');

    expect(findFact(facts, 'energy_class')).toBeDefined();
    expect(findFact(facts, 'energy_class')!.factValue).toBe('C');

    expect(findFact(facts, 'heating')).toBeDefined();
    expect(findFact(facts, 'heating')!.factValue).toBe('Fernwärme');

    expect(findFact(facts, 'condition')).toBeDefined();
    expect(findFact(facts, 'condition')!.factValue).toBe('saniert');

    expect(findFact(facts, 'deposit')).toBeDefined();
    expect(findFact(facts, 'deposit')!.factValue).toBe('3.000');

    expect(findFact(facts, 'commission_free')).toBeDefined();
    expect(findFact(facts, 'commission_free')!.factValue).toBe('provisionsfrei');

    // Verify we got a reasonable total count
    expect(facts.length).toBeGreaterThanOrEqual(12);
  });

  it('extracts facts from a rental listing exposé', () => {
    const expose = [
      'Gepflegte 2 Zimmer Wohnung im Erdgeschoss',
      'Nutzfläche: 55,0 m²',
      'Loggia: 4,5 m²',
      'Nettomiete: € 680',
      'BK: € 150',
      'Heizung: Gas',
      'Provision: € 1.360',
      'Kaution: € 2.040',
    ].join('\n');

    const facts = parseRealEstateFacts(expose);

    expect(findFact(facts, 'rooms')!.factValue).toBe('2');
    // "Erdgeschoss" also contains "EG", and the EG pattern matches first
    const floors = findAllFacts(facts, 'floor');
    const floorValues = floors.map((f) => f.factValue);
    expect(floorValues).toContain('Erdgeschoss');
    expect(findFact(facts, 'usable_area')!.factValue).toBe('55,0');
    expect(findFact(facts, 'loggia')!.factValue).toBe('4,5');
    expect(findFact(facts, 'rent')!.factValue).toBe('680');
    expect(findFact(facts, 'heating')!.factValue).toBe('Gas');
    expect(findFact(facts, 'commission')!.factValue).toBe('1.360');
    expect(findFact(facts, 'deposit')!.factValue).toBe('2.040');
  });
});
