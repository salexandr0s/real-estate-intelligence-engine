# Runbook: Backup Restore

How to restore PostgreSQL from a local backup.

## Prerequisites

- Backup files exist in `~/.rei-backups/postgres/` (created by `infrastructure/backup/backup-postgres.sh`)
- `pg_dump` and `psql` are available on PATH
- `DATABASE_URL` environment variable is set
- Sufficient disk space for the uncompressed dump

## Steps

1. **Stop all services** to prevent writes during restore:
   ```bash
   # Stop worker processes
   pkill -f "worker-scraper" || true
   pkill -f "worker-processing" || true

   # Stop API server
   pkill -f "apps/api" || true
   ```

2. **Identify the backup to restore**:
   ```bash
   ls -lht ~/.rei-backups/postgres/rei_*.sql.gz | head -5
   ```
   The most recent file is the default choice. For point-in-time recovery, select the appropriate timestamp.

3. **Restore the backup**:
   ```bash
   # Drop and recreate the database (or restore to a fresh database)
   gunzip -c ~/.rei-backups/postgres/rei_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
   ```

4. **Verify table counts**:
   ```sql
   SELECT 'listings' AS tbl, COUNT(*) FROM listings
   UNION ALL SELECT 'raw_listings', COUNT(*) FROM raw_listings
   UNION ALL SELECT 'listing_versions', COUNT(*) FROM listing_versions
   UNION ALL SELECT 'user_filters', COUNT(*) FROM user_filters
   UNION ALL SELECT 'alerts', COUNT(*) FROM alerts
   UNION ALL SELECT 'sources', COUNT(*) FROM sources;
   ```

5. **Restart services**:
   ```bash
   npx tsx apps/api/src/main.ts &
   npx tsx apps/worker-scraper/src/main.ts &
   npx tsx apps/worker-processing/src/main.ts &
   ```

## Automated Verification

Use the existing verification script to validate a backup before restoring:

```bash
infrastructure/backup/verify-backup.sh
```

This creates a temporary database, restores the backup, checks table counts, and cleans up.

## Verification

1. `SELECT count(*) FROM listings` returns expected row count
2. Check recent data exists: `SELECT MAX(last_seen_at) FROM listings`
3. API health endpoint responds: `curl http://localhost:3000/health`
4. Worker processes are running and processing jobs
