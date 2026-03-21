import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import { parseDetailPage, detectDetailAvailability } from '../detail.js';
import { Immoscout24Adapter } from '../adapter.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('Immoscout24Adapter', () => {
  const adapter = new Immoscout24Adapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('immoscout24');
    expect(adapter.sourceName).toBe('ImmobilienScout24.at');
    expect(adapter.parserVersion).toBe(2);
  });

  it('canonicalizes URLs correctly', () => {
    expect(adapter.canonicalizeUrl('https://www.immobilienscout24.at/expose/abc123def456789012345678?ref=search'))
      .toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
  });

  it('strips trailing slash from canonical URL', () => {
    expect(adapter.canonicalizeUrl('https://www.immobilienscout24.at/expose/abc123def456789012345678/'))
      .toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
  });

  it('derives source listing key from hex hash ID', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'immoscout24',
      canonicalUrl: 'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      detailUrl: 'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      extractedAt: new Date().toISOString(),
      payload: { immoscout24Id: 'abc123def456789012345678' } as never,
      parserVersion: 2,
      extractionStatus: 'captured',
    });
    expect(key).toBe('immoscout24:abc123def456789012345678');
  });

  it('builds discovery requests with correct selector', async () => {
    const plans = await adapter.buildDiscoveryRequests({
      name: 'test',
      sourceCode: 'immoscout24',
      maxPages: 2,
    });
    expect(plans).toHaveLength(2);
    expect(plans[0]!.waitForSelector).toBe('script[data-testid="collection-page-structured-data"]');
    expect(plans[0]!.url).toContain('/regional/oesterreich/immobilien');
    expect(plans[1]!.url).toContain('pagenumber=2');
  });

  it('builds detail request with correct URL', async () => {
    const plan = await adapter.buildDetailRequest({
      detailUrl: 'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      externalId: 'abc123def456789012345678',
      sourceCode: 'immoscout24',
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        exposeId: 'abc123def456789012345678',
        detailUrl: 'https://www.immobilienscout24.at/expose/abc123def456789012345678',
        titleRaw: 'Test',
        priceRaw: null,
        locationRaw: '1020 Wien',
        roomsRaw: '3',
        areaRaw: '65.20',
      },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
    expect(plan!.waitForSelector).toBe('script[type="application/ld+json"]');
  });
});

describe('Discovery page parsing (CollectionPage JSON-LD)', () => {
  it('extracts listing items from CollectionPage JSON-LD', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(3);
    expect(result.pageNumber).toBe(1);

    const first = result.items[0]!;
    expect(first.externalId).toBe('abc123def456789012345678');
    expect(first.summaryPayload.titleRaw).toContain('3-Zimmer');
    expect(first.summaryPayload.titleRaw).toContain('Balkon');
    expect(first.summaryPayload.locationRaw).toContain('1020');
    expect(first.summaryPayload.locationRaw).toContain('Wien');
    expect(first.summaryPayload.roomsRaw).toBe('3');
    expect(first.summaryPayload.areaRaw).toBe('65.20');
    expect(first.detailUrl).toContain('/expose/abc123def456789012345678');
  });

  it('extracts all three listings with correct hex hash IDs', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });

    expect(result.items[0]!.externalId).toBe('abc123def456789012345678');
    expect(result.items[1]!.externalId).toBe('def789abc012345678901234');
    expect(result.items[2]!.externalId).toBe('789012345abc678def901234');
  });

  it('parses Austrian decimal area correctly', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });

    // "65,20 m2" -> "65.20"
    expect(result.items[0]!.summaryPayload.areaRaw).toBe('65.20');
    // "48 m2" -> "48"
    expect(result.items[1]!.summaryPayload.areaRaw).toBe('48');
    // "110,50 m2" -> "110.50"
    expect(result.items[2]!.summaryPayload.areaRaw).toBe('110.50');
  });

  it('detects pagination and builds next page URL', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('pagenumber=2');
  });

  it('returns totalEstimate from numberOfItems', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });
    expect(result.totalEstimate).toBe(15);
  });

  it('returns empty result for missing JSON-LD', () => {
    const html = '<html><body>No data</body></html>';
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns empty result for invalid JSON', () => {
    const html = '<script data-testid="collection-page-structured-data" type="application/ld+json">{invalid json</script>';
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('includes discoveredAt and sourceCode on items', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/oesterreich/immobilien?pagenumber=1',
      metadata: { page: 1 },
    });

    const first = result.items[0]!;
    expect(first.sourceCode).toBe('immoscout24');
    expect(first.discoveredAt).toBeTruthy();
    expect(() => new Date(first.discoveredAt)).not.toThrow();
  });
});

describe('Detail page parsing (Product + RealEstateAgent JSON-LD)', () => {
  it('extracts listing data from Product JSON-LD', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('abc123def456789012345678');

    const p = result.payload;
    expect(p.titleRaw).toContain('3-Zimmer');
    expect(p.titleRaw).toContain('Balkon');
    expect(p.priceRaw).toBe('299000');
    expect(p.descriptionRaw).toContain('Balkon');
    expect(p.descriptionRaw).toContain('Leopoldstadt');
    expect(p.livingAreaRaw).toBe('65.20');
    expect(p.roomsRaw).toBe('3');
    expect(p.images.length).toBe(3);
  });

  it('extracts agent name from RealEstateAgent JSON-LD', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );
    expect(result.payload.contactName).toBe('Immo Partner GmbH');
    expect(result.payload.brokerName).toBe('Immo Partner GmbH');
  });

  it('extracts address from description text', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );
    expect(result.payload.addressRaw).toContain('Taborstra\u00dfe');
    expect(result.payload.postalCodeRaw).toBe('1020');
    expect(result.payload.cityRaw).toBe('Wien');
  });

  it('derives district from Vienna postcode', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );
    expect(result.payload.districtRaw).toBe('2. Bezirk');
  });

  it('extracts balcony area from description', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );
    expect(result.payload.balconyAreaRaw).toBe('4.50');
  });

  it('extracts floor and year built from description', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );
    expect(result.payload.floorRaw).toBe('3');
    expect(result.payload.yearBuiltRaw).toBe('1905');
  });

  it('builds canonical URL from expose ID', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678?ref=search',
      'immoscout24',
      2,
    );
    expect(result.canonicalUrl).toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
  });

  it('handles parse failure gracefully (no JSON-LD)', () => {
    const html = '<html><body>Empty</body></html>';
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.immoscout24Id).toBe('abc123def456789012345678');
    expect(result.payload.operationTypeRaw).toBeNull();
  });

  it('handles missing Product JSON-LD (only WebPage present)', () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"WebPage","name":"Test"}</script>
    </body></html>`;
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      'immoscout24',
      2,
    );
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.priceRaw).toBeNull();
    expect(result.payload.livingAreaRaw).toBeNull();
  });
});

describe('Availability detection (JSON-LD based)', () => {
  it('detects available listing (Product with InStock)', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('detects not_found listing (no Product JSON-LD, "nicht gefunden" text)', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('not_found');
  });

  it('detects sold listing from Product with SoldOut availability', () => {
    const html = `<html><body>
      <script type="application/ld+json">{
        "@type":"Product","name":"Test","description":"","image":[],
        "offers":{"@type":"Offer","price":0,"priceCurrency":"EUR","availability":"https://schema.org/SoldOut"}
      }</script>
    </body></html>`;
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('detects sold listing from text markers', () => {
    const html = '<html><body><h1>Dieses Objekt wurde verkauft</h1></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('returns unknown for empty page without markers', () => {
    const html = '<html><body></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('unknown');
  });

  it('detects blocked page from captcha markers', () => {
    const html = '<html><body><div class="captcha">Please verify</div></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('blocked');
  });
});
