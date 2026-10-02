# spike 06 — 팀 컨테이너 생명주기 (`spikes/06-lifecycle/`)

orchestrator 대역(`orch`)이 **docker-socket-proxy 경유 Docker Engine API만으로** 팀 컨테이너를 만들고·켜고·끈다. 의존성 없는 스크립트다.
로컬(Windows Docker Desktop)에서는 API 경로와 참고값만 잰다. **권한·UID·bind mount·샌드박스·콜드 스타트 확정값은 GCP VM에서** 잰다.

## 파일

| 파일 | 내용 |
|---|---|
| `docker-compose.yml` | `socket-proxy`(tecnativa v0.5.0, CONTAINERS·POST·ALLOW_START/STOP/RESTARTS만), `orch` |
| `orch/lifecycle.mjs` | `up / stop / start / rm / bench <team> <n> / deny` |
| `orch/seed-openclaw.json` | spike 02~05 결론을 모은 첫 기동 시드(roles `write`, `tools.sessions.visibility: tree`, admin-http-rpc, `auth.password` SecretRef) |
| `orch/sandbox-patch.json` | VM 샌드박스 검증용 `config.patch` 본문 |
| `orch/argon2-bench.mjs` | argon2id 파라미터별 verify 시간 |

## 로컬 실행

```bash
cp ../04-admin-rpc/.env .env
docker compose up -d
docker exec kacp-spike06-orch-1 node /orch/lifecycle.mjs deny team1
docker exec kacp-spike06-orch-1 node /orch/lifecycle.mjs up team1
docker exec kacp-spike06-orch-1 node /orch/lifecycle.mjs bench team1 5
```

## GCP VM 절차 (asia-northeast3, n4d-standard-8, Ubuntu 24.04, `/data` 데이터 디스크)

1. Docker Engine 설치. Docker Desktop이 아닌 엔진으로 하고, `docker info`로 data-root가 `/data/docker`인지 확인한다(05 §5).
2. 레포를 받고 `spikes/06-lifecycle`에서 `.env`를 만든다(`TEAM1_GATEWAY_PASSWORD`, `OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.9.7`, `STATE_MODE=bind`, `DATA_ROOT=/data`).
3. 상태 폴더: `sudo mkdir -p /data/teams/team1/openclaw && sudo chown -R 1000:1000 /data/teams/team1 && sudo chmod 700 /data/teams/team1/openclaw`
4. `docker compose up -d` → `deny` → `up team1` → `bench team1 5`
   - 결과를 `docs/spikes/06-lifecycle.md`에 기록한다(콜드·웜 평균, 첫 기동은 doctor 때문에 따로).
5. **UID 확인**
   - `docker exec kacp-team-team1 id` 결과가 `uid=1000`인지
   - `ls -ln /data/teams/team1/openclaw` 결과가 `1000:1000 0600`인지
   - 팀별 UID 시험: `create`의 `User: "<uid>:<gid>"`를 바꿔 doctor·엔트리포인트가 견디는지 확인. 스크립트에 `User` 필드를 추가해서 본다.
6. **샌드박스(형제 컨테이너)**
   - 이미지: OpenClaw 문서 `gateway/sandboxing` "Images and setup"대로 `openclaw-sandbox:bookworm-slim`을 빌드한다.
   - 팀 전용 socket-proxy `kacp-sbx-proxy-team1`: `CONTAINERS=1 POST=1 EXEC=1 ALLOW_START=1 ALLOW_STOP=1`, IMAGES·NETWORKS·VOLUMES는 0으로 둔다. 팀 컨테이너에 `DOCKER_HOST=tcp://kacp-sbx-proxy-team1:2375`를 준다.
   - 팀 컨테이너의 워크스페이스·상태는 **bind mount**여야 한다(named volume은 형제 샌드박스 마운트에 쓸 수 없다 — OpenClaw docker-backend 문서).
   - 사이드카로 `orch/sandbox-patch.json`을 `config.patch`한다. 그다음 확인할 것:
     - 에이전트 `_meta.sandbox_mode`가 `danger-full-access`에서 바뀌는지
     - 샌드박스 컨테이너의 mount·user·network
     - **샌드박스가 켜진 턴에서 MCP 도구(platform-mcp 자리 echo MCP)를 쓸 수 있는지.** Codex 런타임은 샌드박스 턴에서 user MCP servers를 끈다고 문서에 나와 있다. 안 되면 런타임(OpenClaw 기본 vs Codex) 선택이나 MCP 배치를 다시 정해야 한다.
   - `kacp.kind=sandbox` 라벨 강제 방법: socket-proxy만으로는 라벨을 강제할 수 없다. 대안(orchestrator가 주기적으로 `containerPrefix`로 정리, 또는 라벨 검사 프록시)을 기록한다.
7. **argon2id**: `docker run --rm -v $PWD/orch:/w:ro node:22 sh -c 'cd /tmp && npm i @node-rs/argon2@2 && cp /w/argon2-bench.mjs . && node argon2-bench.mjs'`
8. **비정상 종료 복구**: `docker kill kacp-team-team1` 직후 `start team1`이 몇 초 뒤에 성공하는지 잰다(로컬에서는 약 5분 — 상태 폴더 owner lease).

결과: `docs/spikes/06-lifecycle.md`
