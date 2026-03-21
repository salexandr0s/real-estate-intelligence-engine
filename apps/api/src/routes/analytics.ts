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
}
