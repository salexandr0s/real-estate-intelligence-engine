import { query } from '../client.js';

export interface DashboardStats {
  totalActive: number;
  newToday: number;
  newThisWeek: number;
  highScore70: number;
  avgScore: number | null;
}

/**
 * Fetch dashboard summary stats in a single query using FILTER aggregates.
 */
export async function getStats(): Promise<DashboardStats> {
  const rows = await query<{
    total_active: string;
    new_today: string;
    new_this_week: string;
    high_score: string;
    avg_score: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE listing_status = 'active') AS total_active,
       COUNT(*) FILTER (WHERE listing_status = 'active'
         AND first_seen_at >= CURRENT_DATE) AS new_today,
       COUNT(*) FILTER (WHERE listing_status = 'active'
         AND first_seen_at >= CURRENT_DATE - INTERVAL '7 days') AS new_this_week,
       COUNT(*) FILTER (WHERE listing_status = 'active'
         AND current_score >= 70) AS high_score,
       ROUND(AVG(current_score) FILTER (WHERE listing_status = 'active'
         AND current_score IS NOT NULL)::numeric, 1) AS avg_score
     FROM listings
     WHERE district_no IS NOT NULL`,
    [],
  );

  const row = rows[0];
  return {
    totalActive: Number(row?.total_active ?? 0),
    newToday: Number(row?.new_today ?? 0),
    newThisWeek: Number(row?.new_this_week ?? 0),
    highScore70: Number(row?.high_score ?? 0),
    avgScore: row?.avg_score != null ? Number(row.avg_score) : null,
  };
}
