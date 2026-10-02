# CLAUDE.md — KCC Agent Cloud Platform (KACP)

이 파일은 Claude Code가 이 저장소에서 작업할 때 가장 먼저 읽는 컨텍스트다.
설계 문서의 원본은 `docs/`에 있고, 이 파일은 요약과 작업 규칙만 담는다.
설계와 코드가 다르면 **설계 문서를 먼저 고치고** 코드를 바꾼다.

## 한 줄 요약

비개발자 사원이 인프라 지식 없이 OpenClaw 2.0 에이전트를 팀 단위로 쓰는 사내 에이전트 클라우드.
관리자가 팀·사용자를 만들고 에이전트를 할당하면, 사원은 로그인 후 바로 팀 에이전트를 쓴다.

## v1 데모 네 장면

1. 관리자가 조직(부서)과 사용자를 등록하고, 에이전트 팀을 만들어 에이전트를 할당한다.
2. 사원이 로그인하면 팀 컨테이너가 뜨고 OpenClaw 에이전트를 팀원과 함께 쓴다.
3. 결과물은 드라이브에 쌓이고, 웹 앱은 작업본(Private)으로 바로 뜨고, 관리자 승인을 받으면 공개본(Public)이 따로 생긴다.
4. 개발자가 스캐폴딩으로 만든 MCP를 올리면 관리자 심사 후 다른 팀이 마켓에서 설치해 쓴다.

## v2 (지금 만들지 않음)

- 지식 기능: `docs/design/07-knowledge-v2.md`. v1 코드는 `docs/design/04-api.md` §6 규칙만 지킨다(pgvector 이미지, platform-mcp 도구 파일 분리, 권한은 api 한 곳).

## 문서 지도

| 문서 | 내용 | 언제 읽나 |
|---|---|---|
| `docs/README.md` | 0단계 산출물 목록, 통과 조건, 용어집 | 처음 |
| `docs/design/01-screens.md` | 전체 화면 목록과 화면별 요소·동작·권한 | 웹 작업 전 |
| `docs/design/02-design-system.md` | 디자인 토큰, 공통 컴포넌트, 상태 배지 문구 | 웹 작업 전 |
| `docs/design/03-data-model.md` | ERD, 테이블 정의, 상태 전이 | API·DB 작업 전 |
| `docs/design/04-api.md` | API 규칙, 엔드포인트 목록, 내부 API | API 작업 전 |
| `docs/design/openapi.yaml` | 외부 API 계약(OpenAPI 3.1 초안) | API·웹 타입 생성 |
| `docs/design/05-urls-and-storage.md` | 도메인·라우팅·이름 규칙, `/data` 폴더, 컨테이너·네트워크 이름 | 프록시·오케스트레이터 작업 전 |
| `docs/design/06-auth.md` | 로그인, 세션, forward-auth, 권한 매트릭스, SSO 확장 자리 | 인증 작업 전 |
| `docs/design/07-knowledge-v2.md` | (v2) 지식 기능 설계 초안 | v2 시작 시 |
| `docs/design/mockups/` | Claude Design 시안 사본(참고용, 정본은 01·02 문서와 Claude Design 프로젝트). 수정 프롬프트 `REVISION-PROMPT.md` | 웹 구현 전 |
| `docs/spikes/NN-이름.md` | 1단계 검증 결과(이미지 버전, 확인 방법, 결과, 설계 변경) | 해당 영역 작업 전 |

## 모노레포 구조

```
apps/
  web/            # 사원 화면 + 관리자(/admin) + 에이전트 셸 (한 앱, 호스트·역할별 라우팅)
  api/            # 모든 상태와 권한의 중심 (Postgres)
  proxy/          # Traefik 설정 + forward-auth 연동 (코드는 거의 없음)
  orchestrator/   # 팀·앱·MCP 컨테이너 생명주기, MCP 빌드, 사용량 수집
packages/
  shared/         # 공용 타입, zod 스키마, 상수(상태값, 예약어)
  platform-mcp/   # 모든 팀에 기본 설치되는 MCP (앱 실행·배포, 드라이브 도구)
  create-platform-mcp/  # 개발자용 MCP 스캐폴딩 + validate/pack
deploy/
  openclaw-image/ # 공식 이미지 기반 Dockerfile, openclaw.json 템플릿, 기본 지시문
  infra/          # GCP VM 초기화, docker-compose, 백업, 배포 스크립트
docs/
  design/         # 0단계 설계 문서
  spikes/         # 1단계 검증 결과 문서 (NN-이름.md)
spikes/           # 1단계 검증용 버리는 코드 (NN-이름/)
```

`apps/{web,api,orchestrator,proxy}`, `packages/shared`, `deploy/{openclaw-image,infra}`는 2단계에서 만들었다. `packages/platform-mcp`·`create-platform-mcp`는 5·6단계에서 만든다.

로컬 실행: `deploy/infra/.env.example`을 `.env`로 복사 → `docker compose -f deploy/infra/docker-compose.yml --profile build build openclaw-image` → `docker compose -f deploy/infra/docker-compose.yml up -d --build` → `... exec api node dist/cli.js demo`. 주소는 `http://app.kacp.localhost`, 팀은 `http://team1.kacp.localhost`.

## 기술 스택 (확정 2026-10-01)

근거는 `docs/spikes/01~07` (이미지 버전·실측값은 각 문서 머리).

| 영역 | 선택 | 이유 |
|---|---|---|
| 언어 | TypeScript 전 구간. 예외: Traefik 로컬 플러그인 2개(`cspframe`·`cookiestrip`)만 Go(yaegi) | MCP SDK·스캐폴딩과 언어 통일, 1인 개발. 플러그인은 Traefik이 Go만 받음(spike 03) |
| 패키지 | pnpm workspaces (+ Turborepo 선택) | 모노레포 |
| web | React + Vite + TanStack Router + TanStack Query + TanStack Table | SPA, 서버 렌더링 불필요. [shadcn-admin](https://github.com/satnaing/shadcn-admin) 구조 참고 |
| UI | shadcn/ui (neutral, new-york) + Tailwind CSS v4 + Radix + Lucide + Sonner + Recharts | `docs/design/02-design-system.md` |
| api | Node 22 + Fastify + zod + Drizzle ORM | 가볍고 타입 안전 |
| DB | PostgreSQL 16 (`pgvector/pgvector:pg16` 이미지, `ltree` 확장) | v2 임베딩 대비, 부서 트리 |
| orchestrator | Node 22 + Docker Engine API 직접 호출(`fetch`, 의존성 없음), `tecnativa/docker-socket-proxy:v0.5.0` 경유 — orchestrator용과 팀 샌드박스용 프록시 분리 | dockerode 불필요, 허용 API 제한(spike 06) |
| OpenClaw | `ghcr.io/openclaw/openclaw:2026.9.7` 고정 + docker CLI를 넣은 자체 이미지. 샌드박스 이미지 `openclaw-sandbox:bookworm-slim` | 설정만 한다(spike 01·06) |
| 프록시 | Traefik `v3.7.13` (Docker provider + forwardAuth + 로컬 플러그인) | 라벨로 동적 라우트(spike 01·03) |
| API 계약 | `docs/design/openapi.yaml` → openapi-typescript로 web 타입 생성 | |
| 비밀번호 | argon2id (`@node-rs/argon2`, m=64MB t=3 p=1) | VM verify 41ms(spike 06) |
| 인프라 | GCP `n4-standard-8`, Ubuntu 24.04, Docker 29, `/data` 데이터 디스크 | spike 06·07 |

## 반드시 지킬 규칙

- 브라우저 요청은 전부 Traefik을 거친다. api·orchestrator·postgres 포트를 외부에 열지 않는다.
- 컨테이너를 만들고 지우는 건 orchestrator뿐이다. api는 orchestrator 내부 API를 호출한다.
- Docker 소켓은 orchestrator가 docker-socket-proxy를 통해서만 쓴다(허용 API 제한).
  - 예외 하나: OpenClaw 샌드박스용으로 팀 컨테이너에 **샌드박스 전용 socket-proxy**(`kacp-sbx-proxy-{team}`)를 따로 붙인다. 허용 `CONTAINERS POST EXEC IMAGES INFO VERSION ALLOW_START/STOP/RESTARTS`(spike 06). 샌드박스는 OpenClaw가 붙이는 `openclaw.sandbox=1` 라벨과 이름 접두사 `kacp-sbx-{team}-`로 식별·정리한다(`kacp.kind` 라벨은 강제할 수 없음).
- admin-http-rpc(팀 Gateway 비밀번호)는 orchestrator만 호출한다. api는 orchestrator의 `/internal/gateway/{team}/rpc`를 거친다.
  - trusted-proxy 모드에서 비밀번호는 loopback에서만 통한다(spike 04). orchestrator는 팀 컨테이너와 네트워크 네임스페이스를 공유하는 **팀별 사이드카 `kacp-gwagent-{team}`**를 거쳐 부른다.
- OpenClaw는 **설정만** 한다. OpenClaw 소스를 고치지 않는다.
- Gateway 토큰은 쓰지 않는다(trusted-proxy와 동시 사용 불가). 플랫폼 내부 호출만 팀별 Gateway 비밀번호를 쓴다.
- 클라이언트가 보낸 신원 헤더(`x-kacp-*`, `x-openclaw-*`, trusted-proxy 사용자 헤더)는 프록시에서 항상 제거한 뒤 forward-auth 결과로 다시 넣는다.
- MCP 비밀값은 DB에 저장하지 않는다. 팀 Secret Store로 바로 전달한다.
- 팀·Public 앱 이름은 하나의 네임스페이스(`names` 테이블)에서 중복 검사한다. 예약어 차단, 소문자·숫자·하이픈만, `--` 금지.
- 두 단계 서브도메인(`앱.팀.kacp.cloud`)은 만들지 않는다. 작업본은 `앱--팀.kacp.cloud`.
- 앱은 **작업본과 공개본 두 사본**이다. 공개돼도 작업본은 남고, 공개본은 승인된 스냅샷으로만 바뀐다. 두 사본의 데이터(`/app-data`)는 섞지 않는다.
- 앱 사본은 접속이 없으면 잠들고(유휴 정지) 접속하면 깨어난다. 팀당 동시 실행 작업본 수를 제한한다.
- **부서(조직)와 팀은 다르다.** 부서 = 실제 사내 소속(트리, 한 사람 하나), 팀 = 에이전트를 쓰는 작업 단위(한 사람 여러 팀). 부서는 v1에서 권한을 주지 않는다.
- 사용자에게 보이는 문구는 한국어. 코드·커밋·식별자는 영어.
- 모든 관리 행위(생성·삭제·승인·반려·설치·할당·비활성화)는 `audit_events`에 남긴다.

## 개발 단계

0 설계(**완료 2026-10-02**) → 1 기술 검증(**완료 2026-10-01**, `docs/README.md` "1단계 결론") → 2 뼈대(**완료 2026-10-02**) → 3 관리자 기본 → 4 드라이브 → 5 앱 배포 → 6 MCP 마켓 → 7 마감.
각 단계의 통과 조건은 `docs/README.md` 참고. 1단계 검증 결과가 설계를 바꾸면 해당 문서를 먼저 고친다.

- `spikes/`는 1단계 검증용 버리는 코드다. 질문 하나에 답하는 게 목적이고 품질 규칙을 적용하지 않는다.
- 결론은 `docs/spikes/NN-이름.md`에 남긴다. 코드가 아니라 이 문서가 산출물이다.
- `apps/`, `packages/`는 `spikes/` 코드를 import하거나 복사하지 않는다. 결론을 보고 새로 짠다.
- 1단계가 끝나면 `spikes/`는 지워도 된다.
- 검증 장소: spike 02~05는 로컬(Windows Docker Desktop, WSL2 백엔드, `*.localhost`), 06~07은 GCP VM. 로컬에서는 bind mount 권한을 검증하지 않는다. 권한·성능·인증서처럼 실제 Linux 서버에서만 의미가 있는 것은 VM에서 한다.

## 아직 확인이 필요한 것

1단계 검증은 끝났다(`⚠️ 1단계 확인` 전부 해소, 결과는 `docs/README.md` "1단계 결론"). 남은 `⚠️`는 4·6단계 항목뿐이다(샌드박스 파일 쓰기 이벤트 수집 — 4단계, MCP egress 제한 — 6단계). 목록은 `docs/README.md`에 있다(여기에 따로 적지 않는다).
