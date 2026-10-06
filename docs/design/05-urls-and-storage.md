# 05. URL·도메인 규칙과 폴더 구조

## 1. 도메인

- 도메인 `kacp.cloud`(가비아 구매) → 네임서버 Google Cloud DNS 위임
- A 레코드: `kacp.cloud`, `*.kacp.cloud` → VM 고정 IP
- 인증서: Traefik ACME DNS-01(`provider: gcloud`)로 `kacp.cloud` + `*.kacp.cloud` 와일드카드 하나(spike 07 확인, Let's Encrypt, 약 35초)
  - 요청은 **websecure 진입점 한 곳에서만**: `entrypoints.websecure.http.tls.certresolver=le`, `…tls.domains[0].main=kacp.cloud`, `…tls.domains[0].sans=*.kacp.cloud`
  - **라우터에는 `tls`를 적지 않는다.** `certResolver`를 적으면 라우터 Host마다 인증서를 따로 받아 발급 한도(주당 50장)에 걸리고, `tls: {}`만 적어도 진입점 설정을 덮어써 발급이 안 된다(spike 07)
  - 자격 증명은 VM 서비스 계정(`roles/dns.admin`) + VM 액세스 범위 `cloud-platform`. 키 파일 없음. 범위는 VM을 정지해야 바꿀 수 있다
  - `acme.json`은 `/data/traefik/acme.json`(0600). 비울 때는 0바이트로(빈 줄이면 Traefik이 resolver를 끈다)
- 접속: GCP 방화벽에서 443을 회사 사무실 공인 IP 대역에만 개방. 80은 443 리다이렉트용으로 같은 대역만
- 로그인 쿠키: `Domain=.kacp.cloud`

## 2. 호스트와 라우팅

| 호스트 | 경로 | 가는 곳 | 인증 |
|---|---|---|---|
| `kacp.cloud` | 전체 | `https://app.kacp.cloud`로 301 | 없음 |
| `app.kacp.cloud` | `/api/*` | api | api가 직접 세션 확인 |
| `app.kacp.cloud` | 그 외 | web (SPA) | 없음(SPA가 `/auth/me`로 판단) |
| `{team}.kacp.cloud` | `/claw/*` | 팀 컨테이너 Gateway(Control UI + WS) | forward-auth: 팀 멤버 |
| `{team}.kacp.cloud` | 그 외 | web (에이전트 셸) | forward-auth: 팀 멤버 |
| `{app}--{team}.kacp.cloud` | 전체 | 작업본 컨테이너 | forward-auth: 팀 멤버 |
| `{name}.kacp.cloud` (공개 주소) | 전체 | 공개본 컨테이너(스냅샷) | forward-auth: 로그인 사용자 |
| 등록 안 된 이름 | 전체 | web의 404 화면(C-04) | 없음 |

### Traefik 라우터 구성

| 라우터 | 규칙 | 우선순위 | 등록 방식 |
|---|---|---|---|
| `app-api` | `Host(app.kacp.cloud) && PathPrefix(/api)` | 100 | 정적(compose 라벨) |
| `app-web` | `Host(app.kacp.cloud)` | 90 | 정적 |
| `team-claw-{team}` | `Host({team}.kacp.cloud) && PathPrefix(/claw)` | 70 | **동적**: 팀 컨테이너 라벨 |
| `work-{slug}--{team}` / `public-{name}` | `Host(...)` | 60 | **동적**: 작업본·공개본 컨테이너 라벨 |
| `fallback-web` | `HostRegexp(^[a-z0-9-]+\.kacp\.cloud$)` | 1 | 정적 → web (셸 또는 404/앱 중지됨) |

- 팀 호스트의 에이전트 셸은 API를 `https://app.kacp.cloud/api/v1`로 호출한다(`credentials: include`). api는 `Origin`이 등록된 팀 호스트일 때만 CORS를 허용한다. 팀·앱 호스트에 `/api` 라우트를 두지 않는 이유는 앱이 자기 `/api` 경로를 쓸 수 있기 때문이다.
- 동적 라우트는 orchestrator가 컨테이너를 만들 때 Traefik 라벨을 붙이는 방식(Docker provider). 컨테이너가 멈추면 라우트가 사라지고 `fallback-web`이 받는다. 라벨에는 `entrypoints=websecure`만 두고 `tls`·`certresolver` 라벨은 붙이지 않는다(§1, 와일드카드 재사용).
- `fallback-web`으로 들어온 요청에서 web은 호스트를 해석해 화면을 고른다: 팀 이름이면 에이전트 셸, 그 외에는 `GET /api/v1/app-hosts/{host}`로 판단해 **잠든 사본이면 "앱 깨우는 중"**(자동으로 `wake` 호출 → 준비되면 새로고침, 이때부터는 앱 라우터가 받음), 사람이 멈춘 사본이면 "앱 멈춤", 없으면 404.
- 앱 접속 기록: forward-auth가 앱 호스트 요청을 볼 때마다 해당 사본의 `*_last_accessed_at`을 갱신한다(1분에 한 번만 쓰기). 유휴 정지 워커는 이 값을 본다.
- 셸 라우트의 forward-auth: `fallback-web`에 forward-auth 미들웨어를 걸고, forward-auth가 "팀 이름이 아닌 호스트"는 그대로 통과(200)시킨다. 404/앱 중지됨 화면은 로그인 없이 보여도 문제없다.

### 미들웨어

| 이름 | 적용 | 하는 일 |
|---|---|---|
| `strip-identity` | 모든 라우터 | 요청의 `x-kacp-*`, `x-openclaw-*`, trusted-proxy 사용자 헤더 제거 |
| `kacp-auth` | team-claw, app, public, fallback-web | forwardAuth → `http://api:3000/internal/forward-auth`, `authResponseHeaders`로 신원 헤더 주입 |
| `strip-session-cookie` | 작업본·공개본 라우터 | 앱으로 가는 요청의 `Cookie`에서 `kacp_session`만 제거(앱이 플랫폼 세션을 못 보게, 앱 자체 쿠키는 유지). **`kacp-auth` 뒤에** 둔다. Traefik 기본 미들웨어로는 쿠키 하나만 지울 수 없어 로컬 플러그인으로 한다(spike 03) |
| `claw-frame` | team-claw | 응답의 `X-Frame-Options` 제거, CSP의 `frame-ancestors` 지시문만 `'self'`로 바꿈(나머지 CSP·스크립트 해시는 그대로). **Traefik 로컬 플러그인**으로 한다. CSP에 버전마다 바뀌는 스크립트 해시가 있어 전체 CSP 고정은 안 되고, `headers` 미들웨어는 일부 치환을 못 한다. WebSocket을 위해 `Hijack`을 그대로 넘긴다(spike 03) |
| `secure-headers` | 전체 | HSTS, `X-Content-Type-Options` |

- 로컬 플러그인(`claw-frame`, `strip-session-cookie`)은 `apps/proxy`에 두고 Traefik `experimental.localPlugins`로 싣는다. 외부 플러그인 카탈로그에서 내려받지 않는다. spike 03 코드는 복사하지 않고 새로 짠다.
- **샌드박스 출처(5단계 결정)**: Control UI의 HTML 미리보기·Canvas는 OpenClaw 샌드박스 리스너(Gateway 포트+1 = `18790`)의 **별도 출처**에서 돈다(MCP Apps를 켜지 않아도 쓰인다 — OpenClaw `web/control-ui/chat.md`, `cli/mcp/apps.md`). 팀마다 `{team}--sbx.{base}` → 팀 컨테이너 `18790` 라우트(라벨 `team-sbx-{team}`, 우선순위 65)를 두고 `mcp.apps.sandboxOrigin`·`sandboxPort`를 시드·apply-config로 넣는다. 이 출처는 격리된 렌더러만 내보내고 인증 내용은 Gateway를 거치므로 **forward-auth를 걸지 않고** `strip-identity`·`strip-session-cookie`만 건다(OpenClaw 권고: 다른 인증 콘텐츠를 두지 않음). 두 단계 서브도메인 대신 한 단계 `--sbx`를 쓰고, 작업본 주소(`앱--팀`)와 겹치지 않게 **`sbx`를 예약어**로 둔다. `mcp.apps.enabled`(MCP Apps 자체)는 v1에서 끈 채로 둔다.

## 3. 이름 규칙 (팀·앱 공통)

- 정규식: `^[a-z0-9](?:[a-z0-9]|-(?!-)){1,28}[a-z0-9]$` → 3~30자, 소문자·숫자·하이픈, `--` 금지, 하이픈으로 시작·끝 금지
- 팀 이름과 **Public** 앱 이름은 `names` 테이블 하나에서 중복 검사
- 작업본(Private) slug는 팀 안에서만 unique(`{slug}--{team}`이 전체에서 unique해지므로 `names`에 넣지 않음). 단 같은 규칙 적용
- `{slug}--{team}` 전체 길이는 63자(DNS 라벨 한도) 이하 — slug 30 + 2 + team 30 = 62
- 예약어(시드): `app` `admin` `api` `www` `auth` `login` `static` `assets` `cdn` `mail` `smtp` `ftp` `ns1` `ns2` `traefik` `proxy` `grafana` `prometheus` `status` `help` `docs` `kacp` `claw` `openclaw` `market` `community` `drive` `internal` `system` `root` `test` `dev` `staging` `sbx`
- 플랫폼 설정 `names.reserved_extra`로 추가 가능

## 4. 웹 경로 (app.kacp.cloud)

`/tools/create-platform-mcp.tgz`는 **로그인 없이** 받는 개발 도구(웹 이미지에 포함, nginx 정적 파일). 그 밖의 경로는 아래 표와 같다.

| 경로 | 화면 |
|---|---|
| `/login`, `/password/setup`, `/no-team` | C-01, C-02, C-03 |
| `/forbidden`, `/not-found`, `/app-stopped` | C-04 |
| `/t/{team}/drive/{me\|shared}/{path*}` | U-04 |
| `/t/{team}/drive/trash` | U-06 |
| `/t/{team}/apps`, `/t/{team}/apps/{appId}` | U-07, U-08 |
| `/t/{team}/settings/{members\|mcp\|info}` | U-15 |
| `/market`, `/market/{pkg}`, `/market/installed`, `/market/mine`, `/market/mine/{pkg}/{ver}` | U-09~U-12 |
| `/community`, `/community/new`, `/community/{postId}` | U-13 |
| `/me` | U-14 |
| `/admin/org`, `/admin/import` | A-12, A-13 |
| `/admin`, `/admin/users[/{id}]`, `/admin/teams[/{team}]`, `/admin/agents[/{id}]`, `/admin/mcp/reviews[/{versionId}]`, `/admin/mcp`, `/admin/deploy`, `/admin/settings`, `/admin/audit` | A-01~A-11 |

에이전트 셸은 `https://{team}.kacp.cloud/`(경로 없음), Control UI는 같은 호스트의 `/claw/`(`controlUi.basePath`).

## 5. VM 폴더 구조 (`/data`)

`/data`는 별도 Hyperdisk(200GB), 일일 스냅샷. VM을 다시 만들어도 남는다.

```
/data
├── docker/                       # Docker data-root (이미지, 빌드 캐시, 볼륨)
├── postgres/                     # Postgres 데이터 (compose 바인드)
├── traefik/
│   └── acme.json                 # 인증서 (chmod 600)
├── platform/
│   └── openclaw-image/           # 기본 지시문 등 공용 읽기 전용 자원
├── teams/
│   └── {team}/
│       ├── openclaw/             # 팀 OpenClaw 상태 디렉터리 (openclaw.json, 세션, Secret Store 등)
│       │                         #   owner = OpenClaw 실행 UID, 0700
│       ├── drive/
│       │   ├── shared/           # 팀 공유. group = teams.linux_gid, 2770 (setgid)
│       │   └── personal/
│       │       └── u{linux_uid}/ # 내 드라이브. owner = users.linux_uid, 0700
│       ├── .trash/
│       │   └── {trash_item_id}/  # 휴지통 (원본 경로는 DB)
│       └── mcp/
│           └── {server_key}/     # 팀별 MCP 컨테이너 작업 폴더(필요 시)
├── apps/
│   └── {appId}/
│       ├── snapshots/{version}/  # 공개본 버전별 스냅샷 (최근 3개 보관, 읽기 전용 마운트)
│       ├── work-data/            # 작업본 전용 데이터 (SQLite 등) → /app-data
│       └── public-data/          # 공개본 전용 데이터 → /app-data (작업본과 섞지 않음)
├── mcp/
│   └── {package}/{version}/
│       ├── source.zip
│       ├── build.log, scan.json, test.log
├── backups/
│   ├── postgres/                 # pg_dump 일일, 14일 보관
│   └── deleted-teams/{team}-{date}/  # 삭제된 팀 데이터 30일 보관
└── logs/                         # 플랫폼 서비스 로그 (로테이션)
```

### 마운트 규칙

| 컨테이너 | 마운트 | 모드 |
|---|---|---|
| 팀 컨테이너 | `teams/{team}/openclaw` → `/home/node/.openclaw` | rw, **bind mount**(named volume은 샌드박스 경로 변환에 못 씀). 모든 팀 컨테이너는 공식 이미지 기본 `node`(uid 1000)로 실행하고 폴더는 `1000:1000 0700`(spike 06 결정 — 팀별 UID도 `XDG_CACHE_HOME`을 상태 폴더 안으로 두면 가능하지만 v1은 쓰지 않는다). 엔트리포인트가 기동마다 doctor를 돌려 openclaw.json을 다시 쓰고 JSON5 주석을 지운다. orchestrator는 openclaw.json을 **프로비저닝 때 한 번만, 파일이 없을 때만 시드**하고, 이후 변경은 `config.patch`로 한다. 첫 기동 이후 파일을 통째로 바꾸면 OpenClaw가 백업(`openclaw.json.last-good`, `.bak*`)으로 되돌리는데, 그 백업이 최신이 아니어서 hot reload로 바꾼 최근 설정을 잃을 수 있다(spike 02·03). **로컬**(Windows Docker Desktop)은 bind mount chmod가 안 돼 named volume `kacp-team-{team}-state`를 쓴다(`STATE_MODE=volume`, 시드는 Engine API archive 업로드, `kacp/openclaw` 이미지에 상태 폴더를 `node:node 0700`으로 만들어 첫 마운트가 소유권을 물려받게 함) |
| 팀 컨테이너 | `teams/{team}/drive/shared` → `/team-drive` **와** `/home/node/.openclaw/workspace/team-drive` | rw, 같은 원본을 두 곳에(4단계 결정). `/team-drive`는 모든 에이전트 공통 경로(템플릿 AGENTS.md에 안내), 워크스페이스 안 폴더는 기본 에이전트 `main`이 바로 보게. 개인 폴더(`personal/`)는 넣지 않는다(spike 05). 로컬은 named volume `kacp-data`의 subpath, VM은 bind |
| 샌드박스 (VM만) | 에이전트 워크스페이스 → `/workspace`, 팀 공유 드라이브는 `docker.binds`로 `/team-drive`(`dangerouslyAllowExternalBindSources: true`, 원본은 호스트 경로 그대로) | 원본이 bind mount여야 샌드박스로 비춰진다(OpenClaw docker-backend 문서) — 로컬(named volume)에서는 샌드박스를 끈다. 유휴 샌드박스 정리는 `prune: {idleHours: 1, maxAgeDays: 1}`(OpenClaw 기본 24시간은 세션마다 1GB 한도 컨테이너가 하루씩 남아 과함 — VM 확인 중 발견, 기존 팀은 기동 때 `config.patch`로 맞춤). 팀 컨테이너 `TMPDIR`은 상태 폴더 안 `/home/node/.openclaw/tmp`로 둔다 — `mode: all`이면 Model Setup의 연결 확인도 샌드박스에서 돌고, OpenClaw가 `/tmp`에 만든 임시 작업 공간은 bind mount가 아니라 샌드박스로 넘길 수 없다(VM 확인 중 발견). OpenClaw가 에이전트 워크스페이스를 `/workspace`로 bind(rw) | Gateway 안 경로를 호스트 `/data/...` 경로로 OpenClaw가 바꿔 붙인다(spike 06 실측). 요청자 개인 폴더는 넣지 않는다. 설정: `agents.defaults.sandbox = {mode: "all", backend: "docker", scope: "session", workspaceAccess: "rw", docker: {image: "openclaw-sandbox:bookworm-slim", containerPrefix: "kacp-sbx-{team}-", network: "none", user: "1000:1000", readOnlyRoot: true, capDrop: ["ALL"], pidsLimit: 256, memory: "1g", cpus: 1}}` |
| 작업본 컨테이너 | 원본 폴더(팀 공유 드라이브) → `/src` | ro. 시작 스크립트가 `/app`(쓰기 가능)으로 복사해 의존성 설치 후 실행(5단계 결정, `deploy/app-runtime`). 원본은 바뀌지 않는다. 정적 사이트는 `/src`를 바로 서빙 |
| 작업본 컨테이너 | `apps/{appId}/work-data` → `/app-data` | rw (`APP_DATA_DIR`) |
| 공개본 컨테이너 | `apps/{appId}/snapshots/{version}` → `/src` | ro (작업본과 같은 실행 방식) |
| 공개본 컨테이너 | `apps/{appId}/public-data` → `/app-data` | rw (`APP_DATA_DIR`) |
| MCP 컨테이너 | 없음(기본). 필요 시 `teams/{team}/mcp/{server_key}` | rw |
| api | `teams/*/drive`, `teams/*/.trash` | rw (드라이브 API). 로컬은 `kacp-data` 볼륨 전체를 `/data`로. 소유권: 팀 공유 `1000:{linux_gid}` 폴더 `2770`·파일 `0660`, 개인 `{linux_uid}` `0700`. 경로는 `realpath`가 공간 루트 안일 때만, 심볼릭 링크는 따라가지 않음 |
| orchestrator | `teams`, `apps`, `mcp` | rw (프로비저닝·스냅샷·빌드). 로컬은 `kacp-data` 볼륨을 `/data`로 |

## 6. 컨테이너·이미지·네트워크 이름

| 대상 | 이름 규칙 |
|---|---|
| 팀 컨테이너 | `kacp-team-{team}` |
| 작업본 컨테이너 | `kacp-app-{slug}--{team}` |
| 공개본 컨테이너 | `kacp-pub-{name}` — 업데이트 승인 시 새 버전 컨테이너를 먼저 띄우고 헬스 통과 후 라우트를 넘긴 뒤 옛 컨테이너 제거(무중단 교체) |
| MCP 컨테이너 | `kacp-mcp-{package}--{team}` |
| Gateway 사이드카 | `kacp-gwagent-{team}` — 팀 컨테이너와 네트워크 네임스페이스 공유(`network_mode: container:kacp-team-{team}`), orchestrator의 admin RPC 창구(`06-auth.md` §6, spike 04). 팀 컨테이너와 함께 기동·정지 |
| MCP 이미지 | `kacp/mcp-{package}:{version}` |
| 앱 기본 이미지 | `kacp/app-runtime-node:1`, `kacp/app-runtime-python:1`, `kacp/app-runtime-static:1` — uid 1000, `Init: true`(tini가 SIGTERM 전달), `CapDrop ALL`, `no-new-privileges`, `PidsLimit 256` |
| OpenClaw 이미지 | `kacp/openclaw:{openclaw버전}-{빌드번호}` |

모든 동적 컨테이너 라벨: `kacp.kind=team|app-work|app-public|mcp|sandbox`, `kacp.team={team}`, `kacp.id={uuid}` — orchestrator는 라벨로 자기 컨테이너만 조회·정리한다.

샌드박스 컨테이너만 예외로 OpenClaw가 만든다(spike 06 확인).
- 팀 컨테이너는 orchestrator의 socket-proxy가 아니라 **샌드박스 전용 socket-proxy** `kacp-sbx-proxy-{team}`(`tecnativa/docker-socket-proxy:v0.5.0`, `CONTAINERS POST EXEC IMAGES INFO VERSION ALLOW_START ALLOW_STOP ALLOW_RESTARTS`)에 내부 네트워크 `kacp-sbx-{team}`로 붙고, `DOCKER_HOST=tcp://kacp-sbx-proxy-{team}:2375`를 받는다.
- 팀 Gateway 이미지는 공식 이미지에 docker CLI를 더한 것(`kacp/openclaw:{버전}-{빌드}`, `docker:29-cli`에서 복사)이다. 공식 이미지에는 docker CLI가 없다.
- OpenClaw가 실제로 쓴 API: `_ping`, `version`, `containers/{id}/json`, `containers/create`·`start`, `containers/{id}/exec`, `exec/{id}/start`·`json`, `images/{name}/json`. `networks/{name}` GET은 403이어도 동작한다.
- 남는 위험: `IMAGES=1 + POST=1`이면 이미지 pull·build도 열린다. 샌드박스 이미지는 미리 받아 두고, 이 프록시는 팀 Gateway만 닿는 내부 네트워크에 둔다.
- 식별·정리: 프록시로 라벨을 강제할 수 없다. OpenClaw가 붙이는 `openclaw.sandbox=1`(+ `openclaw.sessionKey`)와 이름 접두사 `kacp-sbx-{team}-`로 찾는다. orchestrator는 팀 정지 때 이 조건으로 그 팀의 샌드박스를 정리한다.

| 네트워크 | 붙는 것 | 목적 |
|---|---|---|
| `kacp-edge` | traefik, web, api, 모든 팀·앱 컨테이너 | 프록시 → 대상. `172.30.0.0/16`, 동적 컨테이너는 `ip_range 172.30.128.0/17`, Traefik은 범위 밖 고정 `172.30.0.10`(= `trustedProxies`, 다른 컨테이너가 먼저 받을 수 없게) |
| `kacp-core` | api, orchestrator, postgres, docker-socket-proxy | 내부(`internal: true`). 외부 노출 없음 |
| (`kacp-edge`에 orchestrator) | orchestrator | 3단계: 사이드카 `kacp-gwagent-{team}:18800` 호출용 **나가는 방향만**. edge로 들어온 요청은 orchestrator가 거부 |
| `kacp-traefik-sock` | traefik, traefik-socket-proxy | 내부. Traefik Docker provider 전용 |
| `kacp-team-{team}` | 팀 컨테이너, 그 팀 MCP 컨테이너, api(platform-mcp 경유 호출용 alias) | 팀 안 MCP 호출 격리 |

**MCP (6단계 확정)**

| 이름 | 무엇 | 네트워크 |
|---|---|---|
| `kacp-mcp/{pkg}:{ver}` | 업로드된 패키지 이미지. 플랫폼 Dockerfile(`packages/create-platform-mcp/platform/Dockerfile`, orchestrator 이미지 `/app/platform/Dockerfile`)로 빌드. 실패·반려·대체된 버전은 지운다 | — |
| `kacp-mcp-{pkg}` | 패키지 MCP 서버, **모든 팀 공용**. uid 1000, 읽기 전용 루트, `/tmp` tmpfs, CapDrop ALL, 헬스 `GET /healthz`, `unless-stopped`. 팀 비밀값은 컨테이너에 없고 호출마다 헤더로 온다. 첫 설치 때 켜고 마지막 제거 때 지움 | `kacp-mcp`만 |
| `kacp-mcpproxy-{pkg}` | egress 프록시(orchestrator 이미지 `node dist/egress-proxy.js`, 포트 3128). 매니페스트 `network` 도메인만 80·443으로 허용, IP 직접 접속·내부 주소로 풀리는 이름은 거절(403). MCP 컨테이너는 `HTTPS_PROXY`·`HTTP_PROXY`로 안다 | `kacp-mcp` + `kacp-egress` |
| `kacp-mcp` | MCP 공용 내부 네트워크(`internal`). 모든 팀 컨테이너도 붙는다. Gateway는 `mcp.servers.{pkg의 -를 _로}` = `http://kacp-mcp-{pkg}:8080/mcp` + 그 팀의 `X-KACP-Secret-*` 헤더 | — |
| `kacp-egress` | 바깥으로 나가는 브리지. egress 프록시만 붙는다 | — |
| `kacp-mcp-test` | 빌드 테스트용 내부 네트워크(compose). orchestrator가 붙어 `tools/list`를 부른다 | — |
| `docker-build-proxy` | orchestrator 전용 빌드 socket-proxy(`BUILD IMAGES POST`), `kacp-core` | — |
| `kacp-trivy-cache` | Trivy 취약점 DB 캐시 볼륨. 스캔 컨테이너는 DB를 받으려고 기본 `bridge`에 붙는다 | — |

팀 Secret Store: `/data/teams/{team}/mcp/{pkg}/secrets.json`(root 0600, 팀 컨테이너에 안 붙임). orchestrator만 읽고 쓰며 apply-config 때 그 팀 Gateway 항목의 헤더로만 넣는다(MCP 컨테이너 환경변수에는 없음). orchestrator socket-proxy는 이제 로컬에서도 `NETWORKS=1`이다.

## 7. 내부 서비스 주소 (compose 서비스 이름)

| 서비스 | 주소 |
|---|---|
| api | `http://api:3000` (외부 경로 `/api/v1/*`, 내부 경로 `/internal/*`) |
| orchestrator | `http://orchestrator:4000/internal/*` (api만 호출, 공유 토큰) |
| postgres | `postgres:5432` |
| docker-socket-proxy | `tcp://docker-socket-proxy:2375` (orchestrator만). 이미지 `tecnativa/docker-socket-proxy:v0.5.0`, 허용 `CONTAINERS=1 POST=1 ALLOW_START=1 ALLOW_STOP=1 ALLOW_RESTARTS=1`(나머지 0). spike 06 로컬: 라벨 필터 조회·생성·archive 업로드·기동·정지·삭제는 통과, `/images`·`/volumes`·`/networks/create`·`/info`는 403. exec는 생성(`POST /containers/{id}/exec`)은 통과하지만 실행(`/exec/{id}/start`)은 403이다. MCP 빌드(6단계)에는 이미지 빌드 권한이 더 필요하다 — 그때 별도 프록시로 연다 |
| traefik-socket-proxy | `tcp://traefik-socket-proxy:2375` (Traefik만, 2단계 추가). 같은 이미지, `CONTAINERS=1`·`POST=0`(이미지 기본 `EVENTS PING VERSION`은 켜 둠 — provider가 컨테이너 시작·정지를 따라가려면 필요). Traefik은 Docker 소켓을 직접 마운트하지 않는다. provider `constraints`로 `kacp.kind`가 `team`·`app-work`·`app-public`인 컨테이너 라벨만 라우트로 받는다 |
| 팀 Gateway | `http://kacp-team-{team}:{port}` (`kacp-edge` 네트워크) |
