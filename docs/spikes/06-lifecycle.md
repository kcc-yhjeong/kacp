# Spike 06 — 팀 컨테이너 생명주기, 샌드박스, 콜드 스타트

- 날짜: 2026-10-01 (로컬 준비 → GCP VM 확정)
- 환경(VM): GCP `kcc-llm` `asia-northeast3-a`, **n4-standard-8**(8 vCPU, 31GB), Ubuntu 24.04.5(커널 7.0 GCP), Docker 29.8.2 / Compose v5.5.1, 데이터 디스크 `/data`(nvme0n2 196G, ext4), Docker data-root `/data/docker`(overlayfs, cgroup v2)
- 검증 코드: `spikes/06-lifecycle/` — `vm-run.sh`(1부: 생명주기·권한·콜드 스타트·argon2), `vm-run06b.sh`(2부: 샌드박스, spike 07 환경 위)
- 이미지: OpenClaw `ghcr.io/openclaw/openclaw:2026.9.7`(c074824, digest `sha256:0da12cd4…fcbc`), `tecnativa/docker-socket-proxy:v0.5.0`, 샌드박스 `openclaw-sandbox:bookworm-slim`(문서의 인라인 Dockerfile), 팀 Gateway `kacp/openclaw:2026.9.7-sbx`(공식 + `docker:29-cli`의 docker CLI)
- 결론: **통과.** socket-proxy 경유 생성·기동·정지, bind mount, 콜드 스타트(평균 25초), 샌드박스 형제 컨테이너 모두 된다. **샌드박스를 켜면 MCP 도구가 기본으로 빠지므로 `tools.sandbox.tools.alsoAllow`가 필요하다**(설계 반영). 팀별 UID는 가능하지만 v1은 uid 1000 하나로 간다.

## 1. 문서 확인 (이미지 안 `/app/docs`)

- `gateway/sandboxing/docker-backend.md`: Gateway가 Docker 안에 있으면 Docker 소켓으로 형제 샌드박스를 만든다. 관리 마운트는 bind mount만 되고(named volume 불가), 자기 컨테이너를 inspect해서 경로를 호스트 경로로 바꾼다.
- `gateway/config-tools/tool-policy.md` "MCP and plugin tools inside sandbox tool policy": 샌드박스 세션에서는 `tools.sandbox.tools`가 **추가 허용 관문**이다. `bundle-mcp`(모든 `mcp.servers`) 또는 서버 접두사 glob(`<server>__*`)을 넣어야 MCP 도구가 보인다.
- (로컬 준비 때 걱정한) "Codex 런타임은 샌드박스 턴에 user MCP servers를 끈다"는 Codex 하네스 전용이다. VM의 턴은 모두 `runner: embedded`(내장 OpenClaw 런타임, MCP 클라이언트 `undici`)였다.

## 2. 결과

### ① docker-socket-proxy(orchestrator용) 권한 — ✅ (로컬·VM 동일)

`CONTAINERS=1 POST=1 ALLOW_START=1 ALLOW_STOP=1 ALLOW_RESTARTS=1`:
- 통과: 라벨 필터 조회, `create`, `PUT archive`, `start`, `stop`, `DELETE`
- 403: `/images`, `/volumes`, `/networks/create`, `/info`
- exec: 생성은 201, 실행(`/exec/{id}/start`)은 403 → 사실상 불가

### ② 생성 → 시드 → 기동 → healthy (bind mount) — ✅

- `/data/teams/team1/openclaw`(1000:1000, 0700) → `/home/node/.openclaw` bind. 컨테이너 `uid=1000(node)`. 파일 `1000:1000 0600`
- 시드는 `HEAD …/archive`가 404일 때만 `PUT …/archive`(tar 1000:1000 0600)
- 호스트 포트 없음. 첫 기동 **25.7초**

### ③ 콜드·웜 스타트 (VM, 각 5회)

| | 1 | 2 | 3 | 4 | 5 | 평균 |
|---|---|---|---|---|---|---|
| 콜드(정상 정지 → 삭제 → 생성 → 기동 → healthy, 상태 유지) | 25.30 | 25.27 | 25.26 | 25.26 | 25.27 | **25.27s** |
| 웜(정지 → 기동 → healthy) | 25.21 | 25.21 | 25.21 | 25.21 | 24.69 | **25.10s** |

- 편차가 거의 없다. 컨테이너를 다시 만드는 비용은 0.2초 미만이다. 시간은 OpenClaw 기동(doctor + Gateway)에서 든다.
- 로컬 Docker Desktop은 콜드 37.2s, 웜 34.6s였다(참고값).
- 이미지 받기: OpenClaw 100s(첫 회만), socket-proxy·node 10~19s

### ④ 비정상 종료 뒤 회복

| 상황 | 결과 |
|---|---|
| VM: `docker kill` 뒤 **같은 컨테이너** `start` | **32초** 뒤 healthy |
| 로컬: 실행 중 **강제 삭제** 뒤 **새 컨테이너** | `Another Gateway owner lease is still active` → 약 5분 뒤 기동 |

→ 규칙: 비정상 종료된 팀 컨테이너는 **지우지 말고 같은 컨테이너를 다시 start**한다. 다시 만들어야 하면 lease 오류에 대해 백오프 재시도(최대 6분).

### ⑤ 샌드박스(형제 컨테이너) + MCP — ✅ (조건부: 허용 목록 필요)

구성: 팀 Gateway에 `DOCKER_HOST=tcp://sbx-proxy:2375`, 팀 전용 socket-proxy(`CONTAINERS POST EXEC IMAGES INFO VERSION ALLOW_*`), 내부 네트워크 `sbx`. `agents.defaults.sandbox = {mode:"all", backend:"docker", scope:"session", workspaceAccess:"rw", docker:{image, containerPrefix:"kacp-sbx-team1-", network:"none", user:"1000:1000", readOnlyRoot:true, capDrop:["ALL"], pidsLimit:256, memory:"1g", cpus:1}}`(hot reload).

| 턴 | 조건 | 셸 | MCP |
|---|---|---|---|
| A | 샌드박스 끔 | Gateway 안(`uid=1000(node)`, `/home/node/.openclaw/workspace`) | ✅ 호출 1 |
| B | 샌드박스 켬 | **샌드박스**(`uid=1000(sandbox)`, `/workspace`) | ❌ 도구 목록에 없음(`tools: ["exec"]`) |
| C | B + 런타임 변경 시도 | 샌드박스 | ❌ (스크립트 오류로 설정이 안 바뀜 — B와 같은 조건) |
| **D** | 샌드박스 켬 + **`tools.sandbox.tools.alsoAllow: ["kacp-echo__*"]`** | **샌드박스**(`uid=1000(sandbox)`) | **✅ 호출 1**(`tools: ["exec", "kacp-echo__kacp_whoami"]`) |

샌드박스 컨테이너(실측):
```
kacp-sbx-team1-workspace-<hash>  openclaw-sandbox:bookworm-slim
User=1000:1000 Network=none ReadonlyRootfs=true CapDrop=[ALL] Memory=1GiB
Labels: openclaw.sandbox=1, openclaw.sessionKey=agent:main:spike06-b:workspace:…, openclaw.configHash, openclaw.createdAtMs, openclaw.mountFormatVersion=4
Mounts: bind /data/spike07/team1/openclaw/workspace → /workspace (rw)
        bind …/sandbox/skills-workspaces/…/skills → /workspace/.openclaw/sandbox-skills/skills (ro)
```
- OpenClaw가 Gateway 안 경로를 호스트 경로(`/data/...`)로 바꿔 bind했다(문서대로).
- MCP 호출은 샌드박스가 아니라 Gateway 프로세스에서 나간다. 그래서 샌드박스 `network: none`과 충돌하지 않는다.

샌드박스 socket-proxy가 받은 API(실측):
```
HEAD /_ping 25, GET /containers/{id}/json 10, POST /containers/{id}/exec 6, POST /exec/{id}/start 6, GET /exec/{id}/json 6,
GET /images/openclaw-sandbox:bookworm-slim/json 4, GET /version 3, POST /containers/create 2, POST /containers/{id}/start 2,
GET /images/{sbx}/json 2, GET /containers/{sbx}/json 2, GET /networks/{sbx} 2 (403 — NETWORKS=0, 동작에는 영향 없음)
```
- `IMAGES=1`은 POST=1과 합쳐지면 이미지 pull·build까지 열린다. 남는 위험이다. 샌드박스 이미지는 미리 받아 두고, 이 프록시는 팀 Gateway만 닿는 내부 네트워크에 둔다.
- **`kacp.kind=sandbox` 라벨은 강제할 수 없다**(프록시는 경로만 거른다). OpenClaw가 붙이는 `openclaw.sandbox=1` 라벨과 `containerPrefix: kacp-sbx-{team}-`로 식별·정리한다.

### ⑥ 팀별 UID (2001:2001)

| 시도 | 결과 |
|---|---|
| `--user 2001:2001`, `HOME=/home/node` | exit 1 — `Unable to create fallback OpenClaw temp dir: /home/node/.cache/openclaw-2001 \| EACCES` (`/home/node`가 uid 1000 소유) |
| + `XDG_CACHE_HOME=/home/node/.openclaw/.cache` | 권한 오류 없이 doctor 완료. 그다음 `existing config is missing gateway.mode`로 멈춤 — 시드를 안 넣은 시험 폴더라 그렇다(UID 문제 아님) |

→ 팀별 UID는 **가능**하다(`XDG_CACHE_HOME`을 상태 폴더 안으로 + 폴더 chown). **v1 결정: 모든 팀 컨테이너는 uid 1000.** 팀 격리는 컨테이너 + 팀별 상태 폴더로 한다. spike 05 결정으로 에이전트는 팀 공유 드라이브만 다루므로 팀별 UID가 필요 없다.

### ⑦ argon2id (`@node-rs/argon2` 2.2.1)

| m | t | p | VM verify 중앙값 | 로컬 |
|---|---|---|---|---|
| 64MB | 3 | 1 | **41ms** | 70ms |
| 64MB | 2 | 1 | 30ms | 47ms |
| 46MB | 2 | 1 | 22ms | 32ms |
| 19MB | 2 | 1 | 9ms | 13ms |
| 128MB | 3 | 1 | 94ms | 138ms |

→ 설계값(64MB, t=3, p=1)을 유지한다. 300ms 목표보다 충분히 빠르다. 메모리를 더 올리면 동시 로그인 시 메모리(64MB × 동시 수)가 먼저 부담이 된다.

## 3. 설계 문서 변경

| 문서·절 | 바꾼 내용 |
|---|---|
| `/CLAUDE.md` 규칙(샌드박스 예외) | 팀 전용 socket-proxy 허용 API 확정, 라벨은 `openclaw.sandbox=1` + 이름 접두사 |
| `06-auth.md` §8, `04-api.md` §3 | 샌드박스 허용 목록 `tools.sandbox.tools.alsoAllow: ["bundle-mcp"]` — 이게 없으면 platform-mcp가 안 보인다 |
| `05-urls-and-storage.md` §5·§6 | 팀 컨테이너 uid 1000, 상태 폴더 bind(named volume 금지), 샌드박스 설정값, 팀 전용 socket-proxy 플래그, 샌드박스 식별 |
| `04-api.md` §3 `stop`·`ensure-running` | 비정상 종료 → 같은 컨테이너 재시작(32초), 새로 만들면 lease 대기. 콜드 스타트 약 25초 |
| `03-data-model.md` 상태 전이, `01-screens.md` U-01 | 기동 약 25초(VM). 120초 타임아웃 유지 |
| `06-auth.md` §2 | argon2id 64MB/t3/p1 유지(VM 41ms) |
| `plan.md` | 코드 실행 결정, deploy/openclaw-image(docker CLI 포함), 1단계 표·확인 목록 |
