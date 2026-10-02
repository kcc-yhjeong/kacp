# Spike 01 — Traefik forwardAuth + OpenClaw trusted-proxy

- 날짜: 2026-09-30
- 환경: Windows 11 + Docker Desktop (Engine 29.7.2, Compose v5.4.0), 브라우저 Chrome
- 검증 코드: `spikes/01-proxy-auth/` (버리는 코드. 이 문서가 산출물)
- 결론: **1번 완료 기준 6개 모두 통과.** 설계 변경 항목(§4)은 2026-09-30 설계 문서에 반영함.

## 1. 사용한 이미지

| 구성 | 이미지 | 정확한 버전 |
|---|---|---|
| OpenClaw | `ghcr.io/openclaw/openclaw:2026.9.7` | `OpenClaw 2026.9.7 (c074824)`, digest `sha256:0da12cd49983fcb5e4915fd3135ce7a33d82f93649b1df6964946d2c1d1dbcfc`, 베이스 `node:24-bookworm-slim`, 실행 사용자 `node`(uid 1000) |
| Traefik | `traefik:v3.7.13` | 3.7.13 (langres) |
| fake-auth | `node:22-alpine` | — |
| whoami | `traefik/whoami` | — |
| 설정 시드 | `busybox:1.36` | — |

검증 당시 `latest`는 2026.9.7이었다. `.env`의 `OPENCLAW_IMAGE`와 compose의 Traefik 태그를 이 버전으로 고정했다.

## 2. 설정 변경 기록

| # | 파일 | 변경 | 이유 |
|---|---|---|---|
| 1 | `docker-compose.yml` | `./data/team1` bind mount 대신 named volume `team1-state`를 쓰고, `openclaw-team1-init`(busybox)이 `openclaw/openclaw.json`을 복사한 뒤 `chown 1000:1000` | 엔트리포인트의 `openclaw doctor`가 설정을 다시 쓰다가 `EPERM: operation not permitted, fchmod`로 컨테이너가 종료됨. Windows 호스트 폴더 bind mount는 chmod를 지원하지 않는다. Linux VM에서는 bind mount + 소유자 1000이면 문제없을 것으로 본다(미검증) |
| 2 | `docker-compose.yml` | `openclaw-team1`에 healthcheck 재정의: 테스트는 이미지와 같은 `node dist/docker-healthcheck.js`, `interval 30s`, `start_interval 5s`, `start_period 60s` | 이미지 기본값이 `interval 180s`. 부팅 중(state maintenance) 체크가 실패하면 다음 체크까지 3분 동안 `starting`에 머문다 |
| 3 | `fake-auth/server.js` | 로그인 302의 `Location`을 `${X-Forwarded-Proto}://${X-Forwarded-Host}/_kacp/login?...` 절대 URL로 | Traefik forwardAuth는 인증 서버가 준 상대 `Location`을 **인증 서버 주소 기준으로** 절대화한다. 브라우저가 `http://fake-auth:4000/_kacp/login`으로 이동해 버렸다 |
| 4 | `docker-compose.yml`, `.env` | `traefik:v3` → `traefik:v3.7.13`, `OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.9.7` | 재현성 확보. 이미지가 같아 동작 변화 없음 |

`openclaw/openclaw.json`(trusted-proxy 설정)은 **바꾸지 않았다.** OpenClaw 소스도 건드리지 않았고, `OPENCLAW_GATEWAY_TOKEN`도 쓰지 않았다(`OPENCLAW_GATEWAY_PASSWORD`만 설정).

## 3. 항목별 결과

### ① `docker compose ps`: 4개 running, openclaw-team1 healthy — ✅

- 방법: `docker compose ps -a`
- 결과: traefik, fake-auth, whoami, openclaw-team1 모두 `Up`, openclaw-team1은 `(healthy)`. 추가한 `openclaw-team1-init`은 `Exited (0)`인데 의도된 것이다. 변경 #2 이후 기동부터 healthy까지 약 30초.
- 컨테이너 안 `GET 127.0.0.1:18789/healthz` → `200 {"ok":true,"status":"live"}`
- 설계 변경: 있음(§4-5, healthcheck 주기)

### ② 비로그인 접근 → 로그인 화면 리다이렉트 — ✅ (fake-auth 수정 후)

- 방법: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://team1.kacp.localhost/some/path?x=1`
- 결과: `302 http://team1.kacp.localhost/_kacp/login?rd=%2Fsome%2Fpath%3Fx%3D1`. 로그인 후 `302 → http://team1.kacp.localhost/`
- 수정 전: `302 http://fake-auth:4000/_kacp/login?rd=%2F` (변경 #3)
- 설계 변경: 06-auth §5에 한 줄 추가(§4-3). 설계는 이미 절대 URL(`https://app.kacp.cloud/login?next=`)이라 동작은 바뀌지 않는다

### ③ alice → Control UI가 뜨고 페어링 화면 없이 연결 — ✅ (브라우저, 사용자 확인)

- 방법: 일반 창에서 `http://team1.kacp.localhost/` → alice 선택
- 결과: Control UI가 로딩되고 페어링 화면 없이 연결됐다. 설정 > 모델 설정(admin 화면)도 열린다.
- Gateway 로그:
  ```
  security audit: trusted-proxy operator device auto-approved user=alice@kcc.dev device=1a6a3b5cfbd7 scopes=operator.approvals,operator.questions,operator.read,operator.write
  security audit: identity scope grant elevated connection identity=alice@kcc.dev addedScopes=operator.admin conn=b21e333b-…
  [ws] authenticated user connected conn=b21e333b-… user=alice@kcc.dev
  [ws] webchat connected … remote=172.30.0.10 client=openclaw-control-ui webchat v2026.9.7
  [ws] ⇄ res ✓ config.get …
  ```
- `openclaw devices list`: alice 기기의 **영구 권한에는 admin이 없다**(approvals, questions, read, write). admin은 `identityScopes`로 연결 단위에만 붙는다. 설계 의도와 같다.
- 설계 변경: 있음(§4-1, 06-auth §6 `deviceAutoApprove` ⚠️ 해소)

### ④ 시크릿 창 bob 접속, carol 403 — ✅ (브라우저 + curl)

- 브라우저: bob은 페어링 화면 없이 `/chat/main`으로 연결됐다. 온라인 목록에 alice와 bob이 함께 보인다. carol은 "carol@kcc.dev 은(는) team1 멤버가 아닙니다" 화면이 나왔다.
- curl: `-b kacp_dev_user=carol` → `403`, bob·alice → `200 text/html`
- Gateway 로그: bob 기기가 기본 4개 scope로 자동 승인됐고, bob 연결에는 `identity scope grant` 로그가 **없다**(admin 미부여).
- 관찰: 같은 시크릿 창에서 bob → carol로 바꾼 뒤에도 브라우저가 `/sw.js`, `/api/users/…/avatar`를 요청했다. bob 세션에서 등록된 Control UI service worker가 보낸 요청이고, forward-auth가 모두 403으로 막아 데이터는 새지 않았다. §4-6 참고.

### ⑤ 위조 헤더 덮어쓰기 — ✅

- 방법:
  ```
  curl -s -H 'X-Forwarded-User: evil@x' -H 'X-Openclaw-Scopes: operator.admin' -H 'X-Kacp-User: evil' \
       -b kacp_dev_user=bob http://team1.kacp.localhost/_debug/
  ```
- 결과(whoami 응답 일부):
  ```
  RemoteAddr: 172.30.0.10:34806
  X-Forwarded-User: bob@kcc.dev
  X-Openclaw-Scopes: operator.read,operator.write,operator.approvals,operator.questions
  X-Forwarded-For: 172.30.0.1
  ```
  `X-Kacp-User`는 제거됐다. 쿠키 없이 `X-Forwarded-User: alice@kcc.dev`만 보내면 `302` 로그인 화면으로 간다.
- 설계 변경: 없음

### ⑥ 직접 접근 불가(18789 미노출) — ✅

- 방법·결과:
  - `netstat -ano | grep LISTENING`: 18789·18790 없음
  - `docker port kacp-spike-openclaw-team1-1`: 매핑 없음
  - `curl http://127.0.0.1:18789/`: 연결 실패(exit 7)
- 추가 확인: 같은 `kacp-edge` 네트워크의 Traefik이 아닌 컨테이너(fake-auth, 172.30.0.3)에서 `x-forwarded-user: alice@kcc.dev`로 Gateway에 직접 요청 → `403 proxy_attribution_required`. Gateway 로그: `observed unattributable proxy-shaped traffic from 172.30.0.3`. 같은 네트워크 안에서도 `trustedProxies`가 막아 준다.
- 설계 변경: 없음

### 참고: `openclaw security audit`

`1 critical · 2 warn`. 모두 이 구성에서 예상한 것이다.

- CRITICAL `gateway.trusted_proxy_auth`: trusted-proxy 모드 자체 경고. README에 적힌 대로 의도된 것이다.
- WARN `trusted_proxy_device_auto_approve`: deviceAutoApprove 사용
- WARN `trusted_proxy_no_allowlist`: `allowUsers`가 비어 있음. §4-4 참고.

## 4. 설계 문서 변경 필요

2026-09-30 전부 반영했다. #4(`allowUsers` 비움)는 권장안으로 반영했다. 남은 미검증 항목은 `docs/README.md` "1단계 통과 조건"에 담당 spike와 함께 옮겼다(#7 → 04-admin-rpc, #8 → 03-iframe-csp, #9 → 06-lifecycle).

| # | 문서·절 | 현재 | 바꿀 내용 |
|---|---|---|---|
| 1 | `06-auth.md` §5 응답 헤더 표, §6 | 사용자 헤더 이름 ⚠️, `deviceAutoApprove` ⚠️ | 사용자 헤더 = **`X-Forwarded-User`**(`gateway.auth.trustedProxy.userHeader: "x-forwarded-user"`). `deviceAutoApprove.enabled: true`로 페어링 화면 없이 접속되는 것을 확인했다. ⚠️ 두 개 제거 |
| 2 | `06-auth.md` §5 `x-openclaw-scopes` 행, §6, §7 | 팀원 `operator.read,operator.write` / 팀 관리자 `+operator.admin` ⚠️ 형식 | ① 형식: **쉼표 구분, 공백 trim**(이미지 안 `http-auth-utils`에서 `split(",")` 확인). ② **WebSocket에서 이 헤더는 상한(cap)일 뿐 권한을 주지 않는다.** admin은 openclaw.json의 `gateway.auth.identityScopes`(`{"이메일": ["operator.admin"]}`)로만 붙는다. 따라서 팀 관리자 목록을 openclaw.json에 반영해야 한다(→ #7). ③ 팀원 값은 `operator.read,operator.write,operator.approvals,operator.questions`로 바꿀 것을 권장한다. deviceAutoApprove 기본 scope와 맞추는 것이고, 빠지면 팀원이 실행 승인·질문에 답하지 못할 가능성이 있다(미검증). ④ **헤더를 절대 생략하지 않는다.** 헤더가 없으면 HTTP 경로에서 CLI 기본 scope가 적용된다(`headerValue === undefined → CLI_DEFAULT_OPERATOR_SCOPES`) |
| 3 | `06-auth.md` §5 판단 순서 3 | 302 대상이 이미 절대 URL | "Location은 반드시 절대 URL. Traefik forwardAuth가 상대 경로를 인증 서버 주소 기준으로 바꾼다" 한 줄 추가 |
| 4 | `06-auth.md` §6 | `allowUsers` 언급 없음 | 결정 필요. 권장: v1은 `allowUsers`를 비워 둔다. forward-auth가 멤버십을 막고 `trustedProxies`가 우회를 막는 것을 확인했고, 멤버 변경마다 설정을 다시 불러오지 않아도 된다. audit WARN은 수용한다고 적는다 |
| 5 | `03-data-model.md` 상태 전이 "팀 컨테이너", `04-api.md` §3 `ensure-running` | "헬스체크 통과", 타임아웃 120초 | 이미지 기본 healthcheck interval이 180초라 120초 타임아웃 안에 healthy가 되지 못할 수 있다. orchestrator가 컨테이너 생성 시 healthcheck를 재정의(`interval 30s`, `start_interval 5s`)하거나 `/readyz`를 직접 폴링한다고 명시한다 |
| 6 | `06-auth.md` §3 세션(로그아웃) | — | (낮음) 팀 호스트 로그아웃·사용자 전환 시 Control UI service worker가 남는다. 데이터는 forward-auth가 막는다. 로그아웃 응답에 `Clear-Site-Data: "cache", "storage"`를 팀 호스트에도 보낼지 검토한다 |
| 7 | `04-api.md` §3 orchestrator `apply-config` | 할당 에이전트·MCP 반영 | **팀 관리자 지정·해제 시** `identityScopes`를 openclaw.json에 반영하는 호출도 추가한다. 실행 중 반영(`config.patch`로 핫 리로드되는지)은 ⚠️ 미검증 |
| 8 | `05-urls-and-storage.md` §2 호스트와 라우팅·라우터 표 | Gateway 포트만 라우팅 | doctor 경고: trusted-proxy 모드에서 `mcp.apps.sandboxOrigin`이 비어 있다. 대시보드 위젯과 MCP 앱은 **Gateway 포트+1(18790) sandbox listener**에서 렌더링되므로, 이 포트로 가는 경로 또는 별도 origin이 필요하다. 호스트·라우터 규칙에 자리를 만든다(⚠️ 다음 spike에서 확인) |
| 9 | `05-urls-and-storage.md` §5 `/data` 트리·마운트 규칙 | `owner = OpenClaw 실행 UID` | 공식 이미지 실행 사용자는 `node`(uid 1000)다. 팀별 UID를 쓰려면 `user:` 재정의가 엔트리포인트·doctor와 호환되는지 확인이 필요하다(⚠️ 미검증). 이미지 엔트리포인트가 매 기동 시 doctor를 돌려 openclaw.json을 **다시 쓰고 JSON5 주석을 지운다.** orchestrator가 생성하는 openclaw.json에 주석이 있다고 가정하지 않는다 |

## 5. 이번에 확인하지 않은 것 (다음 spike 후보)

- `controlUi.basePath = /claw` 아래 서빙(05-urls §4). 이번에는 루트 `/`에서 검증했다.
- `claw-frame`: CSP `frame-ancestors` 재작성(05-urls §2 미들웨어)
- 팀 Gateway 비밀번호로 admin-http-rpc(`POST /api/v1/admin/rpc`) 호출. `OPENCLAW_GATEWAY_PASSWORD`를 넣은 상태로 기동에 문제가 없다는 것까지만 확인했다.
- 팀원 간 **세션(대화)이 사람별로 나뉘는지.** 두 사람이 서로 다른 `user`로 인증되는 것까지는 확인했다.
- `identityScopes` 변경의 핫 리로드, MCP 호출자 신원 전달, `sandboxOrigin` 라우팅
- Linux VM에서 bind mount(`/data/teams/{team}/openclaw`) + uid 1000 동작
