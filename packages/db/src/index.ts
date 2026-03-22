// ── Database client ──────────────────────────────────────────────────────────
export { getPool, query, execute, transaction, queryWithClient, closePool } from './client.js';

// ── Migration runner ────────────────────────────────────────────────────────
export { runMigrations } from './migrate.js';

// ── Query modules ───────────────────────────────────────────────────────────
export * as sources from './queries/sources.js';
export * as scrapeRuns from './queries/scrape-runs.js';
export * as rawListings from './queries/raw-listings.js';
export * as listings from './queries/listings.js';
export * as listingVersions from './queries/listing-versions.js';
export * as userFilters from './queries/user-filters.js';
export * as alerts from './queries/alerts.js';
export * as listingScores from './queries/listing-scores.js';
export * as marketBaselines from './queries/market-baselines.js';
export * as pois from './queries/pois.js';
export * as wienDevelopments from './queries/wien-developments.js';
export * as savedListings from './queries/saved-listings.js';
export * as clusters from './queries/clusters.js';
export * as feedback from './queries/feedback.js';

// ── Re-export query-specific types ──────────────────────────────────────────
export type { SourceCreateInput } from './queries/sources.js';
export type { ListingSearchFilter } from './queries/listings.js';
export type { AppendVersionInput, ListingVersionRow } from './queries/listing-versions.js';
export type { UpsertBaselineInput, MarketBaselineRow } from './queries/market-baselines.js';
export type { UpsertPoiInput, PoiRow, PoiNearbyRow } from './queries/pois.js';
export type { UpsertDevelopmentInput, WienDevelopmentRow } from './queries/wien-developments.js';
