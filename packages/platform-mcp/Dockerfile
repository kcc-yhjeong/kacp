# Build context: repository root.  docker build -f packages/platform-mcp/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

COPY packages/platform-mcp packages/platform-mcp
RUN pnpm install --frozen-lockfile --filter "@kacp/platform-mcp..." --filter kacp
RUN pnpm --filter @kacp/platform-mcp build
RUN pnpm --filter @kacp/platform-mcp deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
EXPOSE 5000
CMD ["node", "dist/server.js"]
