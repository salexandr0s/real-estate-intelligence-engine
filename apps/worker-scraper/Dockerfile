# ── Builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Copy entire monorepo (filtered by .dockerignore)
COPY . .

# Install all workspace dependencies and build the repo
RUN npm ci --ignore-scripts
RUN npm run build
RUN npm prune --omit=dev --workspaces --include-workspace-root --ignore-scripts

# Assemble a curated runtime tree so the final image does not carry the full repo.
RUN mkdir -p /runtime/apps /runtime/packages \
    && cp package.json package-lock.json /runtime/ \
    && cp -R node_modules /runtime/node_modules \
    && find apps -mindepth 1 -maxdepth 1 -type d -print0 | while IFS= read -r -d '' dir; do \
      mkdir -p "/runtime/$dir"; \
      cp "$dir/package.json" "/runtime/$dir/package.json"; \
      if [ -d "$dir/dist" ]; then cp -R "$dir/dist" "/runtime/$dir/dist"; fi; \
    done \
    && find packages -mindepth 1 -maxdepth 1 -type d -print0 | while IFS= read -r -d '' dir; do \
      mkdir -p "/runtime/$dir"; \
      cp "$dir/package.json" "/runtime/$dir/package.json"; \
      if [ -d "$dir/dist" ]; then cp -R "$dir/dist" "/runtime/$dir/dist"; fi; \
    done

# ── Runtime ─────────────────────────────────────────────────────────
# Playwright base image includes Chromium and system dependencies.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# Remove npm from the runtime image; the container only needs Node.js to start the worker.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --chown=pwuser:pwuser --from=builder /runtime /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

USER pwuser

CMD ["node", "apps/worker-scraper/dist/main.js"]
