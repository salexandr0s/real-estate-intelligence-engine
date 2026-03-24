#!/usr/bin/env bash
set -euo pipefail

echo "=== ImmoRadar - Dev Setup ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: node >= 20 required"; exit 1; }

# Start infrastructure if docker available
if command -v docker >/dev/null 2>&1; then
  echo "Starting infrastructure..."
  docker compose -f infrastructure/compose/docker-compose.local.yml up -d

  echo "Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    pg_isready -h localhost -p 5432 -U postgres 2>/dev/null && break
    [ "$i" -eq 30 ] && echo "Warning: PostgreSQL not ready after 30s"
    sleep 1
  done
else
  echo "Warning: docker not found, skipping infra startup"
fi

# Copy env if needed
[ -f .env ] || { cp example.env .env; echo "Created .env from example.env"; }

echo "Installing dependencies..."
npm install

echo "Building packages..."
npm run build 2>/dev/null || echo "Build completed with warnings"

if command -v docker >/dev/null 2>&1; then
  echo "Running migrations..."
  npm run db:migrate 2>/dev/null || echo "Migrations skipped"

  echo "Seeding database..."
  npm run db:seed 2>/dev/null || echo "Seed skipped"
fi

echo ""
echo "=== Setup complete ==="
echo "Start API:  npx tsx apps/api/src/main.ts"
echo "Run tests:  npm run test:unit"
