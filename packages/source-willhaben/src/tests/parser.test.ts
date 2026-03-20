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
  it('extracts listing cards from fixture', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'willhaben', {
      url: 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/wien/?page=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(3);
    expect(result.pageNumber).toBe(1);
    expect(result.nextPagePlan).not.toBeNull();

    const first = result.items[0]!;
    expect(first.externalId).toBe('987654321');
    expect(first.summaryPayload.titleRaw).toContain('3-Zimmer');
    expect(first.summaryPayload.priceRaw).toContain('299.000');
    expect(first.summaryPayload.locationRaw).toContain('1020');
    expect(first.detailUrl).toContain('987654321');
  });

  it('detects pagination', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'willhaben', {
      url: 'https://www.willhaben.at/?page=1',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('page=2');
  });
});

describe('Detail page parsing', () => {
  it('extracts full listing data from fixture', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.willhaben.at/iad/immobilien/987654321',
      'willhaben',
      1,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('987654321');

    const p = result.payload;
    expect(p.titleRaw).toContain('3-Zimmer');
    expect(p.titleRaw).toContain('provisionsfrei');
    expect(p.priceRaw).toContain('299.000');
    expect(p.descriptionRaw).toContain('Balkon');
    expect(p.addressRaw).toContain('Taborstraße');
    expect(p.postalCodeRaw).toBe('1020');
    expect(p.cityRaw).toBe('Wien');
    expect(p.propertyTypeRaw).toBe('Eigentumswohnung');
    expect(p.operationTypeRaw).toBe('sale');

    // Attributes from structured data
    expect(p.attributesRaw?.['Wohnfläche']).toBe('58,4 m²');
    expect(p.attributesRaw?.['Zimmer']).toBe('3');
    expect(p.attributesRaw?.['Baujahr']).toBe('1905');
    expect(p.attributesRaw?.['Heizung']).toBe('Zentralheizung');
  });

  it('extracts JSON-LD data', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/123', 'willhaben', 1);
    // JSON-LD should provide fallback for price and type
    expect(result.payload.priceRaw).toBeTruthy();
  });
});

describe('Availability detection', () => {
  it('detects available listing', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('detects sold/removed listing', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('removed');
  });
});
