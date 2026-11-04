# Build from repo root:  docker build -f apps/web/Dockerfile -t cricket-web .
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable && apk add --no-cache bash
COPY . .
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile && pnpm --filter @cricket/web build && ./scripts/check-web-bundle.sh

FROM node:24-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3100/robots.txt || exit 1
CMD ["node", "apps/web/server.js"]
