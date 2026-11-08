import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import {
  parseDetailPage,
  detectDetailAvailability,
  normalizeDecimal,
  stripHtml,
  extractIdFromUrl,
} from '../detail.js';
import { FindMyHomeAdapter } from '../adapter.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

// ── Adapter metadata ────────────────────────────────────────────────────────

describe('FindMyHomeAdapter', () => {
  const adapter = new FindMyHomeAdapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('findmyhome');
    expect(adapter.sourceName).toBe('findmyhome.at');
    expect(adapter.parserVersion).toBe(3);
  });

  it('canonicalizes URLs correctly', () => {
    expect(
      adapter.canonicalizeUrl(
        'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-wohnung-501234?ref=search&utm_source=google',
      ),
    ).toBe('https://www.findmyhome.at/kaufen/wohnung/wien/schoene-wohnung-501234');
  });

  it('strips trailing slash from canonicalized URLs', () => {
    expect(
      adapter.canonicalizeUrl('https://www.findmyhome.at/kaufen/wohnung/wien/wohnung-501234/'),
    ).toBe('https://www.findmyhome.at/kaufen/wohnung/wien/wohnung-501234');
  });

  it('derives source listing key from findmyhomeId', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'findmyhome',
      canonicalUrl: 'https://www.findmyhome.at/kaufen/wohnung/501234',
      detailUrl: 'https://www.findmyhome.at/kaufen/wohnung/501234',
      extractedAt: new Date().toISOString(),
      payload: { findmyhomeId: '501234' } as never,
      parserVersion: 2,
      extractionStatus: 'captured',
    });
    expect(key).toBe('findmyhome:501234');
  });

  it('derives source listing key from externalId as fallback', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'findmyhome',
      externalId: '999888',
      canonicalUrl: 'https://www.findmyhome.at/kaufen/wohnung/999888',
      detailUrl: 'https://www.findmyhome.at/kaufen/wohnung/999888',
      extractedAt: new Date().toISOString(),
      payload: { findmyhomeId: '' } as never,
      parserVersion: 2,
      extractionStatus: 'captured',
    });
    expect(key).toBe('findmyhome:999888');
  });
});

// ── Discovery parsing ───────────────────────────────────────────────────────

describe('Discovery page parsing', () => {
  it('extracts 3 listing items from HTML cards', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(3);
    expect(result.pageNumber).toBe(1);
    expect(result.totalEstimate).toBe(250);
  });

  it('extracts correct IDs from all items', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    expect(result.items[0]!.externalId).toBe('5501234');
    expect(result.items[1]!.externalId).toBe('5501235');
    expect(result.items[2]!.externalId).toBe('5501236');
  });

  it('extracts correct fields from first discovery item', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    const first = result.items[0]!;
    expect(first.externalId).toBe('5501234');
    expect(first.sourceCode).toBe('findmyhome');
    expect(first.summaryPayload.findmyhomeId).toBe('5501234');
    expect(first.summaryPayload.titleRaw).toContain('3-Zimmer');
    expect(first.summaryPayload.titleRaw).toContain('Leopoldstadt');
    expect(first.summaryPayload.priceRaw).toBe('310000');
    expect(first.summaryPayload.locationRaw).toBe('1020 Wien');
    expect(first.summaryPayload.roomsRaw).toBe('3.0');
    expect(first.summaryPayload.areaRaw).toBe('74');
    expect(first.detailUrl).toBe('https://www.findmyhome.at/5501234');
  });

  it('extracts correct fields from second and third items', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    const second = result.items[1]!;
    expect(second.externalId).toBe('5501235');
    expect(second.summaryPayload.priceRaw).toBe('245000');
    expect(second.summaryPayload.roomsRaw).toBe('2.0');
    expect(second.summaryPayload.locationRaw).toBe('1030 Wien');
    expect(second.summaryPayload.areaRaw).toBe('52');

    const third = result.items[2]!;
    expect(third.externalId).toBe('5501236');
    expect(third.summaryPayload.priceRaw).toBe('420000');
    expect(third.summaryPayload.roomsRaw).toBe('4.0');
    expect(third.summaryPayload.locationRaw).toBe('1100 Wien');
    expect(third.summaryPayload.areaRaw).toBe('92');
  });

  it('strips ?tl=1 from extracted IDs (premium listing flag)', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    // Second card has ?tl=1 in its href
    const second = result.items[1]!;
    expect(second.externalId).toBe('5501235');
    expect(second.detailUrl).toBe('https://www.findmyhome.at/5501235');
    expect(second.detailUrl).not.toContain('?tl=1');
  });

  it('detects pagination when more items available', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('entry=20');
    expect(result.nextPagePlan!.metadata?.['page']).toBe(2);
  });

  it('returns nextPagePlan when more pages exist', () => {
    const html = `<html><body>
      <p>Wir haben 250 Immobilien</p>
      <!-- **** IMMO LIST ***** -->
      <a class="btnHeadlineErgebnisliste" href="/7770001">Pagination Test</a>
      <strong>Ort: 1020</strong> Wien
      <strong>Kaufpreis:</strong><br>300.000,- EUR
      <strong>Flaeche:</strong><br>65 m2
      <strong>Zimmer:</strong><br>3.0
      <nav class="pagination"><a href="?entry=20">2</a></nav>
    </body></html>`;
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('entry=20');
    expect(result.nextPagePlan!.metadata!['page']).toBe(2);
  });

  it('returns nextPagePlan null when no items found', () => {
    const html = '<html><body><p>Wir haben 0 Immobilien</p></body></html>';
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns empty result for HTML without listing cards', () => {
    const html = '<html><body><h1>No data here</h1></body></html>';
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
    expect(result.totalEstimate).toBeNull();
  });

  it('returns empty result for empty HTML', () => {
    const html = '';
    const result = parseDiscoveryPage(html, 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });
});

// ── Detail parsing ──────────────────────────────────────────────────────────

describe('Detail page parsing', () => {
  it('extracts full listing data from JSON-LD Apartment', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-3-zimmer-wohnung-501234',
      'findmyhome',
      1,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('501234');
    expect(result.sourceCode).toBe('findmyhome');

    const p = result.payload;
    expect(p.findmyhomeId).toBe('501234');
    expect(p.titleRaw).toContain('3-Zimmer');
    expect(p.titleRaw).toContain('Leopoldstadt');
    expect(p.priceRaw).toBe('310000');
    expect(p.descriptionRaw).toContain('lichtdurchflutete');
    expect(p.descriptionRaw).toContain('Balkon');
    expect(p.livingAreaRaw).toBe('74.5');
    expect(p.roomsRaw).toBe('3');
    expect(p.yearBuiltRaw).toBe('1905');
    expect(p.cityRaw).toBe('Wien');
    expect(p.postalCodeRaw).toBe('1020');
    expect(p.districtRaw).toBe('Leopoldstadt');
    expect(p.operationTypeRaw).toBe('sale');
    expect(p.heatingTypeRaw).toBe('Fernw\u00e4rme');
    expect(p.conditionRaw).toBe('Saniert');
    expect(p.energyCertificateRaw).toBe('C');
    expect(p.operatingCostRaw).toBe('285');
    expect(p.floorRaw).toBe('3');
    expect(p.contactName).toBe('Mag. Anna Berger');
    expect(p.contactPhone).toBe('+43 1 987 6543');
    expect(p.contactEmail).toBeNull();
    expect(p.propertyTypeRaw).toBe('Wohnung');
  });

  it('extracts coordinates from geo block', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-3-zimmer-wohnung-501234',
      'findmyhome',
      1,
    );

    expect(result.payload.latRaw).toBe('48.2183');
    expect(result.payload.lonRaw).toBe('16.3836');
  });

  it('extracts all images from photo array', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-3-zimmer-wohnung-501234',
      'findmyhome',
      1,
    );

    expect(result.payload.images.length).toBe(3);
    expect(result.payload.images[0]).toContain('photo1.jpg');
    expect(result.payload.images[1]).toContain('photo2.jpg');
    expect(result.payload.images[2]).toContain('photo3.jpg');
  });

  it('extracts amenity features into attributesRaw', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-3-zimmer-wohnung-501234',
      'findmyhome',
      1,
    );

    const attrs = result.payload.attributesRaw as Record<string, unknown>;
    expect(attrs['hasBalcony']).toBe(true);
    expect(attrs['hasElevator']).toBe(true);
    expect(attrs['amenities']).toEqual(['Balkon', 'Lift']);
  });

  it('normalizes Austrian decimal format (74,5 -> 74.5)', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-3-zimmer-wohnung-501234',
      'findmyhome',
      1,
    );

    // "74,5" in fixture -> "74.5" after normalizeDecimal
    expect(result.payload.livingAreaRaw).toBe('74.5');
  });

  it('handles parse failure gracefully when no JSON-LD present', () => {
    const html = '<html><body>Empty page</body></html>';
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/wien/some-listing-789012',
      'findmyhome',
      1,
    );

    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.findmyhomeId).toBe('789012');
    expect(result.payload.titleRaw).toBeNull();
    expect(result.payload.priceRaw).toBeNull();
    expect(result.payload.operationTypeRaw).toBeNull();
    expect(result.payload.images).toEqual([]);
  });

  it('takes the title from the h1, decoded and without the "Objektnr." suffix', () => {
    // og:title is "Immobilie von FindMyHome.at" on every page.
    const html = loadFixture('detail-live.html');
    const result = parseDetailPage(html, 'https://www.findmyhome.at/5501234', 'findmyhome', 3);

    expect(result.extractionStatus).toBe('captured');
    expect(result.payload.titleRaw).toBe('Schöne 3-Zimmer Wohnung & Balkon in Leopoldstadt');
  });

  it('reads price, address and property type by their labels', () => {
    // The first header value is the postal code, not the price.
    const html = loadFixture('detail-live.html');
    const p = parseDetailPage(html, 'https://www.findmyhome.at/5501234', 'findmyhome', 3).payload;

    expect(p.priceRaw).toBe('310000.00');
    expect(p.addressRaw).toBe('1020 Wien, Leopoldstadt / Wien 2., Leo');
    expect(p.postalCodeRaw).toBe('1020');
    expect(p.cityRaw).toBe('Wien');
    expect(p.propertyTypeRaw).toBe('Wohnung - Eigentum');
    expect(p.operationTypeRaw).toBe('sale');
    // The row reads "Betriebskosten (inkl. MwSt):", which an exact label lookup missed.
    expect(p.operatingCostRaw).toBe('€ 285,00');
  });

  it('reads a rent page as rent, priced by its monthly total', () => {
    const html = `<h1>Mietwohnung nahe Prater - Objektnr. 5501299</h1>
      <span class="immo_header_value">1020</span><hr class="immo_header_hr"><span class="immo_header_desc">Ort</span>
      <span class="immo_header_value">€ 1.250,00</span><hr class="immo_header_hr"><span class="immo_header_desc">Gesamtkosten</span>
      <table><tr><td>Immobilienart</td><td>Miete</td></tr></table>`;
    const p = parseDetailPage(html, 'https://www.findmyhome.at/5501299', 'findmyhome', 3).payload;

    expect(p.operationTypeRaw).toBe('rent');
    expect(p.priceRaw).toBe('1250.00');
  });

  it('finds the postal code and city when the address starts with the street', () => {
    const html = `<h1>Wohnung nahe Schönbrunn - Objektnr. 5501300</h1>
      <table><tr><td>Anschrift</td><td align="right">Musterstraße 1/5 1120&nbsp;Wien<br></td></tr></table>`;
    const p = parseDetailPage(html, 'https://www.findmyhome.at/5501300', 'findmyhome', 3).payload;

    expect(p.postalCodeRaw).toBe('1120');
    expect(p.cityRaw).toBe('Wien');
  });

  it('returns a failed capture for a page without the price header or facts table', () => {
    const html = loadFixture('detail-soft-404.html');
    const result = parseDetailPage(html, 'https://www.findmyhome.at/5501234', 'findmyhome', 2);

    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.titleRaw).toBeNull();
  });

  it('derives the key discovery gave the sighting', async () => {
    const adapter = new FindMyHomeAdapter();
    const item = parseDiscoveryPage(loadFixture('discovery-page.html'), 'findmyhome', {
      url: 'https://www.findmyhome.at/immobiliensuche?seite=1',
      metadata: { page: 1 },
    }).items[0]!;
    const plan = await adapter.buildDetailRequest(item);
    const capture = parseDetailPage(loadFixture('detail-live.html'), plan!.url, 'findmyhome', 2);

    // The discovery worker keys a sighting as `${sourceCode}:${externalId}`.
    expect(adapter.deriveSourceListingKey(capture)).toBe(`findmyhome:${item.externalId}`);
  });

  it('strips HTML tags from description', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/501234',
      'findmyhome',
      1,
    );

    // The description in the fixture contains <b>Balkon</b> — should be stripped
    expect(result.payload.descriptionRaw).not.toContain('<b>');
    expect(result.payload.descriptionRaw).toContain('Balkon');
  });

  it('builds correct canonical URL without query params', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-wohnung-501234?ref=search',
      'findmyhome',
      1,
    );

    expect(result.canonicalUrl).toBe(
      'https://www.findmyhome.at/kaufen/wohnung/wien/schoene-wohnung-501234',
    );
  });
});

// ── Helper functions ────────────────────────────────────────────────────────

describe('normalizeDecimal', () => {
  it('converts Austrian comma format', () => {
    expect(normalizeDecimal('74,5')).toBe('74.5');
  });

  it('handles thousands separator with comma decimal', () => {
    expect(normalizeDecimal('1.250,50')).toBe('1250.50');
  });

  it('passes through integer values', () => {
    expect(normalizeDecimal('86')).toBe('86');
  });

  it('passes through dot-decimal values', () => {
    expect(normalizeDecimal('74.5')).toBe('74.5');
  });

  it('returns null for null input', () => {
    expect(normalizeDecimal(null)).toBeNull();
  });

  it('trims whitespace', () => {
    expect(normalizeDecimal('  58,4  ')).toBe('58.4');
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>Hello</p>  <p>world</p>')).toBe('Hello world');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('extractIdFromUrl', () => {
  it('extracts ID from slug-ID URL pattern', () => {
    expect(
      extractIdFromUrl('https://www.findmyhome.at/kaufen/wohnung/wien/schoene-wohnung-501234'),
    ).toBe('501234');
  });

  it('extracts ID from numeric path segment', () => {
    expect(extractIdFromUrl('https://www.findmyhome.at/listing/501234')).toBe('501234');
  });

  it('handles trailing slash', () => {
    expect(extractIdFromUrl('https://www.findmyhome.at/kaufen/wohnung/wien/wohnung-501234/')).toBe(
      '501234',
    );
  });

  it('handles query parameters', () => {
    expect(
      extractIdFromUrl('https://www.findmyhome.at/kaufen/wohnung/wien/wohnung-501234?ref=search'),
    ).toBe('501234');
  });

  it('returns null for non-numeric path', () => {
    expect(extractIdFromUrl('https://www.findmyhome.at/about')).toBeNull();
  });
});

// ── Availability detection ──────────────────────────────────────────────────

describe('Availability detection', () => {
  it('detects available listing from JSON-LD presence', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('reports a "nicht mehr verfügbar" page as removed, which retires it even on a 200', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('removed');
  });

  it('detects sold listing from its headline', () => {
    const html = '<html><body><h1>Dieses Objekt wurde bereits verkauft.</h1></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('detects reserved listing from its headline', () => {
    const html = '<html><head><title>Reserviert | FindMyHome</title></head><body></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('reserved');
  });

  it('stays available when the description says "verkauft"', () => {
    // Project listings mark their sold units in the description.
    const html = loadFixture('detail-live.html');
    expect(detectDetailAvailability(html).status).toBe('available');
  });

  it('reads a soft 404 as unknown, not available or blocked', () => {
    // It has an h1 and loads reCAPTCHA like every page on the site, but holds no listing.
    const html = loadFixture('detail-soft-404.html');
    expect(detectDetailAvailability(html).status).toBe('unknown');
  });

  it('detects a challenge page', () => {
    const html = '<html><head><title>Just a moment...</title></head><body></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('blocked');
  });

  it('returns unknown for unrecognized HTML', () => {
    const html = '<html><body><p>Some unrelated page</p></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('unknown');
  });
});
