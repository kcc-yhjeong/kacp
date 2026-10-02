# apps/proxy — Traefik config and local plugins

Traefik `v3.7.13` (image `traefik:v3.7.13`) is the only entry for browser traffic. This package
holds its config and two local plugins; it has no runtime code of its own. Design:
`docs/design/05-urls-and-storage.md` §1·§2·§6·§7, `docs/design/06-auth.md` §3·§5,
spikes `01-proxy-auth`, `03-iframe-csp`, `07-domain-cert`.

## Files

| File | Purpose |
|---|---|
| `traefik.local.yml` | Static config, local (Docker Desktop, http, `*.kacp.localhost`). No TLS, no ACME |
| `traefik.vm.yml` | Static config, VM (https, `*.kacp.cloud`). `web` :80 → redirect, `websecure` :443 with one wildcard cert via ACME DNS-01 (`gcloud`) |
| `dynamic/core.yml` | File-provider dynamic config (Go template): middlewares `strip-identity`, `kacp-auth`, `claw-frame`, `strip-session-cookie`, `secure-headers`, `apex-redirect`; routers `app-api`, `app-web`, `apex`, `fallback-web`; services `api`, `web` |
| `LABELS.md` | Exact Docker labels orchestrator must put on team (and later app) containers |
| `plugins/cspframe/` | Local plugin: drop `X-Frame-Options`, rewrite only CSP `frame-ancestors` (middleware `claw-frame`) |
| `plugins/cookiestrip/` | Local plugin: remove named cookies (`kacp_session`) from the request (middleware `strip-session-cookie`) |
| `package.json` | Lets `pnpm -r` include this package (no TS) |

## Entry point naming

The serving entry point is called **`websecure` in both modes**:

- local: `websecure` listens on `:80`, plain http (no `web` entry point at all)
- VM: `web` (:80) only redirects to `websecure` (:443, TLS, `certResolver: le`)

So `dynamic/core.yml` and every container label always say `entrypoints=websecure`, and no
router ever carries a `tls` key (the VM wildcard is configured on the entry point — spike 07).
`websecure` is also `asDefault`, so a router that forgets `entryPoints` still lands only there.
Static config cannot be templated, hence two static files; the dynamic config is shared.

## How compose mounts it (compose lives in `deploy/infra`, not here)

| Host (repo / VM) | Container | Mode |
|---|---|---|
| `apps/proxy/traefik.local.yml` or `traefik.vm.yml` | `/etc/traefik/traefik.yml` | ro |
| `apps/proxy/dynamic/` | `/etc/traefik/dynamic/` | ro |
| `apps/proxy/plugins/cspframe/` | `/plugins-local/src/github.com/kacp/cspframe/` | ro |
| `apps/proxy/plugins/cookiestrip/` | `/plugins-local/src/github.com/kacp/cookiestrip/` | ro |
| VM only: `/data/traefik/` (contains `acme.json`, 0600) | `/data/` | rw |

Traefik reads `/etc/traefik/traefik.yml` by default, so no `--configFile` flag is needed.
Local plugins are resolved as `/plugins-local/src/<moduleName>` (Traefik's working dir is `/`);
the module names `github.com/kacp/cspframe` and `github.com/kacp/cookiestrip` must match each
plugin's `go.mod` and `.traefik.yml` `import`. Nothing is downloaded from the plugin catalog.

Ports: local publishes `80:80`; VM publishes `80:80` and `443:443`. `8082` (ping) is never
published; compose healthcheck: `traefik healthcheck --ping`.

Sketch (for the compose author):

```yaml
traefik:
  image: traefik:v3.7.13
  environment:
    BASE_DOMAIN: kacp.localhost          # VM: kacp.cloud
    # VM only:
    # GCE_PROJECT: kcc-llm
    # HSTS_SECONDS: "31536000"
  volumes:
    - ../../apps/proxy/traefik.local.yml:/etc/traefik/traefik.yml:ro
    - ../../apps/proxy/dynamic:/etc/traefik/dynamic:ro
    - ../../apps/proxy/plugins/cspframe:/plugins-local/src/github.com/kacp/cspframe:ro
    - ../../apps/proxy/plugins/cookiestrip:/plugins-local/src/github.com/kacp/cookiestrip:ro
  networks:
    kacp-edge: { ipv4_address: 172.30.0.10 }
    kacp-traefik-sock: {}
```

## Environment variables (traefik container)

| Var | Where | Meaning |
|---|---|---|
| `BASE_DOMAIN` | both | `kacp.localhost` (local) / `kacp.cloud` (VM). Read by `dynamic/core.yml` via `{{ env "BASE_DOMAIN" }}`; defaults to `kacp.localhost` if unset. Orchestrator must use the same value in labels |
| `HSTS_SECONDS` | VM | `31536000` → `Strict-Transport-Security` on all responses. Unset/0 locally (no header) |
| `GCE_PROJECT` | VM | GCP project for the lego `gcloud` DNS provider. Credentials come from the VM service account (`roles/dns.admin`, access scope `cloud-platform`); no key file |

The VM static file hard-codes `kacp.cloud` / `*.kacp.cloud` because static config has no
templating. For a first dry run uncomment `caServer` (Let's Encrypt staging) in
`traefik.vm.yml`, then remove it and truncate `acme.json` to 0 bytes.

## Template syntax in `dynamic/core.yml`

The file provider renders each file as a Go template with sprig functions before parsing YAML:

```
{{- $base := env "BASE_DOMAIN" | default "kacp.localhost" -}}
{{- $baseRe := $base | replace "." "\\." -}}
rule: 'Host(`app.{{ $base }}`)'
rule: 'HostRegexp(`^[a-z0-9-]+\.{{ $baseRe }}$`)'
```

`replace` (sprig, in every v3 release) escapes the dots; a valid domain has no other regex
metacharacters. Regex rules are YAML single-quoted so `\.` is passed literally. A typo in the
template makes Traefik reject the whole file (log: `error while parsing template`), so check the
log after edits.

## Routing summary

| Router | Rule | Prio | Middlewares | Service |
|---|---|---|---|---|
| `app-api` | ``Host(`app.B`) && PathPrefix(`/api`)`` | 100 | secure-headers, strip-identity | api `http://api:3000` (prefix kept: api serves `/api/v1/*`) |
| `app-web` | ``Host(`app.B`)`` | 90 | secure-headers, strip-identity | web `http://web:80` |
| `apex` | ``Host(`B`)`` | 80 | secure-headers, apex-redirect (301 → `app.B`) | `noop@internal` |
| `team-claw-{team}` | labels, see `LABELS.md` | 70 | secure-headers, strip-identity, kacp-auth, claw-frame | team Gateway :18789 |
| app copies (stage 5) | labels | 60 | … kacp-auth, strip-session-cookie | app container |
| `fallback-web` | ``HostRegexp(`^[a-z0-9-]+\.B$`)`` | 1 | secure-headers, strip-identity, kacp-auth | web |

`/internal/*` is never routed to api: `app-api` matches only `/api`, so `app.B/internal/...`
goes to web (404) and other hosts never reach api. forward-auth (`/internal/forward-auth`) is
called by Traefik directly over `kacp-edge`.

## Fixed Traefik IP (trusted proxy)

OpenClaw trusts identity headers only from `gateway.trustedProxies`, so Traefik needs a fixed
address on `kacp-edge` and the same value goes into every team's `openclaw.json`:

- compose network `kacp-edge` with an explicit `name: kacp-edge` (the docker provider and labels
  use this exact name, not a project-prefixed one)
- recommended IPAM: `subnet: 172.30.0.0/16`, `ip_range: 172.30.128.0/17` (dynamic containers get
  addresses from the range), Traefik `ipv4_address: 172.30.0.10` outside the range so no team or
  app container can ever be assigned it before Traefik starts
- `openclaw.json`: `gateway.trustedProxies: ["172.30.0.10"]`

## Read-only Docker socket proxy `traefik-socket-proxy`

Traefik never mounts `/var/run/docker.sock`. It talks to its own
`tecnativa/docker-socket-proxy:v0.5.0`, separate from orchestrator's proxy:

- env: `CONTAINERS=1`, `POST=0`, and every other section 0 **except** the image defaults
  `EVENTS=1`, `PING=1`, `VERSION=1` — Traefik's docker provider needs `/_ping`, `/version`
  (API negotiation), `/containers/json`, `/containers/{id}/json` and `/events` (to see containers
  start/stop). With `EVENTS=0` routes would not follow container changes
- mounts `/var/run/docker.sock:/var/run/docker.sock:ro`
- attached only to an internal network `kacp-traefik-sock` (`internal: true`) shared with
  traefik alone; endpoint `tcp://traefik-socket-proxy:2375`

## Plugins

Both are yaegi-interpreted Go, stdlib only, written fresh for KACP (spike 03 code is not used).

- `cspframe` config: `frameAncestors` (default `'self'`; `;` `,` and line breaks rejected).
  Rewrites `Content-Security-Policy` and `-Report-Only` at WriteHeader / first Write / Flush.
  Passes `Hijack` (WebSocket) and `Flush` through.
- `cookiestrip` config: `names` (default `[kacp_session]`, exact case-sensitive names). Keeps
  all other cookie pairs as received, merges multiple Cookie fields, drops the header if empty.

Tests (Go is not needed for development; run in CI or on the VM):

```
cd apps/proxy/plugins/cspframe && go test ./...
cd apps/proxy/plugins/cookiestrip && go test ./...
```

Traefik refuses to start a plugin whose `.traefik.yml` `testData` does not load, so a broken
plugin shows up immediately in the Traefik log (`Plugins are disabled because an error has
occurred`).
