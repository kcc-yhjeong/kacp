# 02. 디자인 기준 — shadcn/ui 스타일

Claude Design 시안과 `apps/web` 구현이 같은 기준을 쓰도록 정한 값이다.
**shadcn/ui(neutral 테마)를 그대로 따른다.** 참고 구현은 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)(MIT, Vite + shadcn/ui + TanStack Router + Lucide)이다.
직접 디자인을 만들지 않고, shadcn 컴포넌트와 토큰을 조합한다. 새 색·새 컴포넌트가 필요하면 이 문서에 먼저 추가한다.

## 1. 원칙

- **흑백이 기본, 색은 의미가 있을 때만.** 화면의 99%는 검정·회색·흰색이다. 색은 증감(+초록/−빨강), 상태 점, 파괴적 동작에만 쓴다.
- **카드와 얇은 테두리로 구분.** 그림자 대신 `1px border` + 둥근 모서리. 배경은 흰색, 영역 구분은 카드로.
- **숫자가 주인공.** 요약 카드는 작은 회색 라벨 → 큰 숫자 → 작은 변화량 순서.
- **차트도 흑백.** 주 데이터는 검정 실선, 비교 데이터는 회색 점선. 막대는 도트·세그먼트형 흑백.
- **도구처럼 조용하게.** 에이전트(iframe)와 사용자 데이터가 주인공이고 플랫폼 크롬은 얇게.
- **비개발자 기준 문구.** "컨테이너", "Gateway", "빌드"는 사원 화면에 쓰지 않는다(관리자 화면은 허용). 해요체.

## 2. 기술 기준

| 항목 | 선택 |
|---|---|
| 컴포넌트 | shadcn/ui (Radix UI 기반, `components/ui/`에 복사해 소유) |
| 스타일 | Tailwind CSS v4, CSS 변수 토큰(아래) |
| 아이콘 | Lucide (`lucide-react`), 크기 16px 기본 / 카드 머리 아이콘 16px / 빈 상태 32px, `strokeWidth 1.75` |
| 차트 | shadcn Chart(Recharts 래퍼) |
| 토스트 | Sonner |
| 테마 | 라이트 기준 시안. 다크 토큰은 shadcn 기본값으로 함께 정의(전환 스위치는 v1.1) |
| `components.json` | `style: new-york`, `baseColor: neutral`, `cssVariables: true` |

## 3. 토큰

### 색 — shadcn neutral 기본값 (`apps/web/src/styles/globals.css`)

```css
:root {
  --radius: 0.625rem;

  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);            /* 거의 검정. 주요 버튼, 선택 상태 */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);               /* 옅은 회색 배경 (아이콘 원, 표 머리) */
  --muted-foreground: oklch(0.556 0 0);   /* 라벨, 보조 텍스트, "vs last month" */
  --accent: oklch(0.97 0 0);              /* 호버 */
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);

  /* 차트: 흑백 단계 */
  --chart-1: oklch(0.205 0 0);   /* 주 데이터 (검정 실선, 채운 막대) */
  --chart-2: oklch(0.556 0 0);   /* 비교 데이터 (회색 점선) */
  --chart-3: oklch(0.708 0 0);
  --chart-4: oklch(0.87 0 0);    /* 빈 막대·도트 */
  --chart-5: oklch(0.922 0 0);   /* 격자선 */

  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);

  /* KACP 추가: 의미 색 (텍스트·점에만 사용, 넓은 면에 칠하지 않음) */
  --success: oklch(0.596 0.145 163.225);  /* emerald-600: +32.8%, 실행 중 점 */
  --warning: oklch(0.666 0.179 58.318);   /* amber-600: 대기·준비 중 점 */
  --danger:  oklch(0.586 0.253 17.585);   /* rose-600: −1.7%, 오류 점 */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.922 0 0);
  --chart-2: oklch(0.708 0 0);
  --chart-3: oklch(0.556 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.985 0 0);
  --sidebar-primary-foreground: oklch(0.205 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
  --success: oklch(0.696 0.17 162.48);
  --warning: oklch(0.769 0.188 70.08);
  --danger:  oklch(0.645 0.246 16.439);
}
```

색 사용 규칙:

| 쓰는 곳 | 토큰 |
|---|---|
| 페이지 배경, 카드 | `background`, `card` (둘 다 흰색 — 카드는 테두리로만 구분) |
| 제목·숫자 | `foreground` |
| 라벨·보조·"지난달 대비" | `muted-foreground` |
| 주요 버튼 | `primary` (검정 버튼, 흰 글씨) |
| 보조 버튼, 필터 드롭다운 | `outline` 버튼 (흰 배경 + `border`) |
| 아이콘 버튼(카드 머리) | `outline` + `size="icon"` 32px |
| 증가 수치 | `text-[--success]` |
| 감소 수치 | `text-[--danger]` |
| 삭제·반려·강제 중지 | `destructive` 버튼 |

브랜드 색이 필요하면 `--primary`만 바꾸지 말고 로고에만 쓴다. 흑백 기조를 유지한다.

### 글꼴

| 토큰 | 값 |
|---|---|
| `--font-sans` | `"Inter", "Pretendard Variable", Pretendard, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif` |
| `--font-mono` | `"Geist Mono", "JetBrains Mono", "D2Coding", ui-monospace, monospace` |

영문·숫자는 Inter, 한글은 Pretendard로 떨어지게 순서를 둔다. 큰 숫자는 `tabular-nums`.

| 이름 | Tailwind | 용도 |
|---|---|---|
| 화면 제목 | `text-2xl font-bold tracking-tight` | "대시보드", "팀 관리" |
| 화면 설명 | `text-muted-foreground` | 제목 아래 한 줄 |
| 카드 제목 | `text-sm font-medium` | "Monthly Sales" 위치 |
| 카드 라벨 | `text-sm text-muted-foreground` | "Total Sales" 위치 |
| 큰 숫자 | `text-2xl font-semibold tabular-nums` (강조 카드는 `text-3xl`) | KPI |
| 변화량 | `text-xs` — 수치만 `--success`/`--danger`, 뒤 문구는 `muted-foreground` | "+32.8% 지난달 대비" |
| 본문 | `text-sm` | 기본 |
| 캡션 | `text-xs text-muted-foreground` | 시각, 축 라벨, 범례 |
| 코드·주소 | `font-mono text-xs` | 경로, 앱 주소, 로그 |

### 간격·모양

- 모서리: `--radius` 0.625rem(10px). 카드 `rounded-xl`, 버튼·입력 `rounded-md`, 배지 `rounded-md`, 아바타 `rounded-full`
- 카드: `border bg-card rounded-xl` + 안쪽 여백 `p-6`(요약 카드는 `p-5`), **그림자 없음**(`shadow-none` — shadcn 기본 `shadow-sm`도 제거)
- 카드 머리가 있는 카드: 머리 `px-5 py-4 border-b` + 아이콘(16px, `muted-foreground`) + 제목 + 오른쪽 액션
- 카드 사이 간격 `gap-4`, 페이지 여백 `px-6 py-6`
- 레이아웃: 헤더 높이 48(`h-12`), 앱 막대 36, 관리자 사이드바 shadcn Sidebar(`16rem`, 접으면 아이콘 `3rem`), 상세 패널(Sheet) 폭 400, 콘텐츠 최대 폭 `max-w-7xl`(드라이브·셸은 전체 폭)
- 최소 지원 해상도 1280×720 (모바일은 v1 범위 밖)
- 팝오버·드롭다운·토스트는 예외적으로 약한 그림자 유지(`shadow-md` 수준, `0 4px 12px rgb(0 0 0 / 8%)`) — iframe 위에 떠야 해서. 카드는 계속 그림자 없음

### 헤더·셸 확정값 (C-00 / U-01 시안 기준)

- 헤더: `h-12`, 좌우 여백 16/12, 아래 `border`. 왼쪽 로고(24px 검정 사각 모노그램 + "KACP") → 세로 `Separator` → 팀 스위처(ghost 버튼 32px, 상태 점 8px + 팀 이름 + `ChevronsUpDown`) → 팀 메뉴. 오른쪽 전사 메뉴 → 세로 `Separator` → 알림 → 아바타 28px
- 메뉴 항목: 텍스트만(아이콘 없음), `px-2.5 py-1.5`, 현재 위치는 배경 없이 `font-medium text-foreground`
- 알림 안 읽음 배지: `primary` 검정 채움 + 흰 숫자 10px, 종 아이콘 오른쪽 위. 패널 폭 360, 안 읽음 점도 `primary`(의미 색 아님)
- 앱 막대: `h-9`, 칩 높이 26, 칩 = 상태 점 6px + 앱 이름(`font-medium`) + 만든 사람(`muted`) + 작은 ScopeBadge(높이 18)
- 기동 중 화면: 스피너 32px + 제목 `text-lg font-semibold` + 설명 + 진행 막대 6px(`primary` 채움, `muted` 바탕) + 경과/예상 시간 + 단계 3개(작업 공간 준비 → 에이전트 시작 → 화면 연결, Stepper 규칙 그대로 세로 배치)
- 오류 화면: `muted` 원 56px 안 `TriangleAlert` 28px(`--danger`) + 제목 + 설명 + 주요 버튼 "다시 시도". 팀 관리자만 아래 "오류 요약" 카드(폭 440)

## 4. 화면 패턴 (올린 대시보드 이미지 기준)

### 요약 카드 `StatCard`

```
┌─────────────────────────────── [icon] ┐   ← 오른쪽 위: outline 아이콘 버튼 32px (선택)
│ 라벨 (text-sm muted)                   │
│                                        │
│ 1,920  (text-2xl semibold)   [미니차트] │   ← 오른쪽: 스파크라인/도트 막대 (선택)
│ +32.8% 지난달 대비 (xs)                 │
└────────────────────────────────────────┘
```

- 쓰는 곳: A-01 대시보드 카드 줄(활성 팀, 접속 중, 실행 중 앱, 처리 대기), U-08 리소스, A-05 사용량
- 카드 여러 개를 한 줄로 붙일 때는 이미지 하단처럼 **하나의 카드 안을 세로선(`divide-x`)으로 나눈다**

### 섹션 카드 `SectionCard`

- 머리(아이콘 + 제목 + 오른쪽에 필터 `Select` 또는 변화 배지) / 본문 / (선택) 바닥 범례
- 쓰는 곳: 대시보드 VM 리소스·팀 컨테이너 표, 앱 상세 탭 본문, MCP 상세 섹션

### 차트 스타일

| 종류 | 모양 | 쓰는 곳 |
|---|---|---|
| 선 차트 | 주 데이터 `chart-1` 2px 실선(곡선), 비교 `chart-2` 1.5px 점선, 격자 `chart-5` 점선 가로만, 호버 세로 점선 | VM CPU·메모리 24시간 추이, 앱 리소스 |
| 스파크라인 | `chart-1` 1.5px, 축 없음 | 요약 카드 오른쪽 |
| 도트 막대 | 칸마다 작은 정사각형, 값만큼 `chart-1`, 나머지 `chart-4` | 요약 카드 오른쪽(최근 7일 등) |
| 세그먼트 막대 | 가로 줄무늬로 쌓은 세로 막대 `chart-1` | 요일별 접속자 |
| 방사형 게이지 | 눈금형 링(채움 `chart-1`, 남음 `chart-4`), 가운데 아이콘 + 숫자 | VM 메모리·디스크 사용률, 팀 리소스 |
| 범례 | 작은 세로 막대/점 + 라벨 + 오른쪽 숫자 + 변화량 | 게이지 아래 |

경고 기준을 넘으면 그 차트만 **주 데이터 색을 `--warning`/`--danger`로** 바꾼다(그 외에는 흑백 유지).

### 목록 화면

- 제목 영역: 화면 제목 + 설명(왼쪽), 주요 버튼(오른쪽, `primary`)
- 도구 막대: 검색 `Input`(왼쪽, 폭 250) + 필터 `DataTableFacetedFilter`(점선 테두리 버튼, shadcn Tasks 예제 방식) + 보기 옵션(오른쪽)
- 표: shadcn `Table` + TanStack Table, 테두리 있는 카드 안, 행 높이 `h-12`, 머리 `text-muted-foreground`, 행 끝 `⋯` 드롭다운
- 바닥: 선택 개수 + 페이지 나누기

## 5. 공통 컴포넌트 (shadcn 매핑)

| 우리 컴포넌트 | 기반 shadcn | 쓰는 곳 / 요구사항 |
|---|---|---|
| `AppHeader` | `NavigationMenu`, `Separator` | C-00. 팀 범위와 전사 범위 사이 세로 `Separator`. 현재 메뉴는 `font-medium text-foreground`, 나머지 `muted-foreground`. 전사 메뉴 영역은 3개(커뮤니티·MCP 마켓·지식 예정) 폭을 미리 확보 |
| `DeptTree` / `DeptPicker` | `Collapsible` + `Popover` | A-12 트리, 사용자 추가·필터·팀 멤버 추가의 부서 선택. "하위 부서 포함" 체크 |
| `TeamSwitcher` | `DropdownMenu` (shadcn Sidebar 예제의 Team Switcher) | 팀 목록 + 상태 점 + "팀 설정" |
| `ProfileMenu` | `DropdownMenu` + `Avatar` | 내 정보, 관리자 화면, 로그아웃 |
| `AdminSidebar` | `Sidebar` (collapsible="icon") | 메뉴 그룹 + 대기 건수 `SidebarMenuBadge` |
| `CommandSearch` | `Command` (⌘K) | 관리자: 사용자·팀 빠른 이동 (v1.1 가능) |
| `StatCard` / `SectionCard` | `Card` | §4 |
| `StatusBadge` | `Badge variant="outline"` + 앞에 6px 상태 점 | 아래 상태 표의 `kind`+`value`만 받는다 |
| `ScopeBadge` | `Badge variant="secondary"` | Private/Public, 마켓/기본 제공. "직접 추가 · 검토되지 않음"은 `outline` + `--warning` 점 |
| `ActorBadge` | `Avatar`(사람) / Lucide `Bot` 아이콘 원(에이전트) | 에이전트는 색 대신 **아이콘으로** 구분: "🤖 에이전트 · 홍길동 요청" 형태 |
| `DataTable` | `Table` + TanStack Table | 정렬, 행 선택(`Checkbox`), 행 메뉴, 빈·로딩(`Skeleton`)·오류 슬롯 |
| `EmptyState` | `Card` 안 가운데 정렬 | Lucide 아이콘 32px(`muted` 원 배경) + 제목 + 설명 + 버튼 1개 |
| `Modal` | `Dialog` | 폼 모달 |
| `ConfirmDialog` | `AlertDialog` | 위험 동작. 이름 입력 확인 옵션 |
| `SidePanel` | `Sheet` (side="right") | 드라이브 상세, 앱 미리보기(폭 조절) |
| `Tabs` | `Tabs` | 앱 상세, 팀 상세, 마켓 |
| `Stepper` | 커스텀(원 + 선) | U-03, U-12, 팀 생성. 완료 = 검정 원+체크, 현재 = 검정 테두리, 대기 = `border`, 실패 = `--danger` X |
| `Toast` | Sonner | 성공/정보/오류, 행동 링크 1개 |
| `SecretInput` | `Input type=password` + 보기 토글 | 저장 후 `••••` + "변경" |
| `CopyField` | `Input readOnly` + 아이콘 버튼 | 주소, 경로, 임시 비밀번호 |
| `FileTree` / `FileList` | `Collapsible` + `Table` | 드라이브 |
| `UploadTray` | `Card` 고정 + `Progress` | 하단 오른쪽 업로드 진행 |
| `LogViewer` | `ScrollArea` + `font-mono text-xs` | 배경 `muted`, 자동 스크롤 토글 |
| `UsageBar` / `Gauge` / `Sparkline` | `Progress`, Chart | 한도 대비 % |
| `NameField` | `Input` + `FormDescription` | 규칙 안내 + 실시간 검사 결과(✓ 사용 가능 / ✕ 사유) |
| `LoadingStage` | `Card` 없이 가운데 정렬 + 스피너(Lucide `Loader2` 회전) | 에이전트 셸 기동 |
| `FilterSelect` | `Select` (outline) | "최근 30일" 같은 기간 선택 |

## 6. 상태 배지 표 (단일 기준)

코드 값은 `packages/shared`의 상수와 DB가 **이 표와 같아야** 한다.
배지는 모두 **흰 배경 + 테두리 + 앞의 색 점 + 검정 글씨**(`Badge variant="outline"`). 색은 점에만 쓴다.

| 점 색 | 의미 |
|---|---|
| `--success` | 정상·완료 |
| `--warning` | 진행 중·대기 |
| `--danger` | 오류·반려 |
| `muted-foreground` | 멈춤·취소·중립 |

### 팀 컨테이너 `team_container_status`

| 값 | 사원 화면 문구 | 관리자 화면 문구 | 점 |
|---|---|---|---|
| `stopped` | 쉬는 중 | 정지 | muted |
| `starting` | 준비 중 | 기동 중 | warning (깜빡임) |
| `running` | 사용 가능 | 실행 중 | success |
| `stopping` | 정리 중 | 정지 중 | muted |
| `error` | 문제 발생 | 오류 | danger |

### 에이전트 할당 적용 `apply_status`

| 값 | 문구 | 점 |
|---|---|---|
| `pending` | 반영 대기 | warning |
| `applied` | 반영 완료 | success |
| `failed` | 반영 실패 | danger |

### 앱 `app_status` / 공개 범위 `visibility`

| 값 | 문구 | 모양 |
|---|---|---|
| `starting` | 시작 중 | outline + warning 점 |
| `running` | 실행 중 | outline + success 점 |
| `stopped` | 멈춤 | outline + muted 점 |
| `error` | 오류 | outline + danger 점 |
| `private` | Private · 팀만 | `secondary` (회색 채움), Lucide `Lock` |
| `public` | Public · 전사 | `default` (검정 채움, 흰 글씨), Lucide `Globe` |
| (요청 대기 중) | 공개 승인 대기 | outline + warning 점 |

### 앱의 두 사본 — 작업본 / 공개본 (배지 확정)

앱 하나는 **작업본**(Private, `앱--팀.kacp.cloud`, 팀만, 에이전트 수정 즉시 반영)과 **공개본**(Public, `앱.kacp.cloud`, 전 사원, 승인 시점 스냅샷 v1·v2…)을 따로 가진다. 화면에서는 두 사본을 항상 나눠 보여준다.

| 대상 | 문구 | 모양 |
|---|---|---|
| 작업본 | Private · 팀만 | `secondary` 회색 채움 + `Lock` |
| 공개본 | Public v2 | `default` 검정 채움 + `Globe`, 버전 번호 포함 |
| 잠듦 (`sleeping`) | 잠듦 · 접속하면 켜져요 (좁은 곳은 "잠듦") | outline + muted 점. 앱 막대 칩은 흐리게(`opacity-50`) |
| 업데이트 대기 | 업데이트 대기 v2→v3 | outline + warning 점 |
| 공개 요청 대기(첫 공개) | 공개 승인 대기 | outline + warning 점 |
| 미공개 | — | 회색 대시 텍스트 |

- 앱 상태(`app_status`)에 `sleeping` 잠듦(muted 점)을 추가. 작업본·공개본이 각각 상태를 가진다.
- 요청 종류 배지(A-09): "새 공개" `secondary`, "업데이트 v2→v3" outline.
- 문구: "배포 설정" → **"공개 설정"**, "Private으로 되돌리기" → **"공개 중지"**(작업본은 남아요).

### Public 요청 `deploy_request_status`

| 값 | 문구 | 점 | 스테퍼 |
|---|---|---|---|
| `pending` | 검토 중 | warning | 요청됨 ✓ → 검토 중 ● |
| `approved` | 공개됨 | success | … → 승인 ✓ → 공개됨 ✓ |
| `rejected` | 반려됨 | danger | … → 반려 ✕ (사유) |
| `cancelled` | 취소됨 | muted | — |

### MCP 버전 `mcp_version_status`

| 값 | 문구 | 점 | 스테퍼 단계 |
|---|---|---|---|
| `uploaded` | 업로드됨 | muted | 업로드 |
| `validating` | 검증 중 | warning | 검증 |
| `building` | 빌드 중 | warning | 빌드 |
| `scanning` | 보안 스캔 중 | warning | 보안 스캔 |
| `testing` | 테스트 중 | warning | 테스트 |
| `in_review` | 심사 대기 | warning | 심사 대기 |
| `published` | 게시됨 | success | 게시됨 |
| `rejected` | 반려됨 | danger | (심사에서 멈춤) |
| `failed` | 실패 | danger | (실패 단계에서 멈춤, `failed_stage` 표시) |
| `superseded` | 이전 버전 | muted | — |

### MCP 패키지 `mcp_package_status`: `active` 게시 중(success) / `suspended` 게시 중단(danger)

### MCP 설치 `mcp_install_status`

| 값 | 문구 | 점 |
|---|---|---|
| `installing` | 설치 중 | warning |
| `installed` | 설치됨 | success |
| `error` | 오류 | danger |
| `removing` | 제거 중 | muted |

출처 `mcp_install_source`: `default` 기본 제공(`secondary`) / `market` 마켓(`secondary`) / `manual` 직접 추가 · 검토되지 않음(outline + warning 점 + Lucide `ShieldAlert`)

### 사용자 `user_status`: `active` 활성(success) / `disabled` 비활성(muted) / (파생) `must_change_password` 비밀번호 변경 대기(warning)

## 7. 아이콘 (Lucide)

| 대상 | 아이콘 |
|---|---|
| 에이전트 | `Bot` |
| 드라이브 / 폴더 / 파일 | `HardDrive` / `Folder` / `File`, `FileText`, `FileImage`, `FileCode` |
| 배포관리 / 앱 | `Rocket` / `AppWindow` |
| 커뮤니티 | `MessagesSquare` |
| MCP 마켓 / MCP | `Store` / `Plug` |
| 알림 | `Bell` |
| 팀 / 사용자 | `Users` / `User` |
| 대시보드 | `LayoutDashboard` |
| 에이전트 템플릿 | `Sparkles` |
| 심사 / 승인 | `ShieldCheck` / `BadgeCheck` |
| 설정 / 활동 기록 | `Settings` / `History` |
| 리소스(CPU·메모리·디스크) | `Cpu` / `MemoryStick` / `Database` |
| 증가 / 감소 | `TrendingUp` / `TrendingDown` |
| Private / Public | `Lock` / `Globe` |
| 조직(부서) / 가져오기 | `Building2` / `FileUp` |
| 드래그 금지 / 보관 | `Ban` / `Archive` |

### 부서 표기 규칙

- 사원 화면: 이름 옆 `text-xs text-muted-foreground`로 부서명만 — "홍길동 · 영업1팀". 경로는 보이지 않음(툴팁 없음).
- 관리자 표: "부서" 열에 가장 아래 부서명, 말줄임, 마우스 올리면 전체 경로 툴팁.
- 경로: `›` 구분, 상위는 `muted-foreground`, 마지막만 `foreground`. 5단계를 넘으면 "최상위 › … › 마지막"으로 접고 `…` 클릭 시 드롭다운.
- 트리: 행 높이 30, 단계당 들여쓰기 12px, 오른쪽에 하위 포함 인원 수(`text-xs muted tabular-nums`). 보관 부서는 `opacity-50`. 검색 일치는 이름에 `muted`보다 진한 회색(`border` 색) 배경 강조 + 상위 자동 펼침. 드래그 금지 위치는 `--danger` 1px 안쪽 테두리 + `Ban` 아이콘 + 검정 툴팁 사유.
- 가져오기 미리보기 동작 배지: 추가(success) / 변경(warning) / 그대로(muted) / 오류(danger) — outline + 점. 변경된 칸은 `muted` 배경 + 이전 값 취소선.

## 8. 문구 규칙

- 버튼은 짧게: "승인", "반려", "팀 만들기". 위험 동작은 대상 포함("팀 삭제").
- 변화량: "+32.8% 지난달 대비"처럼 수치 + 회색 비교 기준.
- 시각은 24시간 이내 상대 표기("3분 전"), 그 이후 `2026-09-30 14:05`.
- 크기는 KB/MB/GB 자동, 소수 한 자리. 숫자는 천 단위 쉼표.
- 오류 문구는 "무슨 일 + 할 일": "업로드하지 못했어요. 파일이 500MB를 넘어요."
- 영어 고유명(Private, Public, MCP)은 그대로 쓴다.

## 9. Claude Design에 넘길 때

- "shadcn/ui neutral 테마, 흑백, 카드 테두리만, 그림자 없음, Lucide 아이콘, Inter + Pretendard"를 첫 문장에 넣는다.
- 참고 이미지(흑백 KPI 대시보드)와 shadcn-admin 링크를 같이 준다.
- 색은 §3 사용 규칙 표 밖에서 쓰지 말라고 명시한다.
