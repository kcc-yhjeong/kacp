# 04. API 명세 (초안)

외부 API의 계약 원본은 `openapi.yaml`이다. 이 문서는 규칙과 전체 목록, 그리고 OpenAPI에 넣지 않는 **내부 API·워커**를 정리한다.
엔드포인트를 추가·변경할 때는 `openapi.yaml`을 먼저 고치고, web은 `openapi-typescript`로 타입을 다시 생성한다.

## 1. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 기본 경로 | `https://app.kacp.cloud/api/v1` |
| 인증 | `kacp_session` 쿠키. 상태 변경(POST/PUT/PATCH/DELETE)은 `X-KACP-CSRF` 헤더 필수 |
| 형식 | JSON(`application/json`), 업로드만 `multipart/form-data` 또는 스트리밍 |
| 이름 규칙 | 경로는 kebab-case, JSON 필드는 camelCase, 시각은 ISO 8601 UTC 문자열 |
| 팀 지정 | 경로에 팀 **이름**(`/teams/{team}`), 나머지 리소스는 id |
| 목록 | `?cursor=&limit=`(기본 50, 최대 200) → `{ items: [], nextCursor: string \| null }` |
| 오류 | `{ error: { code: "TEAM_NOT_FOUND", message: "사용자에게 보여줄 한국어", details?: {} } }` |
| 비동기 작업 | 오래 걸리는 동작은 `202 Accepted` + 리소스의 `status` 필드로 진행 확인(폴링). 별도 job API는 두지 않음 |
| 검증 | 요청 본문은 zod 스키마(`packages/shared`)로 검증, 같은 스키마로 OpenAPI 컴포넌트 유지 |
| 감사 | 관리 행위는 핸들러에서 `audit(action, target, detail)` 호출 |

### 상태 코드

`200` 성공 · `201` 생성 · `202` 접수(비동기) · `204` 본문 없음 · `400` 검증 실패(`VALIDATION_FAILED`) · `401` 로그인 필요 · `403` 권한 없음 · `404` 없음 · `409` 충돌(이름 중복, 상태 충돌) · `413` 너무 큼 · `422` 규칙 위반(예약어 등) · `429` 시도 제한 · `503` 팀 컨테이너 꺼짐 등 일시 불가

### 주요 오류 코드

`AUTH_INVALID_CREDENTIALS` `AUTH_LOCKED` `AUTH_DISABLED` `AUTH_PASSWORD_CHANGE_REQUIRED` `AUTH_PASSWORD_POLICY` `CSRF_INVALID` `FORBIDDEN` `NAME_INVALID` `NAME_RESERVED` `NAME_TAKEN` `TEAM_NOT_FOUND` `TEAM_NOT_RUNNING` `APP_NOT_FOUND` `APP_STATE_CONFLICT` `APP_NOT_PUBLIC` `APP_ALREADY_PUBLIC` `APP_LIMIT_REACHED` `DEPLOY_ALREADY_PENDING` `DEPARTMENT_NOT_FOUND` `DEPARTMENT_CYCLE` `DEPARTMENT_TOO_DEEP` `DEPARTMENT_NOT_EMPTY` `IMPORT_STALE` `IMPORT_INVALID_CSV` `DRIVE_PATH_INVALID` `DRIVE_NOT_FOUND` `DRIVE_EXISTS` `DRIVE_QUOTA_EXCEEDED` `MCP_NOT_FOUND` `MCP_MANIFEST_INVALID`(`details.problems[]`) `MCP_TOO_LARGE` `MCP_VERSION_EXISTS` `MCP_SUSPENDED` `MCP_ALREADY_INSTALLED` `MCP_NOT_PUBLISHED` `MCP_PLATFORM_LOCKED` `MCP_STATE_CONFLICT` `ORCHESTRATOR_UNAVAILABLE`

## 2. 외부 API 목록

권한 표기:

- `없음` 로그인 없이 호출 가능
- `로그인` 로그인한 모든 사용자
- `멤버` 그 팀의 구성원 전체(`06-auth.md`의 팀원 + 팀 관리자)
- `팀관리` 그 팀의 팀 관리자. 플랫폼 관리자는 **관리 API(팀 설정·멤버·MCP 설치)만** 함께 통과한다(`06-auth.md` §7 마지막 문단). 그 밖의 `팀관리` 행(앱 삭제·공개 중지, 휴지통 영구 삭제 등)은 팀 관리자만
- `본인` 그 리소스의 작성자(휴지통 항목은 지운 사람)
- `관리자` 플랫폼 관리자

### 인증·나

| 메서드 | 경로 | 권한 | 설명 | 화면 |
|---|---|---|---|---|
| POST | `/auth/login` | 없음 | 이메일·비밀번호 → 세션 쿠키 | C-01 |
| POST | `/auth/logout` | 로그인 | 현재 세션 폐기 | C-00 |
| GET | `/auth/me` | 로그인 | 내 정보, 역할, `mustChangePassword`, `csrfToken` | 전체 |
| POST | `/auth/password` | 로그인 | 비밀번호 변경(첫 로그인 포함) | C-02, U-14 |
| GET | `/me/teams` | 로그인 | 소속 팀 + 팀 역할 + 컨테이너 상태 | C-00 |
| GET | `/me/sessions` | 로그인 | 내 로그인 세션 목록 | U-14 |
| DELETE | `/me/sessions` | 로그인 | 현재 세션 외 모두 폐기 | U-14 |
| GET | `/me/notifications?limit=` | 로그인 | 최근 알림(기본 30) `{items: [{id, type, title, link, createdAt, readAt}], unread}`. `link`는 앱 경로(`/…`) 또는 팀 주소(`https://…`) | C-06 |
| GET | `/me/notifications/unread-count` | 로그인 | 안 읽은 수 `{count}`(웹은 30초마다) | C-00 |
| POST | `/me/notifications/read` | 로그인 | `{ids}` 또는 `{all: true}` | C-06 |
| GET | `/departments` | 로그인 | 부서 트리(활성만, 선택 화면용). `?includeArchived=true`는 관리자만 | A-02, A-03, A-05, A-12 |
| GET | `/users/search?q=&departmentId=&includeDescendants=` | 로그인 | 사람 찾기(이름·이메일·부서 표시, 최대 20명) — 멤버 추가용 | U-15, A-05 |
| GET | `/names/check?name=` | 로그인 | 이름 사용 가능 여부 + 이유 | U-03, A-04 |
| GET | `/names/{name}` | 없음 | 호스트 분류 `{hostKind: team\|public_app\|private_app\|none, running}` — web 404 판단용, 최소 정보만(`names.kind`와 다른 값) | C-04 |

### 팀 (사원)

| 메서드 | 경로 | 권한 | 설명 | 화면 |
|---|---|---|---|---|
| GET | `/teams/{team}` | 멤버 | 팀 정보, 할당 에이전트, 한도, 상태 | U-15 |
| GET | `/teams/{team}/status` | 멤버 | 컨테이너 상태만(셸 폴링용, 가벼움) | U-01 |
| POST | `/teams/{team}/session` | 멤버 | 기동 보장 + presence 등록 → `202`/`200` + 상태 | U-01 |
| POST | `/teams/{team}/heartbeat` | 멤버 | presence 갱신 | U-01 |
| GET | `/teams/{team}/members` | 멤버 | 멤버 목록 | U-15 |
| POST | `/teams/{team}/members` | 팀관리 | 기존 사용자 추가 `{email, teamRole}` 또는 일괄 `{userIds[], teamRole}` | U-15, A-05 |
| PATCH | `/teams/{team}/members/{userId}` | 팀관리 | 팀 역할 변경 | U-15, A-05 |
| DELETE | `/teams/{team}/members/{userId}` | 팀관리 | 제거(마지막 팀 관리자는 제거 불가) | U-15, A-05 |

### 드라이브

`space` = `me` | `shared`, `path` = 공간 루트 기준 상대 경로(`/`로 시작, `..`·NUL·절대 경로 금지)
`space=me`는 본인만(팀 관리자·플랫폼 관리자도 불가).

| 메서드 | 경로 | 권한 | 설명 | 화면 |
|---|---|---|---|---|
| GET | `/teams/{team}/drive/list?space=&path=` | 멤버 | 폴더 내용 | U-04 |
| GET | `/teams/{team}/drive/search?space=&q=` | 멤버 | 이름 검색(최대 200건) | U-04 |
| GET | `/teams/{team}/drive/meta?space=&path=` | 멤버 | 상세 + 변경 기록 | U-05 |
| GET | `/teams/{team}/drive/download?space=&path=` | 멤버 | 파일 스트리밍 / 폴더는 zip | U-04, U-05 |
| POST | `/teams/{team}/drive/download-zip` | 멤버 | 여러 항목 zip `{space, paths[]}` | U-04 |
| GET | `/teams/{team}/drive/usage` | 멤버 | 팀 드라이브 사용량 `{usedBytes, limitBytes}` — 한도 = `teams.resource_limits.diskGb`(없으면 플랫폼 기본값). 1분 캐시 | U-04, U-15 |
| POST | `/teams/{team}/drive/upload?space=&path=` | 멤버 | multipart, 파일별 최대 500MB(제안), 같은 이름은 `(1)` 붙임 | U-04 |
| POST | `/teams/{team}/drive/folder` | 멤버 | `{space, path}` | U-04 |
| POST | `/teams/{team}/drive/rename` | 멤버 | `{space, path, newName}` | U-04 |
| POST | `/teams/{team}/drive/move` | 멤버 | `{from:{space,path}[], to:{space,path}}` — 공간 간 이동 허용 | U-04 |
| POST | `/teams/{team}/drive/copy` | 멤버 | 이동과 같은 형식 | U-04 |
| POST | `/teams/{team}/drive/trash` | 멤버 | `{space, paths[]}` → 휴지통 | U-04 |
| GET | `/teams/{team}/drive/trash` | 멤버 | 내가 볼 수 있는 휴지통 항목 | U-06 |
| POST | `/teams/{team}/drive/trash/{id}/restore` | 멤버 | 원위치 복원(충돌 시 이름 변경) | U-06 |
| DELETE | `/teams/{team}/drive/trash/{id}` | 본인·팀관리 | 영구 삭제(팀 관리자는 팀 공유 항목만) | U-06 |
| DELETE | `/teams/{team}/drive/trash` | 멤버 | 휴지통 비우기 — 지운 사람 본인 항목만, 팀 관리자는 팀 공유 항목 전부 `204` | U-06 |

드라이브 세부 규칙(4단계):
- 데이터 API라 **멤버만** 부른다. 멤버가 아닌 플랫폼 관리자도 `403`(`06-auth.md` §7).
- `upload`: multipart 순서대로 스트리밍한다. 폴더 업로드는 파일마다 `relativePaths`(예 `photos/2026/a.jpg`)를 **그 `files` 앞에** 붙인다. 중간 폴더는 api가 만든다(만든 폴더도 `create` 기록). 파일당 500MB 넘으면 `413 DRIVE_TOO_LARGE`, 팀 한도(`diskGb`, 휴지통 포함) 넘으면 `413 DRIVE_QUOTA_EXCEEDED`.
- `download?inline=1`: 이미지·PDF·텍스트만 inline. HTML·SVG는 스크립트가 돌 수 있어 `text/plain`으로 준다. 모든 파일 응답에 `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; …; sandbox`.
- `move`·`copy`: 같은 공간에서 자기 하위로 옮기거나 복사하면 `400`. 도착 폴더에 같은 이름이 있으면 `(n)`을 붙인다. 공간 간 이동이면 소유권을 도착 공간 규칙으로 바꾼다.
- `GET /drive/trash` 항목에는 `canPurge`(지운 사람이거나, 팀 공유 항목이고 팀 관리자)가 붙는다.
- 심볼릭 링크는 목록에서 숨기고, 경로에 링크가 끼면 `400 DRIVE_PATH_INVALID`.

### 앱·배포

앱은 작업본(`work`)과 공개본(`public`) 두 사본을 가진다. 제어 API는 사본별로 나뉜다.

| 메서드 | 경로 | 권한 | 설명 | 화면 |
|---|---|---|---|---|
| GET | `/teams/{team}/apps?work=&public=` | 멤버 | 앱 목록(두 사본 상태 + 사본별 최근 메모리 `memoryMb`(마지막 `usage_samples`, 꺼져 있으면 null) 포함). 필터 값은 표 아래 | U-02, U-07 |
| GET | `/apps/{appId}` | 멤버 | 상세 + 대기 중 요청 + 버전 이력 | U-08, U-03 |
| GET | `/apps/{appId}/stats?target=work\|public&range=1h` | 멤버 | CPU·메모리 추이 | U-08 |
| GET | `/apps/{appId}/logs?target=work\|public&tail=500` | 멤버 | 로그 | U-08 |
| POST | `/apps/{appId}/work/{start\|stop\|restart}` | 멤버 | 작업본 제어 `202` | U-02, U-08 |
| POST | `/apps/{appId}/public/{start\|stop\|restart}` | 멤버 | 공개본 제어 `202`(관리자 강제 중지 상태면 `409`). 팀원이 중지하면 `stop_reason=manual` — 다시 시작할 때까지 접속자에게 "앱 멈춤" | U-08 |
| DELETE | `/apps/{appId}` | 팀관리 | 앱 삭제(두 사본·두 데이터, 원본 폴더 유지) | U-08 |
| POST | `/apps/{appId}/public-request` | 멤버 | 미공개면 `{name, reason}` → `publish`, 공개 중이면 `{reason}` → `update`(변경 목록 계산) `201` | U-03 |
| DELETE | `/apps/{appId}/public-request` | 멤버 | 대기 중 요청 취소 | U-03 |
| POST | `/apps/{appId}/unpublish` | 팀관리 | 공개 중지(공개본·이름 제거, 작업본 유지) `202` | U-03 |
| GET | `/app-hosts/{host}` | 없음* | 앱 호스트 상태 `{exists, copy: work\|public, appId, status, stopReason, statusDetail, canWake}` — C-04 판단용. `statusDetail`은 관리자 강제 중지 사유(로그인 사용자에게만) | C-04 |
| POST | `/app-hosts/{host}/wake` | 멤버(작업본) / 로그인(공개본) | 잠든 사본 기동 `202`. `stopReason`이 `idle`·`limit`일 때만 | C-04 |
| GET | `/public-apps?q=` | 로그인 | 공개 중인 앱 목록 `{id, name, slug, team, url, version}` — 게시글 첨부 선택용 | U-13 |

\* `/app-hosts/{host}` 는 로그인하지 않았으면 존재 여부만 준다.

앱 목록 필터: `work` = `running` | `sleeping`(stopped + `stopReason` `idle`·`limit`) | `stopped`(stopped + `manual`·`admin`) | `error`. `public` = `none`(미공개) | `publish_pending`(공개 요청 대기) | `update_pending`(공개 중 + 업데이트 요청 대기) | `live`(공개 중, 대기 없음).
`stopReason`은 `idle` | `limit` | `manual` | `admin`뿐이다. 오류는 `status=error` + `statusDetail`로 나타낸다.

v1 앱은 전부 에이전트가 만들므로(`creator` 없음) `본인` 권한이 없다. 시작·중지·재시작·공개 요청·요청 취소는 `멤버`, 삭제·공개 중지는 `팀관리`(플랫폼 관리자는 `/admin/apps/{appId}/public/*`로만 개입).

앱 **생성**은 외부 API에 없다. platform-mcp의 `run_app`만 내부 API로 만든다.

### MCP 마켓

| 메서드 | 경로 | 권한 | 설명 | 화면 |
|---|---|---|---|---|
| GET | `/mcp/packages?q=&category=&sort=popular\|recent&team=` | 로그인 | 게시된 패키지(+platform-mcp). `installedInTeam`은 `team`(본인 소속 팀만) 기준 | U-09 |
| GET | `/mcp/packages/{pkg}?team=` | 로그인 | 상세(README, 매니페스트, 도구, 게시 이력) + `canInstallTeams`(설치할 수 있는 팀) | U-10 |
| GET | `/teams/{team}/mcp/installs` | 멤버 | 설치 목록(맨 앞 platform-mcp 가상 행) + `teamRunning`, `lastSyncedAt`, `canManage` | U-11 |
| POST | `/teams/{team}/mcp/installs` | 팀관리 | `{packageName, version?, secrets: {NAME: value}}` → `202`. 최신 게시 버전만. 필수 비밀값 누락 `422`(`details.missing`) | U-10 |
| PUT | `/teams/{team}/mcp/installs/{id}/secrets` | 팀관리 | 비밀값 다시 입력 `{secrets}` — **채운 값만 바꾸고 빈 값은 기존 값 유지** → `202` | U-11 |
| DELETE | `/teams/{team}/mcp/installs/{id}` | 팀관리 | 제거 → `202`. platform 행 `409 MCP_PLATFORM_LOCKED`. 직접 추가는 팀이 실행 중일 때만 | U-11 |
| POST | `/teams/{team}/mcp/manual` | 팀관리 | 직접 추가 `{name, url, headers?}` → `201`. 팀 실행 중일 때만. 헤더 값은 Gateway로만 가고 DB엔 헤더 이름만 | U-15 |
| POST | `/mcp/uploads` | 로그인 | zip 업로드(최대 50MB) → 새 버전 `201` | U-12 |
| GET | `/me/mcp/packages` | 로그인 | 내가 올린 패키지·버전 | U-12 |
| GET | `/mcp/packages/{pkg}/versions/{ver}` | 본인·관리자 | 버전 상태·스캔·도구 | U-12 |
| GET | `/mcp/packages/{pkg}/versions/{ver}/logs?stage=` | 본인·관리자 | 단계 로그 | U-12, A-07 |

비밀값은 요청 본문에서 받아 **바로** orchestrator → 팀 Secret Store로 넘기고, 로그·DB·감사 기록에 남기지 않는다(이름만 기록).

### 커뮤니티

| 메서드 | 경로 | 권한 | 설명 | 화면 |
|---|---|---|---|---|
| GET | `/posts?category=&q=&cursor=` | 로그인 | 최신순 50개 `{items, nextCursor}`(`cursor` = 마지막 글 `createdAt`) | U-13 |
| GET | `/posts/{id}?team=` | 로그인 | 본문 + 첨부 카드(`attachedPackage` = McpPackageSummary, `team` 기준 `installedInTeam` · `attachedApp` = `{id, name, slug, team, url, version, available}`) + `canEdit` | U-13 |
| POST | `/posts` | 로그인 | 작성 `{category, title, bodyMd, attachedPackage?: 패키지 이름, attachedAppId?}`(`notice`는 관리자만 `403`, 게시 안 된 MCP `422 MCP_NOT_PUBLISHED`, 공개 안 된 앱 `422 APP_NOT_PUBLIC`) → `201` | U-13 |
| PATCH | `/posts/{id}` | 본인·관리자 | 수정(일부 필드, 첨부 `null`이면 떼기) | U-13 |
| DELETE | `/posts/{id}` | 본인·관리자 | 삭제 | U-13 |
| GET | `/posts/{id}/comments` | 로그인 | 댓글(오래된 순) `{items: [{id, body, author, createdAt, canDelete}]}` | U-13 |
| POST | `/posts/{id}/comments` | 로그인 | `{body}`(1~2000자) → `201`, 글쓴이에게 `post_commented` 알림 | U-13 |
| DELETE | `/posts/{id}/comments/{commentId}` | 본인·관리자 | 지우기 → `204` | U-13 |
| GET | `/post-categories` | 로그인 | 분류 `{items: [{key, label, adminOnly, hidden, canPost}]}`(숨김은 관리자에게만) | U-13 |
| PUT | `/admin/post-categories` | 관리자 | 분류 전체 `{items: [{key, label, adminOnly, hidden}]}`(배열 순서 = 표시 순서). 글 있는 분류 삭제는 `422` | U-13 |

### 관리자 (`/admin/*`, 전부 관리자)

| 메서드 | 경로 | 설명 | 화면 |
|---|---|---|---|
| GET | `/admin/dashboard` | 요약 카드, 팀 컨테이너 표, 대기 건수, 경고 | A-01 |
| GET | `/admin/metrics?target=&range=` | 추이. `target`(필수) = `vm` \| `team:{name}` \| `app:{appId}`, `range` = `24h`(기본) \| `7d` | A-01 |
| GET | `/admin/users?q=&role=&status=&team=&departmentId=&includeDescendants=` | 목록. `status` = `active` \| `disabled` \| `must_change_password`(파생 값: active + 비밀번호 변경 필요) | A-02 |
| POST | `/admin/users/bulk-department` | `{userIds[], departmentId}` 여러 명 부서 변경 | A-02, A-12 |
| POST | `/admin/users` | 생성 → 초기 비밀번호 1회 반환 | A-03 |
| GET | `/admin/users/{userId}` | 상세 + 최근 로그인 | A-03 |
| PATCH | `/admin/users/{userId}` | 이름·부서·직위·사번·역할 | A-03 |
| POST | `/admin/users/{userId}/reset-password` | 임시 비밀번호 1회 반환 | A-03 |
| POST | `/admin/users/{userId}/disable` · `/enable` | `{restartTeams?: boolean}` | A-03 |
| POST | `/admin/departments` | `{name, code?, parentId?, headUserId?, sortOrder?}` | A-12 |
| PATCH | `/admin/departments/{id}` | 이름·코드·부서장·정렬 | A-12 |
| POST | `/admin/departments/{id}/move` | `{parentId \| null, sortOrder?}` 순환(`DEPARTMENT_CYCLE`)·최대 깊이 초과(`DEPARTMENT_TOO_DEEP`)면 `422` | A-12 |
| POST | `/admin/departments/{id}/archive` · `/unarchive` | 구성원·활성 하위가 있으면 `409` | A-12 |
| GET | `/admin/departments/{id}/members?includeDescendants=` | 구성원 | A-12 |
| POST | `/admin/import/{kind}/preview` | `kind`=`departments`\|`users`, multipart CSV → import_job(미리보기 결과) | A-13 |
| POST | `/admin/import/{kind}/apply` | `{jobId, skipErrors}` → 결과. users면 새 계정 초기 비밀번호 CSV를 응답에 한 번 포함 | A-13 |
| GET | `/admin/teams` | 목록 | A-04 |
| POST | `/admin/teams` | `{name, displayName, adminEmails[], memberUserIds?[], resourceLimits?}` → `202` 프로비저닝 | A-04 |
| GET | `/admin/teams/{team}` | 상세 | A-05 |
| PATCH | `/admin/teams/{team}` | 표시 이름 수정 `{displayName}` | A-05 |
| DELETE | `/admin/teams/{team}` | 삭제(`{confirmName}`) → `202` | A-05 |
| POST | `/admin/teams/{team}/container/{action}` | `start` \| `stop` \| `restart` | A-05 |
| PUT | `/admin/teams/{team}/resources` | 한도 변경(실행 중이면 즉시 적용) | A-05 |
| GET | `/admin/teams/{team}/agents` | 할당 목록 + 적용 상태 | A-05 |
| POST | `/admin/teams/{team}/agents` | `{templateIds[]}` 할당 → `202` | A-05 |
| DELETE | `/admin/teams/{team}/agents/{templateId}` | 해제 → `202` | A-05 |
| GET | `/admin/agent-templates` | 목록 | A-06 |
| POST | `/admin/agent-templates` | 생성 | A-06 |
| GET·PUT·DELETE | `/admin/agent-templates/{id}` | 조회·수정(버전+1, 할당 팀 `pending`)·삭제(할당 없을 때만) | A-06 |
| GET | `/admin/mcp/reviews` | 심사 대기 | A-07 |
| GET | `/admin/mcp/versions/{id}` | 심사 상세(이전 버전 차이 포함) | A-07 |
| GET | `/admin/mcp/versions/{id}/source` | 소스 zip | A-07 |
| POST | `/admin/mcp/versions/{id}/approve` · `/reject` | `{note}`(반려 필수) | A-07 |
| GET | `/admin/mcp/packages` | 전체 패키지 | A-08 |
| POST | `/admin/mcp/packages/{pkg}/suspend` · `/resume` | 게시 중단 `{removeInstalls: boolean}` | A-08 |
| PUT | `/admin/mcp/packages/{pkg}/default` | `{isDefault}` | A-08 |
| GET | `/admin/mcp/installs?team=&source=` | 팀별 설치·직접 추가 목록 | A-08 |
| DELETE | `/admin/mcp/installs/{id}` | 강제 제거 | A-05 |
| GET | `/admin/mcp/versions/{id}/logs?stage=` | 단계 로그 | A-07 |
| GET | `/admin/deploy-requests?status=` | Public 요청 | A-09 |
| POST | `/admin/deploy-requests/{id}/approve` · `/reject` | `{note}` → 승인은 `202`(publish: 스냅샷 v1 + 이름 등록 + 공개본 기동 / update: 스냅샷 v+1 + 공개본 재시작) | A-09 |
| GET | `/admin/apps?public=true&team=` | 앱 목록(공개 중만 필터) | A-05, A-09 |
| POST | `/admin/apps/{appId}/public/force-stop` | 공개본 강제 중지 `{reason}` (작업본 영향 없음) | A-09 |
| POST | `/admin/apps/{appId}/public/resume` | 강제 중지 해제(공개본 다시 기동) `202` | A-09 |
| GET | `/admin/settings` | 설정(API 키는 설정 여부만) | A-10 |
| PUT | `/admin/settings` | 부분 수정 | A-10 |
| GET | `/admin/models` | 템플릿 모델 고르기용 목록 `{items: [{ref, name, provider}], teams}` — 실행 중인 팀 Gateway `models.list`의 합(10분 캐시, 그 팀에 키가 있는 모델만) | A-06 |
| GET | `/admin/audit-events?from=&to=&actor=&action=&targetType=&targetId=&team=` | 활동 기록. A-03 사용자 상세 "활동"은 `actor=`(그 사람이 한 일)와 `targetType=user&targetId=`(그 사람에게 일어난 일)를 합쳐 보여준다 | A-11, A-03 |

## 3. 내부 API (OpenAPI에 넣지 않음)

외부 라우터에 연결되지 않은 경로. 서비스 간 공유 토큰(`INTERNAL_TOKEN` 환경변수, `Authorization: Bearer`)으로 인증.

### api가 받는 것

| 경로 | 호출자 | 설명 |
|---|---|---|
| `GET /internal/forward-auth` | Traefik | `06-auth.md` §5 |
| `POST /internal/mcp/apps/run` | platform-mcp | `{folder, port, command?, runtime?, name?}` → 같은 폴더의 앱이 있으면 작업본 재시작, 없으면 앱 생성 + 작업본 실행 → `{appId, url, status, isNew}`. 팀 동시 실행 한도를 넘으면 가장 오래 안 쓴 작업본을 `limit`으로 재움 |
| `POST /internal/mcp/apps/stop` · `POST /internal/mcp/apps/deploy` · `GET /internal/mcp/apps` | platform-mcp | `stop_app`(`{app}` 이름 또는 id) · `deploy_app`(`{app, reason, name?}`, `requested_by = null`) · `list_apps` (5단계 확정 경로) |
| (인증) | platform-mcp | 팀 MCP 토큰 `{team}.{HMAC(INTERNAL_TOKEN, "mcp:"+team)}` — api가 다시 계산해 확인, 저장 없음. platform-mcp는 받은 토큰을 그대로 넘긴다 |
| `GET /internal/mcp/drive/list` · `read` · `POST write` | platform-mcp | 드라이브 도구. `actor_kind=agent`로 기록 |
| `POST /internal/usage` | orchestrator | 1분마다 `{samples: [{targetType: vm\|team, targetId, cpuPct, memBytes, memLimitBytes, diskBytes?}]}` → `usage_samples` (3단계) |
| `POST /internal/events` | orchestrator | 상태 변경 통지 `{type: team.status\|team.provision\|app.status\|mcp.build\|mcp.install, id, status, detail}`(`team.provision`의 `detail.stage` = `name`→`storage`→`container`→`default_mcp`→`done`, A-04 진행 표시) → DB 반영 + 알림. `app.status`는 `copy: work\|public`, `stopReason`(stopped일 때 `idle`\|`limit`\|`manual`\|`admin`, 아니면 null)을 더 보낸다 |

platform-mcp 인증: `Authorization: Bearer {팀 MCP 서비스 토큰}`만. api는 팀까지만 안다. OpenClaw가 호출자 신원을 넘기지 않으므로(spike 05) 사람 단위 권한 검사는 하지 않고, 대상은 팀 공유 드라이브로 제한한다(`06-auth.md` §8).

### orchestrator가 받는 것 (`http://orchestrator:4000`, api만 호출)

| 경로 | 설명 |
|---|---|
| `POST /internal/teams/{team}/provision` | 디렉터리·UID/GID·openclaw.json **시드**(첫 기동 전 한 번)·Gateway 비밀번호·MCP 토큰 생성, 기본 MCP 설치 |
| `POST /internal/teams/{team}/ensure-running` | 멈춰 있으면 기동(멱등). 컨테이너 생성 시 healthcheck를 재정의한다(테스트는 이미지 것 그대로 `node dist/docker-healthcheck.js`, `interval 30s`, `start_interval 5s`, `start_period 60s`). 이미지 기본 interval 180초로는 기동 타임아웃 120초 안에 healthy가 안 될 수 있다(spike 01). VM 실측 기동 → healthy 약 25초(spike 06, 콜드·웜 차이 0.2초 미만) |
| `POST /internal/teams/{team}/stop` · `restart` | **항상 정상 정지**(`POST /containers/{id}/stop?t=30`, SIGTERM). 비정상 종료(OOM·kill·VM 재부팅)된 팀 컨테이너는 **지우지 말고 같은 컨테이너를 다시 start**한다(VM: kill 뒤 32초에 healthy). 실행 중인 Gateway를 강제로 지우고 새 컨테이너를 만들면 상태 폴더 owner lease가 약 5분 남아 `Another Gateway owner lease is still active`로 종료된다(spike 06 로컬). 이 오류는 `error`로 보내지 말고 백오프 재시도(최대 6분) |
| `POST /internal/teams/{team}/apply-config` | 할당 에이전트·MCP·**팀 관리자 목록(`identityScopes`)** 반영. 실행 중이면 `config.patch`(roles·`identityScopes`는 hot reload, spike 02), 꺼져 있으면 다음 기동 직후 `config.patch`. **openclaw.json을 통째로 다시 쓰지 않는다** — 첫 기동 이후 파일을 바꾸면 OpenClaw가 `Config auto-restored from backup`으로 되돌리고, 그 백업이 최신이 아니어서 최근 hot reload 변경까지 잃을 수 있다(spike 02·03). 시드는 파일이 없을 때만. `controlUi.basePath`처럼 재시작이 필요한 키는 프로비저닝 때만 정한다. api는 팀 관리자 지정·해제 때도 호출한다. admin-http-rpc `config.patch` 경로로도 확인(spike 04: 지정 200, 해제는 `replacePaths` 필요) |
| `PUT /internal/teams/{team}/resources` | `docker update` |
| `DELETE /internal/teams/{team}` | 정상 정지 → 컨테이너(팀·사이드카·MCP)·네트워크 제거, 데이터 `backups/deleted-teams`로 이동 |
| `POST /internal/apps/{appId}/{work\|public}/run` | 사본 실행 `{team, slug, copy, publicName?, version?, sourceRel, dataRel, runtime, command, port, env, limits}` → 202, 결과는 `app.status` 이벤트. 작업본은 컨테이너 교체, 공개본은 새 버전 컨테이너(`kacp-pub-{name}-v{n}`)가 응답하면 이전 버전 제거(무중단) |
| `POST /internal/apps/{appId}/{work\|public}/stop` · `DELETE /internal/apps/{appId}/{work\|public}` | 정지(컨테이너는 로그용으로 남김) · 제거 |
| (스냅샷·차이) | **api가 한다**(5단계 결정): 승인 때 원본 → `apps/{id}/snapshots/{v}` 복사(최근 3개), update 요청 때 파일 차이 계산 |
| (헬스) | orchestrator가 `kacp-edge`로 `http://{컨테이너}:{port}/` 응답을 기다림(90초) |
| (사용량) | 앱 컨테이너 Docker stats → `usage_samples` `target_type=app`, `target_id={appId}:{work\|public}` |
| `GET /internal/apps/{appId}/{work\|public}/logs?tail=` | `{lines}` (Docker 로그 프레임 해석) |
| `POST /internal/mcp/builds` | `{versionId, pkg, version, resources}` → 202. 대기열은 api가 정한다(한 번에 하나, `uploaded` 중 가장 오래된 것). 단계마다 `mcp.build` 이벤트 `{status: building\|scanning\|testing\|in_review\|failed, failedStage?, detail?, imageRef?, scanSummary?, findings?, tools?}`. 로그 `/data/mcp/{pkg}/{ver}/{build,scan,test}.log` |
| `DELETE /internal/mcp/images/{pkg}/{version}` | 반려·대체된 버전 이미지 제거(실패한 버전은 orchestrator가 바로 지움) |
| `PUT /internal/teams/{team}/mcp/{key}` | 설치·업그레이드 `{pkg, version, network, resources, secrets\|null}` → 202. 팀 Secret Store에 쓰고(`null`이면 유지) 패키지 공용 서버를 보장(없거나 버전·허용 도메인·한도가 바뀌면 교체, healthy까지 대기). 결과 `mcp.install` 이벤트 `{id: team, key, status: installed\|error\|removed}` → api가 apply-config(그 팀 헤더 반영) |
| `PUT /internal/teams/{team}/mcp/{key}/secrets` `{secrets}` · `DELETE /internal/teams/{team}/mcp/{key}` · `DELETE /internal/mcp/packages/{pkg}` | 비밀값 병합(빈 값은 유지, 서버는 그대로 — 다음 apply-config가 헤더 갱신) · 그 팀 Secret Store 삭제 · 마지막 팀이 제거한 뒤 공용 서버 삭제(api가 남은 설치 수로 판단) |
| `PUT /internal/gateway/{team}/mcp-manual/{key}` | 직접 추가 `{server: {url, headers?}\|null}` → 실행 중 Gateway에 `config.patch` 한 항목(동기) |
| (apply-config `mcpServers`) | 설치된 마켓·기본 MCP `[{key, url}]` → `mcp.servers.{key}`. **Gateway 키는 패키지 이름의 `-`를 `_`로 바꾼 것**(`my-weather` → `my_weather`, shared `mcpGatewayKey`). OpenClaw 도구 이름이 `{key}__{tool}`이 되는데, 일부 모델(VM gpt-5.6-luna)은 하이픈이 든 함수 이름을 호출하지 못한다(6단계 VM 확인). 컨테이너·Secret Store·DB(`server_key`)는 패키지 이름 그대로. 모든 팀을 Codex `codexDynamicToolsLoading: "direct"`로 맞춘다(`plugins.entries.codex`가 없어도 — Codex 플러그인은 기본으로 켜져 있고, 템플릿 키로 OpenAI를 쓰는 팀은 Control UI를 거치지 않아 항목이 생기지 않는다, 7단계 VM 확인) — 기본 `searchable`은 MCP 도구를 Codex 도구 검색 뒤에 숨겨 작은 모델이 찾지 못한다(6단계 VM 확인). URL이 `http://kacp-mcp-*:8080/mcp`인 관리 항목만 지운다(직접 추가·Control UI 항목은 건드리지 않음) |
| `GET /internal/gateway/{team}/rpc` | api 대신 admin-http-rpc 호출(프록시) — `config.get` 등. 팀 Gateway 비밀번호를 쓰는 유일한 곳. 실제 호출은 팀 사이드카 `kacp-gwagent-{team}` → loopback(`06-auth.md` §6, spike 04). HTTP 허용 메서드만 된다(`config.*`, `agents.*`, `models.authStatus`, `health`, `status` 등. `users.*`·`session.*` 없음) |

**에이전트 해제는 `agents.delete`** `{agentId, deleteFiles: true}`로 한다(7단계 확인). OpenClaw는 `config.patch`로 에이전트 항목을 지우는 요청을 `UNAVAILABLE`로 끝내고(세션·작업 공간 연결을 가진 기록이라), 그 패치에 함께 있던 다른 변경도 반영되지 않는다. 사이드카 허용 메서드: `config.get` `config.patch` `health` `models.list` `agents.delete`. Gateway가 HTTP 200에 `ok:false`를 돌려줄 수 있으므로 그것도 실패로 처리한다.

`config.patch` 규칙(spike 04): `config.get`의 `hash`를 `baseHash`로 보낸다. 400 "config changed since last load"면 다시 get. 삭제는 `null`(JSON merge patch). **배열 값을 가진 항목**(예: `identityScopes.{email}`)을 지우려면 `replacePaths: ["gateway.auth.identityScopes.{email}"]`가 필요하다. 응답에는 비밀값 평문이 없다(SecretRef만).
| `GET /internal/stats` | 전체 사용량 스냅샷 |

오래 걸리는 동작은 즉시 `202` 응답하고, 끝나면 `POST api:/internal/events`로 통지한다.

## 4. 백그라운드 워커

| 워커 | 위치 | 주기 | 하는 일 |
|---|---|---|---|
| 유휴 정지 | api | 1분 | presence 없고 `last_active_at` 초과한 running 팀 → orchestrator stop |
| Gateway 동기화 | api | 1분 | running 팀만 orchestrator `/internal/gateway/{team}/rpc`로 `config.get` → Gateway에만 있는 서버는 `manual`로 기록, 사라진 `manual` 행 삭제, 빠진 마켓 설치는 apply-config 다시, `last_checked_at`. Codex `codexDynamicToolsLoading`이 `direct`가 아닌 팀(Control UI 모델 설정이 Codex 항목을 기본값으로 다시 쓴 경우 등)도 apply-config 다시(그대로 두면 MCP 도구가 숨어 `run_app`을 못 씀). **꺼진 팀은 건너뜀** |
| MCP 빌드 배정 | api | 10초 + 업로드·빌드 종료 직후 | 진행 중 빌드가 없으면 가장 오래된 `uploaded`를 `validating`으로 바꾸고 orchestrator에 넘김. 25분 넘게 소식이 없는 단계는 `failed` |
| 앱 유휴 정지 | api | 1분 | `*_last_accessed_at`이 설정값(작업본 30분·공개본 120분)을 넘은 running 사본 → stop(`idle`) |
| 할당 반영 | api | 이벤트 + 팀 기동 시 | `team_agents.apply_status = pending`인 팀에 apply-config |
| MCP 빌드 | orchestrator | 대기열(한 번에 하나) | build(빌드 socket-proxy `POST /build`, 플랫폼 Dockerfile) → scan(`aquasec/trivy:0.69.3` `trivy fs`, lock 파일 기준, Critical이면 실패) → test(`kacp-mcp-test`에서 `/healthz`·`initialize`·`tools/list`, 도구 0개면 실패) → `in_review`. 검증(매니페스트·레이아웃)은 api가 업로드 때 한다(실패 시 `422`) |
| 사용량 수집 | orchestrator | 1분 | Docker stats + 호스트 CPU·메모리·디스크 → api `usage_samples` |
| 휴지통 정리 | api | 1일 | `purge_after` 지난 항목 영구 삭제 |
| 세션·기록 정리 | api | 1일 | 만료 세션, 30일 지난 login_attempts, 7일 지난 usage_samples |
| 헬스 감시 | orchestrator | 30초 | running 팀·앱 컨테이너 헬스 → 이상 시 `error` 통지 |

## 5. platform-mcp 도구 (에이전트가 보는 인터페이스)

| 도구 | 입력 | 동작 |
|---|---|---|
| `run_app` | `folder`(**팀 공유 드라이브** 경로), `port`, `command?`, `name?` | 작업본 실행(같은 폴더면 재시작) → 작업본 주소 반환. 앱에는 `APP_DATA_DIR=/app-data`(쓰기 가능) 환경변수가 주어진다 |
| `stop_app` | `app`(이름 또는 id) | |
| `deploy_app` | `app`, `name?`, `reason` | 미공개면 공개 요청, 공개 중이면 업데이트 요청(승인 대기) |
| `list_apps` | — | 팀 앱 목록 |
| `drive_list` | `path` | 팀 공유 드라이브만(`space` 인자 없음 — 06-auth §8) |
| `drive_read` | `path` | 텍스트는 내용, 바이너리는 크기·종류만 |
| `drive_write` | `path`, `content` | 저장(작성자 "에이전트(팀)"으로 기록) |

### 에이전트 기본 지시문에 넣을 앱 규칙

- 웹 앱은 반드시 `run_app`으로 실행한다. 서버는 `0.0.0.0`에 바인딩한다.
- 저장이 필요하면 `APP_DATA_DIR`(`/app-data`) 아래에 SQLite 파일을 만든다. 원본 폴더에는 쓰지 않는다(읽기 전용).
- 작업본과 공개본은 데이터를 따로 가진다. 공개본에 필요한 초기 데이터는 앱 시작 시 스스로 만들도록(마이그레이션·시드) 작성한다.
- 공개본을 바꾸려면 `deploy_app`으로 업데이트 요청을 한다. 승인 전에는 공개본이 바뀌지 않는다고 사용자에게 알린다.

## 6. v2 대비 (지금 지켜둘 것)

v2 지식 기능(`07-knowledge-v2.md`)이 기존 코드를 고치지 않고 붙도록:

- Postgres는 처음부터 `pgvector/pgvector:pg16` 이미지로 띄운다(확장은 v2에서 `CREATE EXTENSION vector`).
- platform-mcp는 `tools/` 폴더에 **도구 하나 = 파일 하나**로 두고, `server.ts`는 목록을 모아 등록만 한다.
- 권한 판단은 api 한 곳에서만 한다(MCP 도구 파일에 권한 로직을 두지 않는다).
