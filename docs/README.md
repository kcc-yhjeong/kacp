# KACP 설계 문서 — 0단계 (코드 전)

0단계의 목표는 **화면과 데이터 모델을 확정**하는 것이다. 이 문서 세트가 확정되면 1단계(기술 검증)로 넘어간다.
화면 시안은 Claude Design으로 따로 만들고, 여기서는 "어떤 화면이 있어야 하고 무엇을 하는지"만 정의한다.

## 산출물

| # | 산출물 | 파일 | 상태 |
|---|---|---|---|
| 1 | 화면 설계 (목록·설명) | `design/01-screens.md` | 초안 |
| 2 | 디자인 기준 | `design/02-design-system.md` | 초안 |
| 3 | 데이터 모델 (ERD) | `design/03-data-model.md` | 초안 |
| 4 | API 명세 초안 | `design/04-api.md`, `design/openapi.yaml` | 초안 |
| 5 | URL·도메인 규칙과 `/data` 폴더 구조 | `design/05-urls-and-storage.md` | 초안 |
| 6 | 로그인 설계 (자체 계정, SSO 자리) | `design/06-auth.md` | 초안 |
| 7 | (v2) 지식 기능 설계 초안 | `design/07-knowledge-v2.md` | v2 초안 — 0단계 통과 조건 아님 |

## 0단계 통과 조건

- [x] Claude Design으로 `01-screens.md`의 모든 화면(사원 U-*, 관리자 A-*, 공통 C-*) 시안이 나왔다 — 2026-10-01 전 화면 시안, 2026-10-02 1단계·정합성 결정 반영 수정본 검토 통과(`design/mockups/`). 2차 경미 5건도 같은 날 반영 — 시안 확정
- [x] 시안에서 새로 필요해진 데이터가 `03-data-model.md`에 반영됐다 — 2026-10-01(드라이브 사용량 API, 앱 목록 메모리, `team_agents.applied_at`, 용량 경고 2단계, 감사 action 6종, `installed_by` null=시스템, 강제 중지 사유, 프로비저닝 단계). 시안에만 있고 근거 없는 요소는 시안에서 빼도록 수정 프롬프트에 넣음
- [x] 모든 화면의 "데이터" 칸이 `04-api.md`의 엔드포인트로 연결된다(빠진 API 없음) — 2026-10-01 점검·수정(`GET /public-apps`, `DELETE /teams/{team}/drive/trash`, 공개본 `start|stop` 추가). 시안이 나오면 다시 점검
- [x] 상태값(컨테이너·앱·배포 요청·MCP 버전)이 화면·ERD·API에서 같은 이름을 쓴다(`02-design-system.md` 상태 배지 표 기준) — 2026-10-01 점검·수정(stop_reason 4종, 앱 목록 필터 값, 사원 문구, 상태도)
- [x] 권한 매트릭스(`06-auth.md`)로 모든 화면·API의 접근 주체가 설명된다 — 2026-10-01 점검·수정(에이전트 앱 권한, 팀 채팅·개인 대화, 에이전트(팀) 주체, 전사 행)
- [x] 기술 스택(`/CLAUDE.md`) 확정 — 2026-10-01(Go 플러그인 예외, orchestrator는 Engine API 직접 호출)

## 1단계 통과 조건

설계 문서(`design/*`, `plan.md`)의 `⚠️ 1단계 확인` 항목과 "1단계에서 확정"으로 적힌 항목 전부. 항목마다 담당 spike가 있다.
검증 코드는 `spikes/NN-이름/`(버리는 코드, 레포 루트), 결론은 `docs/spikes/NN-이름.md`(산출물)에 남긴다. 결론이 설계를 바꾸면 해당 문서를 고친 뒤 체크한다.
spike 목록·장소의 원본은 `plan.md` "1단계 진행 방식"이다.

| spike | 질문 | 장소 | 결과 |
|---|---|---|---|
| 01-proxy-auth | forwardAuth → trusted-proxy 신원 전달, 위조 헤더 덮어쓰기, 비멤버 403, Gateway 포트 미노출 | 로컬 | 완료 — `spikes/01-proxy-auth.md` |
| 02-session-scopes | `/claw` basePath, 팀원 간 세션 분리, 페어링 없는 접속, 팀원·팀 관리자 권한 차이 | 로컬 | 완료 — `spikes/02-session-scopes.md` |
| 03-iframe-csp | 셸에서 `/claw` iframe, 프레임 차단 헤더 재작성, WebSocket 업그레이드의 forwardAuth | 로컬 | 완료 — `spikes/03-iframe-csp.md` |
| 04-admin-rpc | Gateway 비밀번호로 `config.get`/`config.patch`, Connected Accounts 조회 | 로컬 | 완료 — `spikes/04-admin-rpc.md` |
| 05-mcp-identity | MCP 호출 시 호출자 신원이 MCP 서버에 넘어오는지 | 로컬 | 완료 — `spikes/05-mcp-identity.md` |
| 06-lifecycle | socket-proxy 경유 생성·기동·정지, 샌드박스 마운트·UID, 콜드 스타트 | GCP VM | 완료 — `spikes/06-lifecycle.md` |
| 07-domain-cert | Cloud DNS 위임, DNS-01 와일드카드 인증서 | GCP VM | 완료 — `spikes/07-domain-cert.md` |

### 01-proxy-auth (완료)

- [x] trusted-proxy 사용자 헤더 이름 → `X-Forwarded-User` (`design/06-auth.md` §5)
- [x] `x-openclaw-scopes` 값 형식 → 쉼표 구분. WS에서는 상한만, admin은 `identityScopes` (`design/06-auth.md` §5·§6)
- [x] 클라이언트 신원 헤더 제거 후 forward-auth 결과로 덮어쓰기, Gateway 포트 직접 접근 차단 (`/CLAUDE.md` 규칙, `design/05-urls-and-storage.md` §2 미들웨어)
- [x] 비멤버 403, 비로그인 → 로그인 화면 리다이렉트 (`design/06-auth.md` §5)

### 02-session-scopes (완료)

- [x] Control UI를 `/claw/`(`controlUi.basePath`) 아래에서 서빙, Traefik 라우트 맞춤 (`design/05-urls-and-storage.md` §2·§4)
- [x] 2.0 멀티플레이어에서 trusted-proxy 신원으로 팀원 간 세션이 나뉘는지 → 기본값은 안 나뉨. `gateway.roles`(`sessions.others: "write"`) + 세션 공개 범위(공유됨 = 팀 채팅, 초안 = 개인 대화)로 결정 (`design/06-auth.md` §6, `design/01-screens.md` U-01, `plan.md`, issue #104499)
- [x] `deviceAutoApprove`로 페어링 화면 없이 접속 (`design/06-auth.md` §6) — spike 01에서 확인. `/claw` 경로·역할 설정 후에도 spike 02에서 확인
- [x] 팀원은 설정(admin) 기능이 막히고 팀 관리자는 되는지(`identityScopes` + 헤더 상한, hot reload) (`design/06-auth.md` §6·§7, `plan.md` 핵심 설계 결정)

### 03-iframe-csp (완료)

- [x] 같은 팀 주소의 셸 페이지에서 `/claw` iframe 로딩 (`design/01-screens.md` U-01)
- [x] iframe 시작 경로 → `/claw/`(공유된 Main Session = 팀 채팅), 새 개인 대화는 `/claw/new` (`design/01-screens.md` U-01)
- [x] Traefik에서 `X-Frame-Options` 제거 + CSP `frame-ancestors 'none'` → `'self'` 재작성 방법 → 로컬 플러그인 — `claw-frame` (`design/05-urls-and-storage.md` §2 미들웨어)
- [x] forwardAuth가 WebSocket 업그레이드 요청에도 적용되는지 (`design/06-auth.md` §5)
- [x] MCP 앱 sandbox listener(Gateway 포트+1) → v1은 `mcp.apps.enabled: false`, 켤 때 `{team}.sbx.kacp.cloud` 안 (`design/05-urls-and-storage.md` §2)
- [x] 앱 라우터에서 `kacp_session` 쿠키만 제거 → 로컬 플러그인, forward-auth 뒤 — `strip-session-cookie` (`design/06-auth.md` §3)

### 04-admin-rpc (완료)

- [x] 팀 Gateway 비밀번호로 admin-http-rpc(`POST /api/v1/admin/rpc`) 호출 → trusted-proxy 모드에서는 loopback에서만 통함, 팀별 사이드카 `kacp-gwagent-{team}`로 (`/CLAUDE.md`, `design/06-auth.md` §6, `design/04-api.md` §3)
- [x] `config.get`으로 `mcp.servers` 조회, `config.patch`로 MCP 추가·제거 → hot reload, `baseHash` 필수 (`design/04-api.md` §3·§4, `design/03-data-model.md` `mcp_installs`)
- [x] `config.patch`로 `identityScopes`(팀 관리자 지정·해제)가 재시작 없이 반영되는지 → 됨, 해제는 `replacePaths` 필요 (`design/04-api.md` §3 `apply-config`)
- [x] 사람별 Connected Accounts 상태 조회 → **불가**(본인 연결에서만 읽힘). U-14는 Control UI 링크만, `/teams/{team}/me/connections` 삭제 (`design/01-screens.md` U-14, `design/04-api.md` §2, `openapi.yaml`)
- [x] 에이전트 템플릿 `spec` ↔ openclaw.json 설정 키 매핑, 스킬 형식 → 대응표 (`design/03-data-model.md` `agent_templates`, `openapi.yaml` `AgentSpec`)

### 05-mcp-identity (완료)

- [x] echo MCP로 alice/bob 호출 시 호출자 신원이 MCP에 넘어오는지 → **안 넘어옴**(정적 헤더 + 런타임 `_meta`뿐). `design/06-auth.md` §8 "안 넘긴다"로 확정 (`design/04-api.md` §3·§5, `design/07-knowledge-v2.md`)
- [x] 샌드박스 실행 시 요청자 식별 방식 → 플랫폼은 요청자를 모름. 샌드박스는 팀 공유 폴더만 마운트 (`design/05-urls-and-storage.md` §5)

### 06-lifecycle (GCP VM, 완료)

- [x] docker-socket-proxy 경유로 팀 컨테이너 생성·기동·정지 → bind mount, 시드, 권한 차단 확인 (`/CLAUDE.md` 규칙, `design/04-api.md` §3)
- [x] 샌드박스 전용 socket-proxy의 허용 API와 라벨 → `CONTAINERS POST EXEC IMAGES INFO VERSION ALLOW_*`, 라벨은 `openclaw.sandbox=1` + 이름 접두사(강제 불가) (`/CLAUDE.md`, `design/05-urls-and-storage.md` §6)
- [x] 샌드박스 형제 컨테이너 bind mount 경로와 UID 권한 → 워크스페이스 `/workspace` rw, uid 1000, 네트워크 없음, 루트 읽기 전용 (`design/05-urls-and-storage.md` §5)
- [x] 샌드박스가 켜진 턴에서 MCP(platform-mcp)를 쓸 수 있는지 → `tools.sandbox.tools.alsoAllow` 필요, 넣으면 됨 (`design/06-auth.md` §8)
- [x] 비정상 종료(kill) 뒤 재기동 → 같은 컨테이너 재시작 32초, 새로 만들면 lease 약 5분 (`design/04-api.md` §3 stop)
- [x] 에이전트 샌드박스 켜기 → 설정값 확정 (`design/05-urls-and-storage.md` §5, `plan.md` 코드 실행)
- [x] 팀별 UID → 가능(`XDG_CACHE_HOME`)하지만 v1은 uid 1000 하나 (`design/05-urls-and-storage.md` §5)
- [x] 콜드 스타트 5회 평균 → 콜드 25.27s·웜 25.10s, healthcheck 재정의 확정 (`design/03-data-model.md`, `design/04-api.md` §3, `design/01-screens.md` U-01)
- [x] argon2id → 64MB/t3/p1 유지, VM verify 41ms (`design/06-auth.md` §2)

### 07-domain-cert (GCP VM, 완료)

- [x] 세션 공개 접근 링크가 https에서 열리는지, forward-auth로 팀원만 열리는지 → 팀원 읽기 전용 ✅, 비멤버 403 ✅ (`design/06-auth.md` §6)
- [x] `plan.md` "도메인과 인증서" 절차: Cloud DNS 위임, A 레코드, 서비스 계정 권한, Traefik DNS-01(`gcloud`)로 `kacp.cloud` + `*.kacp.cloud` 와일드카드 인증서 (`design/05-urls-and-storage.md` §1)

### 1단계 결론 (2026-10-01, 32/32 통과)

설계를 바꾼 결과(자세한 근거는 `spikes/NN-*.md`):

| 영역 | 결론 | 반영 |
|---|---|---|
| 신원·권한 | trusted-proxy 사용자 헤더 `X-Forwarded-User`, `X-Openclaw-Scopes`는 최종 상한(항상 보냄), 팀 관리자 admin = `identityScopes` + 헤더. 지정·해제는 `config.patch`로 재시작 없이(해제는 `replacePaths`) | `design/06-auth.md` §5·§6 |
| 세션 | 기본값은 서로 다 보임 → `gateway.roles` member 하나(`sessions.others: "write"`, 상한 admin). 공유됨 = 팀 채팅, 초안 = 개인 대화. `tools.sessions.visibility: "tree"` | `design/06-auth.md` §6 |
| 셸 | `/claw` basePath, iframe 시작 `/claw/`, 프레임 헤더는 Traefik **로컬 플러그인**(전체 CSP 고정 불가), `kacp_session` 제거도 로컬 플러그인 | `design/05-urls-and-storage.md` §2 |
| 관리 호출 | trusted-proxy 모드에서 Gateway 비밀번호는 loopback에서만 통함 → 팀별 사이드카 `kacp-gwagent-{team}` | `/CLAUDE.md`, `design/06-auth.md` §6 |
| 설정 파일 | openclaw.json은 첫 기동 전에 **한 번만** 시드. 덮어쓰면 오래된 백업으로 되돌림 | `design/05-urls-and-storage.md` §5, `design/04-api.md` §3 |
| MCP 신원 | OpenClaw는 호출자 신원을 넘기지 않음 → 팀 단위 권한, 에이전트는 팀 공유 드라이브만, 작성자 "에이전트(팀)" | `design/06-auth.md` §8 |
| Connected Accounts | 플랫폼이 조회할 수 없음 → U-14는 링크만 | `design/01-screens.md` U-14 |
| 생명주기 | 기동 약 25초, 비정상 종료는 같은 컨테이너 재시작, uid 1000 하나 | `design/04-api.md` §3, `design/05-urls-and-storage.md` §5 |
| 샌드박스 | 켬(`mode: all`, `scope: session`, 네트워크 없음). 팀 전용 socket-proxy + docker CLI 넣은 Gateway 이미지. **`tools.sandbox.tools.alsoAllow: ["bundle-mcp"]` 없으면 MCP가 사라짐** | `design/05-urls-and-storage.md` §5·§6, `design/06-auth.md` §8 |
| 인증서 | 진입점에서 와일드카드 1장, 라우터에 `tls` 금지, VM 범위 `cloud-platform` | `design/05-urls-and-storage.md` §1 |
| 인프라 | n4-standard-8(서울 a에 n4d 없음), 부팅 50GB + 데이터 디스크 200GB(`/data`, Docker data-root) | `plan.md` 인프라 |

미검증으로 남긴 것(위험 낮음): 다른 Origin WebSocket의 Gateway 연결 단계 거부(03), 에이전트 세션 도구에 키를 직접 준 접근(02), 업로드 스킬의 `extraDirs` 로딩(04), 사이드카 ↔ orchestrator 인증 방식(2단계에서 정함).

1단계 대상이 아닌 `⚠️`: 샌드박스 파일 쓰기 이벤트 수집(`design/03-data-model.md` `drive_events`, 4단계), MCP egress 제한(`design/05-urls-and-storage.md` §6, 6단계).

## 2단계 통과 조건 (뼈대) — 완료 2026-10-02

목표: 데모 장면 2의 최소 경로 — **로그인 → 팀 호스트 → 팀 컨테이너 기동 → 셸 안에서 OpenClaw 팀 채팅**이 본 코드(`apps/`, `packages/`, `deploy/`)로 동작한다. 장소는 로컬(Windows Docker Desktop, `*.kacp.localhost`, http). VM 배포는 3단계 이후 한 번에 한다.

범위 밖(뒤 단계): 관리자 화면(3단계 — 2단계는 시드 스크립트로 관리자·팀·멤버를 만든다), 샌드박스·드라이브 마운트(4단계), Gateway 사이드카 `kacp-gwagent`와 `apply-config`(3단계 — 팀 관리자 지정·해제가 3단계에서 처음 생긴다. 2단계는 프로비저닝 시드의 `identityScopes`만), 앱·MCP(5·6단계).

- [x] 모노레포: pnpm workspaces, `apps/{web,api,orchestrator,proxy}`, `packages/shared`, `deploy/{openclaw-image,infra}`. `pnpm -r typecheck`·`pnpm -r test` 통과
- [x] `packages/shared`: 이름 규칙(정규식·예약어), 비밀번호 규칙, 상태값 상수, 요청 zod 스키마 + 단위 테스트
- [x] api: Drizzle 스키마·마이그레이션(`users` `auth_identities` `sessions` `login_attempts` `names` `teams` `memberships` `team_presence` `audit_events` `platform_settings`), 예약어 시드
- [x] api 인증: 로그인(argon2id, 시도 제한, 더미 해시), 로그아웃, `GET /auth/me`(csrfToken), 비밀번호 변경(`pw_setup_only`), CSRF·CORS, `GET/DELETE /me/sessions`, `GET /me/teams`
- [x] api forward-auth: 호스트 분류, 302(절대 URL)/401/403, 신원 헤더(`X-Forwarded-User`, `X-Openclaw-Scopes` 항상), 10초 캐시 + 단위 테스트
- [x] api 팀: `GET /teams/{team}`·`/status`, `POST /session`(ensure-running + presence)·`/heartbeat`, `GET /members`, `GET /names/{name}`, 내부 `POST /internal/events`. 유휴 정지 워커
- [x] orchestrator: Docker Engine API(`fetch`, socket-proxy 경유), `provision`(상태 폴더·openclaw.json 시드 한 번·Gateway 비밀번호), `ensure-running`(healthcheck 재정의, 라벨 라우트), `stop`(정상 정지), 비정상 종료 시 같은 컨테이너 재시작, owner lease 백오프. 로컬은 named volume, VM은 bind mount(`STATE_MODE`)
- [x] proxy: Traefik v3.7.13 정적·동적 설정, `strip-identity`, `kacp-auth`(forwardAuth), 로컬 플러그인 `cspframe`·`cookiestrip` 새로 작성, `fallback-web`
- [x] web: C-00 헤더, C-01 로그인, C-02 첫 비밀번호, C-03 소속 팀 없음, C-04 오류(403·404), C-05 공통(토스트·확인창), U-01 셸(준비 중·사용 가능·정리 중·문제 발생, `/claw/` iframe, "새 개인 대화"), U-14 프로필(비밀번호 변경, 로그인 세션, 팀별 "내 계정 관리" 링크). 호스트별 라우팅(app / 팀 호스트)
- [x] deploy: `kacp/openclaw` 이미지(공식 2026.9.7 + docker CLI), 로컬 `docker-compose.yml`(traefik·postgres(pgvector)·api·web·orchestrator·socket-proxy), 시드 스크립트
- [x] 데모(브라우저, 사용자가 확인): 관리자 시드 → 로그인 → C-02 → 팀 없는 사용자 C-03 → 팀원 `team1.kacp.localhost` → 준비 중 → OpenClaw 팀 채팅에서 대화 → 비멤버 403 → 로그아웃 후 팀 호스트 접근 시 로그인으로
- [x] 2단계에서 정하기로 한 것: 사이드카 ↔ orchestrator 인증 방식(3단계 구현용으로 문서에만 확정), 로그아웃 시 팀 호스트 `Clear-Site-Data`

### 2단계 결과 (2026-10-02, 로컬)

- 검사: `pnpm -r typecheck` 통과, `pnpm -r test` 40개 통과(shared 18, api 9, orchestrator 1, web 12). Traefik 로컬 플러그인 2개 로드 확인(Go 테스트는 Go가 있는 곳에서 `go test`).
- curl: 로그인·잘못된 비밀번호 401·첫 비밀번호 변경·CSRF 403·규칙 위반 400, forward-auth(비로그인 302 절대 URL / XHR 401, 비밀번호 설정 전 302 `/password/setup`, 비멤버 302 `/forbidden`·WS 403, 멤버 WS 101), 팀 컨테이너 기동 25초, `/claw/` 응답에서 `X-Frame-Options` 제거·`frame-ancestors 'self'`, Gateway 포트 호스트 미노출, 시드(trustedProxies·basePath·identityScopes) 정상, CORS(팀 호스트 허용·작업본 호스트 차단), 정상 정지 → `stopped`, 토큰 없는 내부 호출 401.
- 브라우저(사용자 확인): C-02 → C-03, 비멤버 C-04, 팀원 준비 중 → 셸 안 OpenClaw 팀 채팅, 팀 관리자 같은 채팅·모델 설정, U-14 세션·계정 관리 링크, 로그아웃 후 팀 호스트 → 로그인. 전부 통과.
- 실행: `deploy/infra/docker-compose.yml`(README 참고), 시드 `docker compose -f deploy/infra/docker-compose.yml exec api node dist/cli.js demo`.
- 3단계로 넘긴 것: Gateway 사이드카 `kacp-gwagent`와 `apply-config`, orchestrator ↔ 사이드카 네트워크 경로, VM용 compose 오버레이(bind mount·TLS).

## 3단계 통과 조건 (관리자 기본) — 완료 2026-10-02

목표: 데모 장면 1 — **관리자가 조직(부서)과 사용자를 등록하고, 팀을 만들어 에이전트를 할당한다.** 할당·팀 관리자 지정이 실행 중인 팀 Gateway에 재시작 없이 반영된다. 장소는 로컬.

범위 밖(뒤 단계): A-07·A-08(MCP, 6단계), A-09(배포 승인, 5단계), U-15 팀 설정 화면(6단계). A-05의 MCP·앱 탭과 A-01의 앱·대기 건수는 자리만(0건). 템플릿의 스킬 **업로드**와 기본 MCP 실제 설치는 6단계(3단계는 번들 스킬 이름 허용 목록과 값 저장만).

결정(문서 반영):
- Gateway 사이드카 `kacp-gwagent-{team}`: orchestrator 이미지를 `node dist/gwagent.js`로 실행, 팀 컨테이너 네트워크 네임스페이스 공유, `:18800`에서 `config.get`·`config.patch`만 중계. orchestrator가 사이드카에 닿도록 **orchestrator를 `kacp-edge`에도 붙이되, `kacp-edge`로 들어오는 요청은 거부**한다(내부 API는 `kacp-core`로만). 팀 컨테이너가 새로 시작될 때마다 사이드카를 다시 만든다(네임스페이스가 바뀜, 상태 없음).
- 공용 모델 API 키(A-10)는 팀 컨테이너 **환경변수**로 넣는다. 키가 바뀌면 컨테이너 라벨 `kacp.config-hash`가 달라져 다음 기동 때(정지 상태에서) 컨테이너를 다시 만든다. 실행 중인 팀은 관리자가 재시작해야 반영.
- 사용량: orchestrator가 1분마다 팀 컨테이너 Docker stats + VM(CPU·메모리·`/data` 디스크)을 `POST api:/internal/usage`로 보낸다 → `usage_samples`.
- 팀 삭제(로컬): socket-proxy가 볼륨 API를 막아 named volume은 남는다(VM은 bind 폴더를 백업으로 이동).

- [x] api 스키마: `departments`(ltree), `import_jobs`, `agent_templates`, `team_agents`, `usage_samples`, `teams.provision_stage`. 플랫폼 설정 전 항목
- [x] api 조직: `GET /departments`(트리·인원 수), 부서 추가·수정·이동(순환·깊이 10 검사)·보관/해제, 구성원, `POST /admin/users/bulk-department`
- [x] api 사용자: 목록(필터: 부서 하위 포함·역할·상태·팀·검색), 추가(초기 비밀번호 1회), 상세(최근 로그인), 수정, 비밀번호 초기화(세션 전부 폐기), 비활성화(세션 폐기 + presence 제거 + 선택: 소속 팀 재시작)/재활성화, `GET /users/search`
- [x] api 가져오기: 부서·사용자 CSV 미리보기(추가/변경/그대로/오류, 순환·깊이·없는 상위·중복) → 적용(오류 행 빼기, 409 재미리보기), 새 계정 초기 비밀번호 CSV 1회
- [x] api 팀: 목록·생성(`POST /admin/teams` 202 + 진행 단계)·상세·표시 이름·삭제, 컨테이너 시작·정지·재시작, 리소스 한도(실행 중이면 즉시), 멤버 추가·역할 변경·제거(마지막 팀 관리자 보호), `GET /names/check`
- [x] api 에이전트: 템플릿 CRUD(저장 시 version+1, 할당 팀 pending), 할당·해제 → apply-config, 할당 반영 워커
- [x] api 설정·기록: `GET|PUT /admin/settings`, API 키(암호화, 설정 여부만 반환), `GET /admin/audit-events`(필터), `GET /admin/dashboard`, `GET /admin/metrics`. 모든 관리 행위 `audit_events`
- [x] orchestrator: 사이드카 생성·재생성, `/internal/gateway/{team}/rpc`, `apply-config`(agents.entries + 워크스페이스 `AGENTS.md` + `identityScopes`, `baseHash`·`replacePaths` 규칙), `restart`, 리소스 `docker update`, 팀 삭제, 프로비저닝 단계 이벤트, 사용량 수집
- [x] web: `/admin` 레이아웃(AdminSidebar), A-01·A-02·A-03·A-04·A-05(멤버·에이전트 할당·리소스·위험 영역 탭)·A-06·A-10·A-11·A-12·A-13. 헤더 "관리자 화면" 연결
- [x] 테스트: 부서 이동 순환·깊이, CSV 파서·미리보기 판정, apply-config 패치 계산(추가·변경·제거, replacePaths)
- [x] 데모(브라우저, 사용자가 확인): 부서 트리 만들기·이동 → 사용자 CSV 가져오기 → 팀 만들기(진행 표시) → 템플릿 만들고 할당 → 셸에서 새 에이전트 보임·지시문 반영 → 팀원을 팀 관리자로 지정 → 그 사람 Control UI에 설정(admin) 열림(재시작 없이) → 리소스 변경·재시작 → 사용자 비활성화 → 로그인 거부 → 활동 기록에 전부 남음

### 3단계 결과 (2026-10-02, 로컬)

- 검사: `pnpm -r typecheck` 통과, `pnpm -r test` 87개 통과(shared 18, api 23, orchestrator 6, web 40).
- api 스크립트 확인: 부서 추가·자동 코드·이동·순환 422·보관 409, CSV 미리보기·오류 행 422·오류 빼고 적용·초기 비밀번호 CSV 1회, 사용자 목록·필터·검색·추가·중복 409·초기화·비활성화(로그인 403)·재활성화, 템플릿 생성·허용 안 된 모델 422·할당, 팀 생성(진행 단계 done)·리소스·삭제(확인 이름), 대시보드·추이·활동 기록.
- Gateway 반영: 할당 → `agents.entries.kacp-*` + `workspace-<id>/AGENTS.md`, 팀 관리자 지정·해제 → `identityScopes` 추가·제거. 둘 다 사이드카 경유 `config.patch`, **hot reload(재시작 없음)**.
- 브라우저(사용자 확인): A-01·A-02·A-03·A-04·A-05·A-06·A-10·A-11·A-12·A-13, 새 에이전트 선택·지시문, 팀 관리자 지정 후 설정 열림. 전부 통과.
- 확인 중 고친 것: 관리자 시작 직후 유휴 정지(시작 시 `last_active_at` 갱신), 비활성 계정 로그인을 실패로 기록, `default: true` 마커 미사용(2026.9.7 레거시 — 기본 에이전트는 `main`).
- 4단계 이후로 넘긴 것: 템플릿 스킬 업로드·기본 MCP 설치(6단계), A-05 MCP·앱 탭(5·6단계), VM용 compose 오버레이.

## 4단계 통과 조건 (드라이브)

목표: 데모 장면 3의 앞부분 — **결과물이 드라이브에 쌓인다.** 사원은 웹에서 내 드라이브·팀 공유를 쓰고, 팀 에이전트는 팀 공유 드라이브를 자기 폴더처럼 쓴다. 장소는 로컬, 샌드박스만 VM.

범위 밖: platform-mcp 드라이브 도구(`drive_list`·`read`·`write`, 5단계 platform-mcp와 함께), 앱 실행(5단계).

결정(문서 반영):
- **파일 위치**: `/data/teams/{team}/drive/{shared|personal/u{uid}}`, 휴지통 `/data/teams/{team}/.trash/{id}`. 로컬은 named volume `kacp-data`(api·orchestrator가 `/data`로 마운트), VM은 bind `/data`.
- **에이전트가 보는 곳**: 팀 공유 드라이브를 팀 컨테이너에 두 번 붙인다 — `/team-drive`(모든 에이전트 공통 경로)와 `main` 워크스페이스 안 `team-drive/`(기본 에이전트가 폴더로 바로 봄). 플랫폼 지시문("팀 드라이브·공유 드라이브·팀 공유 = `/team-drive`, 내 드라이브는 에이전트가 볼 수 없음")을 템플릿 에이전트 AGENTS.md 앞과 **기본 에이전트 `main`의 AGENTS.md 맨 위 표식 블록**(`<!-- KACP:BEGIN -->`…`<!-- KACP:END -->`, 기동마다 갱신, OpenClaw 기본 내용은 그대로)에 넣는다 — 브라우저 확인에서 `main`이 "팀 드라이브"를 못 알아들어 추가. 개인 드라이브는 붙이지 않는다(spike 05).
- **샌드박스(VM만)**: 원본이 bind mount여야 샌드박스로 비춰진다(OpenClaw docker-backend 문서). 그래서 `STATE_MODE=bind`에서만 켠다 — `agents.defaults.sandbox`(`05` §5 값) + `docker.binds: ["/data/teams/{team}/drive/shared:/team-drive:rw"]` + `dangerouslyAllowExternalBindSources: true`, 팀별 sandbox socket-proxy·네트워크. 로컬(volume)은 샌드박스 끔.
- **소유권**: 팀 공유는 `1000:{teams.linux_gid}`, 폴더 `2770`·파일 `0660`(OpenClaw uid 1000이 쓰고 api(root)가 읽음). 개인은 `{users.linux_uid}` `0700`.
- **⚠️ 해소 — 샌드박스·에이전트가 직접 쓴 파일 기록**: 감시(inotify) 대신 **지연 조정**. api가 `list`·`meta` 때 팀 공유 폴더에서 이벤트가 없는 파일에 `create`(actor `agent`), 마지막 이벤트보다 mtime이 새로운 파일에 `update`(actor `agent`)를 만든다. API를 거친 변경은 그 자리에서 `user` 이벤트로 남는다.
- **경로 안전**: `..`·NUL·절대 경로 거부, 모든 접근은 `realpath`가 공간 루트 안일 때만, 심볼릭 링크는 따라가지 않는다(에이전트가 만든 링크로 api 컨테이너 파일을 읽는 것 방지).
- **이동·이름 변경**: 그 경로(와 하위)의 기존 `drive_events.path`도 새 경로로 옮겨 "만든 사람"·변경 기록이 파일을 따라간다.

- [ ] 문서: 위 결정을 `03`(drive_events 조정 규칙), `05`(§5 마운트·소유권), `04`(드라이브 API 세부)에 반영, ⚠️ 해소
- [ ] api: 경로 검사·realpath 가드, `list`·`search`·`meta`·`download`(파일 스트리밍·폴더 zip, 미리보기 inline)·`download-zip`·`usage`(1분 캐시)·`upload`(multipart 스트리밍, 파일당 500MB, 같은 이름 `(1)`, 한도 초과 413)·`folder`·`rename`·`move`·`copy`(공간 간 허용)·`trash`·휴지통 목록·복원(충돌 시 이름 변경)·영구 삭제·비우기(권한 규칙), `drive_events`·`trash_items`, 휴지통 정리 워커(보관 일수)
- [ ] api 권한: `space=me`는 본인만(팀 관리자·플랫폼 관리자도 불가), 휴지통 영구 삭제는 지운 사람·팀 관리자(팀 공유), 팀 공유는 멤버
- [ ] orchestrator: 프로비저닝 때 드라이브 폴더·소유권, 팀 컨테이너에 팀 공유 드라이브 두 곳 마운트(volume subpath / bind), 설정 해시에 마운트 포함(다음 기동 때 재생성), 템플릿 지시문에 `/team-drive`
- [ ] web: U-04(트리·목록/격자·브레드크럼·검색·업로드 진행 패널·드래그 앤 드롭·새 폴더·여러 개 선택 다운로드·이동·복사·휴지통·행 메뉴·미리보기), U-05(상세·변경 기록·에이전트 배지), U-06(휴지통·복원·영구 삭제·비우기), 헤더 "드라이브" 연결
- [ ] 테스트: 경로 검사(`..`, 심볼릭 링크 탈출, 공간 밖), 이름 충돌 `(1)`, 지연 조정 판정, 휴지통 권한
- [ ] 데모(브라우저, 사용자 확인): 업로드(여러 파일·폴더) → 미리보기 → 이름 변경·이동(공간 간) → 셸에서 에이전트에게 "team-drive에 보고서.md 만들어줘" → 드라이브에 "에이전트 · 팀" 배지로 보임 → 휴지통 → 복원 → 영구 삭제, 다른 팀원이 내 드라이브를 못 봄, 한도 초과 안내
- [ ] VM(사용자가 VM을 켠 뒤): VM compose 오버레이(bind `/data`, TLS, `STATE_MODE=bind`) + 샌드박스 켜고 에이전트 명령이 샌드박스에서 돌며 `/team-drive`에 쓴 파일이 드라이브에 보임

## 다음 단계와의 연결

| 단계 | 이 문서 세트에서 쓰는 부분 |
|---|---|
| 1 기술 검증 | `05` 도메인·인증서, `06` forward-auth·헤더, `⚠️ 1단계 확인` 항목 전부 |
| 2 뼈대 | `03` users·teams·memberships·sessions, `04` 인증·팀 API, `01` C-00~C-05·U-01·U-14 |
| 3 관리자 기본 | `01` §2-2·A-01~A-06·A-10~A-13, `03` departments·import_jobs·agent_templates·team_agents·audit_events, `04` admin·조직 API |
| 4 드라이브 | `01` U-04~U-06, `03` drive_events·trash_items, `05` `/data/teams` |
| 5 앱 배포 | `01` §2-1·U-02·U-03·U-07·U-08·A-09, `03` apps·deploy_requests·app_versions, `05` 앱 라우트·데이터 폴더 |
| 6 MCP 마켓 | `01` U-09~U-12·U-15·A-07·A-08, `03` mcp_*, `04` MCP API |
| 7 마감 | `01` U-13·C-06, `03` posts·notifications |

## v2 로드맵

- **지식 기능**: 사내 문서(PPT·XLSX·DOCX·PDF) 등록 → 메타데이터 → 임베딩(pgvector) → 에이전트가 platform-mcp `knowledge_search`로 권한 필터된 검색. 설계 초안 `design/07-knowledge-v2.md`
- v1에서 지켜둘 것: `04-api.md` §6

## 용어집

| 용어 | 뜻 |
|---|---|
| 플랫폼 관리자 | `users.platform_role = admin`. `/admin` 전체, Public 승인, MCP 심사 |
| 부서 (조직) | 실제 사내 소속. 트리 구조, 한 사람은 부서 하나. v1은 표시·검색·일괄 추가용, v2 지식 권한 단위 |
| 팀 관리자 | `memberships.team_role = team_admin`. 자기 팀의 멤버·MCP 설치·직접 추가 MCP |
| 팀원 | `memberships.team_role = member` |
| 팀 컨테이너 | 팀당 하나. OpenClaw 2.0 Gateway를 멀티플레이어 모드로 실행 |
| 에이전트 템플릿 | 관리자가 만드는 에이전트 정의(모델, 지시문, 스킬, 기본 MCP, 도구 권한) |
| 에이전트 할당 | 템플릿을 팀에 붙이는 것. orchestrator가 팀 `openclaw.json`에 반영 |
| 에이전트 셸 | `팀.kacp.cloud`에서 플랫폼 헤더 + 앱 막대 + Control UI iframe으로 구성된 화면 |
| 앱 막대 | 에이전트 셸 헤더 아래 띠. 이 팀 앱의 작업본 미리보기·공개 설정 진입 |
| 드라이브 | 팀별 파일 공간. 내 드라이브(개인) + 팀 공유 |
| 앱 | 에이전트가 `run_app`으로 띄운 웹 앱. 작업본과 (공개되면) 공개본 두 사본을 가짐 |
| 작업본 (Private) | `앱--팀.kacp.cloud`, 팀원만. 원본 폴더 그대로, 고치면 바로 반영 |
| 공개본 (Public) | `앱.kacp.cloud`, 로그인한 전 사원. 승인 시점 스냅샷(v1, v2…), 업데이트 요청·승인으로만 갱신 |
| 잠듦 | 유휴 정지된 앱 사본. 누가 주소로 접속하면 자동으로 깨어남 |
| platform-mcp | 모든 팀에 기본 설치되는 플랫폼 MCP (run_app, deploy_app, 드라이브 도구) |
| 마켓 MCP | 개발자가 업로드·심사를 거쳐 게시한 MCP. 팀별 MCP 컨테이너로 실행 |
| 직접 추가 MCP | 팀 관리자가 마켓을 거치지 않고 추가한 MCP. "검토되지 않음" 표시 |
| 네임스페이스 | 팀 이름과 Public 앱 이름이 공유하는 1단계 서브도메인 이름 공간 |
| 유휴 정지 | 팀 접속자가 일정 시간 없으면 orchestrator가 팀 컨테이너를 정지 |
