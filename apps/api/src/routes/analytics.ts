import type { FastifyInstance } from 'fastify';
import { query } from '@rei/db';

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
}
