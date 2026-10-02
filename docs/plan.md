# KCC Agent Cloud Platform 개발 계획 (1인 개발)

Sep 30, 2026 · @yunghun0815@gmail.com

## 개요

KCC Agent Cloud Platform(이하 플랫폼)은 비개발자 사원이 인프라 지식 없이 OpenClaw 에이전트를 쓰는 사내 에이전트 클라우드다. 관리자가 팀을 만들고 에이전트를 할당하면, 사원은 관리자가 만든 계정으로 로그인해 바로 우리 팀 에이전트를 쓴다.

v1 목표는 네 장면을 데모로 완성하는 것이다.

1. 관리자가 팀과 사용자를 등록하고 팀에 에이전트를 할당한다.
2. 사원이 로그인하면 팀 컨테이너가 뜨고 OpenClaw 2.0 에이전트를 팀원과 함께 쓴다.
3. 결과물은 드라이브에 쌓이고, 웹 앱은 Private으로 바로 띄우거나 관리자 승인을 거쳐 Public으로 공개한다.
4. 개발자가 스캐폴딩으로 만든 MCP를 올리면 관리자 심사 후 다른 팀이 마켓에서 설치해 쓴다.

전부 클라우드에서만 동작하고 개인 PC 연동은 하지 않는다. 인프라는 GCP VM 한 대에 모두 올리고 AWS는 쓰지 않는다. 1인 개발이라 모노레포 하나에 두고 기성 도구(Traefik, Postgres, OpenClaw 공식 이미지, MCP SDK)를 최대한 활용한다.

## 전체 아키텍처

모든 구성 요소는 GCP VM 한 대의 docker-compose에서 돈다. 브라우저 요청은 전부 프록시를 거치고, 컨테이너를 만들 수 있는 건 오케스트레이터뿐이다.

&#91;embedded content: 전체 구성 · GCP VM 한 대\]

관리자가 할당한 에이전트는 오케스트레이터가 팀 컨테이너 설정에 반영하고, 에이전트는 platform-mcp의 run\_app으로 앱 실행을 부탁한다. 모든 컨테이너의 데이터는 VM의 `/data` 디스크에 바인드 마운트된다.

## 프로젝트 구성

직접 개발할 프로젝트는 6개이고, OpenClaw 이미지와 인프라는 설정만 한다. 전부 모노레포 하나에 둔다.

| 경로 | 구분 | 하는 일 |
| --- | --- | --- |
| apps/web | 개발 | 사원 화면과 관리자 화면(`/admin`)을 한 앱에서 역할별로 제공 |
| apps/api | 개발 | 모든 상태와 권한의 중심. DB, 팀·사용자, 에이전트 할당, 드라이브, 배포 승인, MCP 레지스트리 |
| apps/proxy | 개발(소) | Traefik 설정 + forward-auth 연동. 서브도메인 라우팅과 로그인 확인 |
| apps/orchestrator | 개발 | 팀·앱·MCP 컨테이너 생명주기, MCP 빌드, 리소스 제한, 사용량 수집 |
| packages/platform-mcp | 개발 | 모든 팀 기본 설치 MCP. 앱 실행·배포 도구와 드라이브 도구 |
| packages/create-platform-mcp | 개발 | 개발자용 MCP 스캐폴딩 템플릿과 validate/pack 명령 |
| deploy/openclaw-image | 설정 | 공식 이미지 기반 Dockerfile, openclaw.json 템플릿, 기본 지시문 |
| deploy/infra | 설정 | GCP VM 초기화, docker-compose, 백업, 배포 스크립트 |

Public 배포 서비스는 별도 프로젝트가 아니다. 앱 컨테이너는 같고, 오케스트레이터가 실행하고 프록시가 주소와 공개 범위만 바꾼다.

## 개발 목록 (전체)

만들어야 하는 것을 빠짐없이 나열했다. 버전별 순서는 나중에 이 목록에서 골라 배치한다.

### 설계 산출물 (코드 전)

- [ ] 화면 설계: 사원 화면 + 관리자 화면 전체 (Claude Design)
- [ ] 디자인 기준: 색, 글꼴, 간격, 공통 컴포넌트(헤더, 표, 상태 배지, 모달)
- [ ] 데이터 모델(ERD)
- [ ] API 명세 초안(OpenAPI)
- [ ] URL·도메인 규칙과 폴더 구조(`/data` 아래)
- [ ] 로그인 설계: v1은 플랫폼 자체 계정, 나중에 SSO를 붙일 자리(사용자 식별 = 회사 이메일)

### apps/web · 사원 화면

- [ ] 공통 레이아웃: 헤더(로고, 팀 스위처, 에이전트·드라이브·배포관리, 전사 커뮤니티·MCP 마켓, 알림, 프로필)
- [ ] 로그인·로그아웃, 첫 로그인 비밀번호 변경, 내 비밀번호 변경, 역할별 라우팅, 소속 팀 없음 화면
- [ ] 에이전트: 얇은 셸 + OpenClaw Control UI iframe, 컨테이너 기동 중 로딩 화면
- [ ] 에이전트: 앱 실행 막대(미리보기, 배포 설정)
- [ ] 드라이브: 트리(내 드라이브 / 팀 공유), 파일 목록, 검색
- [ ] 드라이브: 업로드·다운로드, 새 폴더, 이름 변경, 이동, 복사, 휴지통
- [ ] 드라이브: 상세 패널(만든 사람·에이전트 배지, 권한, 변경 기록)
- [ ] 배포관리: 앱 목록·필터, 상세(상태, 리소스, 원본 폴더), 중지·로그
- [ ] 배포 설정: Private/Public 선택, Public 공개 요청과 진행 단계
- [ ] MCP 마켓: 목록·검색, 상세(도구 목록, 권한, 예시 문장)
- [ ] MCP 마켓: 팀에 설치(비밀값 입력, 권한 확인)
- [ ] MCP 마켓: 우리 팀 설치됨(마켓 설치 + 직접 추가, 상태, 마지막 확인 시각)
- [ ] MCP 마켓: 내 배포(zip 업로드, 검증·빌드·스캔·테스트 진행 상태, 버전 목록)
- [ ] 커뮤니티: 게시글 목록·작성·분류, MCP 공유 글에서 바로 설치
- [ ] 프로필: 내 정보(부서 경로·직위 포함, 읽기 전용), 팀별 "에이전트 화면에서 내 계정 관리" 링크(사람별 연결 상태는 플랫폼이 조회 불가 — spike 04)
- [ ] 알림: 승인 결과, 빌드 결과, 컨테이너 오류

### apps/web · 관리자 화면 (`/admin`)

- [ ] 대시보드: 팀 컨테이너 상태, VM CPU·메모리·디스크, 용량 경고, 처리 대기(승인·심사) 건수
- [ ] 사용자 관리: 계정 생성(이메일·이름·부서·직위·사번·초기 비밀번호), 비밀번호 초기화, 목록·검색(부서 트리 필터), 여러 명 부서 일괄 변경, 플랫폼 역할(관리자/일반), 소속 팀, 비활성화
- [ ] 조직 관리(`/admin/org`): 부서 트리(추가, 드래그로 상위 부서 이동, 보관), 부서 상세(구성원, 하위 부서, 부서명·코드·부서장). 삭제 없이 보관만
- [ ] 가져오기(CSV): 부서·사용자 일괄 등록, 미리보기(추가·변경·오류) 후 적용, 새 계정 초기 비밀번호는 결과 화면에서 한 번만 다운로드
- [ ] 팀 관리: 생성·삭제, 서브도메인, 멤버 추가·제거(사용자 검색 또는 부서 단위 일괄 추가), 팀 관리자 지정
- [ ] 팀 관리: 리소스 한도(CPU·메모리·디스크), 컨테이너 수동 시작·정지·재시작
- [ ] 에이전트 관리: 에이전트 템플릿(이름·아이콘·설명, 기본 모델과 추론 수준, 지시문, 스킬, 기본 MCP, 도구 권한) 만들기·수정
- [ ] 에이전트 할당: 팀별 에이전트 할당·해제, 적용 상태(반영 완료/대기)
- [ ] MCP 관리: 배포 심사(스캔 결과, 선언 권한, 네트워크 대상), 승인·반려
- [ ] MCP 관리: 게시 중단, 전사 기본 MCP 지정, 팀별 설치 현황, 직접 추가된 MCP 목록
- [ ] 배포 승인: Public 요청 목록, 승인·반려(사유), 공개 중인 앱 강제 중지
- [ ] 플랫폼 설정: 허용 모델·공용 API 키, 기본 리소스 한도
- [ ] 활동 기록: 승인·반려·삭제·설치·할당 이력

### apps/api

- [ ] 프로젝트 뼈대, Postgres 연결, 마이그레이션
- [ ] 테이블: 전체 목록과 정의는 `docs/design/03-data-model.md`가 기준(users·departments·teams·memberships·sessions·names·apps·mcp\_\* 등)
- [ ] 인증: 자체 계정(비밀번호 argon2 해시, \`.kacp.cloud\` 세션 쿠키, 로그인 시도 제한), 나중에 SSO를 붙일 수 있게 인증 계층 분리, 플랫폼 역할·팀 역할 권한 체크
- [ ] forward-auth 엔드포인트: 이 사용자가 이 주소에 들어갈 수 있는가
- [ ] 사용자·팀·멤버십 API, 이름 규칙 검사(예약어 차단, 팀·앱 공용 네임스페이스 중복 검사, \`--\` 금지)
- [ ] 조직 API: 부서 트리 조회·추가·수정·이동·보관, CSV 가져오기 작업(업로드 → 미리보기 → 적용). v1에서 부서는 권한을 주지 않고 표시·검색·일괄 추가에만 쓴다
- [ ] 에이전트 템플릿·팀 할당 API, 할당 변경 시 오케스트레이터에 설정 반영 요청
- [ ] 드라이브 파일 API: 경로 검사, 개인/팀 권한, 스트리밍 업로드·다운로드, 휴지통
- [ ] 앱·배포 API: 앱 등록·상태, Public 요청, 승인·반려 워크플로
- [ ] MCP 레지스트리 API: 패키지·버전·심사 상태, zip 접수
- [ ] MCP 설치 API: 팀 설치·제거 요청을 받아 오케스트레이터에 위임(오케스트레이터가 MCP 컨테이너 기동 + 팀 Secret Store 전달 + 팀 Gateway \`config.patch\`로 \`mcp.servers\` 반영). 비밀값은 DB에 저장하지 않음
- [ ] Gateway 동기화 워커: 오케스트레이터 경유(\`/internal/gateway/{team}/rpc\`)로 \`config.get\` 해 \`mcp.servers\` 조회, DB 캐시, 꺼진 팀은 건너뜀. admin-http-rpc와 Gateway 비밀번호는 오케스트레이터만 쓴다
- [ ] 커뮤니티 API, 알림 API
- [ ] 활동 기록 저장

### apps/proxy

- [ ] Traefik 정적 설정: `app.kacp.cloud` → 웹·API
- [ ] 동적 라우트: `팀.kacp.cloud` → 에이전트 셸 + 팀 Gateway, `앱--팀.kacp.cloud` → Private 앱, `앱.kacp.cloud` → Public 앱 (오케스트레이터가 등록). 등록되지 않은 주소는 기본 404 페이지
- [ ] forward-auth 연동, trusted-proxy 사용자 헤더 주입, 역할별 `x-openclaw-scopes`로 권한 상한 제한(부여가 아님), 클라이언트가 보낸 신원 헤더 제거
- [ ] Gateway 토큰은 쓰지 않음(trusted-proxy와 동시 사용 불가). 플랫폼 내부 호출만 팀별 Gateway 비밀번호 사용
- [ ] WebSocket 통과, 팀 라우트 응답에서 \`X-Frame-Options\` 제거 + \`frame-ancestors 'none'\` → \`'self'\` 재작성(로컬 플러그인), 앱 라우트에서 \`kacp_session\` 쿠키만 제거(로컬 플러그인)
- [ ] 와일드카드 인증서 \`kacp.cloud\` + \`\*.kacp.cloud\` 자동 발급·갱신(DNS-01, Cloud DNS)

### apps/orchestrator

- [ ] Docker API 클라이언트(소켓 프록시 경유)
- [ ] 팀 프로비저닝: 디렉터리·UID 생성, openclaw.json 시드(첫 기동 전 한 번, 할당된 에이전트 반영), 내부용 Gateway 비밀번호 발급
- [ ] 온디맨드: 로그인·셸 진입·관리자 시작 시 기동, 헬스체크, 참조 카운팅 유휴 정지. v1은 예약 기동 없음 — 팀 컨테이너가 잠든 동안 OpenClaw 예약 작업(cron)은 돌지 않는다
- [ ] 에이전트 할당 변경을 실행 중인 팀에 반영(`config.patch`. openclaw.json을 통째로 다시 쓰면 OpenClaw가 백업으로 되돌린다 — spike 02)
- [ ] 팀 관리자 지정·해제 시 팀 Gateway의 `gateway.auth.identityScopes`를 `config.patch`로 갱신(팀 관리자 admin은 이 설정으로만 부여, 재시작 없이 반영 — spike 02)
- [ ] 리소스 제한 적용·변경, 샌드박스 제한
- [ ] 앱 컨테이너: 원본 폴더(팀 공유 드라이브)만 마운트, 포트 등록, Traefik 라우트 등록, Public 전환, 중지
- [ ] MCP 빌드: 대기열(한 번에 하나), 이미지 빌드, 취약점 스캔, 테스트 실행으로 tools/list 추출
- [ ] MCP 호스팅: 팀별 MCP 컨테이너, 비밀값 주입, 네트워크 대상 제한, 팀 컨테이너와 함께 기동·정지, 팀 Gateway \`config.patch\`로 \`mcp.servers\` 반영
- [ ] admin-http-rpc 호출 창구: api 대신 팀 Gateway를 호출(\`config.get\`/\`config.patch\`), 팀 Gateway 비밀번호를 쓰는 유일한 곳. 팀별 사이드카 `kacp-gwagent-{team}`(네트워크 네임스페이스 공유, loopback 호출) 경유 — trusted-proxy 모드에서 비밀번호는 loopback에서만 통한다(spike 04)
- [ ] 사용량 수집(Docker stats) → 관리자 대시보드

### packages/platform-mcp

- [ ] 앱 도구: run\_app(폴더, 포트), stop\_app, deploy\_app(Public 요청)
- [ ] 드라이브 도구: 목록, 읽기, 저장
- [ ] 팀 MCP 서비스 토큰으로 팀 단위 인증. 대상은 팀 공유 드라이브만(OpenClaw가 호출자 신원을 넘기지 않음 — spike 05)

### packages/create-platform-mcp

- [ ] TypeScript 템플릿: 고정 영역(HTTP 전송, 헬스체크, Dockerfile)과 개발자 영역(`src/tools/`)
- [ ] 매니페스트 `platform-plugin.yaml`: 이름, 버전, 비밀값(v1은 팀 범위만 — 사람별 인증은 v2 OpenClaw per-requester OAuth, spike 05), 네트워크 대상, 리소스, 예시 문장
- [ ] getSecret 헬퍼, 명령 dev(MCP Inspector) · validate(서버와 같은 규칙) · pack(zip)
- [ ] README 템플릿(마켓 상세 페이지로 쓰임)

### deploy/openclaw-image

- [ ] 공식 이미지 기반 Dockerfile(버전 고정) + docker CLI(`docker:29-cli`에서 복사 — 샌드박스 형제 컨테이너용, spike 06), 샌드박스 이미지 `openclaw-sandbox:bookworm-slim` 빌드
- [ ] openclaw.json 템플릿: 멀티플레이어, trusted-proxy 인증(`trustedProxies` = Traefik의 Docker 네트워크 고정 주소, `deviceAutoApprove` 켜기, 팀 관리자 이메일은 `identityScopes`로 admin), 세션 역할(`gateway.roles`: member 하나, `sessions.others: "write"`, 상한 admin), `tools.sessions.visibility: "tree"`, `controlUi.basePath` `/claw`, `controlUi.allowedOrigins` = 팀 주소, admin-http-rpc 플러그인(`plugins.entries.admin-http-rpc.enabled`), `gateway.auth.password` SecretRef(재시작 필요 키), 샌드박스(요청자 폴더만 마운트), platform-mcp 등록. 시드는 파일이 없을 때만
- [ ] 기본 지시문: 웹 앱은 platform-mcp로 실행, 서버는 0.0.0.0 바인딩, 결과물 저장 위치

### deploy/infra

- [ ] GCP VM 생성·초기화 스크립트(Docker, 방화벽, 스왓, 데이터 디스크 마운트), Cloud DNS 영역·레코드, 서비스 계정 DNS 권한, 회사 IP 방화벽 규칙
- [ ] docker-compose: proxy, web, api, orchestrator, postgres, docker-socket-proxy
- [ ] Postgres 백업, 데이터 디스크 일일 스냅샷
- [ ] 배포 스크립트(빌드 → VM 반영), 로그 보관

## 핵심 설계 결정

지금까지 확정한 결정이다. 바꿀 때는 이 표를 먼저 고친다.

| 영역 | 결정 | 이유 |
| --- | --- | --- |
| 플랫폼 형태 | 웹만. 데스크톱 앱과 개인 PC 연동은 하지 않는다 | 로그인·프록시·팀 컨테이너 설계를 그대로 쓰고 1인 개발 범위에 맞다 |
| 인프라 | GCP VM 한 대에 전부, AWS는 쓰지 않음 | 운영 대상이 하나라 혼자 관리할 수 있다 |
| 격리 단위 | 팀당 컨테이너 하나, OpenClaw 멀티플레이어 모드 | 팀 협업이 목적이고, 사람별 분리는 operator 역할과 Connected Accounts가 맡는다 |
| 에이전트 할당 | 관리자가 에이전트 템플릿을 만들고 팀에 할당, 오케스트레이터가 팀 openclaw.json에 반영 | 팀이 직접 설정하지 않고도 검증된 에이전트를 바로 쓴다 |
| 화면 구성 | 에이전트만 OpenClaw Control UI를 프록시하고 나머지는 플랫폼이 직접 그린다 | 팀·드라이브·배포·관리는 플랫폼 데이터다 |
| 에이전트 화면 합치기 | 얇은 셸(상단 헤더 + 앱 막대) + Control UI iframe | 사이드바가 겹치지 않고 OpenClaw 업데이트에 영향을 받지 않는다 |
| 코드 실행 | 샌드박스 켬(`mode: all`, `scope: session`, 네트워크 없음, 루트 읽기 전용, uid 1000, 1GB). 팀 컨테이너에는 샌드박스 전용 docker-socket-proxy를 따로 붙인다. 샌드박스 턴에서도 MCP를 쓰도록 `tools.sandbox.tools.alsoAllow: ["bundle-mcp"]`. 그 밖의 컨테이너는 오케스트레이터만 만든다(spike 06) | 팀원 간 파일·토큰 분리를 지키고 한 사람의 스크립트가 팀 전체를 멈추지 않게 한다 |
| 앱 실행 | 에이전트는 platform-mcp의 run\_app으로만 앱을 띄운다. 원본 폴더(팀 공유 드라이브)만 앱 컨테이너에 넣는다 | 샌드박스는 일회용이고, 플랫폼이 앱 상태를 직접 알아야 한다 |
| 배포 범위 | Private = `앱--팀.kacp.cloud` 즉시 실행, 팀만. Public = 관리자 승인 후 `앱.kacp.cloud`, 승인 전에는 Private 유지. 팀·앱 이름은 하나의 네임스페이스, 예약어 차단, 이름 안 `--` 금지 | 한 단계 서브도메인이라 와일드카드 인증서와 로그인 쿠키로 커버된다 |
| MCP 목록 조회 | admin-http-rpc의 \`config.get\`으로 \`mcp.servers\` 조회 + DB 캐시, 설치는 \`config.patch\` | 컨테이너가 달라도 네트워크로 동작하고 나중에 GKE로 옮겨도 그대로 쓴다 |
| MCP 배포 | 스캐폴딩 → zip 업로드 → 플랫폼 빌드 → 관리자 심사 → 팀별 MCP 컨테이너 | MCP 코드가 팀 컨테이너 밖에서 돌고, 비개발자는 설치 버튼만 누른다 |
| 직접 추가 MCP | 팀 관리자만 가능, "검토되지 않음" 표시 + 마켓 등록 유도 | 실험은 막지 않되 보이게 하고, 좋은 건 정식 배포로 옮긴다 |
| 팀 관리자 권한 | admin은 팀 openclaw.json의 identityScopes에 이메일로 부여, 프록시의 x-openclaw-scopes는 상한으로만 사용 | x-openclaw-scopes는 권한을 좁히기만 하고, identityScopes는 세션 한정이라 영구 기기 권한을 넓히지 않는다 |
| 팀 채팅과 개인 대화 | `gateway.roles` member 하나(`sessions.others: "write"`, 상한 admin) + `tools.sessions.visibility: "tree"`. 세션 공개 범위 공유됨 = 팀 채팅, 초안 = 개인 대화(다른 팀원에게 안 보임), 팀 관리자는 전부 본다. `users.setRole`은 쓰지 않는다 | 기본값은 모두가 모든 세션을 본다(spike 02). 역할 상한은 부여가 아니라 하나로 충분하고, profile 생성 뒤 역할 지정 절차가 필요 없다 |
| 부서와 팀 | 부서는 실제 사내 소속(트리, 한 사람당 하나), 팀은 에이전트를 같이 쓰는 작업 단위(평평한 목록, 한 사람이 여러 팀). 부서가 팀을 만들지 않는다 | 사용자 데이터의 뿌리라 v1에 넣고, 나중에 SSO 조직도 연동과 v2 지식 권한의 기반이 된다 |

## 인프라

GCP 서울 리전에 n4d-standard-8 VM 한 대로 시작한다. LLM은 외부 API라 GPU는 필요 없고, 메모리가 먼저 부족해지는 워크로드다.

| 항목 | 값 |
| --- | --- |
| 리전 | asia-northeast3 (서울) |
| 머신 | n4-standard-8 (8 vCPU, 32GB). asia-northeast3-a에 n4d가 없어 n4로 만듦(spike 07) |
| 예상 용량 | 동시 활성 팀 5\~7개 (팀당 2\~4GB + 플랫폼 3\~4GB + MCP 빌드 여유) |
| 부팅 디스크 | Hyperdisk Balanced 50GB |
| 데이터 디스크 | Hyperdisk Balanced 200GB(`kacp-data`, 단일 영역, 삭제 시 유지), ext4, `/data`(fstab `nofail`), Docker data-root `/data/docker`, 일일 스냅샷 |
| OS | Ubuntu 24.04 LTS, 스왓 몇 GB |
| 네트워크 | 고정 외부 IP, 443은 회사 사무실 공인 IP 대역에만 개방(GCP 방화벽), SSH는 IAP 터널 |
| 도메인 | `kacp.cloud`(가비아 구매), 네임서버는 Google Cloud DNS로 위임, `kacp.cloud` + `*.kacp.cloud` A 레코드 → VM 고정 IP |

`/data` 아래에 팀별 OpenClaw 상태, 개인·팀 드라이브, 앱 소스, Docker 이미지와 빌드 캐시를 둔다. VM을 다시 만들어도 데이터는 남는다.

올린 뒤 며칠간 팀 컨테이너 실제 사용량을 Docker 통계로 측정하고, 그 값으로 팀당 기본 제한과 관리자 대시보드 용량 경고 기준을 정한다. 활성 팀이 10개를 넘으면 VM을 키우거나 GKE로 넘어갈지 그때 정한다.

### 도메인과 인증서

와일드카드 레코드와 와일드카드 인증서를 한 번만 설정하면, 이후 팀이나 앱이 늘어도 DNS를 다시 건드리지 않는다. 새 주소는 오케스트레이터가 Traefik에 라우트를 등록하는 순간 접속된다.

Cloud DNS를 고른 이유는 Traefik이 VM 서비스 계정 권한으로 DNS를 수정해 보관할 API 키가 없고, VM·방화벽·DNS를 GCP 콘솔 하나에서 관리할 수 있기 때문이다. 가비아 DNS는 Traefik(lego)의 자동 DNS-01 지원 목록에 없어 인증서를 손으로 갱신해야 한다.

1. GCP에서 `kacp.cloud` 공개 영역을 만들고 네임서버 4개를 확인한다.
2. 가비아 도메인 관리에서 네임서버를 그 4개로 바꾼다. 반영에 몇 시간 걸릴 수 있다.
3. Cloud DNS에 `kacp.cloud`와 `*.kacp.cloud` A 레코드를 VM 고정 IP로 추가한다.
4. VM 서비스 계정에 DNS 관리자 역할을 주고, VM 액세스 범위는 "모든 Cloud API에 대한 전체 액세스"로 둔다. 기본 범위로 만들면 역할이 있어도 DNS API가 거부된다(spike 07에서 실제로 겪음: `insufficient authentication scopes`). 범위는 VM을 정지한 상태에서만 바꿀 수 있다.
5. Traefik 인증서 리졸버를 `dnsChallenge.provider: gcloud`로 두고 프로젝트 ID를 환경변수(`GCE_PROJECT`)로 넣는다. 인증서는 `kacp.cloud` + `*.kacp.cloud`로 **websecure 진입점에서 한 번만** 요청하고, 라우터에는 `tls`를 적지 않는다(`docs/design/05-urls-and-storage.md` §1). 처음에는 Let's Encrypt staging으로 확인한 뒤 실제로 바꾼다.

| 용도 | 주소 | 접근 |
| --- | --- | --- |
| 플랫폼 웹·관리자 | `app.kacp.cloud` | 로그인한 모든 사용자 |
| 팀 에이전트 | `팀.kacp.cloud` (예: `team1.kacp.cloud`) | 그 팀 멤버 |
| Private 앱 | `앱--팀.kacp.cloud` (예: `lunch-vote--team1.kacp.cloud`) | 그 팀 멤버 |
| Public 앱 | `앱.kacp.cloud` (예: `sprint-board.kacp.cloud`) | 로그인한 모든 사용자 |

로그인 쿠키는 `.kacp.cloud`에 두고, 모든 주소는 회사 IP에서만 접속된다. 이름 규칙은 네 가지다.

- 예약어(`app`, `admin`, `api`, `www` 등)는 팀·앱 이름으로 쓸 수 없다.
- 팀 이름과 Public 앱 이름은 같은 자리를 쓰므로 하나의 테이블에서 중복 검사한다.
- 이름은 소문자·숫자·하이픈만, `--`는 금지한다(`앱--팀` 구분자 충돌 방지).
- 와일드카드 인증서는 한 단계만 커버하므로 `앱.팀.kacp.cloud` 같은 두 단계 주소는 쓰지 않는다.

## 개발 순서 제안

백지에서 시작하니 화면과 데이터 모델을 먼저 확정하고, 코드는 가장 불확실한 OpenClaw 연동 검증부터 시작한다. 각 단계는 통과 조건이 데모로 확인될 때 끝난다.

&#91;embedded content: 개발 순서 · 8단계, 단계마다 통과 조건\]

화면을 먼저 만드는 이유는 화면이 필요한 데이터와 API를 정해 주기 때문이다. 이미 캔버스로 그린 에이전트·드라이브·배포관리·커뮤니티 화면을 출발점으로 삼고, 관리자 화면과 MCP 마켓 화면을 추가하면 된다. 1단계에서 iframe이나 trusted-proxy가 안 되면 화면 구조를 바꿔야 하므로, 이 검증은 다른 코드보다 앞에 둔다. 3단계 이후는 서로 독립적이라 버전 계획에 맞춰 순서를 바꿔도 된다.

### 1단계 진행 방식

1단계는 질문 하나에 답하는 작은 검증(spike)으로 나눠 한 번에 하나씩 진행한다. 권한·성능·인증서처럼 실제 Linux 서버에서만 의미가 있는 것은 GCP VM에서, 나머지는 로컬(Windows Docker Desktop, WSL2 백엔드, `*.localhost` 도메인)에서 한다. 로컬에서는 bind mount 권한을 검증하지 않는다(06에서 VM으로 확인).

| spike | 확인 내용 | 장소 | 상태 |
| --- | --- | --- | --- |
| 01-proxy-auth | Traefik forwardAuth → trusted-proxy 신원 전달, 위조 헤더 덮어쓰기, 비멤버 403, Gateway 포트 미노출 | 로컬 | 완료 |
| 02-session-scopes | `controlUi.basePath` `/claw`, 팀원 간 세션 분리, `deviceAutoApprove`, 팀원·팀 관리자 권한 차이 | 로컬 | 완료 |
| 03-iframe-csp | 셸에서 `/claw` iframe, `X-Frame-Options` 제거와 `frame-ancestors` 재작성, WebSocket 업그레이드의 forwardAuth | 로컬 | 완료 |
| 04-admin-rpc | 팀 Gateway 비밀번호로 `config.get`/`config.patch`(`mcp.servers`), 사람별 Connected Accounts 조회 | 로컬 | 완료 |
| 05-mcp-identity | MCP 호출 시 호출자 신원이 MCP 서버에 넘어오는지 | 로컬 | 완료 |
| 06-lifecycle | docker-socket-proxy 경유 생성·기동·정지, 샌드박스 bind mount 경로와 UID, 콜드 스타트 시간 | GCP VM | 완료 |
| 07-domain-cert | Cloud DNS 위임, DNS-01 와일드카드 인증서 | GCP VM | 완료 |

- 검증용 코드는 레포 `spikes/NN-이름/`에 두고, 결론은 `docs/spikes/NN-이름.md`에 남긴다(OpenClaw 버전, 확인 방법, 결과, 설계 변경 여부).
- 본 코드(`apps/`, `packages/`)는 spike 코드를 import하거나 복사하지 않는다. 결론을 보고 새로 짜고, 1단계가 끝나면 `spikes/`는 지운다.
- 결과가 설계를 바꾸면 문서를 먼저 고친 뒤 다음 spike로 넘어간다.
- 이 계획은 레포 `docs/plan.md`로 옮겨 관리한다. 이후 변경은 레포에서만 한다.

## v1 범위 밖과 남은 결정

v1 다음으로 미룬 것들이다.

- GKE 이전: 노드 자동 확장, 개인 드라이브는 팀별 영구 디스크, 팀 공유는 Filestore, 샌드박스는 gVisor(GKE Sandbox)
- 모니터링 고도화: Docker stats → cAdvisor + Prometheus + Grafana
- 감사 로그 고도화 (v1은 관리자 활동 기록만)
- MCP: Python 템플릿, 버전 고정·롤백, OAuth 계정 연결
- Public 앱을 별도 인프라(Cloud Run 등)로 분리
- 온프레미스 Windows 서버(SMB/NFS) 지원
- 지식 기능(문서 등록·검색, 부서·팀 공개 범위, 출처 표시): v2. 설계 초안은 `docs/design/07-knowledge-v2.md`. 대비로 v1부터 Postgres는 pgvector 이미지, platform-mcp는 도구 하나당 파일 하나, 권한 판단은 api 한 곳

열려 있던 결정 사항과 결론이다. 모두 정리됐다.

- [x] 로그인 방식 → v1은 자체 계정, 관리자가 팀과 사용자를 직접 할당. 사내 SSO는 이후 연동
- [x] Gateway 제어 API → admin-http-rpc 플러그인의 \`config.get\`/\`config.patch\`로 \`mcp.servers\` 조회·설치. 실제 도구 목록은 업로드 테스트 단계에서 추출
- [x] iframe 차단 헤더 → 기본은 \`frame-ancestors 'none'\`. Traefik이 팀 라우트 응답 헤더를 재작성하고, 셸과 Control UI를 같은 팀 주소에 둔다 (1단계에서 검증)
- [x] 에이전트 템플릿 범위 → 이름·아이콘·설명, 모델과 추론 수준, 지시문, 스킬, 기본 MCP, 도구 권한. 채널·예약 작업·메모리 설정은 v2
- [x] 커뮤니티·MCP 마켓 위치 → 헤더 오른쪽 전사 그룹에 유지
- [x] 승인 권한 → Public 승인과 MCP 심사는 플랫폼 관리자만. 팀 관리자는 팀 안의 멤버·MCP 설치·직접 추가 MCP만
- [x] 접속 범위 → 회사 사무실 공인 IP만 허용. 재택 접속이 필요해지면 VPN 추가

조사 중 새로 생긴 확인 항목이다. 모두 1단계(기술 검증)에서 확인한다.

- [x] 2.0 멀티플레이어에서 trusted-proxy 신원으로 팀원 간 세션이 실제로 나뉘는지 (2026년 7월 이슈에서는 모든 operator가 모든 세션을 봤다) → 기본값은 안 나뉨, `gateway.roles`로 나뉨 (spike 02)
- [x] Traefik에서 응답 CSP의 `frame-ancestors`만 바꾸는 방법(헤더 재작성 플러그인 또는 전체 CSP 고정) → Traefik 로컬 플러그인. 전체 CSP 고정은 버전별 스크립트 해시 때문에 불가 (spike 03)
- [x] `deviceAutoApprove`로 사원이 페어링 화면 없이 바로 접속되는지 (spike 01, `docs/spikes/01-proxy-auth.md`)
- [x] 팀원·팀 관리자의 설정 화면 접근이 나뉘는지(`x-openclaw-scopes`는 상한, admin은 `identityScopes`로 부여) (spike 02)
- [x] forwardAuth가 WebSocket 업그레이드 요청에도 적용되는지 (spike 03)
- [x] 팀 Gateway 비밀번호로 admin-http-rpc를 호출해 `mcp.servers` 조회·변경과 사람별 Connected Accounts 조회가 되는지 → 비밀번호는 loopback에서만 통해 사이드카로, `mcp.servers` 조회·변경 ✅(hot reload), Connected Accounts ❌ 조회 불가 (spike 04)
- [x] OpenClaw가 MCP 호출 시 호출한 사용자 신원을 MCP 서버에 넘기는지(platform-mcp 권한 검사 방식 결정) → 안 넘김. 팀 단위 권한 + 팀 공유 드라이브만 (spike 05)
- [x] 샌드박스 형제 컨테이너의 bind mount 경로와 UID 권한이 VM에서 의도대로 동작하는지 → 워크스페이스 bind rw, uid 1000, 네트워크 없음. MCP는 `tools.sandbox.tools` 허용 필요 (spike 06)
- [x] 팀 컨테이너 콜드 스타트 시간(로그인 대기 화면 설계 기준) → VM 평균 25.3초 (spike 06)
- [x] (spike 01에서 발견) MCP 앱·대시보드 위젯이 쓰는 sandbox listener(Gateway 포트+1)의 라우팅 또는 `mcp.apps.sandboxOrigin` → v1은 끔, 켤 때 `{team}.sbx.kacp.cloud` (spike 03)

항목별 담당 spike와 진행 상태는 `docs/README.md` "1단계 통과 조건"이 기준이다. **1단계 완료(2026-10-01, 32/32).** 결론 요약은 같은 절의 "1단계 결론".

## 참고 자료

- [Trusted proxy auth (OpenClaw 문서)](https://docs.openclaw.ai/gateway/trusted-proxy-auth)
- [Trusted proxy auth 원문 (GitHub)](https://github.com/openclaw/openclaw/blob/main/docs/gateway/trusted-proxy-auth.md)
- [Admin HTTP RPC plugin](https://docs.openclaw.ai/plugins/admin-http-rpc)
- [Configuration — MCP, skills, and plugins](https://docs.openclaw.ai/gateway/config-extensions)
- [Control UI](https://docs.openclaw.ai/web/control-ui/index.html)
- [Issue #104499: trusted-proxy 신원 기반 세션 분리](https://github.com/openclaw/openclaw/issues/104499)
- [frame-ancestors 패치 사례 (yourclaw PR #17)](https://github.com/yourclaw/openclaw/pull/17)
- [Traefik ACME 인증서 리졸버 (와일드카드는 DNS-01 전용)](https://doc.traefik.io/traefik-hub/api-gateway/reference/install/tls/cert-resolvers/ref-certs-resolvers-acme)
