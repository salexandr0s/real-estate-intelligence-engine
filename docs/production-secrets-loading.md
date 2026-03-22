# Production Secrets Loading (Mac Mini Deployment)

Step-by-step guide for setting up secrets on the Mac mini production environment.

## Overview

Secrets flow through three layers:

1. **macOS Keychain** (source of truth) -- stored via `claudecodex-vault.sh`
2. **Shell environment** (runtime) -- exported by `.zprofile` on login
3. **Docker Compose** (services) -- reads env vars from the host

## Step 1: Store secrets in macOS Keychain

Use `claudecodex-vault.sh` to store each secret:

```bash
~/.claude/claudecodex-vault.sh set DATABASE_URL "postgres://rei:PASSWORD@localhost:5432/rei_production"
~/.claude/claudecodex-vault.sh set REDIS_URL "redis://localhost:6379/0"
~/.claude/claudecodex-vault.sh set API_BEARER_TOKEN "GENERATE_A_SECURE_TOKEN_HERE"
~/.claude/claudecodex-vault.sh set S3_ACCESS_KEY "minioadmin"
~/.claude/claudecodex-vault.sh set S3_SECRET_KEY "GENERATE_A_SECURE_KEY_HERE"
```

## Step 2: Verify stored secrets

```bash
~/.claude/claudecodex-vault.sh list
```

This lists all keys stored in the `claudecodex.keychain-db`. Verify all five secrets appear.

## Step 3: Shell environment export

The `~/.zprofile` file exports Keychain secrets as environment variables on shell login. Verify the exports exist:

```bash
# These lines should be in ~/.zprofile (added by claudecodex-vault.sh export):
export DATABASE_URL="$(~/.claude/claudecodex-vault.sh get DATABASE_URL)"
export REDIS_URL="$(~/.claude/claudecodex-vault.sh get REDIS_URL)"
export API_BEARER_TOKEN="$(~/.claude/claudecodex-vault.sh get API_BEARER_TOKEN)"
export S3_ACCESS_KEY="$(~/.claude/claudecodex-vault.sh get S3_ACCESS_KEY)"
export S3_SECRET_KEY="$(~/.claude/claudecodex-vault.sh get S3_SECRET_KEY)"
```

After editing, source the profile or open a new terminal:

```bash
source ~/.zprofile
```

## Step 4: Docker Compose reads host environment

In `docker-compose.yml`, services reference environment variables from the host:

```yaml
services:
  api:
    environment:
      - DATABASE_URL
      - REDIS_URL
      - API_BEARER_TOKEN
  worker-scraper:
    environment:
      - DATABASE_URL
      - REDIS_URL
      - S3_ACCESS_KEY
      - S3_SECRET_KEY
  worker-processing:
    environment:
      - DATABASE_URL
      - REDIS_URL
      - S3_ACCESS_KEY
      - S3_SECRET_KEY
```

When no `=value` is provided, Docker Compose passes through the host's env var.

## Step 5: Verify end-to-end

```bash
# Verify secrets are in the shell environment
env | grep -E 'DATABASE_URL|REDIS_URL|API_BEARER_TOKEN|S3_ACCESS_KEY|S3_SECRET_KEY'

# Verify Docker Compose interpolates correctly (shows values, do not share output)
docker compose config | grep -i password
docker compose config | grep -i bearer
docker compose config | grep -i s3_

# Start services and check logs for connection success
docker compose up -d
docker compose logs api | head -20
```

## Rotation

To rotate a secret:

1. Update the value: `~/.claude/claudecodex-vault.sh set SECRET_NAME "new_value"`
2. Source the profile: `source ~/.zprofile`
3. Restart affected services: `docker compose restart api worker-scraper worker-processing`

See `docs/secrets-strategy.md` for rotation frequency and the full secrets inventory.

## Security Notes

- Secrets never appear in source control (`.env` is git-ignored)
- Secrets are never passed as CLI arguments (visible in `ps`)
- Secrets are stored in the macOS Keychain, not in plain text files
- The Keychain requires user login to unlock, adding a layer of physical security
- Docker Compose passes secrets via environment variables, not bind-mounted files
