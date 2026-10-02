# Build context: repository root.  docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile --filter "@kacp/api..." --filter kacp
RUN pnpm --filter @kacp/shared build && pnpm --filter @kacp/api build
RUN pnpm --filter @kacp/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
EXPOSE 3000
CMD ["node", "dist/server.js"]
