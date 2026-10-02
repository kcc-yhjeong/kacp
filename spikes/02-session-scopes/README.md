# spike 02 — 세션 분리·권한 (`spikes/02-session-scopes/`)

spike 01 환경을 복사해 확장했다. compose 프로젝트 이름 `kacp-spike02`(볼륨 분리), 네트워크 `kacp-edge`는 01과 같으므로 동시에 띄우지 않는다.

변경점
- `openclaw.json`: `controlUi.basePath: "/claw"`, `gateway.roles`(member 하나, `sessions.others: "none"`, 상한 admin)
- `traefik/dynamic.yml`: `/claw` → Gateway(prefix 유지), 그 외 → `/claw/` 리다이렉트(셸 자리)

실행: `cp ../01-proxy-auth/.env .env` 후 `docker compose up -d`.
주의: 첫 기동 이후 `openclaw.json`을 바꿔 재기동하면 OpenClaw가 "Config auto-restored from backup"으로 되돌린다.
실행 중 변경은 `docker exec <gateway> node openclaw.mjs config set <path> '<json>' --strict-json` (hot reload).

결과: `docs/spikes/02-session-scopes.md`
