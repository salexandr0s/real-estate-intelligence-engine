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
export * as proximity from './queries/proximity.js';
export * as listingPois from './queries/listing-pois.js';
export * as dashboard from './queries/dashboard.js';
export * as deadLetter from './queries/dead-letter.js';
export * as canaryResults from './queries/canary-results.js';
export * as deviceTokens from './queries/device-tokens.js';
export * as appUsers from './queries/app-users.js';
export * as comparables from './queries/comparables.js';
export * as buildingFacts from './queries/building-facts.js';
export * as legalRent from './queries/legal-rent.js';
export * as documents from './queries/documents.js';
export * as mailboxes from './queries/mailboxes.js';
export * as outreach from './queries/outreach.js';

// ── LISTEN/NOTIFY ──────────────────────────────────────────────────────────
export { subscribeToAlerts, closeNotifyClient } from './notify.js';
export type { AlertNotification, AlertListener } from './notify.js';

// ── Re-export query-specific types ──────────────────────────────────────────
export type { SourceCreateInput } from './queries/sources.js';
export type { ListingSearchFilter } from './queries/listings.js';
export type { AppendVersionInput, ListingVersionRow } from './queries/listing-versions.js';
export type { UpsertBaselineInput, MarketBaselineRow } from './queries/market-baselines.js';
export type { UpsertPoiInput, PoiRow, PoiNearbyRow } from './queries/pois.js';
export type { ListingPoiRow } from './queries/listing-pois.js';
export type { UpsertDevelopmentInput, WienDevelopmentRow } from './queries/wien-developments.js';
export type { DeviceTokenRow } from './queries/device-tokens.js';
export type { AppUserRow } from './queries/app-users.js';
export type { CanaryResultRow } from './queries/canary-results.js';
export type { ClusterMemberInput } from './queries/clusters.js';
export type { ComparableResult } from './queries/comparables.js';
export type { BuildingFactRow, UpsertBuildingFactInput } from './queries/building-facts.js';
export type { LegalRentAssessmentRow, CreateLegalRentInput } from './queries/legal-rent.js';
export type { DocumentRow, FactSpanRow, UpsertDocumentInput } from './queries/documents.js';
