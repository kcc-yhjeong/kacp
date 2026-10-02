# Build context: repository root. docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
# Root project (`kacp`) carries typescript for the shared build.
RUN pnpm install --frozen-lockfile --filter "@kacp/web..." --filter kacp

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @kacp/shared build && pnpm --filter @kacp/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
