import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessingJobData } from '@immoradar/scraper-core';

type Processor = (job: { data: ProcessingJobData }) => Promise<void>;

const hoisted = vi.hoisted(() => ({
  processor: null as Processor | null,
  ingestDetailCapture: vi.fn(),
  recordDetailOutcome: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_queueName: string, processor: Processor) {
      hoisted.processor = processor;
      return { on: vi.fn() };
    }
  },
}));

vi.mock('@immoradar/scraper-core', () => ({
  QUEUE_NAMES: { PROCESSING: 'processing' },
  WORKER_CONCURRENCY: 1,
  getRedisConnection: () => ({}),
  getQueuePrefix: () => 'test',
  classifyScraperError: () => 'unknown',
}));

vi.mock('../pipeline-factory.js', () => ({
  createPipeline: () => ({ ingestDetailCapture: hoisted.ingestDetailCapture }),
}));

vi.mock('@immoradar/db', () => ({
  deadLetter: { insert: vi.fn() },
  rawSightings: { recordDetailOutcome: hoisted.recordDetailOutcome },
}));

import { createIngestionWorker } from './ingestion-worker.js';

function job(capture: Record<string, unknown> = {}): { data: ProcessingJobData } {
  return {
    data: {
      sourceCode: 'willhaben',
      sourceId: 7,
      scrapeRunId: 99,
      detailUrl: 'https://example.test/listing/1',
      discoveryUrl: 'https://example.test/search',
      captureJson: JSON.stringify({ payload: { titleRaw: 'Listing' }, ...capture }),
      sightingKey: 'willhaben:1',
    },
  };
}

function ingestedListing(listingId: number) {
  return { raw: {}, normalization: { listingId, isNew: false }, scoring: null };
}

async function processJob(data: { data: ProcessingJobData }): Promise<void> {
  if (!hoisted.processor) throw new Error('worker not created');
  await hoisted.processor(data);
}

describe('ingestion worker detail outcomes', () => {
  beforeEach(() => {
    hoisted.ingestDetailCapture.mockReset();
    hoisted.recordDetailOutcome.mockReset().mockResolvedValue(undefined);
    createIngestionWorker();
  });

  it('records a stored listing as parsed, at the time the page was fetched', async () => {
    hoisted.ingestDetailCapture.mockResolvedValue(ingestedListing(22));

    await processJob(job({ extractedAt: '2026-11-01T10:00:00.000Z' }));

    expect(hoisted.recordDetailOutcome).toHaveBeenCalledWith({
      sourceId: 7,
      sourceListingKey: 'willhaben:1',
      detailUrl: 'https://example.test/listing/1',
      outcome: 'parsed',
      fetchedAt: new Date('2026-11-01T10:00:00.000Z'),
    });
  });

  // Only a parsed page shows the parser still works, and the stale check relies on that.
  it.each<[string, string, Record<string, unknown>, number]>([
    ['a loaded page with no listing', 'inconclusive', {}, 0],
    ['a page saying the listing sold', 'gone', { availabilityStatus: 'sold' }, 0],
    [
      'a 404 that updated the stored listing',
      'gone',
      { availabilityStatus: 'not_found', responseStatus: 404 },
      22,
    ],
    [
      'a live page the parser called not found',
      'inconclusive',
      { availabilityStatus: 'not_found', responseStatus: 200 },
      0,
    ],
  ])('records %s as %s', async (_, outcome, capture, listingId) => {
    hoisted.ingestDetailCapture.mockResolvedValue(ingestedListing(listingId));

    await processJob(job(capture));

    expect(hoisted.recordDetailOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome }));
  });

  it('records nothing for an error page, which says nothing about the listing', async () => {
    hoisted.ingestDetailCapture.mockResolvedValue(ingestedListing(0));

    await processJob(job({ responseStatus: 500 }));

    expect(hoisted.recordDetailOutcome).not.toHaveBeenCalled();
  });

  it('skips jobs queued before sightings and never fails the ingest over the outcome', async () => {
    hoisted.ingestDetailCapture.mockResolvedValue(ingestedListing(22));
    const { sightingKey: _sightingKey, ...legacy } = job().data;

    await processJob({ data: legacy });
    expect(hoisted.recordDetailOutcome).not.toHaveBeenCalled();

    hoisted.recordDetailOutcome.mockRejectedValueOnce(new Error('connection reset'));
    await expect(processJob(job())).resolves.toBeUndefined();
  });
});
