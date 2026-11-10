# Developer projects and from prices

IS24 developer projects describe several units. Their lowest unit price ("ab") is not an asking price for one property. They remain visible in listing search and watchlists, labelled **Projekt**, with an **ab EUR …** price when supplied. No investment score or investment-match alert is generated for a project. Price, area, room and score filters continue to use the single-property fields; the from price never substitutes for an asking price.

## Ownership and shape

| Layer         | Change                                                                                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IS24 source   | Parser v4 emits `isProjectRaw` and `priceFromRaw`. Only the source's Expose record establishes a project. Unavailable/challenge handling and raw preservation stay in the capture layer.                                                                                                 |
| Normalization | Version 4 maps `isProject` and integer `priceFromEurCents`, records provenance and warnings, and keeps asking price, area and rooms empty for projects. The IS24 mapper alone understands parser v3's `attributesRaw.priceFromRaw` plus `estateTypeRaw` evidence.                        |
| History       | The content fingerprint includes a true project flag and any from price. Absent fields are omitted so existing single-property fingerprints remain stable. New snapshots carry both fields, including lifecycle-only snapshots. Historical rows are never rewritten.                     |
| Database      | Migration 031 adds `is_project BOOLEAN NOT NULL DEFAULT FALSE` and nullable positive `price_from_eur_cents BIGINT`. It backfills current IS24 raw observations and clears current project scores, preserving score history. Upserts clear project scores; score updates reject projects. |
| Scoring       | Score version 4 records the eligibility policy. Ingestion and rescore skip projects before baseline lookup, scoring and alert matching. Single-property weights and explanations are unchanged.                                                                                          |
| API           | Search, detail, filter previews, saved listings and CSV expose the separate fields. History exposes new snapshot metadata. A project's old score explanation returns 404.                                                                                                                |
| macOS         | Optional additive fields preserve older cached data. Shared formatting retains the `ab` prefix and fractional cents. Table, detail, map callout, filter preview and watchlist use the same price presentation.                                                                           |

## Read/write and index impact

There are no new interactive predicates or sort modes. Search still reads the current-state table using the existing status, asking-price and score index paths. Two scalar columns are added to list reads and upserts; raw payloads remain outside those reads. No extra index is needed for presentation-only fields. Migration backfill visits current IS24 listings via the source key and raw primary key. It takes an ALTER TABLE lock and updates affected rows in the migration transaction; schedule deployment while ingestion is stopped.

## Replay and rollback

Migration 031 makes existing projects useful immediately. A normalization replay then appends one `backfill` version per changed current listing, without alerts. Use a backup or isolated database first and inspect the dry run:

```bash
npm run build
DATABASE_URL='<target database URL>' npm run replay:normalize -- --source immoscout24 --current-only --limit 100000 --dry-run
DATABASE_URL='<target database URL>' npm run replay:normalize -- --source immoscout24 --current-only --limit 100000
```

`--current-only` joins each listing to its current raw observation, so older snapshots cannot replace newer source state. Repeating the same replay writes no new versions. Missing or malformed required fields are reported and preserved. Existing source captures without project evidence remain unmarked; a later parser v4 capture can establish the flag even without a from price. Non-numeric, non-positive or unsafe from prices stay NULL with normalization warnings.

The migration has its own rerun guard and is tracked by checksum. Rollback requires deploying code that stops writing and reading the new columns before a compensating migration drops them, following [migration rules](migration-rules.md). Do not restore the old project scores; they did not describe individual units.

## Production checks and verification

Watch structured `Project scoring skipped` / `Project rescore skipped` logs (`listingId`, reason), normalization `priceFrom` warnings, replay error counts, and migration failures. Inspect `SELECT count(*) FROM listings WHERE is_project AND current_score IS NOT NULL` (expected zero). A missing from price may be legitimate; inspect its raw observation and warnings before inferring a failure. Capture failures remain visible through the source's existing diagnostics and health reporting.

Regression coverage includes project/flat parser fixtures and unavailable pages, legacy and typed mapping, missing/malformed money, provenance and district resolution, stable fingerprints, ingestion/replay idempotency, rescore exclusion, lifecycle snapshots, migration reruns, API/watchlist/CSV separation, score-write protection, Swift DTO decoding, cache compatibility and project view-model behavior. The normal scoring regression, explanation and baseline fallback suites also run.

The 2026-11-10 rehearsal used an isolated copy of the stopped app's database (13,361 listings). Migration 031 recovered all seven project from prices (EUR 112,000–990,000) and left zero projects scored. Counts and full-row digests of 16,594 raw records, 15,793 listing versions and 15,658 score records were identical before and after migration. The source database was not opened or changed. Current-observation replay reported 33 older snapshots missing required fields; these remain preserved rather than receiving invented values. Repeating the replay left all 44 normalizable current observations unchanged and appended zero versions.

Validation: `npm run verify` (lint, strict typecheck and 1,076 unit tests), 143 integration tests including schema drift/migration checks, and 81 Swift tests passed. `schema.sql` was regenerated from the migrations. No live crawl or installed-app update is needed for these fixture and copied-data checks.
