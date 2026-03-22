import { query } from '../client.js';

export interface DashboardStats {
  totalActive: number;
  newToday: number;
  highScore70: number;
}

/**
 * Fetch dashboard summary stats in a single query using FILTER aggregates.
 */
export async function getStats(): Promise<DashboardStats> {
  const rows = await query<{
    total_active: string;
    new_today: string;
    high_score: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE listing_status = 'active') AS total_active,
       COUNT(*) FILTER (WHERE listing_status = 'active'
         AND first_seen_at >= CURRENT_DATE) AS new_today,
       COUNT(*) FILTER (WHERE listing_status = 'active'
         AND current_score >= 70) AS high_score
     FROM listings
     WHERE district_no IS NOT NULL`,
    [],
  );

  const row = rows[0];
  return {
    totalActive: Number(row?.total_active ?? 0),
    newToday: Number(row?.new_today ?? 0),
    highScore70: Number(row?.high_score ?? 0),
  };
}
