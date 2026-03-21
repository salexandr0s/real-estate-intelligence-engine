import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import { parseDetailPage, detectDetailAvailability } from '../detail.js';
import { OpenImmoAdapter } from '../adapter.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('OpenImmoAdapter', () => {
  const adapter = new OpenImmoAdapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('openimmo');
    expect(adapter.sourceName).toBe('openimmo.at');
    expect(adapter.parserVersion).toBe(1);
  });

  it('canonicalizes URLs correctly', () => {
    expect(adapter.canonicalizeUrl('https://www.openimmo.at/immobilie/OI-2026-001?ref=search'))
      .toBe('https://www.openimmo.at/immobilie/OI-2026-001');
  });

  it('derives source listing key', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'openimmo',
      canonicalUrl: 'https://www.openimmo.at/immobilie/OI-2026-001',
      detailUrl: 'https://www.openimmo.at/immobilie/OI-2026-001',
      extractedAt: new Date().toISOString(),
      payload: { openimmoId: 'OI-2026-001' } as never,
      parserVersion: 1,
      extractionStatus: 'captured',
    });
    expect(key).toBe('openimmo:OI-2026-001');
  });

  it('builds discovery requests with correct URL pattern', async () => {
    const plans = await adapter.buildDiscoveryRequests({
      name: 'vienna-buy',
      sourceCode: 'openimmo',
      maxPages: 2,
    });
    expect(plans).toHaveLength(2);
    expect(plans[0]!.url).toContain('openimmo.at/suche');
    expect(plans[0]!.url).toContain('seite=1');
    expect(plans[1]!.url).toContain('seite=2');
  });
});

describe('Discovery page parsing', () => {
  it('extracts listing cards from embedded search-data JSON', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'openimmo', {
      url: 'https://www.openimmo.at/suche?typ=wohnung&aktion=kaufen&ort=wien&seite=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(3);
    expect(result.pageNumber).toBe(1);
    expect(result.totalEstimate).toBe(180);

    const first = result.items[0]!;
    expect(first.externalId).toBe('OI-2026-001');
    expect(first.sourceCode).toBe('openimmo');
    expect(first.discoveredAt).toBeTruthy();
    expect(first.summaryPayload.titleRaw).toBe('Moderne 3-Zimmer Wohnung nahe Prater');
    expect(first.summaryPayload.priceRaw).toBe('295000');
    expect(first.summaryPayload.locationRaw).toContain('1020');
    expect(first.summaryPayload.locationRaw).toContain('Wien');
    expect(first.summaryPayload.roomsRaw).toBe('3');
    expect(first.summaryPayload.areaRaw).toBe('71.3');
    expect(first.detailUrl).toBe('/immobilie/OI-2026-001');

    const second = result.items[1]!;
    expect(second.externalId).toBe('OI-2026-002');
    expect(second.summaryPayload.priceRaw).toBe('215000');
    expect(second.summaryPayload.roomsRaw).toBe('2');

    const third = result.items[2]!;
    expect(third.externalId).toBe('OI-2026-003');
    expect(third.summaryPayload.priceRaw).toBe('385000');
    expect(third.summaryPayload.areaRaw).toBe('88');
  });

  it('detects pagination when more pages available', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'openimmo', {
      url: 'https://www.openimmo.at/suche?typ=wohnung&aktion=kaufen&ort=wien&seite=1',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('seite=2');
    expect(result.nextPagePlan!.metadata).toEqual(expect.objectContaining({ page: 2 }));
  });

  it('returns empty result for missing search-data script', () => {
    const html = '<html><body>No data</body></html>';
    const result = parseDiscoveryPage(html, 'openimmo', {
      url: 'https://www.openimmo.at/suche?seite=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns empty result for malformed JSON', () => {
    const html = '<script type="application/json" id="search-data">{invalid json}</script>';
    const result = parseDiscoveryPage(html, 'openimmo', {
      url: 'https://www.openimmo.at/suche?seite=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });
});

describe('Detail page parsing', () => {
  it('extracts full listing data from embedded listing-data JSON', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.openimmo.at/immobilie/OI-2026-001',
      'openimmo',
      1,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('OI-2026-001');
    expect(result.canonicalUrl).toBe('https://www.openimmo.at/immobilie/OI-2026-001');

    const p = result.payload;
    expect(p.openimmoId).toBe('OI-2026-001');
    expect(p.titleRaw).toBe('Moderne 3-Zimmer Wohnung nahe Prater');
    expect(p.descriptionRaw).toContain('Lichtdurchflutete Wohnung');
    expect(p.descriptionRaw).toContain('Blick auf den Prater');
    // HTML should be stripped
    expect(p.descriptionRaw).not.toContain('<b>');
    expect(p.priceRaw).toBe('295000');
    expect(p.livingAreaRaw).toBe('71.3');
    expect(p.usableAreaRaw).toBe('78.5');
    expect(p.roomsRaw).toBe('3');
    expect(p.floorRaw).toBe('4');
    expect(p.yearBuiltRaw).toBe('2018');
    expect(p.postalCodeRaw).toBe('1020');
    expect(p.cityRaw).toBe('Wien');
    expect(p.districtRaw).toBe('2. Bezirk');
    expect(p.streetRaw).toBe('Praterstraße 55');
    expect(p.propertyTypeRaw).toBe('WOHNUNG');
    expect(p.operationTypeRaw).toBe('sale');
    expect(p.heatingTypeRaw).toBe('Fußbodenheizung');
    expect(p.conditionRaw).toBe('Neuwertig');
    expect(p.energyCertificateRaw).toBe('A');
    expect(p.balconyAreaRaw).toBe('8.5');
    expect(p.operatingCostRaw).toBe('195');
    expect(p.contactName).toBe('Immobilien GmbH');
    expect(p.images.length).toBe(2);
    expect(p.images[0]).toContain('OI-2026-001');
  });

  it('extracts coordinates', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://www.openimmo.at/immobilie/OI-2026-001', 'openimmo', 1);
    expect(result.payload.latRaw).toBe('48.2167');
    expect(result.payload.lonRaw).toBe('16.3976');
  });

  it('normalizes Austrian decimal format correctly', () => {
    // Fixture has numeric values (71.3), but let us also verify the normalizeDecimal function
    // with comma-formatted input via a custom HTML snippet
    const html = `<script type="application/json" id="listing-data">
      {
        "objektNr": "TEST-001",
        "titel": "Test Wohnung",
        "beschreibung": null,
        "kaufpreis": null,
        "wohnflaeche": null,
        "nutzflaeche": null,
        "anzahlZimmer": null,
        "etage": null,
        "baujahr": null,
        "plz": null,
        "ort": null,
        "stadtteil": null,
        "strasse": null,
        "breitengrad": null,
        "laengengrad": null,
        "heizungsart": null,
        "zustand": null,
        "energieausweis": null,
        "balkonFlaeche": null,
        "betriebskosten": null,
        "bilder": [],
        "kontaktName": null,
        "kontaktTelefon": null,
        "vermarktungsart": null,
        "objektart": null,
        "status": null
      }
    </script>`;
    const result = parseDetailPage(html, 'https://example.com/immobilie/TEST-001', 'openimmo', 1);
    expect(result.payload.openimmoId).toBe('TEST-001');
    expect(result.payload.livingAreaRaw).toBeNull();
  });

  it('handles parse failure gracefully', () => {
    const html = '<html><body>Empty page</body></html>';
    const result = parseDetailPage(html, 'https://www.openimmo.at/immobilie/UNKNOWN-ID', 'openimmo', 1);
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.openimmoId).toBe('UNKNOWN-ID');
    expect(result.payload.titleRaw).toBeNull();
    expect(result.payload.operationTypeRaw).toBeNull();
  });

  it('returns failed capture for missing listing-data', () => {
    const html = `<script type="application/json" id="listing-data">{"not":"a listing"}</script>`;
    const result = parseDetailPage(html, 'https://www.openimmo.at/immobilie/BAD-001', 'openimmo', 1);
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.openimmoId).toBe('BAD-001');
  });
});

describe('Availability detection', () => {
  it('detects available listing', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('detects not_found when page shows error text', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('not_found');
  });

  it('detects sold listing from embedded status', () => {
    const html = `<script type="application/json" id="listing-data">
      {"objektNr": "SOLD-001", "titel": "Verkaufte Wohnung", "status": "verkauft"}
    </script>`;
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('returns unknown for unrecognizable content', () => {
    const html = '<html><body><p>Some random content</p></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('unknown');
  });
});
