# Spike 03 — 셸 iframe, 프레임 차단 헤더 재작성, WebSocket forwardAuth

- 날짜: 2026-10-01
- 환경: Windows 11 + Docker Desktop(WSL2 백엔드), Chrome(일반 창 = alice, 시크릿 창 = bob)
- 검증 코드: `spikes/03-iframe-csp/` (spike 02 복사·확장, spike 02 상태 볼륨 `kacp-spike02_team1-state`를 이어받음)
- 결론: **통과.** 셸(`/`)에서 `/claw`를 iframe으로 띄워 연결된다. 프레임 차단 헤더는 Traefik **로컬 플러그인**으로 `frame-ancestors`만 재작성한다. 기본 headers 미들웨어로는 안 된다. forwardAuth는 WebSocket 업그레이드에도 적용된다. `kacp_session`만 지우는 것도 같은 플러그인 방식으로 된다.

## 1. 사용한 이미지

| 구성 | 이미지 | 버전 |
|---|---|---|
| OpenClaw | `ghcr.io/openclaw/openclaw:2026.9.7` | `OpenClaw 2026.9.7 (c074824)` |
| Traefik | `traefik:v3.7.13` | 3.7.13, 로컬 플러그인(yaegi) `cspframe`, `cookiestrip` |

## 2. 문서 확인

- OpenClaw(이미지 안 `/app/docs`)에는 `frame-ancestors`·`X-Frame-Options`를 바꾸는 **설정이 없다**. Control UI 응답 헤더:
  ```
  Content-Security-Policy: default-src 'self'; …; frame-ancestors 'none'; frame-src 'self' blob: http: https:; script-src 'self' 'sha256-…' 'sha256-…' 'wasm-unsafe-eval'; …
  X-Frame-Options: DENY
  ```
- **CSP에 버전마다 바뀌는 스크립트 해시가 들어 있다.** 그래서 CSP 전체를 고정값으로 덮어쓰면 OpenClaw를 올릴 때마다 깨진다. 헤더를 하나 더 붙이는 방법도 안 된다. 브라우저는 모든 CSP를 교집합으로 적용해서 허용 범위를 넓힐 수 없다.
- Traefik `headers` 미들웨어는 헤더를 설정·삭제만 하고 일부만 바꾸지는 못한다. → **로컬 플러그인**(저장소 안 Go 소스, 외부 다운로드 없음)
- MCP Apps(`cli/mcp/apps.md`): opt-in(`mcp.apps.enabled`). 켜면 Gateway 포트+1에 sandbox 전용 listener가 뜬다. Control UI와 **다른 전용 origin**이 필요하고, 로그인 프록시 밖에 둔다(`gateway/team-server.md`).

## 3. 설정 변경 기록

| # | 파일 | 변경 | 이유 |
|---|---|---|---|
| 1 | `docker-compose.yml` | 프로젝트 `kacp-spike03`, 볼륨을 외부 `kacp-spike02_team1-state`로 | 02의 profile·세션·역할 상태 재사용 |
| 2 | `docker-compose.yml` | `--experimental.localPlugins.cspframe…`, `./traefik/plugins-local` 마운트 | 로컬 플러그인 로드(`Plugins loaded. ["cspframe"]`) |
| 3 | `traefik/plugins-local/src/github.com/kacp/cspframe/` | CSP의 `frame-ancestors[^;]*`만 `frame-ancestors 'self'`로 바꾸고 `X-Frame-Options` 삭제. `Hijack`/`Flush`는 그대로 넘김 | 스크립트 해시를 건드리지 않고 프레임만 허용. Hijack을 넘기지 않으면 WebSocket이 깨진다 |
| 4 | `traefik/dynamic.yml` | `/claw` 라우터에 `claw-frame` 추가, 셸 라우터(`/`) → fake-auth | 셸 자리 |
| 5 | `fake-auth/server.js` | `/`에서 셸 테스트 페이지(상단 띠 + `<iframe src="{start}">`, `?start=/claw/`·`/claw/new`) | 에이전트 셸 흉내 |
| 6 | `docker-compose.yml` init | `cp` → `[ -f … ] \|\| cp`(첫 기동에만 시드) | 시드 파일을 다시 덮어쓰자 OpenClaw가 **오래된 백업**으로 되돌려 02에서 hot reload로 바꾼 `others: write`가 `none`으로 돌아갔다. §4-⑤ |
| 7 | `config set …member.sessions.others "write"` | #6으로 사라진 설정 복구 | — |
| 8 | `cookiestrip` 플러그인 + `strip-session-cookie` 미들웨어(`/_debug` 라우터) | 요청 Cookie에서 지정 이름만 삭제 | 앱 라우터 흉내(06-auth §3) |

## 4. 항목별 결과

### ① 같은 팀 주소의 셸에서 `/claw` iframe — ✅

- 방법: alice·bob이 `http://team1.kacp.localhost/`(iframe `/claw/`), `/?start=/claw/new`를 연다.
- 결과: iframe 안에서 Control UI가 뜨고 연결된다. Gateway에 `webchat connected` 7회(셸 접속마다).
- 브라우저 콘솔에 `Refused to frame`·CSP·WebSocket 오류는 없다. 보인 오류 두 가지:
  - `GET /claw/api/users/{id}/avatar` 404 — 프로필 사진이 없어서(`hasAvatar: false`). 무해
  - `GET /claw/__openclaw__/workspace-icon/{sessionKey}` 403 — Gateway 응답 `owner access required`(curl: bob 403, alice 404). 팀원 화면에서 세션 아이콘이 안 뜨는 미관 문제. iframe과 무관
- 설계 변경: 없음(01 U-01 구조 그대로)

### ② iframe 시작 경로 — ✅ `/claw/`로 충분

- spike 02의 `others: none`에서는 Main Session(`agent:main:main`)이 처음 쓴 사람 것이라 다른 팀원에게 not found가 났다.
- 이제 `others: write`라 Main Session은 **공유됨 = 팀 채팅**이 된다. bob이 `/claw/`로 들어가도 오류가 없다(이번 접속 동안 `agent:main:main not found` 0건).
- `/claw/new`는 새 세션 화면(공개 범위 선택 포함)으로 열린다. 셸의 "새 개인 대화" 버튼 링크로 쓸 수 있다.
- 설계 변경: `01-screens.md` U-01 — iframe 시작 = `/claw/`(Home = 팀 채팅), "개인 대화" 버튼 = `/claw/new`

### ③ `X-Frame-Options` 제거 + `frame-ancestors 'none'` → `'self'` — ✅ (로컬 플러그인)

- curl(`/claw/`, bob):
  ```
  변경 전: … frame-ancestors 'none'; …   X-Frame-Options: DENY
  변경 후: … frame-ancestors 'self'; …   (X-Frame-Options 없음)
  ```
  나머지 지시문(`script-src`의 해시 포함)은 그대로다.
- 플러그인은 응답 헤더를 쓰기 직전(WriteHeader/Write/Flush)에 한 번 바꾸고, `Hijack`은 원래 ResponseWriter로 넘긴다. Traefik 재기동 뒤에도 같은 결과가 나왔다.
- 설계 변경: `05-urls-and-storage.md` §2 미들웨어 `claw-frame` — 방법 확정(⚠️ 해소)

### ④ forwardAuth가 WebSocket 업그레이드에도 적용되는지 — ✅

- 방법: `curl -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: …" http://team1.kacp.localhost/claw`

  | 요청 | 결과 |
  |---|---|
  | 쿠키 없음 | 302 → 로그인 |
  | 쿠키 없이 `X-Forwarded-User: alice@kcc.dev` 위조 | 302 → 로그인 |
  | carol(비멤버) | 403 (`fake-auth: verify /claw carol -> 403`) |
  | bob | **101** |
- 다른 Origin(`Origin: http://evil.localhost`)으로 보낸 bob 요청도 업그레이드는 101이다. Gateway 로그에 `origin=http://evil.localhost`가 찍히고, curl이 연결 프레임을 보내지 않아 `closed before connect`로 끝났다. Origin 검사(`controlUi.allowedOrigins`)는 **업그레이드 다음의 연결(handshake) 단계**에서 한다. curl로는 그 단계까지 가지 못해 미검증. 브라우저 다른 사이트 요청에는 `SameSite=Lax` 쿠키가 실리지 않는다.
- 참고: 설계(06-auth §5)는 세션 없는 WebSocket에 `401`을 준다. fake-auth는 302를 줬다. 실제 api는 설계대로 401을 준다.
- 설계 변경: 없음(06-auth §5와 일치). ⚠️ 해소

### ⑤ (추가) openclaw.json 덮어쓰기 → **오래된** 백업으로 복원

- init이 시드 파일을 다시 복사하자 기동 로그에 `Config auto-restored from backup … (missing-meta-vs-last-good)`가 찍혔다. 그 결과 `gateway.roles…others`가 `write`(02에서 hot reload로 바꾼 값)가 아니라 **`none`**이었다.
- 상태 폴더에 `openclaw.json.bak`~`.bak.4`, `openclaw.json.last-good`이 있다. 복원본이 가장 최근 설정이라는 보장이 없다.
- 의미: 첫 기동 이후 파일을 덮어쓰면 "되돌려진다"에 그치지 않고, **최근 변경을 잃을 수 있다.** 시드는 파일이 없을 때만 한다.
- 설계 변경: `05-urls-and-storage.md` §5, `04-api.md` §3 문구 강화

### ⑥ 앱 라우터에서 `kacp_session`만 제거(`strip-session-cookie`) — ✅ (로컬 플러그인)

- 방법: `/_debug`(whoami) 라우터에 `[strip-identity, kacp-auth, strip-session-cookie]`, 요청 쿠키 `kacp_dev_user=bob; kacp_session=SECRET; app_pref=dark`
- 결과(whoami가 받은 헤더): `Cookie: app_pref=dark`, `X-Forwarded-User: bob@kcc.dev`. forward-auth는 쿠키로 bob을 확인했고, 앱에는 플랫폼 쿠키가 가지 않는다.
- 순서가 중요하다: **forward-auth 다음에** 쿠키를 지운다.
- 설계 변경: `05-urls-and-storage.md` §2 미들웨어 `strip-session-cookie` — 방법(로컬 플러그인)과 순서 명시

### ⑦ MCP Apps sandbox listener(포트+1) — v1에서는 끈다

- 현재 `mcp.apps.enabled` 미설정(기본 꺼짐), 컨테이너 안 18790 `ECONNREFUSED`. doctor의 `sandboxOrigin` 경고는 "켜면 필요하다"는 안내다.
- 켤 때 필요한 것(문서): Control UI와 다른 전용 origin, 그 origin은 sandbox 포트로만 프록시, 로그인 프록시 밖, 다른 인증 콘텐츠 금지. 켜고 끌 때 Gateway 재시작.
- KACP 안: 와일드카드 인증서는 한 단계만 덮고, `앱--팀` 형식과 겹치면 안 된다. 그래서 **`{team}.sbx.kacp.cloud` + 별도 와일드카드 인증서 `*.sbx.kacp.cloud`**(DNS-01로 발급 가능)가 가장 깔끔하다. forward-auth 없이, `strip-session-cookie`를 적용해 18790으로 보낸다. **v1 범위 밖.**
- 설계 변경: `05-urls-and-storage.md` §2 ⚠️ → "v1 비활성 + 켤 때 안"으로

## 5. 설계 문서 변경

| # | 문서·절 | 바꾼 내용 |
|---|---|---|
| 1 | `05-urls-and-storage.md` §2 미들웨어 | `claw-frame` = Traefik 로컬 플러그인(`frame-ancestors`만 재작성, XFO 삭제, Hijack 통과). `strip-session-cookie` = 로컬 플러그인, forward-auth 뒤. 플러그인 코드는 `apps/proxy`에 새로 짠다(spike 코드 복사 금지) |
| 2 | `05-urls-and-storage.md` §2 sandbox listener | v1은 `mcp.apps.enabled: false`. 켤 때 `{team}.sbx.kacp.cloud` + `*.sbx.kacp.cloud` 인증서, forward-auth 없음 |
| 3 | `01-screens.md` U-01 | iframe 시작 `/claw/`(Home = 팀 채팅), 새 개인 대화 `/claw/new`. 팀원은 세션 아이콘이 안 보인다(owner 전용 경로) |
| 4 | `05-urls-and-storage.md` §5, `04-api.md` §3 | 덮어쓰면 오래된 백업으로 복원돼 최근 변경을 잃을 수 있음. 시드는 파일이 없을 때만 |
| 5 | `06-auth.md` §5 | WebSocket 업그레이드에도 forward-auth가 적용됨(확인). Origin 검사는 Gateway 연결 단계 |

## 6. 남은 것

- 다른 Origin WebSocket이 Gateway 연결 단계에서 거부되는지(브라우저나 WS 클라이언트로) — 미검증
- MCP Apps를 켤 때의 sandbox origin 실제 동작 — v1 범위 밖
