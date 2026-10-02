# mockups — Claude Design 시안 내보내기 (참고용)

- 원본: Claude Design 프로젝트 "Header and agent shell mockups" (`https://claude.ai/design/p/2e43038d-22b1-444c-9b1f-bb2ea433d900`)
- 받은 날: 2026-10-01 첫 시안, 2026-10-02 2차 수정본(최종).
- **정본은 Claude Design 프로젝트**다. 이 폴더는 구현(2단계 `apps/web`) 때 참고하려고 둔 사본이다.
- 화면 명세의 정본은 `docs/design/01-screens.md`, 디자인 기준은 `02-design-system.md`다. 시안과 문서가 다르면 **문서가 맞다**.

> 폴더를 ZIP으로 통째로 바꾸면 이 README와 `REVISION-PROMPT.md`가 지워진다. 바꾼 뒤 다시 만들어 달라고 하면 된다.

## 내용

| 파일 | 화면 |
|---|---|
| `Index.dc.html` | 목차 |
| `U-01 Agent Shell.dc.html` | C-00 헤더 + U-01 에이전트 셸 |
| `U-02 U-03 App Bar and Deploy.dc.html` | U-02 앱 막대·미리보기, U-03 공개 설정 |
| `U-04 U-06 Drive.dc.html` | U-04 드라이브, U-05 파일 상세, U-06 휴지통 |
| `U-07 U-08 Apps.dc.html` | U-07 배포관리, U-08 앱 상세 |
| `U-09 U-12 MCP Market.dc.html` | U-09 마켓, U-10 상세·설치, U-11 우리 팀 설치됨, U-12 내 배포 |
| `U-13 U-15 Community Profile Team.dc.html` | U-13 커뮤니티, U-14 프로필, U-15 팀 설정 |
| `C-01 C-03 Auth.dc.html` | C-01 로그인, C-02 첫 비밀번호, C-03 소속 팀 없음 |
| `C-04 Error Pages.dc.html` | C-04 오류·안내 |
| `A-01 A-05 Admin Dashboard Users Teams.dc.html` | A-01 대시보드, A-02·A-03 사용자, A-04·A-05 팀 |
| `A-05 Team Detail Tabs.dc.html` | A-05 나머지 탭, A-04 팀 만들기, A-09 처리 이력 |
| `A-06 A-08 Agents MCP Review.dc.html` | A-06 템플릿, A-07 심사, A-08 MCP 관리(팀별 설치 현황 A8e 포함) |
| `A-09 A-11 Deploy Settings Audit.dc.html` | A-09 배포 승인, A-10 설정, A-11 활동 기록 |
| `A-12 A-13 Org Import.dc.html` | A-12 조직, A-13 가져오기 |
| `List States.dc.html` | 목록 화면 빈·로딩·오류 |
| `Missing Details.dc.html` | 빠진 세부(모달, C-05, A-03 상세, 할당 모달 등) |
| `AppHeader` `AdminSidebar` `DriveTree` `Icon` `Stepper` `.dc.html` | 공용 부품 |
| `support.js` | Claude Design dc-runtime(`<x-dc>`, `DCLogic`, `{{ }}` 바인딩). 디자인 내용 없음 |
| `_ref/` | 디자인 프로젝트 `CLAUDE.md`, `uploads/`(시안 작업 때 올린 문서 — `02-design-system.md`는 옛 판), 스크린샷, U-13 standalone·옛 내보내기 |

## 검토 이력

- 2026-10-01: 1단계·정합성 결정 기준 1차 수정 목록(약 130항목) 작성.
- 2026-10-02: 1차 수정본 검토 통과. 경미 5건을 2차로 요청(`REVISION-PROMPT.md`).
- 2026-10-02: 2차 수정본 검토 통과 — 5건 모두 반영. **시안 확정.**
- ZIP 주의: 앞선 두 번은 파일 이름과 내용이 정렬 순서로 밀렸고 U-09가 빠졌었다. 받으면 각 파일의 `dv-tname` 제목과 이름을 맞춰 본다.
