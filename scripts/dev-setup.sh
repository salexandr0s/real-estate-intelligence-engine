#!/usr/bin/env bash
set -euo pipefail

echo "=== ImmoRadar - Dev Setup ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node 22 or later is required" >&2; exit 1; }

# Start infrastructure if docker available
if command -v docker >/dev/null 2>&1; then
  echo "Starting infrastructure..."
  docker compose -f infrastructure/compose/docker-compose.local.yml up -d

  echo "Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    pg_isready -h localhost -p 5432 -U postgres 2>/dev/null && break
    if [ "$i" -eq 30 ]; then
      echo "Error: PostgreSQL did not accept connections within 30 s" >&2
      exit 1
    fi
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
npm run build

if command -v docker >/dev/null 2>&1; then
  echo "Running migrations..."
  npm run db:migrate

  echo "Seeding database..."
  npm run db:seed
fi

echo ""
echo "=== Setup complete ==="
echo "Start API:  npx tsx apps/api/src/main.ts"
echo "Run tests:  npm run test:unit"
