# Team Gateway image: the official OpenClaw image (pinned) + docker CLI for sandbox containers (spike 06).
# Tag: kacp/openclaw:{openclaw version}-{build}. OpenClaw itself is only configured, never modified.
ARG OPENCLAW_VERSION=2026.9.7
FROM docker:29-cli AS dockercli

FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
# The state dir exists in the image so a fresh named volume (local Docker Desktop) inherits
# node:node 0700 on first mount. On the VM the orchestrator bind-mounts /data/teams/{team}/openclaw instead.
USER root
RUN mkdir -p /home/node/.openclaw && chown node:node /home/node/.openclaw && chmod 700 /home/node/.openclaw
USER node
