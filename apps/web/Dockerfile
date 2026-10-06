# Build context: repository root. docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/create-platform-mcp/package.json packages/create-platform-mcp/
COPY apps/web/package.json apps/web/
# Root project (`kacp`) carries typescript for the shared build.
RUN pnpm install --frozen-lockfile --filter "@kacp/web..." --filter "@kacp/create-platform-mcp..." --filter kacp

COPY packages/shared packages/shared
COPY packages/create-platform-mcp packages/create-platform-mcp
COPY apps/web apps/web
RUN pnpm --filter @kacp/shared build && pnpm --filter @kacp/web build

# Downloadable scaffolding tool (docs/README.md 7단계): npx <TOOL_ORIGIN>/tools/create-platform-mcp.tgz create my-mcp
ARG TOOL_ORIGIN=http://app.kacp.localhost
RUN TOOL_URL="$TOOL_ORIGIN/tools/create-platform-mcp.tgz" node packages/create-platform-mcp/scripts/build-tool.mjs apps/web/dist/tools

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
