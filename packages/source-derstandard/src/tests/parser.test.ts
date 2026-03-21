import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import { parseDetailPage, detectDetailAvailability } from '../detail.js';
import { DerStandardAdapter } from '../adapter.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('DerStandardAdapter', () => {
  const adapter = new DerStandardAdapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('derstandard');
    expect(adapter.sourceName).toBe('derstandard.at Immobilien');
    expect(adapter.parserVersion).toBe(2);
  });

  it('canonicalizes URLs correctly', () => {
    expect(
      adapter.canonicalizeUrl(
        'https://immobilien.derstandard.at/detail/15086452/slug?ref=search',
      ),
    ).toBe('https://immobilien.derstandard.at/detail/15086452/slug');
  });

  it('strips trailing slash during canonicalization', () => {
    expect(
      adapter.canonicalizeUrl('https://immobilien.derstandard.at/detail/15086452/slug/'),
    ).toBe('https://immobilien.derstandard.at/detail/15086452/slug');
  });

  it('derives source listing key', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'derstandard',
      canonicalUrl: 'https://immobilien.derstandard.at/detail/15086452/slug',
      detailUrl: 'https://immobilien.derstandard.at/detail/15086452/slug',
      extractedAt: new Date().toISOString(),
      payload: { standardId: '15086452' } as never,
      parserVersion: 2,
      extractionStatus: 'captured',
    });
    expect(key).toBe('derstandard:15086452');
  });

  it('builds discovery requests with correct pagination', async () => {
    const plans = await adapter.buildDiscoveryRequests({
      name: 'derstandard-wien',
      sourceCode: 'derstandard',
      maxPages: 3,
    });
    expect(plans).toHaveLength(3);
    expect(plans[0]!.url).toContain('page=1');
    expect(plans[1]!.url).toContain('page=2');
    expect(plans[2]!.url).toContain('page=3');
    expect(plans[0]!.url).toContain('immobilien.derstandard.at');
  });

  it('uses correct waitForSelector for discovery', async () => {
    const plans = await adapter.buildDiscoveryRequests({
      name: 'derstandard-wien',
      sourceCode: 'derstandard',
      maxPages: 1,
    });
    expect(plans[0]!.waitForSelector).toBe('.results-container a[href*="/detail/"]');
  });

  it('builds detail request from discovery item', async () => {
    const plan = await adapter.buildDetailRequest({
      detailUrl: '/detail/15086452/slug',
      sourceCode: 'derstandard',
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        standardId: '15086452',
        detailUrl: '/detail/15086452/slug',
        titleRaw: 'Test',
        priceRaw: '460000',
        locationRaw: '1070 Wien Wohnung, Kauf, Sonstige Wohnungen',
        roomsRaw: '3',
        areaRaw: '87',
      },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toBe('https://immobilien.derstandard.at/detail/15086452/slug');
    expect(plan!.waitForSelector).toBe('#listing-detail-data');
  });

  it('builds detail request for absolute URLs', async () => {
    const plan = await adapter.buildDetailRequest({
      detailUrl: 'https://immobilien.derstandard.at/detail/15086452/slug',
      sourceCode: 'derstandard',
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        standardId: '15086452',
        detailUrl: 'https://immobilien.derstandard.at/detail/15086452/slug',
        titleRaw: 'Test',
        priceRaw: null,
        locationRaw: null,
        roomsRaw: null,
        areaRaw: null,
      },
    });
    expect(plan!.url).toBe('https://immobilien.derstandard.at/detail/15086452/slug');
  });
});

describe('Discovery page parsing', () => {
  it('extracts listing cards from HTML anchors', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche/i/kaufen/wohnung/wien?page=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(3);
    expect(result.pageNumber).toBe(1);

    const first = result.items[0]!;
    expect(first.externalId).toBe('15086452');
    expect(first.sourceCode).toBe('derstandard');
    expect(first.summaryPayload.standardId).toBe('15086452');
    expect(first.summaryPayload.titleRaw).toBe(
      'Innenhof-Idylle nur wenige Schritte zur Neubaugasse - A',
    );
    expect(first.summaryPayload.priceRaw).toBe('460000');
    expect(first.summaryPayload.locationRaw).toBe(
      '1070 Wien Wohnung, Kauf, Sonstige Wohnungen',
    );
    expect(first.summaryPayload.roomsRaw).toBe('3');
    expect(first.summaryPayload.areaRaw).toBe('87');
    expect(first.detailUrl).toBe(
      '/detail/15086452/innenhof-idylle-nur-wenige-schritte-zur-neubaugasse-a-',
    );
    expect(first.canonicalUrl).toContain('immobilien.derstandard.at');
    expect(first.discoveredAt).toBeTruthy();
  });

  it('parses all three listings correctly', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche/i/kaufen/wohnung/wien?page=1',
      metadata: { page: 1 },
    });

    const second = result.items[1]!;
    expect(second.externalId).toBe('15086500');
    expect(second.summaryPayload.titleRaw).toBe('Moderne 2-Zimmer Wohnung mit Balkon');
    expect(second.summaryPayload.priceRaw).toBe('219000');
    expect(second.summaryPayload.roomsRaw).toBe('2');
    expect(second.summaryPayload.areaRaw).toBe('52.3');

    const third = result.items[2]!;
    expect(third.externalId).toBe('15086600');
    expect(third.summaryPayload.titleRaw).toContain('Penthouse');
    expect(third.summaryPayload.priceRaw).toBe('520000');
    expect(third.summaryPayload.roomsRaw).toBe('4');
    expect(third.summaryPayload.areaRaw).toBe('112');
  });

  it('detects pagination from next page link', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche/i/kaufen/wohnung/wien?page=1',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('page=2');
    expect(result.nextPagePlan!.metadata?.page).toBe(2);
  });

  it('returns null totalEstimate (HTML cards have no total count)', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche/i/kaufen/wohnung/wien?page=1',
      metadata: { page: 1 },
    });
    expect(result.totalEstimate).toBeNull();
  });

  it('strips query params from detail URLs', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche/i/kaufen/wohnung/wien?page=1',
      metadata: { page: 1 },
    });
    // The fixture href has ?src=search&pos=1 but detailUrl should be clean
    expect(result.items[0]!.detailUrl).not.toContain('?');
    expect(result.items[0]!.detailUrl).not.toContain('src=');
  });

  it('normalizes Austrian decimal format in area', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche/i/kaufen/wohnung/wien?page=1',
      metadata: { page: 1 },
    });
    // Second listing has "52,3 m²" -> should be "52.3"
    expect(result.items[1]!.summaryPayload.areaRaw).toBe('52.3');
  });

  it('returns empty result for missing listing cards', () => {
    const html = '<html><body>No data here</body></html>';
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche?page=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns empty result for page with no detail links', () => {
    const html = '<html><body><a href="/other/page">Not a listing</a></body></html>';
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/?page=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns no next page when there is no pagination link', () => {
    const html = `<html><body>
      <a href="/detail/99999/test-listing">
        <h2>Test Listing</h2>
        <p>1010 Wien Wohnung, Kauf</p>
        <span>Wohnfläche 50 m²</span>
        <span>Zimmer 2</span>
        <span>Kaufpreis € 300.000</span>
      </a>
    </body></html>`;
    const result = parseDiscoveryPage(html, 'derstandard', {
      url: 'https://immobilien.derstandard.at/immobiliensuche?page=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(1);
    expect(result.nextPagePlan).toBeNull();
  });
});

describe('Detail page parsing', () => {
  it('extracts full listing data from embedded JSON', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://immobilien.derstandard.at/detail/15086452/innenhof-idylle',
      'derstandard',
      2,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('15086452');
    expect(result.sourceCode).toBe('derstandard');

    const p = result.payload;
    expect(p.standardId).toBe('15086452');
    expect(p.titleRaw).toBe('Innenhof-Idylle nur wenige Schritte zur Neubaugasse - A');
    expect(p.descriptionRaw).toContain('Helle, sanierte Altbauwohnung');
    expect(p.descriptionRaw).toContain('Balkon');
    expect(p.priceRaw).toBe('460000');
    expect(p.livingAreaRaw).toBe('87');
    expect(p.usableAreaRaw).toBe('95.4');
    expect(p.roomsRaw).toBe('3');
    expect(p.floorRaw).toBe('2');
    expect(p.yearBuiltRaw).toBe('1905');
    expect(p.cityRaw).toBe('Wien');
    expect(p.postalCodeRaw).toBe('1070');
    expect(p.districtRaw).toBe('7. Bezirk');
    expect(p.streetRaw).toBe('Neubaugasse 18');
    expect(p.propertyTypeRaw).toBe('Wohnung');
    expect(p.propertySubtypeRaw).toBe('Sonstige Wohnungen');
    expect(p.operationTypeRaw).toBe('sale');
    expect(p.heatingTypeRaw).toBe('Fernwärme');
    expect(p.conditionRaw).toBe('Erstbezug nach Sanierung');
    expect(p.energyCertificateRaw).toBe('B');
    expect(p.operatingCostRaw).toBe('250');
    expect(p.statusRaw).toBe('active');
    expect(p.contactName).toBe('Immobilien Wien GmbH');
    expect(p.images).toHaveLength(3);
    expect(p.images[0]).toContain('15086452');
  });

  it('extracts coordinates', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://immobilien.derstandard.at/detail/15086452/slug',
      'derstandard',
      2,
    );
    expect(result.payload.latRaw).toBe('48.1985');
    expect(result.payload.lonRaw).toBe('16.3492');
  });

  it('extracts features into attributesRaw', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://immobilien.derstandard.at/detail/15086452/slug',
      'derstandard',
      2,
    );
    const attrs = result.payload.attributesRaw as Record<string, unknown>;
    expect(attrs.features).toEqual(['Balkon', 'Lift', 'Kellerabteil']);
    expect(attrs.hasBalcony).toBe(true);
    expect(attrs.hasElevator).toBe(true);
    expect(attrs.hasTerrace).toBe(false);
    expect(attrs.hasGarden).toBe(false);
  });

  it('handles parse failure gracefully', () => {
    const html = '<html><body>Empty page</body></html>';
    const result = parseDetailPage(
      html,
      'https://immobilien.derstandard.at/detail/99999/test',
      'derstandard',
      2,
    );
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.standardId).toBe('99999');
    expect(result.payload.operationTypeRaw).toBeNull();
    expect(result.payload.images).toEqual([]);
  });

  it('extracts ID from URL when detail data parse fails', () => {
    const html = '<html><body>Broken</body></html>';
    const result = parseDetailPage(
      html,
      'https://immobilien.derstandard.at/detail/12345/some-slug',
      'derstandard',
      2,
    );
    expect(result.externalId).toBe('12345');
    expect(result.payload.standardId).toBe('12345');
  });

  it('returns empty result for missing fields', () => {
    const html = `<script type="application/json" id="listing-detail-data">
      {"id": 77777, "title": "", "description": null, "price": null, "livingArea": null,
       "usableArea": null, "rooms": null, "floor": null, "yearBuilt": null,
       "address": {"postalCode": "1010", "city": "Wien", "district": "Innere Stadt", "street": null},
       "coordinates": null, "images": [], "contact": null,
       "propertyType": null, "subType": null, "heatingType": null, "condition": null,
       "energyCertificate": null, "features": [], "operatingCosts": null, "status": "active"}
    </script>`;
    const result = parseDetailPage(
      html,
      'https://immobilien.derstandard.at/detail/77777/test',
      'derstandard',
      2,
    );
    expect(result.externalId).toBe('77777');
    expect(result.payload.priceRaw).toBeNull();
    expect(result.payload.livingAreaRaw).toBeNull();
    expect(result.payload.roomsRaw).toBeNull();
    expect(result.payload.contactName).toBeNull();
    expect(result.payload.districtRaw).toBe('1. Bezirk');
  });

  it('sets canonicalUrl without query params', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://immobilien.derstandard.at/detail/15086452/slug?tracking=abc&ref=search',
      'derstandard',
      2,
    );
    expect(result.canonicalUrl).toBe(
      'https://immobilien.derstandard.at/detail/15086452/slug',
    );
  });
});

describe('Availability detection', () => {
  it('detects available listing from embedded data', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('detects removed listing from error page text', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('not_found');
  });

  it('detects sold status from embedded data', () => {
    const html = `<script type="application/json" id="listing-detail-data">
      {"id": 123, "title": "Test", "description": null, "price": 100000, "livingArea": 50,
       "usableArea": null, "rooms": 2, "floor": 1, "yearBuilt": null,
       "address": {"postalCode": "1010", "city": "Wien", "district": "Innere Stadt", "street": null},
       "coordinates": null, "images": [], "contact": null,
       "propertyType": "Wohnung", "subType": null, "heatingType": null, "condition": null,
       "energyCertificate": null, "features": [], "operatingCosts": null, "status": "sold"}
    </script>`;
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('detects reserved status', () => {
    const html = `<script type="application/json" id="listing-detail-data">
      {"id": 456, "title": "Reserved", "description": null, "price": null, "livingArea": null,
       "usableArea": null, "rooms": null, "floor": null, "yearBuilt": null,
       "address": {"postalCode": "1010", "city": "Wien", "district": "Innere Stadt", "street": null},
       "coordinates": null, "images": [], "contact": null,
       "propertyType": null, "subType": null, "heatingType": null, "condition": null,
       "energyCertificate": null, "features": [], "operatingCosts": null, "status": "reserved"}
    </script>`;
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('reserved');
  });

  it('detects blocked page', () => {
    const html = '<html><body><div class="captcha">Please verify you are human</div></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('blocked');
  });

  it('returns unknown for unrecognizable page', () => {
    const html = '<html><body>Something else entirely</body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('unknown');
  });
});
