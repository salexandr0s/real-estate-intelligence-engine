# ImmoRadar

> **Important:** This is a project for educational purposes only. The purpose was to learn how to build Swift apps in combination with backends. Usage of this may go against the terms and conditions of certain apps.

ImmoRadar is a desktop-first real-estate intelligence system built around a native **macOS SwiftUI app** and a typed **TypeScript backend**.

The goal of the project is to explore how to build a serious native Mac client that works with a backend stack for scraping, ingestion, normalization, scoring, alerts, and search.

## What this repository contains

- a native **macOS app** in SwiftUI
- a **Fastify API**
- a **scraper worker** for source-specific raw capture
- a **processing worker** for normalization, scoring, and alerts
- shared domain packages for contracts, DB access, filtering, scoring, and more
- local infrastructure for **PostgreSQL**, **Redis**, and **S3-compatible object storage**

This is a self-hosted, learning-oriented system. It is **not** an official integration, not a hosted SaaS product, and not a guarantee that any scraping or automation use is allowed.

## High-level architecture

### macOS client

Path: `apps/macos`

The macOS app is the operator-facing client.

It is responsible for:

- native SwiftUI UI
- authentication and token storage
- interacting with the API
- local runtime orchestration and desktop packaging

It is **not** the ingestion engine.

### API

Path: `apps/api`

The API provides:

- typed request/response contracts
- auth and validation
- listing, alert, filter, analytics, and source-health endpoints
- the backend surface consumed by the macOS app

### Scraper worker

Path: `apps/worker-scraper`

The scraper worker is responsible for:

- browser automation with Playwright / Patchright
- source-isolated extraction logic
- retries, pacing, and raw snapshot capture

It writes raw source-shaped data, not canonical listings.

### Processing worker

Path: `apps/worker-processing`

The processing worker handles:

- normalization into canonical forms
- scoring
- reverse filter matching
- alert generation and delivery
- related processing flows such as document and outreach work

### Shared packages

Path: `packages/*`

Important packages include:

- `contracts` — shared types and domain contracts
- `config` — environment/config loading
- `db` — database access, migrations, seeds
- `scraper-core` — shared scraping runtime behavior
- `normalization` — canonical mapping layer
- `scoring` — scoring formulas and explanations
- `filtering` — filter semantics and matching
- `alerts`, `analysis`, `documents`, `outreach`, `observability`
- `source-*` — source-specific adapters, each kept isolated

## Design and engineering principles

This repo follows a few strict rules:

- scrapers produce **raw source-shaped DTOs only**
- normalization owns canonical mapping
- raw data is preserved for replay and auditing
- scoring must be explainable and versioned
- filters must behave consistently across UI, API, and background processing
- critical data should not silently fall back to fake defaults
- the macOS app stays a client, not the backend brain

For the full project rules, see:

- `agents.md`
- `.impeccable.md`

## Tech stack

- **Swift 6 / SwiftUI** for the macOS app
- **TypeScript** in strict mode for backend services
- **Fastify** for the API
- **BullMQ + Redis** for background job orchestration
- **PostgreSQL** as the system of record
- **Playwright / Patchright** for browser automation
- **XcodeGen** for macOS project generation
- **Docker Compose** for local infrastructure

## Requirements

Minimum useful local setup:

- macOS
- **Node.js 20+**
- **npm 10+**
- **Xcode**
- **XcodeGen**
- **Docker** (recommended)

If you do not use Docker locally, you will need your own working instances of:

- PostgreSQL
- Redis
- S3-compatible object storage

## Quick start

### 1. Configure the environment

```bash
cp example.env .env
bash scripts/dev-setup.sh
```

What `scripts/dev-setup.sh` does:

- starts local infra if Docker is available
- creates `.env` from `example.env` if missing
- installs npm dependencies
- builds the repo
- attempts migrations and seed setup

### 2. Start local infrastructure manually if needed

```bash
docker compose -f infrastructure/compose/docker-compose.local.yml up -d
```

This starts:

- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- MinIO on `localhost:9000`
- MinIO console on `localhost:9001`

### 3. Run migrations and seed data

```bash
npm run db:migrate
npm run db:seed
```

### 4. Start backend services

Run each of these in its own terminal when needed:

```bash
npm -w @immoradar/api run dev
npm -w @immoradar/worker-scraper run dev
npm -w @immoradar/worker-processing run dev
```

Default API base URL:

```text
http://localhost:8080
```

### 5. Open the macOS app

Generate the Xcode project if needed:

```bash
cd apps/macos
xcodegen generate
open ImmoRadar.xcodeproj
```

Then build and run from Xcode.

## Common commands

### Quality gates

```bash
npm run verify
npm run build
npm run test:integration
```

### Database

```bash
npm run db:migrate
npm run db:seed
```

### Pipeline / maintenance

```bash
npm run scrape
npm run rescore
npm run replay:normalize
npm run reparse
npm run backfill
npm run canary
npm run report:quality
npm run baselines
```

### Type generation

```bash
npm run generate:types
```

### macOS packaging

Build a macOS DMG:

```bash
npm run macos:dmg
```

Output:

```text
.build/macos-release/ImmoRadar-macOS.dmg
```

## Repository layout

```text
apps/
  api/                 Fastify API
  macos/               SwiftUI macOS app
  worker-processing/   normalization, scoring, alerts, outreach, documents
  worker-scraper/      browser automation and raw capture

packages/
  alerts/
  analysis/
  config/
  contracts/
  copilot/
  db/
  documents/
  filtering/
  geocoding/
  ingestion/
  legal-rent/
  normalization/
  observability/
  outreach/
  scoring/
  scraper-core/
  source-*/

infrastructure/
  compose/             local/prod Docker Compose files
  dashboards/          Grafana dashboards
  monitoring/          Prometheus config
  backup/              backup helpers and launchd plist

docs/
  architecture.md
  api.md
  infra.md
  normalization.md
  scrapers.md
  scoring_engine.md
  filtering_engine.md
  runbooks/
```

## Useful docs

Start here if you want deeper context:

- `docs/architecture.md`
- `docs/api.md`
- `docs/infra.md`
- `docs/normalization.md`
- `docs/scrapers.md`
- `docs/scoring_engine.md`
- `docs/filtering_engine.md`
- `docs/runbooks/`

## Safety and legal note

Be careful with how you use this code.

- scraping and automation may be restricted by the terms of some services
- you are responsible for checking the rules that apply to your usage
- do not expose secrets, cookies, tokens, or raw artifacts
- do not treat this repository as legal advice

## Status

This is an actively evolving codebase for learning and building experience around:

- native SwiftUI desktop apps
- backend/API design
- queue-based ingestion systems
- data normalization and scoring pipelines
- macOS runtime bundling and release packaging
