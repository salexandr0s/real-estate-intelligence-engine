# Source Onboarding Checklist

Template checklist for adding any new real estate source to the platform.
Copy this checklist into a new issue or document when starting source onboarding.

## Pre-work

- [ ] Legal/compliance review completed for the source
- [ ] robots.txt and terms of service reviewed
- [ ] Crawl risk assessed and documented in `docs/phase0/risk-feasibility.md`

## Implementation

1. [ ] Create source package from template (`packages/source-template/`)
   ```bash
   cp -r packages/source-template packages/source-<code>
   # Update package.json name to @rei/source-<code>
   ```

2. [ ] Implement `SourceAdapter` interface (discovery + detail + availability)
   - `discovery.ts` — Extract listing summaries from search/listing pages
   - `detail.ts` — Extract full listing data from detail pages
   - `availability.ts` — Detect sold/removed/unavailable states

3. [ ] Save 3 fixture files (discovery, detail, sold/unavailable)
   - `fixtures/discovery.html` — Representative search results page
   - `fixtures/detail.html` — Representative listing detail page
   - `fixtures/sold.html` — Representative sold/unavailable page

4. [ ] Write parser tests against fixtures
   - Test discovery page extraction (listing count, basic fields)
   - Test detail page extraction (all mapped fields)
   - Test availability detection (sold, removed, active states)

5. [ ] Add source to seed data with appropriate rate limit and crawl config
   - Insert row in `sources` table via seed script
   - Set `rate_limit_rpm`, `concurrency_limit`, `crawl_interval_minutes`

6. [ ] Add normalizer mapper in `packages/normalization/src/sources/`
   - Map source-specific DTO fields to canonical listing schema
   - Handle source-specific quirks (price formats, area units, etc.)

7. [ ] Register in adapter registry (`apps/worker-scraper/src/adapter-registry.ts`)

8. [ ] Register in pipeline factory normalizer map

9. [ ] Run canary crawl
   ```bash
   npm run canary -- --source <code>
   ```

10. [ ] Compare field coverage with willhaben
    - Run data quality report: `npm run report:quality -- --source <code>`
    - Document any fields the new source provides that willhaben does not
    - Document any fields missing compared to willhaben

11. [ ] Tune anti-bot config (rate, jitter, concurrency)
    - Start conservative (5 RPM, 3-10s jitter, concurrency 1)
    - Monitor for blocks during canary crawl
    - Adjust based on observed behavior

12. [ ] Write source runbook
    - Copy template from `docs/templates/source-runbook-template.md`
    - Document known anti-bot patterns
    - Document recovery procedures

13. [ ] Update `docs/phase0/source-inventory.md`

14. [ ] Set `legal_status = 'approved'` after compliance review

## Verification

- [ ] All parser tests pass: `npm run test:unit -- --filter source-<code>`
- [ ] Canary crawl completes without errors
- [ ] Normalized listings appear in `listings` table with correct field mappings
- [ ] Scoring works correctly for new source listings
- [ ] Filters match new source listings as expected
- [ ] No cross-layer leakage from source-specific logic
