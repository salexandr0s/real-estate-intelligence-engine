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
FROM node:22-slim

WORKDIR /app

# Install curl for the HEALTHCHECK probe
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Copy the entire built workspace (node_modules symlinks need full tree)
COPY --from=builder /app /app

ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "apps/api/dist/main.js"]
