# Build from repo root:  docker build -f apps/api/Dockerfile -t cricket-api .
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @cricket/api build \
 && pnpm --filter @cricket/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && mkdir -p /out/drizzle && cp -r packages/db/drizzle/. /out/drizzle/

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist/server.js"]
