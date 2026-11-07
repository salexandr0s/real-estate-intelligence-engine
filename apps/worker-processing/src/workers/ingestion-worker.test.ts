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

  it('marks the sighting ok when the listing was stored', async () => {
    hoisted.ingestDetailCapture.mockResolvedValue(ingestedListing(22));

    await processJob(job());

    expect(hoisted.recordDetailOutcome).toHaveBeenCalledWith({
      sourceId: 7,
      sourceListingKey: 'willhaben:1',
      detailUrl: 'https://example.test/listing/1',
      outcome: 'ok',
    });
  });

  it('counts a loaded page without a listing as inconclusive unless it says the listing is gone', async () => {
    hoisted.ingestDetailCapture.mockResolvedValue(ingestedListing(0));

    await processJob(job());
    await processJob(job({ availabilityStatus: 'sold' }));
    // An error page says nothing about the listing.
    await processJob(job({ responseStatus: 404 }));

    const outcomes = hoisted.recordDetailOutcome.mock.calls.map(([input]) => input.outcome);
    expect(outcomes).toEqual(['inconclusive', 'ok']);
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
