import type { FastifyInstance } from 'fastify';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import { query } from '@immoradar/db';
import { velocityToTemperature } from '@immoradar/contracts';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@immoradar/scraper-core';
import type { RescoreJobData } from '@immoradar/scraper-core';
import { parseOrThrow, districtTrendQuerySchema } from '../schemas.js';
import { z } from 'zod';

let rescoreQueue: Queue<RescoreJobData> | null = null;

function getRescoreQueue(): Queue<RescoreJobData> {
  if (!rescoreQueue) {
    const connection = getRedisConnection() as ConnectionOptions;
    const prefix = getQueuePrefix();
    rescoreQueue = new Queue<RescoreJobData>(QUEUE_NAMES.RESCORE, { connection, prefix });
  }
  return rescoreQueue;
}

interface BaselineDbRow {
  city: string;
  district_no: number | null;
  operation_type: string;
  property_type: string;
  area_bucket: string;
  room_bucket: string;
  sample_size: number;
  median_ppsqm_eur: string;
  p25_ppsqm_eur: string | null;
  p75_ppsqm_eur: string | null;
  stddev_ppsqm_eur: string | null;
  baseline_date: Date;
}

function toApiBaseline(row: BaselineDbRow) {
  return {
    city: row.city,
    districtNo: row.district_no,
    operationType: row.operation_type,
    propertyType: row.property_type,
    areaBucket: row.area_bucket,
    roomBucket: row.room_bucket,
    sampleSize: row.sample_size,
    medianPpsqmEur: Number(row.median_ppsqm_eur),
    p25PpsqmEur: row.p25_ppsqm_eur != null ? Number(row.p25_ppsqm_eur) : null,
    p75PpsqmEur: row.p75_ppsqm_eur != null ? Number(row.p75_ppsqm_eur) : null,
    stddevPpsqmEur: row.stddev_ppsqm_eur != null ? Number(row.stddev_ppsqm_eur) : null,
    baselineDate: row.baseline_date,
  };
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/analytics/baselines', async (_request, reply) => {
    const rows = await query<BaselineDbRow>(
      `SELECT city, district_no, operation_type, property_type,
              area_bucket, room_bucket, sample_size,
              median_ppsqm_eur, p25_ppsqm_eur, p75_ppsqm_eur,
              stddev_ppsqm_eur, baseline_date
       FROM market_baselines
       ORDER BY city, district_no NULLS LAST, area_bucket
       LIMIT 500`,
      [],
    );
    return reply.send({
      data: rows.map(toApiBaseline),
      meta: { count: rows.length },
    });
  });

  // GET /v1/analytics/score-distribution - Score distribution buckets
  app.get('/v1/analytics/score-distribution', async (_request, reply) => {
    const rows = await query<{ bucket: string; count: string }>(
      `SELECT
        CASE
          WHEN current_score IS NULL THEN 'unscored'
          WHEN current_score < 20 THEN '0-19'
          WHEN current_score < 40 THEN '20-39'
          WHEN current_score < 60 THEN '40-59'
          WHEN current_score < 80 THEN '60-79'
          ELSE '80-100'
        END AS bucket,
        count(*) AS count
      FROM listings
      WHERE listing_status = 'active'
      GROUP BY 1
      ORDER BY 1`,
      [],
    );
    return reply.send({
      data: rows.map((r) => ({
        bucket: r.bucket,
        count: Number(r.count),
      })),
      meta: {},
    });
  });

  // GET /v1/analytics/district-comparison - District-level stats
  app.get('/v1/analytics/district-comparison', async (_request, reply) => {
    const rows = await query<{
      district_no: number;
      listing_count: string;
      avg_price_per_sqm: string;
      min_price_per_sqm: string;
      max_price_per_sqm: string;
      avg_score: string | null;
    }>(
      `SELECT
        district_no,
        count(*) AS listing_count,
        ROUND(AVG(price_per_sqm_eur)::numeric, 2) AS avg_price_per_sqm,
        ROUND(MIN(price_per_sqm_eur)::numeric, 2) AS min_price_per_sqm,
        ROUND(MAX(price_per_sqm_eur)::numeric, 2) AS max_price_per_sqm,
        ROUND(AVG(current_score)::numeric, 1) AS avg_score
      FROM listings
      WHERE listing_status = 'active'
        AND district_no IS NOT NULL
        AND price_per_sqm_eur IS NOT NULL
      GROUP BY district_no
      ORDER BY district_no`,
      [],
    );
    return reply.send({
      data: rows.map((r) => ({
        districtNo: r.district_no,
        listingCount: Number(r.listing_count),
        avgPricePerSqm: Number(r.avg_price_per_sqm),
        minPricePerSqm: Number(r.min_price_per_sqm),
        maxPricePerSqm: Number(r.max_price_per_sqm),
        avgScore: r.avg_score != null ? Number(r.avg_score) : null,
      })),
    });
  });

  // GET /v1/analytics/district-trends - Price trends over time by district
  app.get(
    '/v1/analytics/district-trends',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Get district price trends over time from market baselines',
        querystring: {
          type: 'object',
          properties: {
            districtNo: { type: 'number', description: 'Filter to specific district' },
            operationType: { type: 'string', description: 'sale or rent' },
            propertyType: { type: 'string' },
            months: { type: 'integer', description: 'Lookback period in months (default 12)' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseOrThrow(districtTrendQuerySchema, request.query);
      const months = parsed.months ?? 12;

      const rows = await query<{
        district_no: number;
        baseline_date: Date;
        avg_median_ppsqm: string;
        total_samples: string;
        avg_p25: string | null;
        avg_p75: string | null;
      }>(
        `SELECT
          district_no,
          baseline_date,
          ROUND(AVG(median_ppsqm_eur)::numeric, 2) AS avg_median_ppsqm,
          SUM(sample_size)::int AS total_samples,
          ROUND(AVG(p25_ppsqm_eur)::numeric, 2) AS avg_p25,
          ROUND(AVG(p75_ppsqm_eur)::numeric, 2) AS avg_p75
        FROM market_baselines
        WHERE district_no IS NOT NULL
          AND ($1::smallint IS NULL OR district_no = $1)
          AND ($2::text IS NULL OR operation_type = $2)
          AND ($3::text IS NULL OR property_type = $3)
          AND baseline_date >= CURRENT_DATE - ($4::int * INTERVAL '1 month')
        GROUP BY district_no, baseline_date
        ORDER BY district_no, baseline_date`,
        [
          parsed.districtNo ?? null,
          parsed.operationType ?? null,
          parsed.propertyType ?? null,
          months,
        ],
      );

      return reply.send({
        data: rows.map((r) => ({
          districtNo: r.district_no,
          date: r.baseline_date.toISOString().slice(0, 10),
          avgMedianPpsqm: Number(r.avg_median_ppsqm),
          totalSamples: Number(r.total_samples),
          avgP25: r.avg_p25 != null ? Number(r.avg_p25) : null,
          avgP75: r.avg_p75 != null ? Number(r.avg_p75) : null,
        })),
        meta: { months },
      });
    },
  );

  // GET /v1/analytics/market-temperature - Market velocity/temperature by district
  app.get(
    '/v1/analytics/market-temperature',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Get market temperature (listing velocity) by district',
      },
    },
    async (_request, reply) => {
      const rows = await query<{
        district_no: number;
        new_last_7d: string;
        new_last_30d: string;
        total_active: string;
        current_avg_ppsqm: string;
      }>(
        `SELECT
          district_no,
          COUNT(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '7 days')::int AS new_last_7d,
          COUNT(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '30 days')::int AS new_last_30d,
          COUNT(*)::int AS total_active,
          ROUND(AVG(price_per_sqm_eur)::numeric, 2) AS current_avg_ppsqm
        FROM listings
        WHERE listing_status = 'active'
          AND district_no IS NOT NULL
          AND price_per_sqm_eur IS NOT NULL
        GROUP BY district_no
        ORDER BY district_no`,
        [],
      );

      return reply.send({
        data: rows.map((r) => {
          const totalActive = Number(r.total_active);
          const newLast7d = Number(r.new_last_7d);
          const velocity = totalActive > 0 ? newLast7d / totalActive : 0;
          return {
            districtNo: r.district_no,
            newLast7d,
            newLast30d: Number(r.new_last_30d),
            totalActive,
            currentAvgPpsqm: Number(r.current_avg_ppsqm),
            velocity: Math.round(velocity * 10000) / 10000,
            temperature: velocityToTemperature(velocity),
          };
        }),
        meta: {},
      });
    },
  );

  // POST /v1/admin/rescore — Enqueue a batch rescore job
  app.post(
    '/v1/admin/rescore',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Enqueue a batch rescore operation',
      },
    },
    async (request, reply) => {
      const rescoreSchema = z.object({
        sourceCode: z.string().optional(),
        limit: z.number().int().min(1).max(10000).default(1000),
      });
      const parsed = parseOrThrow(rescoreSchema, request.body);

      const queue = getRescoreQueue();

      const job = await queue.add('rescore', {
        triggeredBy: 'api',
        sourceCode: parsed.sourceCode ?? null,
        limit: parsed.limit,
      });

      return reply.status(201).send({
        data: { jobId: job.id, status: 'queued' },
        meta: {},
      });
    },
  );
}
