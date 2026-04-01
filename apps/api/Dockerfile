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

# Remove npm from the runtime image; the container only needs Node.js to start the API.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy the entire built workspace (node_modules symlinks need full tree)
COPY --from=builder /app /app

ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then((r)=>process.exit(r.ok ? 0 : 1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
