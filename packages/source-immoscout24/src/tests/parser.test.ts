import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiscoveryPage } from '../discovery.js';
import { parseDetailPage, detectDetailAvailability } from '../detail.js';
import { Immoscout24Adapter } from '../adapter.js';
import type { Immoscout24DiscoveryItem } from '../dto.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('Immoscout24Adapter', () => {
  const adapter = new Immoscout24Adapter();

  it('has correct source metadata', () => {
    expect(adapter.sourceCode).toBe('immoscout24');
    expect(adapter.sourceName).toBe('ImmobilienScout24.at');
    expect(adapter.parserVersion).toBe(4);
  });

  it('canonicalizes URLs correctly', () => {
    expect(
      adapter.canonicalizeUrl(
        'https://www.immobilienscout24.at/expose/abc123def456789012345678?ref=search',
      ),
    ).toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
  });

  it('strips trailing slash from canonical URL', () => {
    expect(
      adapter.canonicalizeUrl('https://www.immobilienscout24.at/expose/abc123def456789012345678/'),
    ).toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
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

  it('builds discovery requests with page 1 seed only', async () => {
    const plans = await adapter.buildDiscoveryRequests({
      name: 'test',
      sourceCode: 'immoscout24',
      maxPages: 2,
    });
    // Adapters now only build page 1; dynamic pagination follows nextPagePlan
    expect(plans).toHaveLength(1);
    // Pages after the first lack the JSON-LD script, so the wait accepts the results list.
    expect(plans[0]!.waitForSelector).toContain('[data-testid="results-items"]');
    expect(plans[0]!.url).toContain('/regional/wien/wien/wohnung-kaufen');
    expect(plans[0]!.url).not.toContain('/seite-');
    // The default order leads with developer projects.
    expect(new URL(plans[0]!.url).searchParams.get('sort')).toBe('CREATED_DESC');
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

  it('builds detail request with empty summaryPayload (runtime scenario)', async () => {
    const plan = await adapter.buildDetailRequest({
      detailUrl: 'https://www.immobilienscout24.at/expose/abc123def456789012345678',
      sourceCode: 'immoscout24',
      discoveredAt: new Date().toISOString(),
      summaryPayload: {} as Immoscout24DiscoveryItem,
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
  });

  it('builds detail request with relative detailUrl', async () => {
    const plan = await adapter.buildDetailRequest({
      detailUrl: '/expose/abc123def456789012345678',
      sourceCode: 'immoscout24',
      discoveredAt: new Date().toISOString(),
      summaryPayload: {} as Immoscout24DiscoveryItem,
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toBe('https://www.immobilienscout24.at/expose/abc123def456789012345678');
  });
});

describe('Discovery page parsing (CollectionPage JSON-LD)', () => {
  it('extracts listing items from CollectionPage JSON-LD', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
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
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });

    expect(result.items[0]!.externalId).toBe('abc123def456789012345678');
    expect(result.items[1]!.externalId).toBe('def789abc012345678901234');
    expect(result.items[2]!.externalId).toBe('789012345abc678def901234');
  });

  it('parses Austrian decimal area correctly', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
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
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('/seite-2');
  });

  it('returns totalEstimate from numberOfItems', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.totalEstimate).toBe(15);
  });

  it('returns empty result for missing JSON-LD', () => {
    const html = '<html><body>No data</body></html>';
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns empty result for invalid JSON', () => {
    const html =
      '<script data-testid="collection-page-structured-data" type="application/ld+json">{invalid json</script>';
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.items.length).toBe(0);
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns nextPagePlan when more pages exist', () => {
    const html = `
      <html><body>
      <script data-testid="collection-page-structured-data" type="application/ld+json">
      {
        "@type": "CollectionPage",
        "mainEntity": {
          "@type": "ItemList",
          "numberOfItems": 60,
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "item": {
              "@type": "RealEstateListing",
              "name": "Test 3-Zimmer mit Balkon",
              "url": "/expose/aaa111bbb222ccc333ddd444",
              "description": "65,20 m\u00b2 . 3 Zimmer . 1020 Wien",
              "mainEntity": {"@type": "Apartment", "address": {"postalCode": "1020", "addressLocality": "Wien"}}
            }}
          ]
        }
      }
      </script>
      <div data-testid="pagination-section"></div>
      </body></html>`;
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('/seite-2');
    expect(result.nextPagePlan!.metadata!.page).toBe(2);
  });

  it('returns nextPagePlan null when no items found', () => {
    const html = `
      <script data-testid="collection-page-structured-data" type="application/ld+json">
      {
        "@type": "CollectionPage",
        "mainEntity": {
          "@type": "ItemList",
          "numberOfItems": 0,
          "itemListElement": []
        }
      }
      </script>`;
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).toBeNull();
  });

  it('returns nextPagePlan via seite-link fallback when pagination marker missing', () => {
    const html = `
      <html><body>
      <script data-testid="collection-page-structured-data" type="application/ld+json">
      {
        "@type": "CollectionPage",
        "mainEntity": {
          "@type": "ItemList",
          "numberOfItems": 0,
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "item": {
              "@type": "RealEstateListing",
              "name": "Fallback Test",
              "url": "/expose/bbb222ccc333ddd444eee555",
              "description": "50 m\u00b2 . 2 Zimmer . 1030 Wien",
              "mainEntity": {"@type": "Apartment", "address": {"postalCode": "1030", "addressLocality": "Wien"}}
            }}
          ]
        }
      }
      </script>
      <nav><a href="/regional/wien/wien/immobilien/seite-2">Seite 2</a></nav>
      </body></html>`;
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('/seite-2');
  });

  it('returns nextPagePlan via total count fallback', () => {
    const html = `
      <script data-testid="collection-page-structured-data" type="application/ld+json">
      {
        "@type": "CollectionPage",
        "mainEntity": {
          "@type": "ItemList",
          "numberOfItems": 100,
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "item": {
              "@type": "RealEstateListing",
              "name": "Count Fallback Test",
              "url": "/expose/ccc333ddd444eee555fff666",
              "description": "70 m\u00b2 . 3 Zimmer . 1010 Wien",
              "mainEntity": {"@type": "Apartment", "address": {"postalCode": "1010", "addressLocality": "Wien"}}
            }}
          ]
        }
      }
      </script>`;
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });
    expect(result.nextPagePlan).not.toBeNull();
    expect(result.nextPagePlan!.url).toContain('/seite-2');
  });

  it('includes discoveredAt and sourceCode on items', () => {
    const html = loadFixture('discovery-page.html');
    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    });

    const first = result.items[0]!;
    expect(first.sourceCode).toBe('immoscout24');
    expect(first.discoveredAt).toBeTruthy();
    expect(() => new Date(first.discoveredAt)).not.toThrow();
  });
});

describe('Discovery page parsing (app state)', () => {
  // Pages after the first carry only the app state. Live pages escape "/" as / and hold
  // bare `undefined` values, which JSON.parse alone rejects.
  function statePage(results: Record<string, unknown>): string {
    const state = JSON.stringify({
      htmlMeta: { canonicalURL: '__undefined__' },
      reduxAsyncConnect: { pageData: { results } },
    })
      .replace('"__undefined__"', 'undefined')
      .replace(/\//g, '\\u002F');
    return `<html><body><script>window.__INITIAL_STATE__=${state};</script></body></html>`;
  }

  it('reads the listings and the next page from a page without JSON-LD', () => {
    const html = statePage({
      totalHits: 22057,
      hits: [
        {
          exposeId: 'aaa111bbb222ccc333ddd444',
          links: { targetURL: '/expose/aaa111bbb222ccc333ddd444' },
          headline: 'Neubauprojekt mit 40 Einheiten',
          addressString: '1220 Wien',
          primaryPrice: 0,
          primaryArea: null,
          numberOfRooms: null,
        },
        {
          exposeId: 'bbb222ccc333ddd444eee555',
          links: { targetURL: '/expose/bbb222ccc333ddd444eee555' },
          headline: '2-Zimmer-Wohnung mit Loggia',
          addressString: 'Musterstraße 3, 1100 Wien',
          primaryPrice: 249000,
          primaryArea: 54.5,
          numberOfRooms: 2,
        },
      ],
      pagination: {
        pageIndex: 1,
        totalPages: 100,
        nextURL: '/regional/wien/wien/wohnung-kaufen/seite-3',
      },
    });
    expect(html).toContain('undefined');

    const result = parseDiscoveryPage(html, 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen/seite-2?sort=CREATED_DESC',
      metadata: { page: 2 },
    });

    expect(result.items.map((item) => item.externalId)).toEqual([
      'aaa111bbb222ccc333ddd444',
      'bbb222ccc333ddd444eee555',
    ]);
    // A developer project sends price 0, which means no price.
    expect(result.items[0]!.summaryPayload.priceRaw).toBeNull();
    expect(result.items[1]!.summaryPayload).toMatchObject({
      detailUrl: 'https://www.immobilienscout24.at/expose/bbb222ccc333ddd444eee555',
      titleRaw: '2-Zimmer-Wohnung mit Loggia',
      priceRaw: '249000',
      // A fractional JSON number keeps two decimals, so it never shows three after the dot.
      areaRaw: '54.50',
      roomsRaw: '2',
      locationRaw: 'Musterstraße 3, 1100 Wien',
    });
    expect(result.totalEstimate).toBe(22057);
    // The next page keeps the newest-first order.
    expect(result.nextPagePlan!.url).toBe(
      'https://www.immobilienscout24.at/regional/wien/wien/wohnung-kaufen/seite-3?sort=CREATED_DESC',
    );
    expect(result.nextPagePlan!.metadata!.page).toBe(3);
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
    // As the description writes it, so normalization reads the Austrian separators.
    expect(p.livingAreaRaw).toBe('65,20');
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
    expect(result.payload.balconyAreaRaw).toBe('4,50');
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
    expect(result.canonicalUrl).toBe(
      'https://www.immobilienscout24.at/expose/abc123def456789012345678',
    );
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

  it('detects blocked page from a challenge title', () => {
    const html = '<html><head><title>Just a moment...</title></head><body></body></html>';
    const status = detectDetailAvailability(html);
    expect(status.status).toBe('blocked');
  });

  it('does not read a page that loads reCAPTCHA as blocked', () => {
    // Blocked fails the detail job, so loading reCAPTCHA alone must not count.
    const html = `<html><head><title>3-Zimmer-Wohnung - ImmobilienScout24.at</title>
      <script src="https://www.google.com/recaptcha/api.js?render=explicit"></script></head>
      <body><h1>3-Zimmer-Wohnung</h1><div class="g-recaptcha"></div></body></html>`;
    expect(detectDetailAvailability(html).status).toBe('unknown');
  });

  it('keeps a live @graph listing available when only a teaser says verkauft', () => {
    const status = detectDetailAvailability(loadFixture('detail-graph.html'));
    expect(status.status).toBe('available');
  });

  it('ignores verkauft outside the title and h1 when the page has no JSON-LD', () => {
    const html = `<html><head><title>3-Zimmer-Wohnung - ImmobilienScout24.at</title></head><body>
      <h1>3-Zimmer-Wohnung</h1>
      <section><p>Bereits verkauft</p></section>
    </body></html>`;
    expect(detectDetailAvailability(html).status).toBe('unknown');
  });
});

describe('Detail page parsing (@graph JSON-LD)', () => {
  // The fixture has no app state, so the Offer, the visible price and the text are the sources.
  const GRAPH_URL = 'https://www.immobilienscout24.at/expose/0a1b2c3d4e5f60718293a4b5';
  const VISIBLE_PRICE = '<div data-testid="primary-price">ab 389.000<span> €</span></div>';

  function parseGraphPage(html: string) {
    return parseDetailPage(html, GRAPH_URL, 'immoscout24', 3).payload;
  }

  it('reads the Product inside @graph and keeps an "ab" visible price apart from the asking price', () => {
    // The Offer says 0, and "ab 389.000 €" is the lowest price of a range.
    const result = parseDetailPage(loadFixture('detail-graph.html'), GRAPH_URL, 'immoscout24', 2);

    expect(result.extractionStatus).toBe('captured');
    expect(result.payload.titleRaw).toBe('Altbauwohnung mit Balkon nahe Musterpark');
    expect(result.payload.priceRaw).toBeNull();
    expect(result.payload.priceFromRaw).toBe('389000');
    // Without the Expose record nothing says whether the listing is a project.
    expect(result.payload.isProjectRaw).toBeNull();
    expect(result.payload.images).toHaveLength(2);
    // The ItemList holds other listings, so their provider is not this listing's agent.
    expect(result.payload.contactName).toBeNull();
  });

  it('reads the visible price from its own element only', () => {
    const html = loadFixture('detail-graph.html');
    expect(html).toContain(VISIBLE_PRICE);
    const withPrice = (markup: string) => parseGraphPage(html.replace(VISIBLE_PRICE, markup));

    // "Preis auf Anfrage" has no amount, and the area in the next element is not a price.
    const onRequest = withPrice(
      '<div data-testid="primary-price">Preis auf Anfrage</div><div>65,2 m²</div>',
    );
    expect(onRequest.priceRaw).toBeNull();
    expect(onRequest.priceFromRaw).toBeNull();

    const nested = withPrice(
      '<div data-testid="primary-price"><div>Kaufpreis</div><div>389.000&nbsp;€</div></div>',
    );
    expect(nested.priceRaw).toBe('389000');
    expect(nested.priceFromRaw).toBeNull();

    // Austrian notations: "389.000,- €", and "€ ab 389.000" for the lowest price of a range.
    expect(withPrice('<div data-testid="primary-price">389.000,- €</div>').priceRaw).toBe('389000');
    const fromAfterCurrency = withPrice('<div data-testid="primary-price">€ ab 389.000</div>');
    expect(fromAfterCurrency.priceRaw).toBeNull();
    expect(fromAfterCurrency.priceFromRaw).toBe('389000');
  });

  it('gives a fractional Offer price two decimals', () => {
    // "389000.125" would read as 389,000,125 euros: three digits after a dot are a thousands group.
    const html = loadFixture('detail-graph.html').replace('"price": 0,', '"price": 389000.125,');
    expect(html).toContain('389000.125');
    expect(parseGraphPage(html).priceRaw).toBe('389000.13');
  });

  it('fills area, rooms and balcony from labelled description values only', () => {
    // Without the app state the text is the only source. A bare "120 m²" or "4 Zimmer" can be the
    // top of a project's range, and the first "m²" can be the balcony.
    const withDescription = (description: string) =>
      parseGraphPage(
        loadFixture('detail-graph.html').replace(
          /"description": "[^"]*"/g,
          `"description": "${description}"`,
        ),
      );

    expect(
      withDescription('Neubauprojekt mit 2 bis 4 Zimmer und 45 bis 120 m² Wohnfläche.'),
    ).toMatchObject({ livingAreaRaw: null, roomsRaw: null });
    expect(withDescription('Wohnfläche: 45 bis 120 m², Zimmer: 2 bis 4.')).toMatchObject({
      livingAreaRaw: null,
      roomsRaw: null,
    });
    expect(
      withDescription('Wohnung mit 8 m² Balkon und 72 m² Wohnfläche.').livingAreaRaw,
    ).toBeNull();
    expect(
      withDescription('Wohnfläche: 72 m², Schlafzimmer: 2, Zimmer: 3, Balkon: 8 m².'),
    ).toMatchObject({ livingAreaRaw: '72', roomsRaw: '3', balconyAreaRaw: '8' });
  });

  it('keeps the separators of a string Offer price for normalization', () => {
    // Number("455.000") would read 455.
    const html = loadFixture('detail-graph.html').replace('"price": 0,', '"price": "455.000",');
    expect(html).toContain('"455.000"');
    const result = parseDetailPage(
      html,
      'https://www.immobilienscout24.at/expose/0a1b2c3d4e5f60718293a4b5',
      'immoscout24',
      2,
    );
    expect(result.payload.priceRaw).toBe('455.000');
  });
});

describe('Detail page parsing (Expose record)', () => {
  it('reads price, area, rooms, address and type from the Expose record', () => {
    // The description names none of these, so the values can only come from the record.
    const result = parseDetailPage(
      loadFixture('detail-expose.html'),
      'https://www.immobilienscout24.at/expose/0f1e2d3c4b5a69788796a5b4',
      'immoscout24',
      3,
    );

    expect(result.extractionStatus).toBe('captured');
    expect(result.payload).toMatchObject({
      priceRaw: '389000',
      livingAreaRaw: '72.40',
      roomsRaw: '3',
      balconyAreaRaw: '5.20',
      streetRaw: 'Musterstraße 12',
      postalCodeRaw: '1150',
      districtRaw: '15. Bezirk',
      cityRaw: 'Wien',
      addressRaw: 'Musterstraße 12, 1150 Wien',
      estateTypeRaw: 'APARTMENT',
      operationTypeRaw: 'sale',
      yearBuiltRaw: '1905',
      isProjectRaw: false,
      priceFromRaw: null,
    });
  });

  const EXPOSE_URL = 'https://www.immobilienscout24.at/expose/0f1e2d3c4b5a69788796a5b4';

  function parseExposePage(html: string) {
    return parseDetailPage(html, EXPOSE_URL, 'immoscout24', 3).payload;
  }

  it('reads the Expose record when the state assignment has spaces around "="', () => {
    const html = loadFixture('detail-expose.html').replace(
      'window.__APOLLO_STATE__={',
      'window.__APOLLO_STATE__ = {',
    );
    expect(html).toContain('window.__APOLLO_STATE__ = {');
    expect(parseExposePage(html)).toMatchObject({ priceRaw: '389000', livingAreaRaw: '72.40' });
  });

  it('gives a fractional Expose number two decimals', () => {
    // The normalizer would read "72.125" as 72,125 m².
    const html = loadFixture('detail-expose.html').replace(
      '"primaryArea":72.4,"livingArea":72.4',
      '"primaryArea":72.125,"livingArea":72.125',
    );
    expect(html).toContain('"livingArea":72.125');
    expect(parseExposePage(html).livingAreaRaw).toBe('72.13');
  });

  it('takes no Offer or visible price when the Expose record has no price', () => {
    // The record's 0 means "price on request", and the other sources must not fill it in.
    const html = loadFixture('detail-expose.html')
      .replace('"primaryPrice":389000', '"primaryPrice":0')
      .replace('"priceCurrency": "EUR",', '"priceCurrency": "EUR", "price": 389000,')
      .replace('</h1>', '</h1><div data-testid="primary-price">389.000 €</div>');
    expect(html).toContain('"price": 389000,');
    expect(parseExposePage(html).priceRaw).toBeNull();
  });

  it('gives a developer project no asking price, area, rooms or floor', () => {
    // primaryPrice is the cheapest unit's price and changes as units sell, so it is kept as a
    // from-price. The record's area and rooms can describe one unit, and the text quotes ranges
    // across all units, so neither describes the listing.
    const html = loadFixture('detail-expose.html')
      .replace('"__typename":"Expose",', '"__typename":"Expose","meta":{"hasChildren":true},')
      .replace(
        '"description": "Helle Wohnung in ruhiger Lage, nahe Musterpark."',
        '"description": "Neubauprojekt mit 2 bis 5 Zimmern und 40 bis 155 m² Wohnfläche im 1. bis 5. Stock."',
      );
    expect(html).toContain('"hasChildren":true');
    expect(html).toContain('"livingArea":72.4');
    expect(html).toContain('155 m²');

    expect(parseExposePage(html)).toMatchObject({
      priceRaw: null,
      livingAreaRaw: null,
      roomsRaw: null,
      balconyAreaRaw: null,
      floorRaw: null,
      isProjectRaw: true,
      priceFromRaw: '389000',
      postalCodeRaw: '1150',
    });
  });
});

describe('Listing key', () => {
  it('derives the same key from the detail page as discovery gives the listing', () => {
    const item = parseDiscoveryPage(loadFixture('discovery-page.html'), 'immoscout24', {
      url: 'https://www.immobilienscout24.at/regional/wien/wien/immobilien',
      metadata: { page: 1 },
    }).items[0]!;
    const detail = parseDetailPage(
      loadFixture('detail-page.html'),
      item.detailUrl,
      'immoscout24',
      2,
    );

    // The discovery worker keys sightings as `${sourceCode}:${externalId}`.
    expect(new Immoscout24Adapter().deriveSourceListingKey(detail)).toBe(
      `${item.sourceCode}:${item.externalId}`,
    );
  });
});
