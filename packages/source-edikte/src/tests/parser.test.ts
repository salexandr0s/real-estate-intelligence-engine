import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DetailContext, NormalizationContext } from '@immoradar/contracts';
import { EdikteMapper } from '@immoradar/normalization';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EdikteAdapter } from '../adapter.js';

const DETAIL_URL =
  'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/alldoc/0123456789abcdef0123456789abcdef!OpenDocument';

const auctionPage = readFileSync(
  resolve(__dirname, '..', '..', 'fixtures', 'detail-synthetic.html'),
  'utf-8',
);

const adapter = new EdikteAdapter();

/** The context the detail worker builds: the page HTML is all the metadata there is. */
function workerContext(html: string): DetailContext {
  return {
    page: null,
    requestPlan: { url: DETAIL_URL, metadata: { html } },
    scrapeRunId: 1,
    sourceCode: 'edikte',
  };
}

/** The synthetic auction page under another edict heading. */
function edictTitled(heading: string): string {
  return auctionPage.replace(
    '<small>Versteigerung - Wohnung Top 1</small>',
    `<small>${heading}</small>`,
  );
}

describe('EdikteAdapter detail page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses a live auction from its HTML and keeps it available on the auction day', async () => {
    // 09:00 in Vienna on 15 April, the auction day.
    vi.setSystemTime(new Date('2026-04-15T07:00:00Z'));
    const ctx = workerContext(auctionPage);

    const capture = await adapter.extractDetailPage(ctx);

    expect(capture.payload).toMatchObject({
      ediktId: '0123456789abcdef0123456789abcdef',
      titleRaw: 'Eigentumswohnung – 1220 Wien',
      caseNumber: '99 E 4711/26x',
      courtName: 'BG Donaustadt (027)',
      auctionDateRaw: '15.4.2026 um 09:30 Uhr',
      appraisedValueRaw: '382.000,00',
      minimumBidRaw: '191.000,00',
      livingAreaRaw: '85,22',
      postalCodeRaw: '1220',
      // The meeting point after the time stays out.
      viewingDatesRaw: ['14.4.2026, 15:30 - 16:00 Uhr'],
      legalNoticesRaw:
        'Der Ersteher kann beantragen, dass nach Verteilung des Meistbotes sämtliche Pfandrechte ' +
        'gelöscht werden. Der für 4.3.2026 anberaumte Versteigerungstermin wurde aufgehoben.\n' +
        'Die Wohnung ist vermietet.',
      publicationDate: '02.03.2026',
    });
    expect(capture.attachmentUrls).toEqual([
      {
        url: 'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/00000000000000000000000000000001/$file/Gutachten.pdf',
        label: 'Gutachten.pdf',
        type: 'application/pdf',
      },
    ]);
    // The page says pledges get "gelöscht" and an earlier sitting was "aufgehoben".
    expect(adapter.detectAvailability(ctx)).toEqual({ status: 'available' });
  });

  it('reports the listing sold once the auction day has passed in Vienna', () => {
    // 00:30 on 16 April in Vienna, while UTC still reads 15 April.
    vi.setSystemTime(new Date('2026-04-15T22:30:00Z'));

    expect(adapter.detectAvailability(workerContext(auctionPage))).toEqual({ status: 'sold' });
  });

  it.each(['Zuschlag ohne Überbot - Wohnung Top 1', 'Meistbotsverteilung'])(
    'reports a "%s" edict sold before the auction day it names',
    (heading) => {
      vi.setSystemTime(new Date('2026-04-01T08:00:00Z'));

      expect(adapter.detectAvailability(workerContext(edictTitled(heading)))).toEqual({
        status: 'sold',
      });
    },
  );

  it.each(['2026-04-01T08:00:00Z', '2026-04-20T08:00:00Z'])(
    'reports a cancelled sitting removed at %s, before or after its date',
    (now) => {
      vi.setSystemTime(new Date(now));
      const html = edictTitled('Entfall des Termins - Wohnung Top 1');

      expect(adapter.detectAvailability(workerContext(html))).toEqual({ status: 'removed' });
    },
  );

  it('titles a page without category or place by its case number', async () => {
    const html =
      '<span class="col-sm-3 text-right">Aktenzeichen:</span>\n' +
      '<p class="col-sm-9"><strong>99 E 4711/26x</strong></p>';

    const capture = await adapter.extractDetailPage(workerContext(html));

    expect(capture.payload.titleRaw).toBe('Zwangsversteigerung 99 E 4711/26x');
  });

  it('still reports a removal notice that shows no case number', () => {
    const html = '<html><body><p>Dieses Edikt ist nicht mehr verfügbar.</p></body></html>';

    expect(adapter.detectAvailability(workerContext(html))).toEqual({ status: 'removed' });
  });
});

describe('EdikteMapper on a parsed edict', () => {
  it('normalizes the auction and viewing dates as Vienna times', async () => {
    const capture = await adapter.extractDetailPage(workerContext(auctionPage));
    const context: NormalizationContext = {
      sourceId: 1,
      sourceListingKey: adapter.deriveSourceListingKey(capture),
      rawListingId: 1,
      scrapeRunId: 1,
      canonicalUrl: capture.canonicalUrl,
      detailUrl: capture.detailUrl,
    };

    const result = new EdikteMapper().normalize(capture.payload, context);

    expect(result.success).toBe(true);
    expect(result.listing?.normalizedPayload).toMatchObject({
      isAuction: true,
      auctionDate: '2026-04-15T09:30:00+02:00',
      viewingDates: ['2026-04-14T15:30:00+02:00'],
      appraisedValueEurCents: 38_200_000,
      minimumBidEurCents: 19_100_000,
    });

    // Winter time, and a viewing day printed without a time.
    const winter = new EdikteMapper().normalize(
      {
        ...capture.payload,
        auctionDateRaw: '15.1.2027 um 10:00 Uhr',
        viewingDatesRaw: ['14.1.2027'],
      },
      context,
    );
    expect(winter.listing?.normalizedPayload).toMatchObject({
      auctionDate: '2027-01-15T10:00:00+01:00',
      viewingDates: ['2027-01-14'],
    });
  });
});
