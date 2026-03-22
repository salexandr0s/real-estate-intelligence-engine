# Runbook: Queue Stuck

When BullMQ processing queues stop making progress.

## Symptoms

- Queue depth is growing with no jobs completing
- No new `scrape_runs` completing in the database
- Worker processes are silent in logs (no new log entries)
- Alert lag metrics (`rei_alert_lag_seconds`) increasing

## Detection

```bash
# Check Redis queue depth (BullMQ key format: bull:{prefix}:{queue}:wait)
redis-cli LLEN bull:rei:scrape-detail:wait
redis-cli LLEN bull:rei:scrape-discovery:wait
redis-cli LLEN bull:rei:processing-ingest:wait
redis-cli LLEN bull:rei:processing-baseline:wait

# Check for active/waiting/delayed jobs
redis-cli SCARD bull:rei:scrape-detail:active
redis-cli ZCARD bull:rei:scrape-detail:delayed
redis-cli ZCARD bull:rei:scrape-detail:waiting

# Check worker process status
ps aux | grep worker
```

```sql
-- Check recent scrape run completion times
SELECT id, started_at, finished_at, status
  FROM scrape_runs
  ORDER BY started_at DESC
  LIMIT 10;
```

## Resolution

1. **Check worker process status**: Verify worker processes are running. Restart if crashed:
   ```bash
   # Restart scraper worker
   npx tsx apps/worker-scraper/src/main.ts &

   # Restart processing worker
   npx tsx apps/worker-processing/src/main.ts &
   ```

2. **Check Redis connectivity**: Verify Redis is reachable:
   ```bash
   redis-cli PING
   ```

3. **Check for dead-letter jobs**: Inspect failed jobs that exhausted retries:
   ```bash
   redis-cli LRANGE bull:rei:scrape-detail:failed 0 5
   ```

4. **Clear stuck jobs if needed**: If jobs are stuck in active state with no worker processing them:
   ```bash
   # Move stale active jobs back to waiting (use with caution)
   redis-cli DEL bull:rei:scrape-detail:active
   ```

5. **Check for resource exhaustion**: Verify the system has sufficient memory and file descriptors for Playwright browser instances.

## Verification

1. Queue depth is decreasing after worker restart
2. New scrape runs are completing in the database
3. Worker logs show active job processing
4. `rei_alert_lag_seconds` metric is returning to normal levels
