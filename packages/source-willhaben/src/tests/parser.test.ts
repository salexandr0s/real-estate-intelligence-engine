import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import { parseDetailPage, detectDetailAvailability } from '../detail.js';
import { WillhabenAdapter } from '../adapter.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('WillhabenAdapter', () => {
  const adapter = new WillhabenAdapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('willhaben');
    expect(adapter.sourceName).toBe('willhaben.at');
    expect(adapter.parserVersion).toBe(1);
  });

  it('canonicalizes URLs correctly', () => {
    expect(adapter.canonicalizeUrl('https://www.willhaben.at/iad/immobilien/123?ref=search'))
      .toBe('https://www.willhaben.at/iad/immobilien/123');
  });

  it('derives source listing key', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'willhaben',
      canonicalUrl: 'https://example.com/123',
      detailUrl: 'https://example.com/123',
      extractedAt: new Date().toISOString(),
      payload: { willhabenId: '987654321' } as never,
      parserVersion: 1,
      extractionStatus: 'captured',
    });
    expect(key).toBe('willhaben:987654321');
  });
});

describe('Discovery page parsing', () => {
  it('extracts listing cards from __NEXT_DATA__', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'willhaben', {
      url: 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?page=1&rows=25&sort=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(3);
    expect(result.pageNumber).toBe(1);
    expect(result.totalEstimate).toBe(500);
    expect(result.nextPagePlan).not.toBeNull();

    const first = result.items[0]!;
    expect(first.externalId).toBe('987654321');
    expect(first.summaryPayload.titleRaw).toContain('3-Zimmer');
    expect(first.summaryPayload.priceRaw).toBe('299000');
    expect(first.summaryPayload.locationRaw).toContain('1020');
    expect(first.detailUrl).toContain('987654321');
  });

  it('detects pagination', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'willhaben', {
      url: 'https://www.willhaben.at/iad/immobilien?page=1&rows=25',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('page=2');
  });

  it('returns empty result for missing __NEXT_DATA__', () => {
    const html = '<html><body>No data</body></html>';
    const result = parseDiscoveryPage(html, 'willhaben', {
      url: 'https://www.willhaben.at/?page=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });
});

describe('Detail page parsing', () => {
  it('extracts full listing data from __NEXT_DATA__', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1020-leopoldstadt/3-zimmer-eigentumswohnung-987654321/',
      'willhaben',
      1,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('987654321');

    const p = result.payload;
    expect(p.titleRaw).toContain('3-Zimmer');
    expect(p.titleRaw).toContain('provisionsfrei');
    expect(p.priceRaw).toBe('299000');
    expect(p.descriptionRaw).toContain('Balkon');
    expect(p.livingAreaRaw).toBe('58.4');
    expect(p.roomsRaw).toBe('3');
    expect(p.floorRaw).toBe('3');
    expect(p.yearBuiltRaw).toBe('1905');
    expect(p.cityRaw).toBe('Wien');
    expect(p.postalCodeRaw).toBe('1020');
    expect(p.propertyTypeRaw).toBe('Eigentumswohnung');
    expect(p.operationTypeRaw).toBe('sale');
    expect(p.heatingTypeRaw).toBe('Zentralheizung');
    expect(p.conditionRaw).toBe('Gut');
    expect(p.energyCertificateRaw).toBe('C');
    expect(p.balconyAreaRaw).toBe('4.5');
    expect(p.districtRaw).toBe('2. Bezirk');
    expect(p.contactName).toBe('Max Mustermann');
    expect(p.images.length).toBe(2);
  });

  it('extracts coordinates', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/987654321', 'willhaben', 1);
    expect(result.payload.latRaw).toBe('48.2183');
    expect(result.payload.lonRaw).toBe('16.3836');
  });

  it('handles parse failure gracefully', () => {
    const html = '<html><body>Empty</body></html>';
    const result = parseDetailPage(html, 'https://example.com/123', 'willhaben', 1);
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.willhabenId).toBe('123');
  });
});

describe('Availability detection', () => {
  it('detects available listing', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('detects removed listing (is404)', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('not_found');
  });
});
