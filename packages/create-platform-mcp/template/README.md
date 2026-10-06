# 예제 MCP

KACP 마켓에 올릴 MCP 서버예요. `create-platform-mcp create`로 만들었어요.
에이전트(OpenClaw)는 이 서버의 도구를 불러 일을 해요. 마켓에 올리면 관리자 심사를 거쳐 다른 팀이 설치해 쓸 수 있어요.

## 시작하기

Node.js 22 이상이 필요해요.

```bash
npm install
npm run dev        # http://localhost:8080/mcp (파일을 고치면 다시 시작돼요)
```

비밀값이 필요한 도구는 환경변수로 값을 주고 실행해요(플랫폼에서는 팀마다 요청 헤더로 들어와요 — 아래 "비밀값은 팀 범위만").

```bash
EXAMPLE_API_KEY=테스트키 npm run dev                     # macOS·Linux·Git Bash
$env:EXAMPLE_API_KEY="테스트키"; npm run dev             # PowerShell
```

### MCP Inspector로 확인

서버를 켠 채로 다른 터미널에서:

```bash
npx @modelcontextprotocol/inspector
```

Transport는 **Streamable HTTP**, URL은 `http://localhost:8080/mcp`로 연결하고 Tools 탭에서 도구를 불러 봐요.

## 폴더 구조

| 경로 | 누가 고치나 | 내용 |
|---|---|---|
| `src/platform/` | **고치지 마세요** (플랫폼 고정 영역) | HTTP 서버(`/mcp`, `/healthz`), `getSecret`, 프록시를 따르는 `fetch` |
| `src/server.ts` | 고치지 마세요 | 시작점 |
| `src/tools/` | 개발자 | 도구 하나 = 파일 하나, `index.ts`가 목록 |
| `platform-plugin.yaml` | 개발자 | 매니페스트(이름·버전·비밀값·네트워크 등) |

## 도구 추가하기

1. `src/tools/새-도구.ts`를 만들어요.

   ```ts
   import { z } from 'zod';
   import { defineTool } from '../platform/tool.js';

   export default defineTool({
     name: 'add_numbers',              // 에이전트가 부르는 이름(snake_case)
     title: '더하기',
     description: '두 수를 더해요.',     // 에이전트가 언제 쓸지 판단하는 설명. 구체적으로 적어요
     input: { a: z.number(), b: z.number() },
     run: ({ a, b }) => ({ sum: a + b }), // 문자열이나 JSON으로 돌려줘요. 오류는 throw
   });
   ```

2. `src/tools/index.ts`의 `tools` 목록에 넣어요. 서버가 목록의 도구를 자동으로 등록해요.

## 매니페스트 `platform-plugin.yaml`

| 필드 | 뜻 |
|---|---|
| `name` | 패키지 이름. 소문자·숫자·하이픈 3~30자, `--` 금지. `package.json`의 `name`과 같아야 해요 |
| `version` | semver(`1.2.3`). `package.json`의 `version`과 같아야 하고, 올릴 때마다 높여요 |
| `displayName` · `summary` | 마켓에 보이는 이름과 한 줄 소개 |
| `category` | 문서 · 데이터 · 메신저 · 일정 · 개발 · 업무 · 기타 |
| `icon` | (선택) 아이콘 이모지 |
| `secrets[]` | `name`(대문자·숫자·밑줄) · `description` · `required`. 설치하는 팀 관리자가 값을 넣어요 |
| `network[]` | 접속할 외부 도메인. `*.example.com`은 하위 도메인 |
| `resources` | `cpu`(최대 2) · `memoryMb`(64~2048) |
| `examples[]` | 마켓 상세에 보이는 사용 예시 문장 |

### 비밀값은 팀 범위만

비밀값은 **팀 단위**로 한 번 입력돼요. 같은 팀의 모든 사람이 같은 값을 써요. 사람별 비밀값(`scope: user`)은 아직 지원하지 않아 검증에서 거부돼요.
코드에서는 `getSecret('EXAMPLE_API_KEY')`로 읽어요. 필수 값이 없으면 알기 쉬운 오류를 던져요. 선택 값은 `getSecret('EXAMPLE_LANG', { required: false })`.
값을 로그에 찍거나 도구 결과로 돌려주지 마세요.

**서버 하나를 여러 팀이 같이 써요.** 플랫폼은 이 MCP 서버를 하나만 띄우고, 설치한 모든 팀이 같이 불러요. 팀마다 입력한 비밀값은 그 팀이 부를 때 요청에 함께 실려 오고(`X-KACP-Secret-이름` 헤더), `getSecret()`은 **지금 처리 중인 요청**의 값만 돌려줘요. 그래서:

- 비밀값은 도구 안에서 그때그때 `getSecret()`으로 읽어요. 모듈 변수에 저장해 두거나, 비밀값으로 만든 클라이언트를 전역에 캐시하지 마세요(다른 팀 요청에 섞여요).
- 팀별 데이터를 서버 메모리나 파일에 쌓지 마세요. 필요한 상태는 외부 서비스에 두세요.
- 로컬에서는 플랫폼이 없으니 같은 이름의 환경변수에서 읽어요.

### 네트워크 허용 목록과 프록시

플랫폼에서 MCP 서버는 인터넷에 바로 나가지 못해요. 모든 요청은 플랫폼 프록시(`HTTPS_PROXY`·`HTTP_PROXY`)를 거치고,
프록시는 `network`에 적은 도메인만 통과시켜요. 다른 도메인은 **403으로 막혀요**.
`src/platform/fetch.ts`가 이 설정을 따르게 해 주니, `fetch`나 `platformFetch`를 그대로 쓰면 돼요.
(프록시 환경변수를 따르지 않는 다른 HTTP 라이브러리는 막힐 수 있어요.) 로컬에서는 프록시 없이 바로 나가요.

## 검증하고 올리기

```bash
npx create-platform-mcp validate   # 업로드 때 서버와 같은 규칙으로 검사
npx create-platform-mcp pack       # 이름-버전.zip 생성 (node_modules·dist·.git·.env* 제외, 50MB 이하)
```

만든 zip은 KACP 웹의 **마켓 → 내 배포**에서 올려요. 빌드 → 보안 검사 → 테스트(도구 목록 확인) → 관리자 심사를 거쳐 마켓에 게시돼요.

### 빌드 방식

플랫폼은 **자체 표준 Dockerfile**로 빌드해요. 직접 넣은 Dockerfile은 쓰지 않아요.

1. `npm ci`(lock 파일이 없으면 `npm install`) → `npm run build` → 개발 의존성 제거
2. `node dist/server.js`, 사용자 `node`(uid 1000), 포트 `8080`

그래서 `package.json`에 `build`·`start` 스크립트가 있어야 하고, 빌드 결과가 `dist/server.js`여야 해요.
`package-lock.json`을 함께 올리면 같은 버전으로 빌드돼요(권장).
