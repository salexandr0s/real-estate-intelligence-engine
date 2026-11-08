import { query } from '../client.js';

/** A detail page worth fetching, as selected after a discovery sweep. */
export interface DetailFetchCandidate {
  sourceListingKey: string;
  detailUrl: string;
  discoveryUrl: string | null;
}

interface DetailFetchCandidateDbRow {
  source_listing_key: string;
  detail_url: string;
  discovery_url: string | null;
}

function toCandidate(row: DetailFetchCandidateDbRow): DetailFetchCandidate {
  return {
    sourceListingKey: row.source_listing_key,
    detailUrl: row.detail_url,
    discoveryUrl: row.discovery_url,
  };
}

// ── Discovery ───────────────────────────────────────────────────────────────

export interface PageSighting {
  sourceListingKey: string;
  detailUrl: string;
  discoveryUrl: string | null;
  summarySha256: string;
}

/**
 * Record the items of one discovery page. A row with no summary hash yet (a new
 * or backfilled key) takes the hash without counting as changed, so the first
 * sweep after an import marks nothing as changed.
 */
export async function upsertPage(
  sourceId: number,
  scrapeRunId: number,
  sightings: PageSighting[],
): Promise<void> {
  // A page can repeat a key, and one INSERT can't update the same row twice.
  const unique = [...new Map(sightings.map((s) => [s.sourceListingKey, s])).values()];
  if (unique.length === 0) return;

  await query(
    `INSERT INTO raw_listing_sightings (
       source_id, source_listing_key, detail_url, discovery_url,
       last_sighted_at, last_sighted_run_id, summary_sha256
     )
     SELECT $1, t.source_listing_key, t.detail_url, t.discovery_url, NOW(), $2, t.summary_sha256
     FROM unnest($3::text[], $4::text[], $5::text[], $6::text[])
       AS t(source_listing_key, detail_url, discovery_url, summary_sha256)
     ON CONFLICT (source_id, source_listing_key) DO UPDATE SET
       detail_url = EXCLUDED.detail_url,
       discovery_url = EXCLUDED.discovery_url,
       last_sighted_at = EXCLUDED.last_sighted_at,
       last_sighted_run_id = EXCLUDED.last_sighted_run_id,
       summary_sha256 = EXCLUDED.summary_sha256,
       summary_changed_at = CASE
         WHEN raw_listing_sightings.summary_sha256 IS NOT NULL
           AND raw_listing_sightings.summary_sha256 IS DISTINCT FROM EXCLUDED.summary_sha256
         THEN NOW()
         ELSE raw_listing_sightings.summary_changed_at
       END`,
    [
      sourceId,
      scrapeRunId,
      unique.map((s) => s.sourceListingKey),
      unique.map((s) => s.detailUrl),
      unique.map((s) => s.discoveryUrl),
      unique.map((s) => s.summarySha256),
    ],
  );
}

export interface SelectFreshInput {
  sourceId: number;
  scrapeRunId: number;
  /** Refetch a sighted listing whose last good detail page is older than this. */
  refreshDays: number;
  /** Recheck a sighted listing that isn't active after this many days, which repairs wrong statuses. */
  recheckInactiveDays: number;
  limit: number;
}

/** Sightings from this run that need a fetch: new keys, then changed summaries, then the oldest. */
export async function selectFresh(input: SelectFreshInput): Promise<DetailFetchCandidate[]> {
  const rows = await query<DetailFetchCandidateDbRow>(
    `SELECT s.source_listing_key, s.detail_url, s.discovery_url
     FROM raw_listing_sightings s
     LEFT JOIN listings l
       ON l.source_id = s.source_id AND l.source_listing_key = s.source_listing_key
     WHERE s.source_id = $1
       AND s.last_sighted_run_id = $2
       AND (s.next_detail_at IS NULL OR s.next_detail_at <= NOW())
       AND (
         s.last_detail_ok_at IS NULL
         OR s.summary_changed_at > s.last_detail_ok_at
         OR s.last_detail_ok_at < NOW() - make_interval(days => $3)
         OR (l.listing_status <> 'active' AND s.last_detail_ok_at < NOW() - make_interval(days => $4))
       )
     ORDER BY
       s.last_detail_ok_at IS NULL DESC,
       s.summary_changed_at > s.last_detail_ok_at DESC NULLS LAST,
       l.listing_status <> 'active' DESC NULLS LAST,
       s.last_detail_ok_at ASC
     LIMIT $5`,
    [input.sourceId, input.scrapeRunId, input.refreshDays, input.recheckInactiveDays, input.limit],
  );
  return rows.map(toCandidate);
}

/**
 * Active listings discovery hasn't seen lately, oldest first. Only their own
 * detail pages can show whether they're gone.
 */
export async function selectRevalidate(
  sourceId: number,
  staleDays: number,
  limit: number,
): Promise<DetailFetchCandidate[]> {
  const rows = await query<DetailFetchCandidateDbRow>(
    `SELECT s.source_listing_key, s.detail_url, s.discovery_url
     FROM listings l
     JOIN raw_listing_sightings s
       ON s.source_id = l.source_id AND s.source_listing_key = l.source_listing_key
     WHERE l.source_id = $1
       AND l.listing_status = 'active'
       AND l.last_seen_at < NOW() - make_interval(days => $2)
       AND (s.last_sighted_at IS NULL OR s.last_sighted_at < NOW() - make_interval(days => $2))
       AND (s.next_detail_at IS NULL OR s.next_detail_at <= NOW())
     ORDER BY l.last_seen_at
     LIMIT $3`,
    [sourceId, staleDays, limit],
  );
  return rows.map(toCandidate);
}

/** Hold selected keys back for a day, so an overlapping sweep doesn't select them again. */
export async function markEnqueued(sourceId: number, sourceListingKeys: string[]): Promise<void> {
  if (sourceListingKeys.length === 0) return;
  await query(
    `UPDATE raw_listing_sightings
     SET last_detail_enqueued_at = NOW(),
         next_detail_at = NOW() + INTERVAL '1 day'
     WHERE source_id = $1 AND source_listing_key = ANY($2::text[])`,
    [sourceId, sourceListingKeys],
  );
}

// ── Detail outcomes ─────────────────────────────────────────────────────────

export interface DetailOutcomeInput {
  sourceId: number;
  sourceListingKey: string;
  detailUrl: string;
  /**
   * `parsed`: the page gave a listing. `gone`: it said the listing was removed, sold or
   * rented. `inconclusive`: it loaded but gave neither. Blocked pages and network errors
   * aren't outcomes, because they say nothing about the listing.
   */
  outcome: 'parsed' | 'gone' | 'inconclusive';
  /** When the page was fetched. */
  fetchedAt: Date;
}

/**
 * Inconclusive fetches back off for 2, 4, 8, 16, then 30 days, so three strikes span 6 days.
 * Outcomes are dated by their fetch, so a job that runs twice counts once, and a fetch older
 * than the latest outcome on the row changes nothing.
 */
export async function recordDetailOutcome(input: DetailOutcomeInput): Promise<void> {
  if (input.outcome !== 'inconclusive') {
    await query(
      `INSERT INTO raw_listing_sightings (
         source_id, source_listing_key, detail_url, last_detail_ok_at, last_detail_parsed_at
       )
       VALUES ($1, $2, $3, $4::timestamptz, CASE WHEN $5::boolean THEN $4::timestamptz END)
       ON CONFLICT (source_id, source_listing_key) DO UPDATE SET
         last_detail_ok_at = GREATEST(
           raw_listing_sightings.last_detail_ok_at, EXCLUDED.last_detail_ok_at
         ),
         last_detail_parsed_at = GREATEST(
           raw_listing_sightings.last_detail_parsed_at, EXCLUDED.last_detail_parsed_at
         ),
         inconclusive_count = CASE
           WHEN raw_listing_sightings.last_inconclusive_at IS NULL
             OR raw_listing_sightings.last_inconclusive_at < EXCLUDED.last_detail_ok_at
           THEN 0
           ELSE raw_listing_sightings.inconclusive_count
         END`,
      [
        input.sourceId,
        input.sourceListingKey,
        input.detailUrl,
        input.fetchedAt,
        input.outcome === 'parsed',
      ],
    );
    return;
  }

  await query(
    `INSERT INTO raw_listing_sightings (
       source_id, source_listing_key, detail_url,
       inconclusive_count, last_inconclusive_at, next_detail_at
     )
     VALUES ($1, $2, $3, 1, $4::timestamptz, $4::timestamptz + INTERVAL '2 days')
     ON CONFLICT (source_id, source_listing_key) DO UPDATE SET
       inconclusive_count = raw_listing_sightings.inconclusive_count + 1,
       last_inconclusive_at = EXCLUDED.last_inconclusive_at,
       next_detail_at = EXCLUDED.last_inconclusive_at + make_interval(
         days => LEAST(30, power(2, LEAST(raw_listing_sightings.inconclusive_count + 1, 5)))::int
       )
     WHERE (raw_listing_sightings.last_inconclusive_at IS NULL
         OR raw_listing_sightings.last_inconclusive_at < EXCLUDED.last_inconclusive_at)
       AND (raw_listing_sightings.last_detail_ok_at IS NULL
         OR raw_listing_sightings.last_detail_ok_at < EXCLUDED.last_inconclusive_at)`,
    [input.sourceId, input.sourceListingKey, input.detailUrl, input.fetchedAt],
  );
}
