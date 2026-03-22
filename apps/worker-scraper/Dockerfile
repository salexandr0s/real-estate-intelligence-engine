# ── Builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Copy entire monorepo (filtered by .dockerignore)
COPY . .

# Install all workspace dependencies (deterministic, skip native addons)
RUN npm ci --ignore-scripts

# Build all packages and apps via Turbo
RUN npm run build

# ── Runtime ─────────────────────────────────────────────────────────
# Playwright base image includes Chromium and system dependencies
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Copy the entire built workspace (node_modules symlinks need full tree)
COPY --from=builder /app /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

CMD ["node", "apps/worker-scraper/dist/main.js"]
