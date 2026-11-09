# TAREQ AI — production image for the owner API + dashboard.
#
# The build context can be either of these, depending on Railway's
# "Root Directory" setting for the service:
#   - the repository root (contains a `tareq/` directory), or
#   - the `tareq/` directory itself (Root Directory = `tareq/`).
#
# The build stage therefore copies the whole context to /ctx and then resolves
# the real application directory at build time, so the same file builds
# correctly in both layouts. There is deliberately no `COPY tareq/...` that would
# fail with "COPY tareq/: not found" when the context is already `tareq/`.

FROM node:22-slim AS build
# openssl 3 + ca-certificates: `node:22-slim` (Debian 12) ships without them.
# Installing openssl before `prisma generate` lets Prisma select the
# debian-openssl-3.0.x engine instead of guessing openssl-1.1.x.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=development

# Copy the context to a neutral path, then pick the app directory: `tareq/` when
# the context is the repository root, otherwise the context root itself. Secrets
# (`.env*`), VCS metadata and stale build output are never copied into the image.
COPY . /ctx
RUN set -eux; \
    if [ -f /ctx/tareq/package.json ]; then SRC=/ctx/tareq; else SRC=/ctx; fi; \
    cd "$SRC"; \
    for entry in * .[!.]*; do \
        case "$entry" in node_modules|dist|.env|.env.*|.git) continue;; esac; \
        [ -e "$entry" ] || continue; \
        cp -r "$entry" /app/; \
    done; \
    cd /app; \
    npm ci; \
    npm run build

FROM node:22-slim AS runtime
# libssl.so.3 must be present at runtime or the Prisma query engine cannot load.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
# The server reads the dashboard from dist/src/app/dashboard.html (copied by
# `npm run build`), so no source files are needed at runtime.
EXPOSE 8080
# Railway injects $PORT; the API defaults to 3300 locally.
CMD ["node", "dist/src/app/server.js"]
