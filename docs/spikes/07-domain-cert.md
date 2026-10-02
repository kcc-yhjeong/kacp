# Spike 07 — kacp.cloud Cloud DNS + Traefik DNS-01 와일드카드 인증서

- 날짜: 2026-10-01
- 환경: GCP `kcc-llm`, `asia-northeast3-a`, **`n4-standard-8`**(plan.md의 n4d는 이 영역에 없음), Ubuntu 24.04.5, Docker 29.8.2, 부팅 50GB + 데이터 디스크 `kacp-data` 200GB(`/data`, Docker data-root `/data/docker`), 고정 외부 IP 34.47.107.69
- 검증 코드: `spikes/07-domain-cert/` — `vm-run07.sh`(VM에서 실행. spike 03 구성을 https로)
- 결론: **통과.** `kacp.cloud` + `*.kacp.cloud` 와일드카드 인증서 1장을 DNS-01(`gcloud`)로 받았다. VM 서비스 계정 권한만 쓰고 키 파일은 없다. 모든 서브도메인이 같은 인증서를 쓴다. 설정 함정이 셋 있었다(§3).

## 1. 이미지·버전

| 구성 | 값 |
|---|---|
| Traefik | `traefik:v3.7.13`(lego `gcloud` 제공자), 로컬 플러그인 `cspframe`·`cookiestrip`(spike 03) |
| OpenClaw | `ghcr.io/openclaw/openclaw:2026.9.7`(c074824) |
| 인증서 | Let's Encrypt `YR2`, `CN=kacp.cloud`, `SAN=*.kacp.cloud, kacp.cloud`, 2026-10-01 ~ 2026-12-30 |

## 2. 절차 (plan.md "도메인과 인증서"와 대조)

| plan.md 단계 | 실제 |
|---|---|
| 1. Cloud DNS 공개 영역 | 영역 `kacp`(`kacp.cloud.`) |
| 2. 가비아 네임서버 변경 | `ns-cloud-d1~d4.googledomains.com`(8.8.8.8에서 확인) |
| 3. `kacp.cloud`, `*.kacp.cloud` A → 고정 IP | 둘 다 34.47.107.69 |
| 4. 서비스 계정 DNS 관리자 + 범위 "모든 Cloud API" | `roles/dns.admin` + **범위 `cloud-platform`(VM 정지 → `set-service-account --scopes=cloud-platform` → 시작)**. §3-① |
| 5. Traefik `dnsChallenge.provider: gcloud`, 프로젝트 ID 환경변수 | `GCE_PROJECT=kcc-llm`, `resolvers=8.8.8.8:53,1.1.1.1:53`, staging으로 먼저 → prod |

## 3. 설정 변경 기록과 함정

| # | 증상 | 원인 | 조치 |
|---|---|---|---|
| ① | `googlecloud: ManagedZones.List … Error 403: insufficient authentication scopes` | VM을 콘솔에서 기본 액세스 범위로 만듦(plan.md 4단계 경고 그대로) | VM 정지 → 범위 `cloud-platform` → 시작. 스크립트가 메타데이터 토큰으로 Cloud DNS API를 미리 불러 확인한다 |
| ② | staging에서 `team1.kacp.cloud` 전용 인증서(SAN = team1만)가 따로 발급되어 나감 | 라우터마다 `tls.certResolver`를 둠 → 라우터의 `Host`마다 인증서 요청 | 와일드카드 요청을 **websecure 진입점 한 곳에만**: `--entrypoints.websecure.http.tls.certresolver=le`, `…domains[0].main=kacp.cloud`, `…domains[0].sans=*.kacp.cloud` |
| ③ | ②를 고친 뒤 발급 요청이 아예 없음(`dns01` 로그 0) | 라우터에 `tls: {}`를 남김 → **빈 값이라도 진입점 TLS 설정을 덮어씀** | 라우터에서 `tls` 블록을 지움 → 진입점 설정을 물려받음 |
| ④ | (스크립트 버그) `unable to get ACME account: unexpected end of JSON input` | `acme.json`을 빈 줄로 덮어씀 | 비울 때는 `truncate -s 0`(0바이트) |
| ⑤ | (스크립트 버그) 두 번째 실행에 설정 파일을 다시 시드 | 상태 폴더 `700/1000`이라 일반 사용자 `[ -f ]`가 실패 | `sudo test -f` |
| ⑥ | — | 방화벽을 테스트 동안 `0.0.0.0/0`으로 엶(사용자 결정) | 모든 라우터 앞에 basicAuth(`spike-gate`, `removeHeader: true`). **spike 전용 임시 구성** |

## 4. 결과

### ① 와일드카드 1장 — ✅

```
Obtaining bundled SAN certificate. domains="kacp.cloud, *.kacp.cloud"
dns01: preparing/trying/cleaning … domain=*.kacp.cloud / kacp.cloud
Validations succeeded; requesting certificates.   (진입점 기동 후 35초)
acme.json: main=kacp.cloud sans=['*.kacp.cloud']   (이것 하나)
team1.kacp.cloud / x.kacp.cloud / kacp.cloud → 모두 CN=kacp.cloud, SAN=*.kacp.cloud, kacp.cloud
```

### ② https에서 spike 01~03 결과 유지 — ✅ (VM 안 `--resolve 127.0.0.1`)

| 요청 | 결과 |
|---|---|
| basicAuth 없이 | 401 |
| http :80 | 301 → `https://team1.kacp.cloud/` |
| 비로그인 `/` | 302 → `https://team1.kacp.cloud/_kacp/login?rd=%2F` |
| carol `/claw/` / bob `/claw/` | 403 / 200 |
| 응답 헤더 | `frame-ancestors 'self'`, `strict-transport-security: max-age=31536000` |
| wss 업그레이드(bob) | 101 |
| `/_debug`(앱 라우터 흉내) | `Cookie: app_pref=dark`만, `X-Forwarded-User: bob@kcc.dev`(위조값 덮어씀), `X-Forwarded-Proto: https` |
| 열린 포트 | 80, 443만(18789·18790 없음) |

### ③ 외부(사무실 PC 14.34.6.249)에서 — ✅

`team1.kacp.cloud`, `kacp.cloud`, `abc-123.kacp.cloud` 모두 `ssl_verify=0`(공인 인증서 검증 통과). `34.47.107.69:18789` 직접 접속은 시간 초과.

### ④ 브라우저 — ✅

- `https://team1.kacp.cloud/`: 자물쇠 정상, basicAuth → 가짜 로그인 → alice 셸 안 iframe Control UI 연결(wss), bob 시크릿 창 연결·alice 초안 안 보임, 모델 키 등록
- 세션 공개 링크(spike 02 남은 항목): alice가 공개 접근 활성화 → bob은 읽기 전용으로 열림, carol(비멤버)은 403

## 5. 설계 문서 변경

| 문서·절 | 바꾼 내용 |
|---|---|
| `05-urls-and-storage.md` §1 | 인증서 규칙: 진입점에서 와일드카드 1장(`kacp.cloud` + `*.kacp.cloud`), 라우터에는 `tls`를 적지 않음(`certResolver`도 `tls: {}`도 금지). VM 범위 `cloud-platform` 필수 |
| `05-urls-and-storage.md` §2 | 동적 라우트(orchestrator가 붙이는 Traefik 라벨)도 `tls` 라벨 없이 `entrypoints=websecure`만 |
| `plan.md` 인프라 표 | 머신 `n4-standard-8`(서울 a 영역에 n4d 없음), 데이터 디스크 이름 `kacp-data`, Docker data-root `/data/docker` |
| `plan.md` "도메인과 인증서" | 4단계에 "범위는 VM 정지 상태에서만 바꿀 수 있다", 5단계에 진입점 단위 요청과 staging 먼저 |

## 6. 남은 것

- 운영 전 방화벽을 회사 IP로 좁히고 basicAuth 임시 구성 제거
- 갱신: Traefik이 만료 30일 전에 자동 갱신(로그 `Testing certificate renew…`). 첫 갱신은 2026-11 말에 확인
