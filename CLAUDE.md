# Real Estate Intelligence Engine

## Project Overview
Always-on Austrian real estate intelligence platform. Backend-first TypeScript services with native macOS SwiftUI client.

## Stack
- **Backend**: TypeScript (strict), Fastify, PostgreSQL, Redis + BullMQ
- **Frontend**: Native macOS SwiftUI app
- **Scraping**: Playwright with source isolation
- **Monorepo**: npm workspaces + Turbo

## Architecture Boundaries
- Scraping → raw_listings only (never writes to canonical tables)
- Normalization → turns raw DTOs into canonical listings
- Scoring → reads canonical listings + baselines, writes scores
- Filtering → compiles criteria to SQL, reverse-matches listings to filters
- Alerting → matches listings to filters, creates deduplicated alert records
- API → serves read models to the Swift app
- Swift app → pure client, no backend logic

## Key Commands
```bash
npm install                    # Install all workspace dependencies
npm run build                  # Build all packages
npm run typecheck              # Type-check all packages
npm run test:unit              # Run unit tests
npm run db:migrate             # Run database migrations
npm run db:seed                # Seed initial data
npx tsx apps/api/src/main.ts   # Start API server
```

## Verification
```bash
npm run verify    # lint + typecheck + test
```

## Non-Negotiable Rules
1. Source isolation: each site scraper is its own package
2. Raw data preservation: never skip raw_listings
3. Idempotent writes: upsert on deterministic keys
4. Strong typing: strict mode, no `any`
5. Separation of concerns: scraping ≠ normalization ≠ scoring ≠ filtering

## Design Context

**User:** Professional Austrian real estate investor. Daily use. Expects institutional-grade tools, zero friction.
**Personality:** Precise · Calm · Confident. Quiet authority — let the data speak.
**Emotion:** "I have an edge." Quiet confidence, everything under control.

**Aesthetic:** Native macOS (Apple Finance/Stocks + Fantastical/Things 3 influence). System-adaptive light/dark.

**Anti-references:** Cluttered dashboards, generic web apps, consumer real estate portals, enterprise SaaS.

**Design Principles:**
1. Data density through clarity, not compression — smart arrangement, never shrinking
2. Every color communicates — no decorative color, all semantic
3. Native or nothing — SwiftUI system components, San Francisco type, macOS patterns
4. Typography is the design — hierarchy from weight/size/spacing, not borders or backgrounds
5. Quiet until relevant — functional animation only, respect Reduce Motion

**Tokens:** All values in `apps/macos/ImmoRadar/DesignSystem/Theme.swift`. Full spec in `.impeccable.md`.
