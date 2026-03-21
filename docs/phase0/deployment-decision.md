# Deployment Mode Decision

## Decision: Mac mini daemon

Backend services run in Docker Compose on a local Mac mini. The SwiftUI macOS app runs natively on the same machine.

## Rationale

| Factor | Assessment |
|--------|------------|
| Setup complexity | Lowest — single machine, no remote infra |
| Cost | Zero hosting cost |
| Browser debugging | Direct access to Playwright browser contexts |
| Swift app co-location | API on localhost, zero-latency client calls |
| Uptime | Sufficient for personal/small-team use |
| Maintenance | Standard Docker Compose lifecycle |

## Infrastructure

Uses `infrastructure/compose/docker-compose.local.yml` with:
- PostgreSQL 16
- Redis 7 (BullMQ queue backend)
- MinIO (S3-compatible object storage for HTML/screenshots/HAR)
- API service (Fastify)
- Scraper worker (Playwright)
- Processing worker (normalization, scoring, alerts)

## Migration Triggers

Consider migrating to a remote VPS if any of:
- Source blocks become correlated to home IP address
- Uptime requirements exceed home network reliability
- Multi-user remote access is needed
- Geographic IP diversity is required for scraping

## Migration Path

The Docker Compose setup is portable. Migration to VPS requires:
1. Provision VPS with Docker
2. Copy `docker-compose.yml` and `.env`
3. Restore PostgreSQL backup
4. Update Swift app API base URL from `localhost` to VPS IP/domain
5. Configure firewall and TLS for remote API access
