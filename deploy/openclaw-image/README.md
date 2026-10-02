# deploy/openclaw-image

팀 Gateway 이미지. 공식 `ghcr.io/openclaw/openclaw:2026.9.7`에 docker CLI(`docker:29-cli`)만 더한다(spike 06 — 샌드박스 형제 컨테이너용, 샌드박스는 4단계에서 켠다).

- 태그: `kacp/openclaw:{OpenClaw 버전}-{빌드 번호}` (현재 `kacp/openclaw:2026.9.7-1`)
- 빌드: `docker compose -f deploy/infra/docker-compose.yml --profile build build openclaw-image`
- openclaw.json은 이미지에 넣지 않는다. orchestrator가 팀마다 첫 기동 전에 한 번 시드한다(`apps/orchestrator/src/openclaw-config.ts`).
- 상태 폴더 `/home/node/.openclaw`를 이미지에 `node:node 0700`으로 만들어 둔다. 로컬(Docker Desktop)은 named volume이라 첫 마운트 때 이 소유권을 물려받는다.
