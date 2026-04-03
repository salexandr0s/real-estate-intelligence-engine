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
FROM node:22-slim

WORKDIR /app

# Remove package managers from the runtime image; the container only needs Node.js to start the worker.
RUN rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/yarn \
    /usr/lib/node_modules/npm \
    /usr/lib/node_modules/corepack \
    /usr/lib/node_modules/yarn \
    /opt/yarn-v* \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg \
    /usr/bin/npm \
    /usr/bin/npx \
    /usr/bin/corepack \
    /usr/bin/yarn \
    /usr/bin/yarnpkg

COPY --chown=node:node --from=builder /runtime /app

ENV NODE_ENV=production

USER node

CMD ["node", "apps/worker-processing/dist/main.js"]
