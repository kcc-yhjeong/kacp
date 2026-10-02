# Spike 05 — MCP 호출 시 호출자 신원 전달

- 날짜: 2026-10-01
- 환경: Windows 11 + Docker Desktop(WSL2 백엔드), Chrome(alice 일반 창, bob 시크릿 창), 모델 `gpt-5.4-nano`(Control UI에서 등록된 OpenAI 키)
- 검증 코드: `spikes/04-admin-rpc/orch/echo-mcp.mjs`(spike 04 환경 재사용, orch 컨테이너에서 실행)
- 결론: **OpenClaw는 MCP 호출에 호출한 사람의 신원을 넘기지 않는다.** `06-auth.md` §8의 "안 넘긴다" 갈래로 확정하고, 안전한 쪽(팀 단위 권한, 팀 공유 드라이브만)으로 설계를 바꿨다.

## 1. 사용한 이미지

| 구성 | 이미지 | 버전 |
|---|---|---|
| OpenClaw | `ghcr.io/openclaw/openclaw:2026.9.7` | `OpenClaw 2026.9.7 (c074824)`. 에이전트 런타임은 Codex 하네스(`codex-mcp-client/0.158.0`) |
| echo MCP | `node:22-alpine` + 의존성 없는 스크립트 | streamable-http, JSON 응답 |

## 2. 문서 확인 (이미지 안 `/app/docs`)

- `gateway/config-extensions.md`의 `mcp.servers.<name>.oauth.identity`: `"shared"`(기본) | **`"per-requester"`** — "isolate credentials for each authenticated sender".
  - 요구 조건: HTTP MCP, `auth: "oauth"`, `gateway.publicOrigin` 콜백. 사람마다 MCP별 OAuth 연결(`openclaw mcp login`/UI)을 거쳐야 한다.
  - 사람별 신원을 MCP에 넘기는 **유일한 문서상 방법**이다. 그러려면 KACP api가 OAuth 인가 서버 역할을 해야 해서 v1 범위 밖이다.
- 정적 `headers`(예: `Authorization: Bearer ${…}`)는 서버 정의 단위다. 사람별로 달라지지 않는다.
- 그 밖에 호출자 신원을 헤더나 `_meta`로 전달한다는 설명은 없다.

## 3. 설정 변경 기록

| # | 위치 | 변경 | 이유 |
|---|---|---|---|
| 1 | `orch/echo-mcp.mjs` | 헤더 전부 + `params._meta`를 로그로 남기는 echo MCP(`kacp_whoami` 도구) | 무엇이 넘어오는지 직접 확인 |
| 2 | 사이드카 `config.patch` | `mcp.servers.kacp-echo = {url: "http://orch:7000/mcp", transport: "streamable-http", headers: {Authorization: "Bearer team1-mcp-service-token"}}` | 팀 MCP 서비스 토큰 흉내(06-auth §8). hot reload |

## 4. 결과

방법: alice·bob이 각자 자기 새 세션에서 "kacp_whoami 도구를 note "… 테스트"로 호출"을 보냈다.

| MCP가 받은 것 | alice 호출 | bob 호출 |
|---|---|---|
| `authorization` | `Bearer team1-mcp-service-token` | 같음 |
| `user-agent` | `codex-mcp-client/0.158.0` | 같음 |
| 기타 헤더 | `mcp-protocol-version`, `mcp-session-id`, `accept`, `content-type`, `host` | 같음 |
| `arguments` | `{"note":"alice 테스트"}` | `{"note":"bob 테스트"}` |
| `_meta` | `callId`, `progressToken`, `x-codex-turn-metadata{session_id, thread_id, turn_id, model, reasoning_effort, sandbox:"none", sandbox_mode:"danger-full-access", workspaces, turn_trigger:"user", …}`, `threadId`, `sessionId`, `windowId`, `itemId` | 같은 키, 다른 id |
| **사람 정보(이메일, profile id, 이름)** | **없음** | **없음** |

- `_meta.sessionId`/`threadId`는 Codex 런타임의 스레드 id다(`01a0f59f-…`). OpenClaw 세션 키(`agent:main:dashboard:…`)와는 형식이 다르다.
- 세션에서 사람을 역추적하는 방법도 안 된다. 팀 채팅(공유됨) 세션은 여러 사람이 함께 쓰고, 세션 조회 RPC(`sessions.*`)는 admin-http-rpc 허용 목록에 없다(spike 04).
- Gateway 쪽 MCP 연결(`undici`, `initialize`)과 세션 런타임 연결(`codex-mcp-client`)이 따로 생긴다. 모두 같은 정적 헤더다.
- 도구 인자(`note`)는 모델이 정한다. 사람이 "내 이메일은 alice@…"라고 쓰면 그대로 인자에 실릴 수 있으므로, **인자 속 신원은 위조 가능하다.**

### 함께 발견한 것

- `x-codex-turn-metadata.sandbox_mode: "danger-full-access"`, `sandbox: "none"` — **현재 에이전트가 샌드박스 없이 Gateway 컨테이너 안에서 실행된다.** 기본 설정 그대로다. 06-lifecycle에서 샌드박스 설정(`agents.defaults.sandbox`, 역할 `sandbox: "required"`)과 함께 다룬다.
- 역할의 `sandbox: "required"`는 "세션을 만든 사람별로 샌드박스 환경·워크스페이스를 분리"한다(OpenClaw `operator-scopes` 문서, spike 02). 이것은 OpenClaw 내부의 분리다. 플랫폼(MCP·api)이 그 사람이 누구인지 알게 해 주지는 않는다.

## 5. 결정 (안전한 쪽으로)

원칙: **위조 가능한 신원 경로를 만들지 않는다.** 플랫폼이 모르는 "요청한 사람"을 추측하지 않는다.

1. platform-mcp → api 인증은 **팀 MCP 서비스 토큰만**. api는 "어느 팀"까지만 안다. `X-KACP-Acting-User` 같은 헤더나 도구 인자의 이메일은 받지 않는다(받아도 무시).
2. 에이전트 드라이브 도구(`drive_*`)와 `run_app`의 대상은 **팀 공유 드라이브만**이다. 에이전트는 사람별 "내 드라이브"에 닿지 않는다. 사람이 자기 파일을 에이전트에게 쓰게 하려면 공유 드라이브로 옮긴다.
3. 에이전트가 만든 파일·앱의 작성자는 **"에이전트(팀)"**이다(`actor_kind=agent`, 사람 id는 null). 화면 배지는 "에이전트 · 팀"이다.
4. 에이전트가 만든 앱(`creator_id = null`) 권한:
   - 작업본·공개본 시작·중지: 팀원 누구나
   - 공개·업데이트 요청: UI에서 누른 팀원이 요청자. 에이전트 `deploy_app`이면 요청자 = "에이전트(팀)"이고, 승인은 그대로 플랫폼 관리자
   - 삭제·공개 중지: 팀 관리자
5. 샌드박스 마운트는 **팀 공유 폴더만**(요청자 개인 폴더 마운트 안은 폐기). 실제 마운트 경로·UID는 06-lifecycle에서 확인한다.
6. 나중에 사람별 신원이 꼭 필요해지면(v2) `oauth.identity: "per-requester"` + KACP api를 OAuth 인가 서버로 만드는 안을 검토한다.

## 6. 설계 문서 변경

| # | 문서·절 | 바꾼 내용 |
|---|---|---|
| 1 | `06-auth.md` §8 | ⚠️ 해소. "안 넘긴다"로 확정, §5 결정 1·6 |
| 2 | `06-auth.md` §7 권한 매트릭스 | 에이전트가 만든 앱 규칙(§5-4), 에이전트는 내 드라이브에 접근하지 않음 |
| 3 | `04-api.md` §3·§5 | platform-mcp 인증 = 팀 서비스 토큰만. `drive_*`의 `space`는 `shared` 고정, `run_app` 폴더도 공유 드라이브 |
| 4 | `03-data-model.md` `drive_events`, `apps` | `actor_user_id`(agent면 null), `apps.creator_id` nullable(null = 에이전트(팀)), `source_space`는 run_app이면 `shared` |
| 5 | `01-screens.md` 드라이브 상세, `02-design-system.md` `ActorBadge` | 배지 "에이전트 · 홍길동 요청" → "에이전트 · 팀" |
| 6 | `05-urls-and-storage.md` §5 마운트 규칙, `plan.md` | 샌드박스·앱 컨테이너 = 팀 공유 폴더만. "요청자 폴더" 표현 삭제 |
| 7 | `docs/README.md` | 06에 "에이전트가 샌드박스 없이 실행됨(danger-full-access)" 항목 추가 |
