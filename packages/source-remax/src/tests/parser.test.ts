import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import { parseDetailPage, detectDetailAvailability } from '../detail.js';
import { RemaxAdapter } from '../adapter.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

// -- 1. Adapter metadata -----------------------------------------------------

describe('RemaxAdapter', () => {
  const adapter = new RemaxAdapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('remax');
    expect(adapter.sourceName).toBe('RE/MAX Austria');
    expect(adapter.parserVersion).toBe(2);
  });

  it('canonicalizes path-based URLs correctly', () => {
    expect(
      adapter.canonicalizeUrl(
        'https://www.remax.at/de/immobilien/wohnung-kaufen-wien-leopoldstadt/id350755?ref=search&utm=abc',
      ),
    ).toBe('https://www.remax.at/de/immobilien/wohnung-kaufen-wien-leopoldstadt/id350755');
  });

  it('canonicalizes query-param URLs keeping only id', () => {
    expect(
      adapter.canonicalizeUrl(
        'https://www.remax.at/index.php?page=objekt&t=1&srid=-1&s=1&id=350755&p=1&lang=de',
      ),
    ).toBe('https://www.remax.at/index.php?id=350755');
  });

  it('removes trailing slash from canonical URL', () => {
    expect(adapter.canonicalizeUrl('https://www.remax.at/de/immobilien/id350755/')).toBe(
      'https://www.remax.at/de/immobilien/id350755',
    );
  });

  it('derives source listing key from detail capture', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'remax',
      canonicalUrl: 'https://www.remax.at/index.php?id=350755',
      detailUrl: 'https://www.remax.at/index.php?page=objekt&id=350755',
      extractedAt: new Date().toISOString(),
      payload: { remaxId: '350755' } as never,
      parserVersion: 2,
      extractionStatus: 'captured',
    });
    expect(key).toBe('remax:350755');
  });

  it('builds discovery requests with page 1 seed only', async () => {
    const plans = await adapter.buildDiscoveryRequests({
      name: 'test',
      sourceCode: 'remax',
      maxPages: 3,
    });
    // Adapters now only build page 1; dynamic pagination follows nextPagePlan
    expect(plans).toHaveLength(1);
    expect(plans[0]!.url).toContain('page=1');
    expect(plans[0]!.waitForSelector).toBe('.real-estate-wrapper');
  });

  it('builds detail request from discovery item', async () => {
    const plan = await adapter.buildDetailRequest({
      detailUrl: 'https://www.remax.at/index.php?page=objekt&t=1&srid=-1&s=1&id=350755&p=1&lang=de',
      externalId: '350755',
      sourceCode: 'remax',
      discoveredAt: new Date().toISOString(),
      summaryPayload: {
        remaxId: '350755',
        detailUrl: 'https://www.remax.at/index.php?page=objekt&id=350755',
        titleRaw: 'Test',
        priceRaw: '315000',
        locationRaw: null,
        roomsRaw: '3',
        areaRaw: '68.7',
        agentName: null,
        agentCompany: null,
      },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toContain('id=350755');
    expect(plan!.waitForSelector).toBe('h1');
  });
});

// -- 2. Discovery parsing -----------------------------------------------------

describe('Discovery page parsing', () => {
  it('extracts 3 non-exclusive listing items from HTML cards', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=1',
      metadata: { page: 1 },
    });

    // Fixture has 4 cards total: 3 normal + 1 exclusive (skipped)
    expect(result.items).toHaveLength(3);
    expect(result.pageNumber).toBe(1);
    expect(result.totalEstimate).toBeNull(); // No total in HTML
  });

  it('skips exclusive (login-walled) listings', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=1',
      metadata: { page: 1 },
    });

    const ids = result.items.map((i) => i.externalId);
    expect(ids).not.toContain('350799'); // The exclusive listing
    expect(ids).toContain('350755');
    expect(ids).toContain('350812');
    expect(ids).toContain('350901');
  });

  it('extracts correct fields from first discovery item', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=1',
      metadata: { page: 1 },
    });

    const first = result.items[0]!;
    expect(first.externalId).toBe('350755');
    expect(first.sourceCode).toBe('remax');
    expect(first.discoveredAt).toBeTruthy();
    expect(first.detailUrl).toContain('id=350755');
    expect(first.canonicalUrl).toContain('https://www.remax.at');

    const payload = first.summaryPayload;
    expect(payload.remaxId).toBe('350755');
    expect(payload.titleRaw).toContain('3-Zimmer');
    expect(payload.priceRaw).toBe('315000');
    expect(payload.roomsRaw).toBe('3');
    expect(payload.areaRaw).toBe('68.7');
    expect(payload.agentName).toBe('Maria Huber');
    expect(payload.agentCompany).toBeNull();
  });

  it('extracts fields from second and third items', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=1',
      metadata: { page: 1 },
    });

    const second = result.items[1]!;
    expect(second.externalId).toBe('350812');
    expect(second.summaryPayload.priceRaw).toBe('238000');
    expect(second.summaryPayload.roomsRaw).toBe('2');
    expect(second.summaryPayload.areaRaw).toBe('51.3');

    const third = result.items[2]!;
    expect(third.externalId).toBe('350901');
    expect(third.summaryPayload.priceRaw).toBe('445000');
    expect(third.summaryPayload.roomsRaw).toBe('4');
    expect(third.summaryPayload.areaRaw).toBe('95.2');
  });

  it('returns null nextPagePlan (all results on one page)', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=1',
      metadata: { page: 1 },
    });

    expect(result.nextPagePlan).toBeNull();
  });

  it('always returns nextPagePlan null (single-page source)', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns null nextPagePlan when no items found', () => {
    const html = '<html><body>No listings here</body></html>';
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=5',
      metadata: { page: 5 },
    });

    expect(result.items).toHaveLength(0);
    expect(result.nextPagePlan).toBeNull();
    expect(result.totalEstimate).toBeNull();
  });

  it('extracts id from data-id attribute', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'remax', {
      url: 'https://www.remax.at/de/immobilien/immobilien-suchen?page=1',
      metadata: { page: 1 },
    });

    // All IDs should be extracted from ?id= query params
    for (const item of result.items) {
      expect(item.externalId).toMatch(/^\d+$/);
    }
  });
});

// -- 3. Detail parsing --------------------------------------------------------

describe('Detail page parsing', () => {
  it('extracts full listing data from JSON-LD + dataLayer + HTML', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&t=1&srid=-1&s=1&id=350755&p=1&lang=de',
      'remax',
      2,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('350755');
    expect(result.sourceCode).toBe('remax');

    const p = result.payload;
    expect(p.remaxId).toBe('350755');
    expect(p.titleRaw).toContain('3-Zimmer');
    expect(p.titleRaw).toContain('Leopoldstadt');
    expect(p.descriptionRaw).toContain('Balkon');
    expect(p.priceRaw).toBe('315000');
    expect(p.livingAreaRaw).toBe('68.7');
    expect(p.usableAreaRaw).toBe('73.2');
    expect(p.roomsRaw).toBe('3');
    expect(p.floorRaw).toBe('2');
    expect(p.yearBuiltRaw).toBe('1960');
    expect(p.cityRaw).toBe('Wien');
    expect(p.postalCodeRaw).toBe('1020');
    expect(p.districtRaw).toBe('Leopoldstadt');
    expect(p.streetRaw).toContain('Taborstra');
    expect(p.propertyTypeRaw).toBe('Wohnung');
    expect(p.operationTypeRaw).toBe('sale');
    expect(p.heatingTypeRaw).toBe('Gasetagenheizung');
    expect(p.conditionRaw).toBe('Gepflegt');
    expect(p.energyCertificateRaw).toBe('D');
    expect(p.balconyAreaRaw).toBe('6.2');
    expect(p.operatingCostRaw).toBe('245');
    expect(p.statusRaw).toBe('available');
  });

  it('extracts immoId from dataLayer', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.payload.immoId).toBe('2275/7748');
  });

  it('extracts coordinates from JSON-LD geo', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.payload.latRaw).toBe('48.2201');
    expect(result.payload.lonRaw).toBe('16.3811');
  });

  it('extracts images from JSON-LD Product', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.payload.images).toHaveLength(3);
    expect(result.payload.images[0]).toContain('img350755');
    expect(result.payload.images[0]).toContain('1.jpg');
    expect(result.payload.images[2]).toContain('3.jpg');
  });

  it('extracts agent info from JSON-LD RealEstateAgent', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.payload.contactName).toBe('Maria Huber');
    expect(result.payload.agentCompany).toBe('RE/MAX Donaustadt');
    expect(result.payload.agentPhone).toBe('+43 1 888 7777');
    expect(result.payload.agentEmail).toBe('maria.huber@remax.at');
  });

  it('extracts features list', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.payload.features).toContain('Balkon');
    expect(result.payload.features).toContain('Aufzug');
    expect(result.payload.features.length).toBeGreaterThanOrEqual(3);
  });

  it('extracts commission info', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.payload.commissionRaw).toContain('3%');
  });

  it('extracts federal state from dataLayer', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.payload.federalStateRaw).toBe('Wien');
  });

  it('handles parse failure gracefully', () => {
    const html = '<html><body>Empty page</body></html>';
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=350755',
      'remax',
      2,
    );
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.remaxId).toBe('350755');
    expect(result.payload.titleRaw).toBeNull();
    expect(result.payload.operationTypeRaw).toBeNull();
    expect(result.payload.images).toHaveLength(0);
    expect(result.payload.features).toHaveLength(0);
  });

  it('handles page with only JSON-LD Product (no dataLayer)', () => {
    const html = `<!DOCTYPE html><html><body>
    <script type="application/ld+json">
    {"@type":"Product","name":"Minimal listing","offers":[{"@type":"Offer","price":"100000","priceCurrency":"EUR","availability":"https://schema.org/InStock"}]}
    </script>
    <h1>Minimal listing</h1>
    </body></html>`;
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&id=999999',
      'remax',
      2,
    );
    expect(result.externalId).toBe('999999');
    expect(result.payload.titleRaw).toBe('Minimal listing');
    expect(result.payload.priceRaw).toBe('100000');
    expect(result.payload.postalCodeRaw).toBeNull();
    expect(result.payload.images).toHaveLength(0);
  });

  it('strips query parameters from canonical URL', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.remax.at/index.php?page=objekt&t=1&srid=-1&s=1&id=350755&p=1&lang=de',
      'remax',
      2,
    );
    expect(result.canonicalUrl).toBe('https://www.remax.at/index.php');
  });
});

// -- 4. Availability detection ------------------------------------------------

describe('Availability detection', () => {
  it('detects available listing from JSON-LD InStock', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('detects sold listing from JSON-LD SoldOut', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('detects sold from "verkauft" text when no Product JSON-LD', () => {
    const html = '<html><body><h1>Dieses Objekt wurde verkauft</h1></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('detects reserved listing', () => {
    const html = '<html><body><h1>Dieses Objekt ist reserviert</h1></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('reserved');
  });

  it('detects rented listing', () => {
    const html = '<html><body><h1>Dieses Objekt ist vermietet</h1></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('rented');
  });

  it('detects not_found from "nicht verfuegbar" text', () => {
    const html = '<html><body><h1>Dieses Objekt ist nicht verf\u00FCgbar</h1></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('not_found');
  });

  it('detects not_found from missing data', () => {
    const html = '<html><body><p>Seite nicht gefunden</p></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('not_found');
  });

  it('detects blocked from captcha marker', () => {
    const html = '<html><body><div class="captcha">Please verify</div></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('blocked');
  });

  it('returns unknown when JSON-LD exists but no availability signal', () => {
    const html = `<html><body>
    <script type="application/ld+json">{"@type":"Product","name":"Test","offers":[{"@type":"Offer"}]}</script>
    </body></html>`;
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('unknown');
  });
});
