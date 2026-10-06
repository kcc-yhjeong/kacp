# KACP platform Dockerfile for marketplace MCP packages (docs/README.md 6단계).
# The orchestrator builds every uploaded package with this file; a Dockerfile inside the package is ignored.
# Build context: the extracted package zip (its root holds package.json). Nothing outside it is used.
#   docker build -f packages/create-platform-mcp/platform/Dockerfile <extracted package dir>
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
# The scaffolding tool (optional dependency from the platform URL) is not needed to build: drop it so the
# build never fetches it (`npm ci` then fails on the changed lock and `npm install` re-resolves).
RUN rm -f Dockerfile .dockerignore \
 && npm pkg delete optionalDependencies.create-platform-mcp devDependencies.create-platform-mcp \
 && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app .
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
