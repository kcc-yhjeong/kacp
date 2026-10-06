# Build context: repository root.  docker build -f apps/orchestrator/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/orchestrator apps/orchestrator
RUN pnpm install --frozen-lockfile --filter "@kacp/orchestrator..." --filter kacp
RUN pnpm --filter @kacp/shared build && pnpm --filter @kacp/orchestrator build
RUN pnpm --filter @kacp/orchestrator deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
# Platform Dockerfile for uploaded MCP packages (docs/README.md 6단계), read by mcp-build.ts.
COPY packages/create-platform-mcp/platform/Dockerfile /app/platform/Dockerfile
EXPOSE 4000
CMD ["node", "dist/server.js"]
