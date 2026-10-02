# spike 04 — admin-http-rpc·config.patch (`spikes/04-admin-rpc/`)

spike 03 복사. 프로젝트 `kacp-spike04`, 상태 볼륨은 외부 `kacp-spike02_team1-state`.
- `orch` 서비스: orchestrator 대역(다른 컨테이너). 여기서 비밀번호로 부르면 401
- 사이드카(수동 실행): `docker run -d --name kacp-spike04-gwagent --network container:kacp-spike04-openclaw-team1-1 -e GW=http://127.0.0.1:18789 -e GW_PASSWORD=… -v <orch>:/orch:ro node:22-alpine sleep infinity`
- `orch/rpc.mjs` 단일 호출, `orch/cfg.mjs` get→patch(baseHash, replacePaths)

결과: `docs/spikes/04-admin-rpc.md`
