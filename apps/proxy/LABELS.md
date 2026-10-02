# Traefik labels for orchestrator-created containers

Dynamic routes come from Docker labels that **orchestrator** sets when it creates a container
(Docker provider, `docs/design/05-urls-and-storage.md` §2). Static routes and the shared
middlewares live in `dynamic/core.yml` and are referenced with the `@file` suffix.

`{BASE}` = the same value as the traefik container's `BASE_DOMAIN` (`kacp.localhost` locally,
`kacp.cloud` on the VM). orchestrator reads it from its own env.

## Rules for every routed container

- `kacp.kind` must be `team`, `app-work` or `app-public`. Traefik's docker provider has a
  constraint `LabelRegex(kacp.kind, ^(team|app-work|app-public)$)`; anything else (MCP
  containers, sandboxes, sidecars) is ignored even if its image ships `traefik.*` labels.
  Container labels override image labels with the same key, so orchestrator always sets `kacp.kind`.
- `entrypoints=websecure` only. **Never** add `tls`, `tls.certresolver` or `tls.domains` labels
  (spike 07: per-router `certResolver` issues one certificate per Host; even an empty `tls`
  overrides the entry point and no certificate is issued). `websecure` is the serving entry
  point in both local (:80, http) and VM (:443, https) static configs.
- Always set `traefik.docker.network=kacp-edge` (the container may also sit on
  `kacp-team-{team}` / `kacp-sbx-{team}`; without this Traefik may pick an unreachable IP).
- Always name the service explicitly and set its port.
- If the container has a Docker healthcheck, Traefik ignores it until it is `healthy`; requests
  then fall through to `fallback-web` (web shows "preparing"). This is intended.
- Containers without routes (`kacp-gwagent-{team}` sidecar, `kacp-sbx-proxy-{team}`,
  `kacp-mcp-*`, sandboxes) get **no** `traefik.*` labels.

## Team container `kacp-team-{team}`

| Label | Value |
|---|---|
| `kacp.kind` | `team` |
| `kacp.team` | `{team}` |
| `kacp.id` | `{teams.id}` |
| `traefik.enable` | `true` |
| `traefik.docker.network` | `kacp-edge` |
| `traefik.http.routers.team-claw-{team}.rule` | ``Host(`{team}.{BASE}`) && PathPrefix(`/claw`)`` |
| `traefik.http.routers.team-claw-{team}.priority` | `70` |
| `traefik.http.routers.team-claw-{team}.entrypoints` | `websecure` |
| `traefik.http.routers.team-claw-{team}.middlewares` | `secure-headers@file,strip-identity@file,kacp-auth@file,claw-frame@file` |
| `traefik.http.routers.team-claw-{team}.service` | `team-claw-{team}` |
| `traefik.http.services.team-claw-{team}.loadbalancer.server.port` | `18789` |

The `/claw` prefix is **not** stripped: OpenClaw serves the Control UI under
`controlUi.basePath = /claw`. Everything else on `{team}.{BASE}` (the agent shell) goes to
`fallback-web`. `/api/v1/admin/rpc` of the Gateway is therefore unreachable from outside.

Middleware order matters (Traefik runs them left to right on the request):

1. `secure-headers` — adds `X-Content-Type-Options` (and HSTS on the VM) to every response,
   including forward-auth redirects/denials.
2. `strip-identity` — deletes client-supplied `X-Forwarded-User`, `X-Openclaw-Scopes`,
   `X-Kacp-*` **before** anything trusts them.
3. `kacp-auth` — forward-auth to api; on 200 it injects the identity headers
   (`X-Forwarded-User` = trusted-proxy user, `X-Openclaw-Scopes` always present for team hosts).
   On 302/401/403 the chain stops here.
4. `claw-frame` — response-only: removes `X-Frame-Options`, sets `frame-ancestors 'self'` so the
   shell at `{team}.{BASE}/` can iframe `/claw/`. It is last so it wraps exactly the Gateway
   response; it passes WebSocket `Hijack` through.

Example (team `team1`, local):

```
kacp.kind=team
kacp.team=team1
kacp.id=6f1c…
traefik.enable=true
traefik.docker.network=kacp-edge
traefik.http.routers.team-claw-team1.rule=Host(`team1.kacp.localhost`) && PathPrefix(`/claw`)
traefik.http.routers.team-claw-team1.priority=70
traefik.http.routers.team-claw-team1.entrypoints=websecure
traefik.http.routers.team-claw-team1.middlewares=secure-headers@file,strip-identity@file,kacp-auth@file,claw-frame@file
traefik.http.routers.team-claw-team1.service=team-claw-team1
traefik.http.services.team-claw-team1.loadbalancer.server.port=18789
```

openclaw.json of the team must have `gateway.trustedProxies` = Traefik's fixed `kacp-edge`
address (see README "Fixed Traefik IP").

### Local-only note: `X-Forwarded-Proto`

Locally Traefik terminates plain http, so the Gateway sees `X-Forwarded-Proto: http`.
OpenClaw public share links (`/claw/share/session?token=…`) open only when it is exactly
`https`. Not needed in stage 2; on the VM it is `https` automatically. Do not fake it with a
header middleware in the shared config.

## App copies (stage 5, preview)

Same rules; to be finalized in stage 5.

| | Working copy `kacp-app-{slug}--{team}` | Public copy `kacp-pub-{name}` |
|---|---|---|
| `kacp.kind` | `app-work` | `app-public` |
| router | `work-{slug}--{team}` | `public-{name}` |
| rule | ``Host(`{slug}--{team}.{BASE}`)`` | ``Host(`{name}.{BASE}`)`` |
| priority | `60` | `60` |
| middlewares | `secure-headers@file,strip-identity@file,kacp-auth@file,strip-session-cookie@file` | same |

`strip-session-cookie` must come **after** `kacp-auth` (forward-auth still needs the
`kacp_session` cookie). During a public copy replacement the old and new containers both carry
the router for a moment. Keep the router **and** service labels identical on both (same names,
same values): Traefik then merges them into one service with two servers. Different values
under the same router name are a conflict and Traefik drops the router (to verify in stage 5).
