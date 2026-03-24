#!/usr/bin/env npx tsx
/**
 * Cross-source cluster build script.
 *
 * Groups active listings by cross_source_fingerprint and creates
 * listing_clusters + listing_cluster_members records for listings
 * that appear on 2+ sources.
 *
 * Usage:
 *   npx tsx scripts/build-clusters.ts
 *   npx tsx scripts/build-clusters.ts --dry-run
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@immoradar/observability';
import { query, clusters, closePool } from '@immoradar/db';

const log = createLogger('clusters-cli');
const isDryRun = process.argv.includes('--dry-run');

interface ClusterGroupRow {
  fingerprint: string;
  listing_ids: string[];
  source_ids: string[];
  prices: (string | null)[];
  scores: (string | null)[];
}

interface GeoListingRow {
  id: string;
  source_id: string;
  latitude: string;
  longitude: string;
  rooms: string | null;
  list_price_eur_cents: string | null;
}

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Groups unclustered geo-listings by proximity (≤50m), same room count,
 * and price within ±10%. Uses a simple greedy union-find approach.
 */
function buildGeoProximityClusters(listings: GeoListingRow[]): GeoListingRow[][] {
  const MAX_DISTANCE_M = 50;
  const PRICE_TOLERANCE = 0.1; // ±10%

  // parent[i] → index of parent in union-find
  const parent = listings.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!; // path compression
      i = parent[i]!;
    }
    return i;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < listings.length; i++) {
    const li = listings[i]!;
    const latI = Number(li.latitude);
    const lonI = Number(li.longitude);
    const roomsI = li.rooms != null ? Number(li.rooms) : null;
    const priceI = li.list_price_eur_cents != null ? Number(li.list_price_eur_cents) : null;

    for (let j = i + 1; j < listings.length; j++) {
      const lj = listings[j]!;
      const roomsJ = lj.rooms != null ? Number(lj.rooms) : null;

      // Must have same room count (both non-null and equal)
      if (roomsI == null || roomsJ == null || roomsI !== roomsJ) continue;

      const priceJ = lj.list_price_eur_cents != null ? Number(lj.list_price_eur_cents) : null;

      // Must have price within ±10% (both non-null)
      if (priceI == null || priceJ == null) continue;
      const ratio = priceI > priceJ ? priceI / priceJ : priceJ / priceI;
      if (ratio > 1 + PRICE_TOLERANCE) continue;

      const latJ = Number(lj.latitude);
      const lonJ = Number(lj.longitude);
      const dist = haversineMeters(latI, lonI, latJ, lonJ);
      if (dist > MAX_DISTANCE_M) continue;

      union(i, j);
    }
  }

  // Collect groups
  const groups = new Map<number, GeoListingRow[]>();
  for (let i = 0; i < listings.length; i++) {
    const root = find(i);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(listings[i]!);
  }

  // Only return groups with 2+ members
  return Array.from(groups.values()).filter((g) => g.length >= 2);
}

async function buildClusters(): Promise<void> {
  log.info('Building cross-source clusters...', { isDryRun });

  const groups = await query<ClusterGroupRow>(
    `SELECT
       cross_source_fingerprint AS fingerprint,
       array_agg(id::text ORDER BY current_score DESC NULLS LAST) AS listing_ids,
       array_agg(source_id::text ORDER BY current_score DESC NULLS LAST) AS source_ids,
       array_agg(list_price_eur_cents::text ORDER BY current_score DESC NULLS LAST) AS prices,
       array_agg(current_score::text ORDER BY current_score DESC NULLS LAST) AS scores
     FROM listings
     WHERE cross_source_fingerprint IS NOT NULL
       AND listing_status = 'active'
     GROUP BY cross_source_fingerprint
     HAVING COUNT(DISTINCT source_id) >= 2`,
    [],
  );

  log.info(`Found ${groups.length} fingerprints with 2+ sources`);

  if (isDryRun) {
    for (const group of groups.slice(0, 10)) {
      const ids = group.listing_ids.map(Number);
      log.info(`  [dry-run] ${group.fingerprint.slice(0, 12)}... → ${ids.length} listings`, {
        listingIds: ids,
      });
    }
    log.info(`Dry run complete. Would create ${groups.length} clusters.`);
    return;
  }

  let created = 0;
  let totalMembers = 0;

  for (const group of groups) {
    const members = group.listing_ids.map((idStr, i) => ({
      listingId: Number(idStr),
      sourceId: Number(group.source_ids[i]),
      listPriceEurCents: group.prices[i] != null ? Number(group.prices[i]) : null,
    }));

    await clusters.upsertCluster(group.fingerprint, members);
    created++;
    totalMembers += members.length;
  }

  log.info('Fingerprint-based clustering complete', {
    clustersCreated: created,
    totalListingsClustered: totalMembers,
  });

  // ── Pass 2: Geo-proximity fallback ──────────────────────────────────────
  // For unclustered listings with coordinates, group by proximity (≤50m),
  // same room count, and price within ±10%.

  const clusteredIds = await query<{ listing_id: string }>(
    `SELECT DISTINCT listing_id::text AS listing_id FROM listing_cluster_members`,
    [],
  );
  const clusteredIdSet = new Set(clusteredIds.map((r) => r.listing_id));

  const geoListings = await query<GeoListingRow>(
    `SELECT
       id::text AS id,
       source_id::text AS source_id,
       latitude::text AS latitude,
       longitude::text AS longitude,
       rooms::text AS rooms,
       list_price_eur_cents::text AS list_price_eur_cents
     FROM listings
     WHERE listing_status = 'active'
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL`,
    [],
  );

  // Filter to only unclustered listings
  const unclustered = geoListings.filter((l) => !clusteredIdSet.has(l.id));
  log.info(`Geo-proximity pass: ${unclustered.length} unclustered listings with coordinates`);

  const geoGrouped = buildGeoProximityClusters(unclustered);

  let geoClustersCreated = 0;
  let geoMembersTotal = 0;

  for (const geoGroup of geoGrouped) {
    if (geoGroup.length < 2) continue;

    // Generate a stable fingerprint from centroid + rooms + price bucket (not member IDs)
    const avgLat = geoGroup.reduce((s, l) => s + Number(l.latitude), 0) / geoGroup.length;
    const avgLon = geoGroup.reduce((s, l) => s + Number(l.longitude), 0) / geoGroup.length;
    const rooms = geoGroup[0]!.rooms ?? '0';
    const avgPrice =
      geoGroup.reduce((s, l) => s + Number(l.list_price_eur_cents ?? 0), 0) / geoGroup.length;
    const priceBucket = Math.round(avgPrice / 100_00 / 10) * 10; // round to nearest 10 EUR
    const fpInput = `${avgLat.toFixed(5)}|${avgLon.toFixed(5)}|${rooms}|${priceBucket}`;
    const geoFingerprint = `geo:${createHash('sha256').update(fpInput).digest('hex')}`;

    const members = geoGroup.map((l) => ({
      listingId: Number(l.id),
      sourceId: Number(l.source_id),
      listPriceEurCents: l.list_price_eur_cents != null ? Number(l.list_price_eur_cents) : null,
    }));

    if (isDryRun) {
      log.info(
        `  [dry-run] geo-cluster ${geoFingerprint.slice(0, 16)}... → ${members.length} listings`,
      );
    } else {
      await clusters.upsertCluster(geoFingerprint, members);
    }

    geoClustersCreated++;
    geoMembersTotal += members.length;
  }

  log.info('Cluster build complete', {
    fingerprintClusters: created,
    geoClusters: geoClustersCreated,
    totalListingsClustered: totalMembers + geoMembersTotal,
  });
}

buildClusters()
  .catch((err: unknown) => {
    log.error('Cluster build failed', { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
