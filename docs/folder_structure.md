
# folder_structure.md

## Recommended monorepo layout

```text
real-estate-intelligence-engine/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── repositories/
│   │   │   ├── auth/
│   │   │   ├── presenters/
│   │   │   └── main.ts
│   │   ├── openapi/
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── worker-scraper/
│   │   ├── src/
│   │   │   ├── jobs/
│   │   │   ├── browser/
│   │   │   ├── queues/
│   │   │   ├── runtime/
│   │   │   └── main.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── worker-processing/
│   │   ├── src/
│   │   │   ├── jobs/
│   │   │   ├── normalization/
│   │   │   ├── scoring/
│   │   │   ├── alerts/
│   │   │   └── main.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   └── macos/
│       ├── RealEstateIntel.xcodeproj
│       ├── RealEstateIntel/
│       │   ├── App/
│       │   ├── Features/
│       │   │   ├── Dashboard/
│       │   │   ├── Listings/
│       │   │   ├── Filters/
│       │   │   ├── Alerts/
│       │   │   ├── Sources/
│       │   │   ├── Analytics/
│       │   │   └── Settings/
│       │   ├── Networking/
│       │   ├── Storage/
│       │   ├── Models/
│       │   ├── DesignSystem/
│       │   └── Support/
│       └── Tests/
│
├── packages/
│   ├── config/
│   │   └── src/
│   │
│   ├── contracts/
│   │   ├── openapi/
│   │   ├── src/
│   │   └── package.json
│   │
│   ├── db/
│   │   ├── migrations/
│   │   ├── seeds/
│   │   ├── src/
│   │   │   ├── queries/
│   │   │   ├── types/
│   │   │   └── client.ts
│   │   └── package.json
│   │
│   ├── scraper-core/
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   ├── browser/
│   │   │   ├── queue/
│   │   │   ├── rate-limit/
│   │   │   ├── retries/
│   │   │   ├── capture/
│   │   │   ├── health/
│   │   │   └── types/
│   │   └── package.json
│   │
│   ├── normalization/
│   │   ├── src/
│   │   │   ├── canonical/
│   │   │   ├── sources/
│   │   │   ├── district/
│   │   │   ├── enrichments/
│   │   │   ├── fingerprint/
│   │   │   └── jobs/
│   │   └── package.json
│   │
│   ├── filtering/
│   │   ├── src/
│   │   │   ├── compiler/
│   │   │   ├── validators/
│   │   │   ├── sql/
│   │   │   └── types/
│   │   └── package.json
│   │
│   ├── scoring/
│   │   ├── src/
│   │   │   ├── baselines/
│   │   │   ├── keywords/
│   │   │   ├── formulas/
│   │   │   ├── explain/
│   │   │   └── jobs/
│   │   └── package.json
│   │
│   ├── alerts/
│   │   ├── src/
│   │   │   ├── matching/
│   │   │   ├── dedupe/
│   │   │   ├── delivery/
│   │   │   └── jobs/
│   │   └── package.json
│   │
│   ├── observability/
│   │   ├── src/
│   │   │   ├── logging/
│   │   │   ├── metrics/
│   │   │   └── tracing/
│   │   └── package.json
│   │
│   ├── source-template/
│   │   ├── src/
│   │   │   ├── adapter.ts
│   │   │   ├── discovery.ts
│   │   │   ├── detail.ts
│   │   │   ├── dto.ts
│   │   │   ├── selectors.ts
│   │   │   ├── cookies.ts
│   │   │   ├── fingerprints.ts
│   │   │   ├── health.ts
│   │   │   └── tests/
│   │   └── package.json
│   │
│   ├── source-willhaben/
│   │   └── src/...
│   │
│   └── source-immoscout24/
│       └── src/...
│
├── infrastructure/
│   ├── docker/
│   │   ├── api.Dockerfile
│   │   ├── worker-scraper.Dockerfile
│   │   └── worker-processing.Dockerfile
│   ├── compose/
│   │   ├── docker-compose.local.yml
│   │   └── docker-compose.prod.yml
│   ├── nginx/
│   ├── prometheus/
│   ├── grafana/
│   ├── loki/
│   ├── otel/
│   └── scripts/
│
├── docs/
│   ├── architecture.md
│   ├── buildplan.md
│   ├── scrapers.md
│   ├── normalization.md
│   ├── filtering_engine.md
│   ├── scoring_engine.md
│   ├── api.md
│   ├── infra.md
│   ├── agents.md
│   ├── checklist.md
│   └── folder_structure.md
│
├── .github/
│   └── workflows/
│
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

## Layout rationale

### `apps/`
Deployable units:

- API
- scraper worker
- processing worker
- native macOS app

### `packages/`
Reusable libraries and source-isolated modules.

### `infrastructure/`
Deployment manifests, images, and observability config.

### `docs/`
Living architecture and implementation documents.

---

## Recommended ownership rules

- source-specific code stays in `packages/source-*`
- shared scraping behavior stays in `packages/scraper-core`
- canonical field logic stays in `packages/normalization`
- score math stays in `packages/scoring`
- filter compilation stays in `packages/filtering`
- alert matching/delivery stays in `packages/alerts`
- HTTP concerns stay in `apps/api`
- Swift UI and local cache stay in `apps/macos`

This prevents source-specific logic from leaking across the system.
