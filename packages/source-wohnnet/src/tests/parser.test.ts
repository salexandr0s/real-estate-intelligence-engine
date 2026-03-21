import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import { parseDetailPage, detectDetailAvailability } from '../detail.js';
import { WohnnetAdapter } from '../adapter.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('WohnnetAdapter', () => {
  const adapter = new WohnnetAdapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('wohnnet');
    expect(adapter.sourceName).toBe('wohnnet.at');
    expect(adapter.parserVersion).toBe(1);
  });

  it('canonicalizes URLs correctly', () => {
    expect(adapter.canonicalizeUrl('https://www.wohnnet.at/immobilien/eigentumswohnung-1020-wien-294241001?ref=search'))
      .toBe('https://www.wohnnet.at/immobilien/eigentumswohnung-1020-wien-294241001');
  });

  it('strips trailing slash during canonicalization', () => {
    expect(adapter.canonicalizeUrl('https://www.wohnnet.at/immobilien/test-123/'))
      .toBe('https://www.wohnnet.at/immobilien/test-123');
  });

  it('derives source listing key', () => {
    const key = adapter.deriveSourceListingKey({
      sourceCode: 'wohnnet',
      canonicalUrl: 'https://example.com/123',
      detailUrl: 'https://example.com/123',
      extractedAt: new Date().toISOString(),
      payload: { wohnnetId: '296210602' } as never,
      parserVersion: 1,
      extractionStatus: 'captured',
    });
    expect(key).toBe('wohnnet:296210602');
  });

  it('builds discovery requests with pagination', async () => {
    const plans = await adapter.buildDiscoveryRequests({
      name: 'wien-apartments',
      sourceCode: 'wohnnet',
      maxPages: 3,
    });
    expect(plans.length).toBe(3);
    expect(plans[0]!.url).toContain('seite=1');
    expect(plans[1]!.url).toContain('seite=2');
    expect(plans[2]!.url).toContain('seite=3');
  });
});

describe('Discovery page parsing', () => {
  it('extracts listing cards from HTML <a data-id> blocks', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'wohnnet', {
      url: 'https://www.wohnnet.at/immobilien/eigentumswohnungen/wien?seite=1',
      metadata: { page: 1 },
    });

    expect(result.items.length).toBe(3);
    expect(result.pageNumber).toBe(1);
    expect(result.totalEstimate).toBe(1247);
    expect(result.nextPagePlan).not.toBeNull();

    const first = result.items[0]!;
    expect(first.externalId).toBe('296210602');
    expect(first.summaryPayload.titleRaw).toBe('Siebenbrunnengasse 44 - Exklusives Wohngefuehl');
    expect(first.summaryPayload.priceRaw).toBe('615900');
    expect(first.summaryPayload.locationRaw).toBe('1050 Wien');
    expect(first.summaryPayload.roomsRaw).toBe('2');
    expect(first.summaryPayload.areaRaw).toBe('65,12');
    expect(first.detailUrl).toContain('296210602');
  });

  it('extracts all three listings with correct data', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'wohnnet', {
      url: 'https://www.wohnnet.at/immobilien/eigentumswohnungen/wien?seite=1',
      metadata: { page: 1 },
    });

    const second = result.items[1]!;
    expect(second.externalId).toBe('301445018');
    expect(second.summaryPayload.titleRaw).toBe('Moderne Stadtwohnung nahe Augarten');
    expect(second.summaryPayload.priceRaw).toBe('349000');
    expect(second.summaryPayload.roomsRaw).toBe('3');
    expect(second.summaryPayload.areaRaw).toBe('88');

    const third = result.items[2]!;
    expect(third.externalId).toBe('298877200');
    expect(third.summaryPayload.titleRaw).toBe('Altbaujuwel im Botschaftsviertel');
    expect(third.summaryPayload.priceRaw).toBe('1250000');
    expect(third.summaryPayload.roomsRaw).toBe('4');
    expect(third.summaryPayload.areaRaw).toBe('112,50');
  });

  it('extracts features from badge-secondary spans', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'wohnnet', {
      url: 'https://www.wohnnet.at/immobilien/eigentumswohnungen/wien?seite=1',
      metadata: { page: 1 },
    });

    const first = result.items[0]!;
    expect(first.summaryPayload.features).toContain('Balkon');
    expect(first.summaryPayload.features).toContain('Terrasse');
    // "11 Bilder" is also a badge-secondary
    expect(first.summaryPayload.features).toContain('11 Bilder');

    const third = result.items[2]!;
    expect(third.summaryPayload.features).toContain('Terrasse');
    expect(third.summaryPayload.features).toContain('Garten');
  });

  it('detects pagination and builds next page plan', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'wohnnet', {
      url: 'https://www.wohnnet.at/immobilien/eigentumswohnungen/wien?seite=1',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('seite=2');
    expect(result.nextPagePlan!.metadata?.['page']).toBe(2);
  });

  it('returns empty result for pages without listing cards', () => {
    const html = '<html><body>No listings here</body></html>';
    const result = parseDiscoveryPage(html, 'wohnnet', {
      url: 'https://www.wohnnet.at/immobilien?seite=1',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('handles last page with no next page link', () => {
    const html = `<!DOCTYPE html>
<html><body>
<div class="search-results">
  <!-- Realty -->
  <a href="/immobilien/test-999001" data-id="999001" data-title="Last Page Listing">
    <div class="realty realty-result">
      <div class="realty-content">
        <div class="realty-detail-title-address"><div class="col-10"><p class="h4">Last Page Listing</p></div></div>
        <div class="realty-detail-area-rooms">
          <div class="col"><b>50</b> m&sup2;</div>
          <div class="col"><b>2</b> Zimmer</div>
          <div class="col text-right"><b>200.000 &euro;</b></div>
        </div>
      </div>
    </div>
  </a>
</div>
<nav><ul class="pagination">
  <li class="page-item active"><a class="page-link" href="?seite=5">5</a></li>
</ul></nav>
</body></html>`;
    const result = parseDiscoveryPage(html, 'wohnnet', {
      url: 'https://www.wohnnet.at/immobilien?seite=5',
      metadata: { page: 5 },
    });
    expect(result.items.length).toBe(1);
    expect(result.items[0]!.externalId).toBe('999001');
    // No seite=6 link exists, so no next page
    expect(result.nextPagePlan).toBeNull();
  });
});

describe('Detail page parsing', () => {
  it('extracts data from JSON-LD Product and dataLayer', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.wohnnet.at/immobilien/eigentumswohnung-1050-wien-margareten-kauf-2-zimmer-296210602',
      'wohnnet',
      1,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.externalId).toBe('296210602');

    const p = result.payload;
    expect(p.titleRaw).toBe('Siebenbrunnengasse 44 - Exklusives Wohngefuehl');
    expect(p.priceRaw).toBe('615900');
    expect(p.descriptionRaw).toContain('Balkon');
    expect(p.descriptionRaw).toContain('Naschmarkt');
    expect(p.livingAreaRaw).toBe('65.12');
    expect(p.roomsRaw).toBe('2');
    expect(p.propertyTypeRaw).toBe('Eigentumswohnung');
    expect(p.operationTypeRaw).toBe('sale');
    expect(p.postalCodeRaw).toBe('1050');
    expect(p.cityRaw).toBe('Wien');
    expect(p.districtRaw).toBe('Margareten');
    expect(p.brokerCompany).toBe('Wiener Immobilien Kontor GmbH');
  });

  it('extracts wohnnetId from var realtyId', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/test-999', 'wohnnet', 1);
    expect(result.payload.wohnnetId).toBe('296210602');
  });

  it('extracts Eckdaten fields from HTML tables', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(
      html,
      'https://www.wohnnet.at/immobilien/eigentumswohnung-1050-wien-margareten-kauf-2-zimmer-296210602',
      'wohnnet',
      1,
    );

    const p = result.payload;
    expect(p.floorRaw).toContain('3');
    expect(p.yearBuiltRaw).toBe('1895');
    expect(p.conditionRaw).toBe('Erstbezug nach Sanierung');
    expect(p.heatingTypeRaw).toBe('Fussbodenheizung');
  });

  it('extracts energy certificate class', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/296210602', 'wohnnet', 1);
    expect(result.payload.energyCertificateRaw).toBe('B');
  });

  it('extracts feature areas (Balkon m2)', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/296210602', 'wohnnet', 1);
    expect(result.payload.balconyAreaRaw).toBe('5.8');
  });

  it('extracts coordinates from map data attributes', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/296210602', 'wohnnet', 1);
    expect(result.payload.latRaw).toBe('48.1920');
    expect(result.payload.lonRaw).toBe('16.3560');
  });

  it('extracts images from gallery', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/296210602', 'wohnnet', 1);
    expect(result.payload.images.length).toBe(4);
    expect(result.payload.images[0]).toContain('api.wohnnet.at');
  });

  it('extracts street from HTML address section', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/296210602', 'wohnnet', 1);
    expect(result.payload.streetRaw).toBe('Siebenbrunnengasse 44');
    expect(result.payload.addressRaw).toContain('1050 Wien');
  });

  it('extracts operating cost and commission from Eckdaten', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/296210602', 'wohnnet', 1);
    expect(result.payload.operatingCostRaw).toContain('285');
    expect(result.payload.commissionRaw).toContain('3%');
  });

  it('handles parse failure gracefully', () => {
    const html = '<html><body>Empty</body></html>';
    const result = parseDetailPage(html, 'https://example.com/test-123', 'wohnnet', 1);
    expect(result.extractionStatus).toBe('parse_failed');
    expect(result.payload.wohnnetId).toBe('123');
    expect(result.payload.operationTypeRaw).toBeNull();
  });

  it('returns empty result for missing data sources', () => {
    const html = '<html><body><h1>Error page</h1></body></html>';
    const result = parseDetailPage(html, 'https://www.wohnnet.at/immobilien/test-999', 'wohnnet', 1);
    expect(result.externalId).toBe('999');
    expect(result.payload.priceRaw).toBeNull();
    expect(result.payload.livingAreaRaw).toBeNull();
    expect(result.extractionStatus).toBe('parse_failed');
  });

  it('builds attributes map from extracted data', () => {
    const html = loadFixture('detail-page.html');
    const result = parseDetailPage(html, 'https://example.com/296210602', 'wohnnet', 1);
    const attrs = result.payload.attributesRaw ?? {};
    expect(attrs['numberOfRooms']).toBe('2');
    expect(attrs['yearBuilt']).toBe('1895');
    expect(attrs['price']).toBe('615900');
    expect(attrs['propertyType']).toBe('Eigentumswohnung');
    expect(attrs['energyClass']).toBe('B');
    expect(attrs['contactPhone']).toBe('+43 1 555 1234');
    expect(attrs['contactEmail']).toBe('info@wik-immo.at');
  });
});

describe('Availability detection', () => {
  it('detects available listing (has JSON-LD Product)', () => {
    const html = loadFixture('detail-page.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });

  it('detects removed listing (nicht mehr verfuegbar)', () => {
    const html = loadFixture('detail-sold.html');
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('removed');
  });

  it('detects sold listing', () => {
    const html = '<html><body><p>Das Objekt wurde bereits verkauft.</p></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('sold');
  });

  it('detects reserved listing', () => {
    const html = '<html><body><p>Dieses Objekt ist reserviert.</p></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('reserved');
  });

  it('detects rented listing', () => {
    const html = '<html><body><p>Dieses Objekt wurde bereits vermietet.</p></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('rented');
  });

  it('detects blocked page', () => {
    const html = '<html><body>Please complete the captcha to continue.</body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('blocked');
  });

  it('returns unknown for ambiguous content', () => {
    const html = '<html><body><p>Something else entirely.</p></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('unknown');
  });

  it('detects available via dataLayer when no JSON-LD present', () => {
    const html = `<html><body>
<script>
  dataLayer = [{"dL-preis": "500000"}];
</script>
</body></html>`;
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('available');
  });
});
