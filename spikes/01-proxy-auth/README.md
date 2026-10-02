# spike 01 — 프록시·신원 검증 환경 (`spikes/01-proxy-auth/`)


## 구성
브라우저 → Traefik(172.30.0.10) → [strip-identity → forwardAuth(fake-auth)] → OpenClaw team1(172.30.0.20)

| 사용자 | team1 역할 | 기대 결과 |
|---|---|---|
| alice@kcc.dev | team_admin | 접속 + admin scope (identityScopes) |
| bob@kcc.dev | member | 접속, admin 없음 |
| carol@kcc.dev | 없음 | 403 |

## 실행
```bash
cp .env.example .env            # 값 채우기 (OPENCLAW_IMAGE 는 검증한 2026.9.7 권장)
# 상태 폴더는 named volume(team1-state). openclaw-team1-init 이 기동 때마다
# openclaw/openclaw.json 을 복사하고 소유자를 1000 으로 맞춘다 (Windows bind mount 는 chmod 불가 → EPERM).
docker compose up -d
docker compose logs -f openclaw-team1 fake-auth
```
`*.localhost` 는 브라우저가 자동으로 127.0.0.1 로 풀어서 hosts 파일 수정이 필요 없다.
(WSL2 라면 Windows 브라우저에서 그대로 열림)

## 1번 완료 기준 (2026-09-30 전부 통과 — `docs/spikes/01-proxy-auth.md`)
- [x] `docker compose ps` 에서 4개 모두 running, openclaw-team1 healthy (init 컨테이너는 Exited 0)
- [x] http://team1.kacp.localhost → 로그인 화면으로 리다이렉트
- [x] alice 선택 → Control UI 가 뜨고 페어링 화면 없이 연결됨
- [x] 시크릿 창에서 bob 으로 접속됨, carol 은 403
- [x] 위조 헤더가 덮어써지는지:
      `curl -s -H 'X-Forwarded-User: evil@x' -b kacp_dev_user=bob http://team1.kacp.localhost/_debug/`
      → 응답의 X-Forwarded-User 가 bob@kcc.dev
- [x] 직접 접근 불가: 호스트에서 18789 포트가 열려 있지 않음

## 문제가 생기면
- 컨테이너가 바로 종료: `docker compose logs openclaw-team1`. 설정 검증 오류 메시지 그대로 기록.
- `proxy_attribution_required` / `trusted_proxy_*` 오류: trustedProxies 와 Traefik IP 확인.
- Origin 오류: `controlUi.allowedOrigins` 와 브라우저 주소(포트 포함) 일치 확인.
- 모델 응답이 없음: alice 로 Control UI 설정에서 모델 키 등록 (1번 범위 밖, 2번에서 필요).
- `openclaw security audit` 의 trusted-proxy critical 경고는 의도된 것.

## 결과 기록
`docs/spikes/01-proxy-auth.md` 에 OpenClaw 이미지 태그(버전), 확인 방법, 결과, 설계 변경 여부를 남긴다.
