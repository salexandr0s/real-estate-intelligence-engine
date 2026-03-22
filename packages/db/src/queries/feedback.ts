import { query } from '../client.js';

// ── Types ───────────────────────────────────────────────────────────────────

type FeedbackRating = 'interested' | 'not_interested' | 'bookmarked' | 'contacted';

interface FeedbackDbRow {
  id: string;
  listing_id: string;
  user_id: string;
  rating: FeedbackRating;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FeedbackRow {
  id: number;
  listingId: number;
  userId: number;
  rating: FeedbackRating;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toFeedbackRow(row: FeedbackDbRow): FeedbackRow {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    userId: Number(row.user_id),
    rating: row.rating,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function upsert(
  userId: number,
  listingId: number,
  rating: FeedbackRating,
  notes?: string,
): Promise<FeedbackRow> {
  const rows = await query<FeedbackDbRow>(
    `INSERT INTO investor_feedback (user_id, listing_id, rating, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (listing_id, user_id) DO UPDATE
       SET rating = EXCLUDED.rating,
           notes = EXCLUDED.notes,
           updated_at = NOW()
     RETURNING *`,
    [userId, listingId, rating, notes ?? null],
  );
  return toFeedbackRow(rows[0]!);
}

export async function findByListing(
  listingId: number,
  userId: number,
): Promise<FeedbackRow | null> {
  const rows = await query<FeedbackDbRow>(
    `SELECT * FROM investor_feedback
     WHERE listing_id = $1 AND user_id = $2`,
    [listingId, userId],
  );
  const row = rows[0];
  return row ? toFeedbackRow(row) : null;
}

export async function findByUser(
  userId: number,
  limit = 50,
  cursor?: string,
): Promise<{ data: FeedbackRow[]; nextCursor: string | null }> {
  const cursorDate = cursor ? new Date(cursor) : null;

  const rows = await query<FeedbackDbRow>(
    `SELECT * FROM investor_feedback
     WHERE user_id = $1
       AND ($3::timestamptz IS NULL OR created_at < $3)
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit + 1, cursorDate],
  );

  const hasNext = rows.length > limit;
  const data = (hasNext ? rows.slice(0, limit) : rows).map(toFeedbackRow);
  const nextCursor =
    hasNext && data.length > 0 ? data[data.length - 1]!.createdAt.toISOString() : null;

  return { data, nextCursor };
}

export async function remove(userId: number, listingId: number): Promise<boolean> {
  const rows = await query(
    `DELETE FROM investor_feedback
     WHERE user_id = $1 AND listing_id = $2
     RETURNING id`,
    [userId, listingId],
  );
  return rows.length > 0;
}
