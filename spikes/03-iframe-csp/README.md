# spike 03 — 셸 iframe·프레임 헤더·WebSocket forwardAuth (`spikes/03-iframe-csp/`)

spike 02를 복사해 확장했다. 프로젝트 `kacp-spike03`, 상태 볼륨은 외부 `kacp-spike02_team1-state`(02 상태 재사용).
01·02와 네트워크 `kacp-edge`를 공유하므로 동시에 띄우지 않는다.

변경점
- `traefik/plugins-local/src/github.com/kacp/cspframe` — CSP `frame-ancestors`만 재작성 + `X-Frame-Options` 삭제(로컬 플러그인)
- `traefik/plugins-local/src/github.com/kacp/cookiestrip` — 요청 Cookie에서 지정 쿠키만 삭제(로컬 플러그인)
- `traefik/dynamic.yml` — `/claw`에 `claw-frame`, `/`(셸) → fake-auth, `/_debug`에 `strip-session-cookie`
- `fake-auth/server.js` — `/`에 셸 테스트 페이지(`?start=/claw/` | `/claw/new`)
- init 컨테이너 — 첫 기동에만 시드(덮어쓰면 OpenClaw가 오래된 백업으로 되돌림)

실행: `docker compose up -d` → http://team1.kacp.localhost/
결과: `docs/spikes/03-iframe-csp.md`
