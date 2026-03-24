# Secrets Strategy

## Development
- Secrets stored in `.env` file (git-ignored)
- Template in `example.env` with placeholder values
- Loaded via `@immoradar/config` `envStr()` / `envBool()` / `envInt()`

## Mac Mini Production
- Secrets stored in macOS Keychain via `claudecodex-vault.sh`
- Loaded into environment via `.zprofile` before Docker Compose starts
- Per-service env vars passed through `docker-compose.yml` `environment:` block

## Rotation
- `API_BEARER_TOKEN`: Rotate by updating Keychain + restarting API service
- `S3_ACCESS_KEY` / `S3_SECRET_KEY`: Rotate via MinIO admin + update Keychain
- `DATABASE_URL`: Rotate by updating Postgres password + Keychain + restart all services

## Secrets Inventory
| Secret | Where Used | Rotation Frequency |
|--------|-----------|-------------------|
| `DATABASE_URL` | API, workers, scripts | On compromise |
| `REDIS_URL` | Workers, scheduler | On compromise |
| `API_BEARER_TOKEN` | API auth, macOS app | Quarterly |
| `S3_ACCESS_KEY` | Workers (artifact storage) | Annually |
| `S3_SECRET_KEY` | Workers (artifact storage) | Annually |

## Rules
- Never commit `.env` files
- Never log secrets (use `redactUrl()` from `@immoradar/observability`)
- Never pass secrets as CLI arguments (visible in `ps`)
- Store secrets in Keychain, not plain text files
