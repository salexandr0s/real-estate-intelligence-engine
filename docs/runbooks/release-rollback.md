# Runbook: Release Rollback

How to roll back a bad release to restore service stability.

## When to Roll Back

- Tests pass but production behavior is broken
- A migration caused data issues
- Performance regression detected after deploy
- Critical bug discovered in the new release

## Steps

### Code Rollback

1. **Revert the problematic commit(s)**:
   ```bash
   # Revert a single commit
   git revert HEAD

   # Or check out a known-good commit
   git checkout <good-commit-sha> -- .
   git commit -m "chore: rollback to <good-commit-sha>"
   ```

2. **Rebuild and redeploy**:
   ```bash
   npm install
   npm run build
   ```

3. **Restart services**:
   ```bash
   pkill -f "apps/api" || true
   pkill -f "worker-scraper" || true
   pkill -f "worker-processing" || true

   npx tsx apps/api/src/main.ts &
   npx tsx apps/worker-scraper/src/main.ts &
   npx tsx apps/worker-processing/src/main.ts &
   ```

### Docker Rollback (if applicable)

```bash
docker compose down
# Update docker-compose.yml or .env to reference the previous image tag
docker compose up -d
```

### Migration Rollback

If the release included a destructive migration, apply a compensating migration per `docs/migration-rules.md`:

1. Write a new forward migration that reverses the changes (this project does not use down migrations)
2. Each original migration should contain a `-- Rollback:` comment documenting the compensating SQL
3. Apply the compensating migration: `npm run db:migrate`
4. Verify schema state matches the pre-release state

**Warning**: If data was deleted or columns were dropped, restore from backup first (see `docs/runbooks/backup-restore.md`).

## Verification

1. Run the full test suite: `npm run verify`
2. Check API health: `curl http://localhost:8080/health`
3. Verify recent data is intact: `SELECT MAX(last_seen_at) FROM listings`
4. Confirm worker processes are healthy and processing jobs
5. Monitor metrics for 15 minutes to confirm stability
