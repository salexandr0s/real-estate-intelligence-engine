import { query, transaction, queryWithClient } from '../client.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClusterRow {
  id: number;
  fingerprint: string;
  canonicalListingId: number | null;
  listingCount: number;
  minPriceEurCents: number | null;
  maxPriceEurCents: number | null;
  priceSpreadPct: number | null;
  firstSeenAt: Date;
  lastUpdatedAt: Date;
}

export interface ClusterMemberRow {
  listingId: number;
  sourceCode: string;
  sourceName: string;
  title: string;
  listPriceEurCents: number | null;
  pricePerSqmEur: number | null;
  currentScore: number | null;
  canonicalUrl: string;
  firstSeenAt: Date;
}

export interface ClusterWithMembers extends ClusterRow {
  members: ClusterMemberRow[];
}

// ── Row mapping ──────────────────────────────────────────────────────────────

interface ClusterDbRow {
  id: string;
  fingerprint: string;
  canonical_listing_id: string | null;
  listing_count: number;
  min_price_eur_cents: string | null;
  max_price_eur_cents: string | null;
  price_spread_pct: string | null;
  first_seen_at: Date;
  last_updated_at: Date;
}

function toClusterRow(row: ClusterDbRow): ClusterRow {
  return {
    id: Number(row.id),
    fingerprint: row.fingerprint,
    canonicalListingId: row.canonical_listing_id != null ? Number(row.canonical_listing_id) : null,
    listingCount: row.listing_count,
    minPriceEurCents: row.min_price_eur_cents != null ? Number(row.min_price_eur_cents) : null,
    maxPriceEurCents: row.max_price_eur_cents != null ? Number(row.max_price_eur_cents) : null,
    priceSpreadPct: row.price_spread_pct != null ? Number(row.price_spread_pct) : null,
    firstSeenAt: row.first_seen_at,
    lastUpdatedAt: row.last_updated_at,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface ClusterMemberInput {
  listingId: number;
  sourceId: number;
  listPriceEurCents: number | null;
}

export function dedupeClusterMemberInputs(
  members: readonly ClusterMemberInput[],
): ClusterMemberInput[] {
  const seenSourceIds = new Set<number>();
  const uniqueMembers: ClusterMemberInput[] = [];

  for (const member of members) {
    if (seenSourceIds.has(member.sourceId)) continue;
    seenSourceIds.add(member.sourceId);
    uniqueMembers.push(member);
  }

  return uniqueMembers;
}

export async function upsertCluster(
  fingerprint: string,
  members: ClusterMemberInput[],
): Promise<ClusterRow> {
  const uniqueMembers = dedupeClusterMemberInputs(members);

  if (uniqueMembers.length === 0) {
    throw new Error('Cannot create cluster with zero members');
  }

  const prices = uniqueMembers
    .map((m) => m.listPriceEurCents)
    .filter((p): p is number => p != null);
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const spread =
    minPrice != null && maxPrice != null && minPrice > 0
      ? ((maxPrice - minPrice) / minPrice) * 100
      : null;

  // Use first member as canonical (caller should sort by score before calling)
  const canonicalListingId = uniqueMembers[0]?.listingId ?? null;

  return transaction(async (client) => {
    const clusterRows = await queryWithClient<ClusterDbRow>(
      client,
      `INSERT INTO listing_clusters (fingerprint, canonical_listing_id, listing_count, min_price_eur_cents, max_price_eur_cents, price_spread_pct)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (fingerprint) DO UPDATE SET
         canonical_listing_id = EXCLUDED.canonical_listing_id,
         listing_count = EXCLUDED.listing_count,
         min_price_eur_cents = EXCLUDED.min_price_eur_cents,
         max_price_eur_cents = EXCLUDED.max_price_eur_cents,
         price_spread_pct = EXCLUDED.price_spread_pct,
         last_updated_at = NOW()
       RETURNING *`,
      [fingerprint, canonicalListingId, uniqueMembers.length, minPrice, maxPrice, spread],
    );

    const cluster = toClusterRow(clusterRows[0]!);

    // Remove stale members no longer in the current set
    const currentListingIds = uniqueMembers.map((m) => m.listingId);
    await queryWithClient(
      client,
      `DELETE FROM listing_cluster_members
       WHERE cluster_id = $1 AND listing_id != ALL($2::bigint[])`,
      [cluster.id, currentListingIds],
    );

    for (const member of uniqueMembers) {
      await queryWithClient(
        client,
        `INSERT INTO listing_cluster_members (cluster_id, listing_id, source_id, list_price_eur_cents)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cluster_id, listing_id) DO UPDATE SET
           list_price_eur_cents = EXCLUDED.list_price_eur_cents`,
        [cluster.id, member.listingId, member.sourceId, member.listPriceEurCents],
      );
    }

    return cluster;
  });
}

export async function findClusterByListingId(
  listingId: number,
): Promise<ClusterWithMembers | null> {
  const clusterRows = await query<ClusterDbRow>(
    `SELECT lc.*
     FROM listing_clusters lc
     JOIN listing_cluster_members lcm ON lcm.cluster_id = lc.id
     WHERE lcm.listing_id = $1`,
    [listingId],
  );

  if (clusterRows.length === 0) return null;

  const cluster = toClusterRow(clusterRows[0]!);

  const memberRows = await query<{
    listing_id: string;
    source_id: string;
    source_code: string;
    source_name: string;
    title: string;
    list_price_eur_cents: string | null;
    price_per_sqm_eur: string | null;
    current_score: string | null;
    canonical_url: string;
    first_seen_at: Date;
  }>(
    `WITH ranked_members AS (
       SELECT
         l.id AS listing_id,
         l.source_id AS source_id,
         s.code AS source_code,
         s.name AS source_name,
         l.title,
         l.list_price_eur_cents,
         l.price_per_sqm_eur,
         l.current_score,
         l.canonical_url,
         l.first_seen_at,
         ROW_NUMBER() OVER (
           PARTITION BY l.source_id
           ORDER BY l.current_score DESC NULLS LAST, l.first_seen_at DESC, l.id DESC
         ) AS source_rank
       FROM listing_cluster_members lcm
       JOIN listings l ON l.id = lcm.listing_id
       JOIN sources s ON s.id = l.source_id
       WHERE lcm.cluster_id = $1
     )
     SELECT
       listing_id,
       source_id,
       source_code,
       source_name,
       title,
       list_price_eur_cents,
       price_per_sqm_eur,
       current_score,
       canonical_url,
       first_seen_at
     FROM ranked_members
     WHERE source_rank = 1
     ORDER BY current_score DESC NULLS LAST, first_seen_at DESC, listing_id DESC`,
    [cluster.id],
  );

  return {
    ...cluster,
    members: memberRows.map((r) => ({
      listingId: Number(r.listing_id),
      sourceCode: r.source_code,
      sourceName: r.source_name,
      title: r.title,
      listPriceEurCents: r.list_price_eur_cents != null ? Number(r.list_price_eur_cents) : null,
      pricePerSqmEur: r.price_per_sqm_eur != null ? Number(r.price_per_sqm_eur) : null,
      currentScore: r.current_score != null ? Number(r.current_score) : null,
      canonicalUrl: r.canonical_url,
      firstSeenAt: r.first_seen_at,
    })),
  };
}
