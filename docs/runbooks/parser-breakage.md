# Runbook: Parser Breakage

When a source changes its HTML or JSON structure, causing extraction failures.

## Symptoms

- `extraction_status = 'parse_failed'` spikes on new raw listings
- Empty or null payloads on pages that return HTTP 200
- Previously populated fields are now missing
- Parser test failures after fixture update

## Detection

```sql
-- Check parse failure rate
SELECT extraction_status, COUNT(*)
  FROM raw_listings
  WHERE source_id = (SELECT id FROM sources WHERE code = '<source_code>')
    AND created_at > NOW() - INTERVAL '1 day'
  GROUP BY 1;

-- Check which fields are affected
SELECT id, title_raw, price_raw, living_area_raw, rooms_raw, extraction_status
  FROM raw_listings
  WHERE source_id = (SELECT id FROM sources WHERE code = '<source_code>')
    AND extraction_status = 'parse_failed'
  ORDER BY created_at DESC
  LIMIT 5;
```

## Resolution

1. **Capture fresh HTML**:
   ```bash
   npx tsx scripts/capture-site-html.ts --source <source_code>
   ```
   Output lands in `/tmp/immoradar-captures/<source_code>/`.

2. **Compare with stored fixtures**: Diff old vs new HTML to identify structural changes (selector names, JSON paths, attribute renames).

3. **Update extraction logic**: Modify selectors/parsers in `packages/source-<source_code>/src/discovery.ts` and/or `detail.ts`.

4. **Update fixture files**: Replace fixtures in `packages/source-<source_code>/src/fixtures/` with the newly captured HTML.

5. **Update parser test expectations**: Adjust expected values in `packages/source-<source_code>/src/tests/parser.test.ts`.

6. **Bump parser version**: Increment `parserVersion` in the source adapter.

7. **Run parser tests**:
   ```bash
   npx vitest run --filter source-<source_code>
   ```

## Verification

1. All parser tests pass with the new fixtures
2. Run a canary crawl and confirm `extraction_status = 'captured'` on new raw listings
3. Confirm no null fields in critical columns (title, price, area)
4. Run `npm run report:quality` to verify data quality is restored
