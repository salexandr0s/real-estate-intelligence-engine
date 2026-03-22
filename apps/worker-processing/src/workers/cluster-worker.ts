/**
 * BullMQ worker: rebuilds cross-source listing clusters.
 * Runs daily at 03:00 via scheduler.
 */

import { createHash } from 'node:crypto';
import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@rei/observability';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@rei/scraper-core';
import type { ClusterJobData } from '@rei/scraper-core';
import { query, clusters } from '@rei/db';

const log = createLogger('worker:cluster');

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

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildGeoProximityClusters(listings: GeoListingRow[]): GeoListingRow[][] {
  const parent = listings.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
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
      if (roomsI == null || roomsJ == null || roomsI !== roomsJ) continue;

      const priceJ = lj.list_price_eur_cents != null ? Number(lj.list_price_eur_cents) : null;
      if (priceI == null || priceJ == null) continue;
      const ratio = priceI > priceJ ? priceI / priceJ : priceJ / priceI;
      if (ratio > 1.1) continue;

      const dist = haversineMeters(latI, lonI, Number(lj.latitude), Number(lj.longitude));
      if (dist > 50) continue;

      union(i, j);
    }
  }

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

  return Array.from(groups.values()).filter((g) => g.length >= 2);
}

export function createClusterWorker(): Worker<ClusterJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const worker = new Worker<ClusterJobData>(
    QUEUE_NAMES.CLUSTER,
    async (job: Job<ClusterJobData>) => {
      log.info('Cluster rebuild started', { triggeredBy: job.data.triggeredBy });

      // Pass 1: Fingerprint-based clustering
      const groups = await query<ClusterGroupRow>(
        `SELECT
           cross_source_fingerprint AS fingerprint,
           array_agg(id::text ORDER BY current_score DESC NULLS LAST) AS listing_ids,
           array_agg(source_id::text ORDER BY current_score DESC NULLS LAST) AS source_ids,
           array_agg(list_price_eur_cents::text ORDER BY current_score DESC NULLS LAST) AS prices,
           array_agg(current_score::text ORDER BY current_score DESC NULLS LAST) AS scores
         FROM listings
         WHERE cross_source_fingerprint IS NOT NULL AND listing_status = 'active'
         GROUP BY cross_source_fingerprint
         HAVING COUNT(DISTINCT source_id) >= 2`,
      );

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

      // Pass 2: Geo-proximity fallback
      const clusteredIds = await query<{ listing_id: string }>(
        `SELECT DISTINCT listing_id::text AS listing_id FROM listing_cluster_members`,
      );
      const clusteredIdSet = new Set(clusteredIds.map((r) => r.listing_id));

      const geoListings = await query<GeoListingRow>(
        `SELECT id::text, source_id::text, latitude::text, longitude::text,
                rooms::text, list_price_eur_cents::text
         FROM listings
         WHERE listing_status = 'active' AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      );

      const unclustered = geoListings.filter((l) => !clusteredIdSet.has(l.id));
      const geoGrouped = buildGeoProximityClusters(unclustered);

      let geoClusters = 0;
      for (const geoGroup of geoGrouped) {
        // Stable fingerprint from centroid + rooms + price bucket (not member IDs)
        const avgLat = geoGroup.reduce((s, l) => s + Number(l.latitude), 0) / geoGroup.length;
        const avgLon = geoGroup.reduce((s, l) => s + Number(l.longitude), 0) / geoGroup.length;
        const rooms = geoGroup[0]!.rooms ?? '0';
        const avgPrice =
          geoGroup.reduce((s, l) => s + Number(l.list_price_eur_cents ?? 0), 0) / geoGroup.length;
        const priceBucket = Math.round(avgPrice / 100_00 / 10) * 10;
        const fpInput = `${avgLat.toFixed(5)}|${avgLon.toFixed(5)}|${rooms}|${priceBucket}`;
        const fp = `geo:${createHash('sha256').update(fpInput).digest('hex')}`;
        const members = geoGroup.map((l) => ({
          listingId: Number(l.id),
          sourceId: Number(l.source_id),
          listPriceEurCents: l.list_price_eur_cents != null ? Number(l.list_price_eur_cents) : null,
        }));
        await clusters.upsertCluster(fp, members);
        geoClusters++;
        totalMembers += members.length;
      }

      log.info('Cluster rebuild complete', {
        fingerprintClusters: created,
        geoClusters,
        totalListingsClustered: totalMembers,
      });
    },
    { connection, prefix, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error('Cluster job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}
