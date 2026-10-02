# Spike 04 — admin-http-rpc, `config.get`/`config.patch`, Connected Accounts

- 날짜: 2026-10-01
- 환경: Windows 11 + Docker Desktop(WSL2 백엔드)
- 검증 코드: `spikes/04-admin-rpc/` (spike 03 복사, 02 상태 볼륨 이어받음). orchestrator 대역 컨테이너 `orch`, 사이드카 `kacp-spike04-gwagent`
- 결론: **설계 변경 필요.** trusted-proxy 모드에서 Gateway 비밀번호는 **같은 호스트(loopback)에서만** 통한다. 다른 컨테이너(orchestrator)에서 부르면 401이다. 팀 컨테이너와 네트워크 네임스페이스를 공유하는 **사이드카**로 부르면 된다. `config.get`/`config.patch`로 MCP 추가·제거와 `identityScopes` 변경은 모두 hot reload로 된다. **사람별 Connected Accounts는 플랫폼이 조회할 수 없다.**

## 1. 사용한 이미지

| 구성 | 이미지 | 버전 |
|---|---|---|
| OpenClaw | `ghcr.io/openclaw/openclaw:2026.9.7` | `OpenClaw 2026.9.7 (c074824)` |
| Traefik | `traefik:v3.7.13` | 3.7.13 |
| orch, 사이드카 | `node:22-alpine` | — |

## 2. 문서 확인 (이미지 안 `/app/docs`)

- `plugins/admin-http-rpc.md`: 번들 플러그인이고 **기본으로 꺼져 있다.** 켜면 `POST /api/v1/admin/rpc`가 생긴다. 허용 메서드는 health, status, `config.get/schema/set/patch/apply`, channels, models.list, `models.authStatus`, `agents.*`, cron, devices, nodes 등이다. **`users.*`, `session.*`는 없다.**
  - 인증: shared-secret(`token`/`password` 모드)은 Bearer, **trusted-proxy 모드는 프록시 신원 헤더**
- `gateway/trusted-proxy-auth.md`: "Internal Gateway clients that do not travel through the reverse proxy should use `gateway.auth.password`". 그런데 이 비밀번호는 **local-direct password fallback**이다. loopback이면서 `X-Forwarded-*` 헤더가 없을 때만 허용된다.
- `gateway/configuration/config-rpc.md`: `config.patch` = JSON merge patch(`null`이면 삭제). 한 번 쓴 뒤로는 `baseHash`가 필수다. 배열 항목을 지우려면 `replacePaths`가 필요하다.

## 3. 설정 변경 기록

| # | 위치 | 변경 | 이유 |
|---|---|---|---|
| 1 | `openclaw plugins enable admin-http-rpc` | 플러그인 켬 | hot reload(`Plugin replacement applied`) |
| 2 | `docker-compose.yml` | `orch` 서비스(node:22-alpine, `./orch` 마운트, `GW_PASSWORD`) | orchestrator 대역. Traefik이 아닌 IP(172.30.0.3) |
| 3 | `config set gateway.auth.password {source:"env",id:"OPENCLAW_GATEWAY_PASSWORD"}` | 비밀번호 SecretRef 명시 | 원격 401 원인 확인용. **재시작 필요 키**(in-process restart) |
| 4 | 사이드카 `docker run --network container:<gateway>` | 팀 컨테이너와 네트워크 네임스페이스 공유, `127.0.0.1:18789` 호출 | loopback 비밀번호 경로 |
| 5 | `config.patch` ×6 | MCP `kacp-echo` 추가·제거, `identityScopes` carol 추가·제거 | 아래 §4 |

## 4. 항목별 결과

### ① 팀 Gateway 비밀번호로 admin-http-rpc 호출 — ⚠️ 원격은 안 됨 → 사이드카로 ✅

| 호출 위치 | 경로 | 인증 | 결과 |
|---|---|---|---|
| orch(다른 컨테이너) | `/api/v1/admin/rpc` | 비밀번호 | **401** (`auth.password` SecretRef 명시 + 재시작 후에도 401) |
| orch | `/claw/api/v1/admin/rpc` | 비밀번호 | 404 — 경로는 basePath와 무관하게 `/api/...` |
| orch | `/api/v1/admin/rpc` | 없음, 틀린 비밀번호 | 401 |
| Gateway 컨테이너 안(loopback) | `/api/v1/admin/rpc` | 비밀번호 | **200** |
| **사이드카(네임스페이스 공유, loopback)** | `/api/v1/admin/rpc` | 비밀번호 | **200** (틀린 비밀번호 401) |
| 브라우저 경로(Traefik, alice 쿠키) | `/api/…`, `/claw/api/…` | — | 404 — Traefik이 `/claw`만 Gateway로 보내서 외부에 노출되지 않는다 |

- 로그: `[secrets] gateway.auth.password is active … password auth can win`. 그래도 원격 요청은 trusted-proxy 경로로 판정돼 거부된다.
- `commands.list`(사이드카): 허용 메서드 목록이 문서와 같다.
- 결론: **orchestrator는 팀마다 붙는 사이드카(gw-agent)를 거쳐 부른다.** 사이드카가 팀 Gateway를 loopback·비밀번호로 부르고, orchestrator↔사이드카는 별도 내부 토큰으로 인증한다. 대안 A(`docker exec`로 컨테이너 안 CLI 실행)도 된다(spike 02·03에서 계속 사용). 다만 socket-proxy에 exec 권한을 줘야 해서 B(사이드카)를 권장한다.
- 설계 변경: 있음 — §5-1

### ② `config.get`으로 `mcp.servers` 조회, `config.patch`로 MCP 추가·제거 — ✅

```
config.get   → payload: {path, raw, parsed, resolved, config, hash, configRevisionHash, appliedConfigHash, …}
추가  config.patch {raw:'{"mcp":{"servers":{"kacp-echo":{"url":"http://orch:7000/mcp","transport":"streamable-http"}}}}', baseHash}
      → 200 (458ms), "config hot reload applied (mcp.servers)", config.get mcp.servers = {"kacp-echo":{…}}
제거  config.patch {raw:'{"mcp":{"servers":{"kacp-echo":null}}}', baseHash}
      → 200 (353ms), "config hot reload applied (mcp.servers.kacp-echo)", mcp.servers = {}
오래된 baseHash → 400 "config changed since last load; re-run config.get and retry"
```

- Gateway 로그에 쓰기 주체가 남는다: `config.patch write actor=gateway-client … ip=127.0.0.1 conn=plugin-http:127.0.0.1 changedPaths=…`
- `config.get` 응답(17KB)에 Gateway 비밀번호 평문은 없다. 비밀값은 SecretRef로만 표시된다.
- 설계 변경: 있음(규칙) — §5-2

### ③ `config.patch`로 `identityScopes`(팀 관리자 지정·해제) — ✅ (재시작 없음)

- 지정: `{"gateway":{"auth":{"identityScopes":{"carol@kcc.dev":["operator.admin"]}}}}` → 200, `config hot reload applied (gateway.auth.identityScopes.carol@kcc.dev)`
- 해제: 같은 경로에 `null` → **400** "would remove entries from array path(s) … Pass replacePaths". `replacePaths: ["gateway.auth.identityScopes.carol@kcc.dev"]`를 붙이면 200, hot reload
- 02에서 확인한 "해당 사람만 `4001`로 재접속" 동작은 CLI `config set`과 같은 reload 경로다.
- 설계 변경: 있음 — §5-2

### ④ 사람별 Connected Accounts 조회 — ❌ 불가

- 메서드: `users.listAuthLinks`, `users.listModelAccounts`(인자 `profileId`). HTTP 허용 목록에는 없다.
- loopback 관리자 CLI로 불러도: `FORBIDDEN — This account action requires a current authorized connection; reconnect and try again.` 본인이 지금 연결해 있는 신원으로만 읽을 수 있다(문서: 개인 계정은 "identity-scoped records").
- 시스템(공용) 모델 계정 상태는 `models.authStatus`(HTTP 허용)로 조회된다. 예: `openai` api_key `static`.
- 결론: U-14 "내 계정 연결 상태"는 **에이전트 화면(Control UI → 설정 → 프로필 → Connected accounts) 링크만** 둔다(01-screens에 미리 적어 둔 대안). `GET /teams/{team}/me/connections`는 v1에서 뺀다.
- 설계 변경: 있음 — §5-3

### ⑤ 에이전트 템플릿 `spec` ↔ openclaw.json — ✅ (문서 + 실제 워크스페이스 확인)

| `spec` | OpenClaw | 반영 방법 |
|---|---|---|
| (템플릿 id) | `agents.entries.<agentId>` | `agentId`는 안정적인 슬러그(템플릿 id 기반). `agents.create/update`(HTTP 허용) 또는 `config.patch` |
| name, icon | `agents.entries.<id>.name`, `.identity.emoji` | config.patch |
| description | 없음 | DB에만 |
| `model.id` | `agents.entries.<id>.model` = `"provider/model"` 문자열 또는 `{primary, fallbacks}` | config.patch. `spec.model.id`는 **provider 접두사 포함**으로 저장 |
| `model.reasoning` | `agents.entries.<id>.thinkingDefault` (`off\|minimal\|low\|medium\|high\|xhigh\|adaptive\|max\|ultra`) | config.patch. OpenClaw의 `reasoningDefault`는 "추론 표시 여부"라 다른 키 |
| `instructions` | **설정 키가 아니다.** 워크스페이스의 `AGENTS.md`(부트스트랩 파일, 실제 워크스페이스에 `AGENTS.md`·`SOUL.md`·`IDENTITY.md`·`USER.md` 있음) | orchestrator가 팀 워크스페이스에 파일로 쓴다 |
| `skills[]` | 스킬 = `SKILL.md`가 든 폴더. 위치: `<workspace>/skills/<name>/` 또는 `skills.load.extraDirs`. 에이전트별 허용 목록 `agents.entries.<id>.skills: [name…]` | 업로드 스킬은 플랫폼 공용 폴더(읽기 전용)를 `extraDirs`로, 허용 목록은 config.patch |
| `defaultMcp[]` | `mcp.servers.<name>`(Gateway 전체 공유) | config.patch(§4-②) |
| `tools.allow/deny` | `agents.entries.<id>.tools.{profile, allow, deny}` | config.patch |

- 설계 변경: 있음 — §5-4 (`03-data-model.md` `agent_templates` ⚠️ 해소)

### 참고: MCP 호출자 신원 단서 (→ 05)

`mcp.servers.<name>.oauth.identity: "per-requester"`: "isolate credentials for each authenticated sender". MCP가 요청자별로 다른 자격 증명을 받을 수 있다는 단서다. 05-mcp-identity에서 확인한다.

## 5. 설계 문서 변경

| # | 문서·절 | 바꾼 내용 |
|---|---|---|
| 1 | `/CLAUDE.md` 규칙, `06-auth.md` §6, `04-api.md` §3, `05-urls-and-storage.md` §6, `plan.md` | 팀 Gateway 관리 호출 = **팀별 사이드카 `kacp-gwagent-{team}`**(팀 컨테이너 네트워크 네임스페이스 공유) → `127.0.0.1:18789/api/v1/admin/rpc`, Bearer 팀 Gateway 비밀번호. orchestrator → 사이드카는 내부 토큰. 프로비저닝 시드에 `plugins.entries.admin-http-rpc.enabled: true`, `gateway.auth.password` SecretRef(재시작 필요 키라 시드에 넣는다) |
| 2 | `04-api.md` §3 | `config.patch` 규칙: get → patch(`baseHash`), 충돌(400 "config changed…")이면 다시 get. 배열 항목 삭제는 `replacePaths`. 응답에 비밀값 평문 없음 |
| 3 | `01-screens.md` U-14, `04-api.md` §2, `openapi.yaml` | Connected Accounts는 플랫폼이 조회 불가 → U-14는 Control UI 링크만, `GET /teams/{team}/me/connections` 삭제 |
| 4 | `03-data-model.md` `agent_templates`, `openapi.yaml` `AgentSpec` | §4-⑤ 대응표, `model.id`는 `provider/model` |

## 6. 남은 것

- 사이드카 ↔ orchestrator 인증 방식과 사이드카 이미지 구성은 2단계(orchestrator 뼈대)에서 정한다. 이번 spike는 "loopback이면 된다"까지만 확인했다.
- 스킬 업로드 → `extraDirs` 실제 로딩은 미검증(문서 기준)
