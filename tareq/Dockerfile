# TAREQ AI — production image for the owner API + dashboard.
#
# This Dockerfile intentionally targets the `tareq/` subdirectory. It exists so
# Railway (and any Docker host) builds and runs the TAREQ application, NOT the
# repository root, which is a different (legacy) Next.js app.
#
# Build context is the repository root, so we copy only `tareq/`.
FROM node:22-slim AS build
# openssl 3 + ca-certificates: `node:22-slim` (Debian 12) ships without them.
# Installing openssl before `prisma generate` lets Prisma select the
# debian-openssl-3.0.x engine instead of guessing openssl-1.1.x.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=development
COPY tareq/package.json tareq/package-lock.json ./
RUN npm ci
COPY tareq/ ./
RUN npm run build

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
