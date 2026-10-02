# Spike 02 — `/claw` basePath, 팀원 간 세션 분리, 팀원·팀 관리자 권한

- 날짜: 2026-10-01
- 환경: Windows 11 + Docker Desktop(WSL2 백엔드), Chrome(일반 창 = alice, 시크릿 창 = bob)
- 검증 코드: `spikes/02-session-scopes/` (spike 01 복사·확장)
- 결론: **4개 항목 모두 통과.** 단 세션 분리는 기본값으로는 안 되고 `gateway.roles` 설정이 필요하다. 첫 기동 이후 openclaw.json을 통째로 바꾸면 OpenClaw가 되돌린다(설계 변경).

## 1. 사용한 이미지

| 구성 | 이미지 | 버전 |
|---|---|---|
| OpenClaw | `ghcr.io/openclaw/openclaw:2026.9.7` | `OpenClaw 2026.9.7 (c074824)` (spike 01과 동일) |
| Traefik | `traefik:v3.7.13` | 3.7.13 |

## 2. 문서 확인

- 공식 사이트(docs.openclaw.ai)의 Control UI·security 페이지에는 세션 분리 관련 내용이 없었다. 이슈 [#104499](https://github.com/openclaw/openclaw/issues/104499)는 **아직 열려 있다**. 제안된 `gateway.sessionScope: "per-user"`는 2026.9.7에 없다.
- **이미지 안에 같은 버전의 문서가 들어 있다**(`/app/docs`). 이번 결론의 근거:
  - `gateway/operator-scopes.md` — scope 목록, **Named operator roles**(`gateway.roles`, `sessions.others`), identity scope 결정 순서, hot reload
  - `concepts/multi-user.md` — 세션 생성자·소유자·참여자, 사람별 모델 계정(Connected accounts)
  - `gateway/team-server.md` — trusted-proxy + `deviceAutoApprove` + `identityScopes` + roles 조합의 공식 팀 서버 예시(KACP 구조와 거의 같음)
- 앞으로 OpenClaw 동작을 확인할 때는 `docker run --rm --entrypoint sh ghcr.io/openclaw/openclaw:<버전> -c 'cat /app/docs/…'`로 **이미지와 같은 버전의 문서**를 먼저 본다.

## 3. 설정 변경 기록

| # | 파일·명령 | 변경 | 이유 |
|---|---|---|---|
| 1 | `docker-compose.yml` | 프로젝트 이름 `kacp-spike02` | spike 01 상태와 섞이지 않게 볼륨 분리 |
| 2 | `openclaw.json` | `gateway.controlUi.basePath: "/claw"` | 셸(`/`)과 Control UI(`/claw`)를 같은 호스트에 두는 설계(05 §2·§4) |
| 3 | `traefik/dynamic.yml` | 팀 라우터를 `Host && PathPrefix(/claw)`(priority 70, prefix 유지), 나머지는 `redirectRegex`로 `/claw/` | 셸 자리 마련. Gateway가 basePath를 직접 처리하므로 strip하지 않는다 |
| 4 | `openclaw.json` + 재기동 | `gateway.roles` 추가 → **반영 안 됨** | 기동 시 `Config auto-restored from backup: … (size-drop-vs-last-good:3281->1599, missing-meta-vs-last-good)`. §5-1 |
| 5 | `openclaw config set gateway.roles …` | Phase B 역할(member: `others none`, team_admin: `others write`, 상한 admin) | 실행 중 변경. `config hot reload applied (gateway.roles)`, 재시작 0회 |
| 6 | `openclaw gateway call users.setRole` | alice → `team_admin` | Phase B 확인 |
| 7 | `users.setRole … role:null` + `config set gateway.roles …` | 역할을 `member` 하나로 줄이고 상한을 `operator.admin`으로 | Phase C: `users.setRole` 없이 되는지 |
| 8 | `config set gateway.auth.identityScopes …` (2회 ×2) | bob admin 부여·회수 | `identityScopes` hot reload 확인 |
| 9 | `fake-auth/server.js` (임시, 되돌림) | bob을 잠시 `team_admin`으로 | 헤더 상한 때문에 #8 첫 시도에서 admin이 안 붙음 — §4-④ |

| 10 | `traefik/dynamic.yml` | `/claw` 라우터에 `fake-https`(요청 헤더 `X-Forwarded-Proto: https`) | 공개 세션 링크는 정확히 https여야 열림. 로컬 전용(운영은 TLS 종료) |
| 11 | RPC `session.members.add` → `remove` | alice 세션에 bob 멤버 추가 후 제거 | 화면의 구성원 추가가 저장되지 않아 직접 확인 |
| 12 | `config set …member.sessions.others` | `none` → `write` → `none` | 공개 범위(초안·읽기 전용) 동작 확인 후 결정값으로 복귀 |
| 13 | `config set tools.sessions.visibility "tree"` + `openclaw.json` | 에이전트 세션 도구 범위 축소 | 심층 방어. hot reload 확인, `config validate` 통과 |

CLI는 컨테이너 안에서 실행했다(`docker exec … node openclaw.mjs …`). Gateway 비밀번호(`OPENCLAW_GATEWAY_PASSWORD`) 경로를 쓰고, 토큰은 쓰지 않았다.

## 4. 항목별 결과

### ① `controlUi.basePath "/claw"` + Traefik 라우트 — ✅

- 방법(curl):
  ```
  비로그인 /, /claw, /claw/   → 302 http://team1.kacp.localhost/_kacp/login?rd=…
  bob /, /claw               → 302 http://team1.kacp.localhost/claw/
  bob /claw/, /claw/chat/main → 200 text/html
  bob /chat/main             → 200 text/plain (셸 자리 = whoami)
  ```
  HTML 안의 자원 경로가 모두 `/claw/assets/…`, `/claw/favicon.svg`…로 나온다. WebSocket도 `/claw` 아래에서 연결됐다(브라우저 확인, 로그 `webchat connected`).
- 문서에 따르면 basePath 변경은 Gateway **재시작이 필요하다**. 프로비저닝 때 한 번만 정한다.
- 설계 변경: 없음(05 §2·§4 그대로). ⚠️ 표시만 해소

### ② 팀원 간 세션 분리 — ⚠️ 기본값으로는 안 됨 → `gateway.roles`로 ✅

| Phase | 설정 | 결과(브라우저) | 서버 기록 |
|---|---|---|---|
| A | roles 없음 | 서로의 세션이 **보임**. bob이 alice가 만든 Main Session에서 대화 | 세션 `agent:main:main` 하나, `createdActor` = alice profile, `visibility: shared`, 참여자 2 |
| B | `default: member(others none)`, alice만 `team_admin(others write)` | bob: alice의 Main Session·새 세션 **안 보임**, 자기 새 세션 생성·전송 가능. alice: bob 세션 보임 | bob의 `sessions.describe agent:main:main` → `Session "agent:main:main" was not found`(존재 여부도 드러나지 않음) |
| C | `member` 하나(`others none`, 상한 `operator.admin`), `users.setRole` 없음 | B와 같음. alice는 bob 세션 보임, bob은 alice 세션 안 보임 | 세션마다 `createdActor`에 생성자 profile id 기록 |

- Phase C가 되는 이유(문서): 역할 `scopes`는 **상한일 뿐 권한을 주지 않는다**. `operator.admin`을 가진 연결은 `sessions.others`와 무관하게 관리자 세션 접근을 유지한다. 그래서 역할은 하나로 충분하고, 팀 관리자 구분은 지금 설계대로 `identityScopes`만으로 된다.
- Phase B 방식의 문제: profile은 **그 사람이 처음 로그인할 때 생긴다**(`openclaw users list`로 확인. 미리 만드는 CLI는 없다). 역할을 쓰려면 첫 로그인 뒤에 `users.setRole`을 따로 호출해야 한다. Phase C는 이 단계가 필요 없다.
- 문서상 한계(설계에 명시할 것): `sessions.others: "none"`은 세션 목록·대화 접근을 막는다. 그러나 **`operator.write`의 Gateway 전역 동작(도구 호출, 감사 진단 등)은 사람별 격리가 아니다.** "서로 믿지 못하는 사람"이 아니라 "팀 안의 사생활·정돈" 수준의 분리다.
- 발견: **Main Session(`agent:main:main`)은 처음 쓴 사람의 것이 된다.** Control UI가 기본으로 이 세션을 열기 때문에, 숨겨진 쪽(bob)은 화면에 `Session "agent:main:main" was not found.`가 뜨고 5초마다 `sessions.describe` 오류가 난다. 셸이 iframe을 띄울 시작 경로를 정해야 한다(→ 03-iframe-csp).
- 설계 변경: 있음 — §5-2, §5-3

### ③ `deviceAutoApprove`로 페어링 화면 없이 접속 — ✅ (`/claw`, 역할 설정 후에도)

- Phase A·B·C 모두 alice·bob이 페어링 화면 없이 연결됐다.
- 문서에는 "역할을 설정하면 identity 연결에 재사용 기기 토큰을 주지 않는다"고 돼 있는데, 페어링 화면은 나오지 않았다. 기기 기록(`devices list`)의 Control UI 기기 scope는 모두 `approvals, questions, read, write`이고 admin은 없다.
- 설계 변경: 없음

### ④ 팀원은 설정(admin) 막힘, 팀 관리자는 됨 — ✅

- 브라우저: alice는 설정 → 모델 설정이 열린다. bob은 모델을 바꾸지 못한다(Phase A·C 모두).
- 로그: alice 연결마다 `identity scope grant elevated … identity=alice@kcc.dev addedScopes=operator.admin`, bob에게는 없다.
- `identityScopes` **hot reload**(`openclaw config set gateway.auth.identityScopes …`):
  - 바꾸면 `config hot reload applied` → **해당 사람의 연결만** `4001 gateway policy changed`로 끊기고, Control UI가 약 1초 안에 다시 붙는다. 재시작은 없다.
  - 승격: bob을 `identityScopes`에 넣는 것**만으로는 admin이 붙지 않았다.** forward-auth가 bob에게 보낸 `X-Openclaw-Scopes`(팀원 값)가 최종 상한으로 걸리기 때문이다(문서의 결정 순서 3단계). fake-auth에서 bob을 팀 관리자로 바꾼 뒤(헤더에 admin 포함) 다시 넣자 `identity scope grant elevated … bob … operator.admin`.
  - 강등: `identityScopes`에서 빼면 재접속 시 admin이 없다.
  - 의미: 팀 관리자 지정·해제는 **api(헤더 상한)와 orchestrator(`identityScopes`) 둘 다** 바뀌어야 반영된다. 한쪽만 바뀌면 권한은 좁은 쪽으로 정해지고 새지 않는다. `identityScopes`를 바꾸면 연결이 강제로 끊기므로, 열려 있던 WebSocket도 새 헤더로 다시 검사된다.
- 아직 못 본 것: 같은 변경을 admin-http-rpc `config.patch`로 하는 경로(→ 04-admin-rpc). 이번에는 컨테이너 안 CLI(`config set`)로 했다.
- 설계 변경: 있음 — §5-2

### ⑤ (추가) 세션별 공유, 공개 범위, 에이전트 세션 도구

질문: "기본은 서로 못 보게 하고, 원하는 세션만 공유할 수 있나?" → **2026.9.7에서는 안 된다.**

| 시도 | 설정 | 결과 |
|---|---|---|
| Control UI **Session sharing → 구성원**에 bob 추가 | `others: none` | 화면에는 체크 표시가 되지만 **서버에 요청이 가지 않았다**(`session.members.*` 쓰기 로그 없음, `session.members.list`의 `members` 비어 있음). bob에게 안 보임 |
| RPC `session.members.add {sessionKey, identityId}`로 직접 추가 | `others: none` | `members`에 bob 저장 확인. 그래도 bob에게 **안 보임**. 문서의 "membership can raise `view` or `suggest`"는 `none`보다 위 단계에서 올리는 뜻으로 보인다 |
| 공개 범위 **초안** | `others: write` | bob 목록에서 사라짐. **공유됨**으로 바꾸면 다시 보임 ✅ |
| 공개 범위 **읽기 전용** | `others: write` | bob이 메시지를 보낼 수 있었다(서버 history에 bob 메시지 저장, 에이전트 응답). 문서와 일치한다: `write`는 "초안·시크릿 제한만 유지"하고 읽기 전용·제안은 무시된다. 쓰기를 막으려면 역할을 `view`로 둬야 한다 |
| 공개 접근(Public access) 링크 | — | 로컬은 "This public session is unavailable". 문서상 **`X-Forwarded-Proto`가 정확히 `https`여야** 열린다. KACP에서는 `/claw/share/*`도 forward-auth를 거치므로(비로그인 → 로그인 화면 확인) 사실상 "링크를 받은 팀원만 읽기"가 된다. https 환경(07)에서 재확인 |
| 에이전트 세션 도구(`sessions_list`/`sessions_search`/`sessions_history`) | `others: none`, `tools.sessions.visibility` 기본값 `all` | bob의 에이전트는 **bob 세션 1개만** 봤다. alice 세션은 목록·검색에 안 나옴. 도구가 요청자의 역할 권한 안에서 동작했다. 세션 키를 직접 주는 시도는 미검증 |

- 1차 결정은 `none`이었으나, **팀 채팅(공유)과 개인 대화가 둘 다 필요하다**는 요구로 다시 확인했다.

| 시도 (`others: write`) | 결과 |
|---|---|
| alice가 새 세션 페이지에서 **초안**으로 `alice 개인 대화` 생성 | 서버 `visibility: draft` |
| alice가 **공유됨**으로 `팀 채팅 테스트` 생성 | 서버 `visibility: shared` |
| bob 새로고침 | `팀 채팅 테스트`는 보이고 메시지 전송 가능, `alice 개인 대화`는 안 보임 ✅ |
| bob이 alice 초안 세션 URL로 직접 접속 | 화면 "세션이 삭제되었거나 링크가 올바르지 않을 수 있습니다", 서버 `sessions.resolve` → `No session found: 8d84d07a…` ✅ (서버가 거부) |

- **결정(2026-10-01, 변경): `others: "write"`.** 공유됨 = 팀 채팅(팀원 모두 읽기·쓰기), 초안 = 개인 대화(다른 팀원은 목록·직접 주소 모두 불가). 팀 관리자(admin)는 초안도 본다(문서: "Drafts are never hidden from admins").
- 한계: ① 새 세션의 기본값은 **공유됨**이라, 개인 대화는 사용자가 초안을 골라야 한다(기본값을 바꾸는 설정은 못 찾음). ② `write`에서는 읽기 전용·제안 표시가 무시된다. ③ 문서상 초안은 "보안 경계가 아님"이지만, 목록·직접 주소·에이전트 세션 도구 모두 서버에서 막혔다.
- 심층 방어로 `tools.sessions.visibility: "tree"`도 설정한다(hot reload 확인, 효과는 따로 검증하지 않음).
- 기본값을 초안으로 시작하게 하는 설정은 문서에서 찾지 못했다. 초안은 문서상 "정돈용이지 보안 경계가 아님"이다.

## 5. 설계 문서 변경

| # | 문서·절 | 바꾼 내용 |
|---|---|---|
| 1 | `05-urls-and-storage.md` §5 마운트 규칙, `04-api.md` §3 `provision`·`apply-config`, `plan.md` orchestrator·openclaw-image | openclaw.json은 **프로비저닝 때 한 번만 시드**한다. 첫 기동 이후 통째로 바꾸면 OpenClaw가 "손상"으로 보고 백업으로 되돌린다. 실행 중 변경은 `config.patch`(또는 CLI `config set`)로 하고, roles·`identityScopes`는 hot reload된다. "매번 새로 생성"은 삭제 |
| 2 | `06-auth.md` §6, `plan.md` 핵심 설계 결정·openclaw-image | `gateway.roles = {default: "member", definitions: {member: {sessions: {others: "write"}, agents: "*", scopes: ["operator.admin"]}}}`를 추가한다(검증은 `none`으로 했고 §4-⑤에서 `write`로 변경). `users.setRole`은 쓰지 않는다. 팀 관리자 admin = `identityScopes` + 헤더 상한. hot reload와 강제 재접속 동작, 분리의 한계(전역 write 동작은 공유)를 적는다 |
| 3 | `01-screens.md` U-01 | Main Session 소유 문제와 셸의 iframe 시작 경로를 ⚠️(03)로 추가 |
| 5 | `06-auth.md` §6, `plan.md` 핵심 설계 결정, `01-screens.md` U-01 | `others: write`(공유됨 = 팀 채팅, 초안 = 개인 대화), 기본값이 공유됨이라는 안내 필요, `none`에서는 멤버 초대가 효과 없음, 공개 링크는 https 필요 + 팀원 전용, `tools.sessions.visibility: "tree"` |
| 4 | `06-auth.md` §5 | `X-Openclaw-Scopes`가 `identityScopes`보다 뒤에 적용되는 **최종 상한**이라는 점을 명시(이미 있던 "상한" 설명을 보강) |

`sessions.others`는 **`write`**로 결정했다(§4-⑤, 팀 채팅 + 초안 개인 대화). 같은 hot reload로 바꿀 수 있다.

## 6. 남은 것

- 셸 iframe의 시작 경로(Main Session 문제) → 03-iframe-csp
- `config.patch`(admin-http-rpc)로 roles·`identityScopes` 변경 → 04-admin-rpc
- 공개 접근 링크(https) → 07-domain-cert(VM, TLS)에서 재확인
- 에이전트 세션 도구에 세션 키를 직접 줬을 때 막히는지(미검증)
- 모델 응답은 중간에 모델 키가 등록된 뒤(`gpt-5.4-nano`) 확인됐다. 모델 키 등록은 이 spike 범위 밖
