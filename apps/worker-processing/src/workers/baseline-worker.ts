/**
 * BullMQ worker: recomputes market baselines from active listings.
 * Runs hourly via scheduler.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@immoradar/observability';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@immoradar/scraper-core';
import type { BaselineJobData } from '@immoradar/scraper-core';
import { getAreaBucket, getRoomBucket } from '@immoradar/contracts';
import { query, marketBaselines } from '@immoradar/db';

const log = createLogger('worker:baseline');

interface ListingAggRow {
  city: string;
  district_no: number | null;
  operation_type: string;
  property_type: string;
  price_per_sqm_eur: string;
  living_area_sqm: string | null;
  rooms: string | null;
}

interface BucketGroup {
  city: string;
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  areaBucket: string;
  roomBucket: string;
  values: number[];
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(sorted: number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function stddev(values: number[], mean: number): number {
  const sumSqDiff = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(sumSqDiff / values.length);
}

export function createBaselineWorker(): Worker<BaselineJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const worker = new Worker<BaselineJobData>(
    QUEUE_NAMES.BASELINE,
    async (job: Job<BaselineJobData>) => {
      log.info('Baseline recomputation started', { triggeredBy: job.data.triggeredBy });

      const rows = await query<ListingAggRow>(
        `SELECT city, district_no, operation_type, property_type,
                price_per_sqm_eur, living_area_sqm, rooms
         FROM listings
         WHERE listing_status = 'active' AND price_per_sqm_eur IS NOT NULL`,
      );

      if (rows.length === 0) {
        log.warn('No active listings with price data');
        return;
      }

      const groupKey = (
        city: string,
        districtNo: number | null,
        op: string,
        prop: string,
        area: string,
        room: string,
      ): string => `${city}|${districtNo ?? 'NULL'}|${op}|${prop}|${area}|${room}`;

      const districtGroups = new Map<string, BucketGroup>();
      const cityGroups = new Map<string, BucketGroup>();

      for (const row of rows) {
        const ppsqm = Number(row.price_per_sqm_eur);
        if (isNaN(ppsqm) || ppsqm <= 0) continue;

        const areaSqm = row.living_area_sqm != null ? Number(row.living_area_sqm) : null;
        const roomCount = row.rooms != null ? Number(row.rooms) : null;
        const areaBucket = getAreaBucket(areaSqm);
        const roomBucket = getRoomBucket(roomCount);

        const dKey = groupKey(
          row.city,
          row.district_no,
          row.operation_type,
          row.property_type,
          areaBucket,
          roomBucket,
        );
        if (!districtGroups.has(dKey)) {
          districtGroups.set(dKey, {
            city: row.city,
            districtNo: row.district_no,
            operationType: row.operation_type,
            propertyType: row.property_type,
            areaBucket,
            roomBucket,
            values: [],
          });
        }
        districtGroups.get(dKey)!.values.push(ppsqm);

        const cKey = groupKey(
          row.city,
          null,
          row.operation_type,
          row.property_type,
          areaBucket,
          roomBucket,
        );
        if (!cityGroups.has(cKey)) {
          cityGroups.set(cKey, {
            city: row.city,
            districtNo: null,
            operationType: row.operation_type,
            propertyType: row.property_type,
            areaBucket,
            roomBucket,
            values: [],
          });
        }
        cityGroups.get(cKey)!.values.push(ppsqm);
      }

      const baselineDate = new Date();
      let upserted = 0;

      for (const group of [...districtGroups.values(), ...cityGroups.values()]) {
        if (group.values.length < 3) continue;

        const sorted = group.values.slice().sort((a, b) => a - b);
        const med = median(sorted);
        const p25 = percentile(sorted, 25);
        const p75 = percentile(sorted, 75);
        const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        const sd = stddev(sorted, mean);

        const trimCount = Math.floor(sorted.length * 0.1);
        const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
        const trimmedMean =
          trimmed.length > 0 ? trimmed.reduce((a, b) => a + b, 0) / trimmed.length : mean;

        await marketBaselines.upsertBaseline({
          baselineDate,
          city: group.city,
          districtNo: group.districtNo,
          operationType: group.operationType,
          propertyType: group.propertyType,
          areaBucket: group.areaBucket,
          roomBucket: group.roomBucket,
          sampleSize: group.values.length,
          medianPpsqmEur: Math.round(med * 100) / 100,
          trimmedMeanPpsqmEur: Math.round(trimmedMean * 100) / 100,
          p25PpsqmEur: Math.round(p25 * 100) / 100,
          p75PpsqmEur: Math.round(p75 * 100) / 100,
          stddevPpsqmEur: Math.round(sd * 100) / 100,
        });
        upserted++;
      }

      log.info('Baseline recomputation complete', {
        listings: rows.length,
        baselinesUpserted: upserted,
      });
    },
    {
      connection,
      prefix,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    log.error('Baseline job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}
