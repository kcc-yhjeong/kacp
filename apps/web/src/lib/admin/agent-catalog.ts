// A-06 template editor catalog: OpenClaw 2026.9.7 bundled skills and tool groups, in plain Korean.
// Source: the image's /app/skills/*/SKILL.md and docs/gateway/config-tools/tool-policy.md.
// Skills that only run on macOS, need personal accounts or devices, or manage OpenClaw itself are left
// out on purpose (they can still be typed in by name under "직접 입력").

export interface SkillInfo {
  name: string;
  label: string;
  description: string;
  /** Needs a key or account the team must set up in the Control UI (or an MCP), shown as a hint. */
  needs?: string;
}

export interface SkillGroup {
  title: string;
  skills: SkillInfo[];
}

export const SKILL_GROUPS: SkillGroup[] = [
  {
    title: '업무·문서',
    skills: [
      { name: 'summarize', label: '요약', description: '웹 페이지·PDF·영상·파일 내용을 요약하거나 받아 적어요.' },
      { name: 'nano-pdf', label: 'PDF 편집', description: '말로 지시해서 PDF를 고쳐요.' },
      { name: 'weather', label: '날씨', description: '지역의 현재 날씨와 예보를 알려줘요.' },
      { name: 'notion', label: 'Notion', description: 'Notion 페이지·데이터베이스를 찾고 읽고 써요.', needs: 'Notion API 키' },
      { name: 'trello', label: 'Trello', description: 'Trello 보드·카드를 관리해요.', needs: 'Trello API 키' },
      { name: 'openai-whisper-api', label: '음성 받아쓰기', description: '녹음 파일을 글로 옮겨요(OpenAI 음성 인식).', needs: 'OpenAI API 키' },
    ],
  },
  {
    title: '시각화',
    skills: [
      { name: 'visualize', label: '시각화', description: '설명에 맞는 그림·대시보드 위젯을 대화 안에 만들어요.' },
      { name: 'diagram-maker', label: '다이어그램', description: '구조도·흐름도·화이트보드 그림(SVG, Excalidraw)을 그려요.' },
      { name: 'meme-maker', label: '밈 만들기', description: '밈 템플릿을 찾아 이미지를 만들어요.' },
    ],
  },
  {
    title: '개발',
    skills: [
      { name: 'github', label: 'GitHub', description: '이슈·PR·CI 로그·리뷰를 다뤄요(gh CLI).', needs: 'GitHub 로그인' },
      { name: 'gh-issues', label: 'GitHub 이슈 자동 처리', description: '이슈를 골라 수정 작업을 돌리고 PR을 열어요.', needs: 'GitHub 로그인' },
      { name: 'coding-agent', label: '코딩 에이전트 위임', description: '큰 코딩 작업을 Codex·Claude Code 같은 별도 에이전트에 맡겨요.' },
      { name: 'spike', label: '시제품 검증', description: '버리는 시제품을 빠르게 만들어 가능 여부를 판단해요.' },
      { name: 'python-debugpy', label: 'Python 디버깅', description: 'pdb·debugpy로 Python 코드를 디버깅해요.' },
      { name: 'node-inspect-debugger', label: 'Node.js 디버깅', description: '중단점·프로파일로 Node.js 코드를 디버깅해요.' },
      { name: 'skill-creator', label: '스킬 만들기', description: '새 스킬(SKILL.md)을 만들거나 고쳐요.' },
    ],
  },
];

export const KNOWN_SKILLS = new Map(SKILL_GROUPS.flatMap((g) => g.skills.map((s) => [s.name, s] as const)));

export interface ToolBlock {
  /** Entries written to `tools.deny`. */
  deny: string[];
  label: string;
  description: string;
  /** What breaks when blocked, so admins see the cost. */
  impact: string;
}

/** "막을 기능" checkboxes → `tools.deny` (OpenClaw tool groups). Nothing checked = everything allowed. */
export const TOOL_BLOCKS: ToolBlock[] = [
  {
    deny: ['group:runtime'],
    label: '명령·코드 실행',
    description: '셸 명령과 코드를 실행해요(exec, process, code_execution). 샌드박스 안에서 돌아요.',
    impact: '막으면 스크립트 실행, 패키지 설치, 웹 앱 만들기 같은 작업을 못 해요.',
  },
  {
    deny: ['write', 'edit', 'apply_patch'],
    label: '파일 만들기·고치기',
    description: '작업 공간과 팀 드라이브에 파일을 쓰고 고쳐요. 읽기는 막히지 않아요.',
    impact: '막으면 결과물을 파일로 남기지 못하고 대화로만 답해요.',
  },
  {
    deny: ['group:web'],
    label: '웹 검색·가져오기',
    description: '인터넷을 검색하고 웹 페이지를 가져와요(web_search, web_fetch).',
    impact: '막으면 최신 정보 조회를 못 해요.',
  },
  {
    deny: ['group:ui'],
    label: '브라우저·화면',
    description: '브라우저를 직접 조작하고, 캔버스·위젯 화면을 띄워요.',
    impact: '막으면 웹사이트 자동 조작, 미리보기 화면 띄우기를 못 해요.',
  },
  {
    deny: ['group:media'],
    label: '이미지·음성·영상',
    description: '이미지를 보고 만들고, 음성·음악·영상을 만들고, PDF를 읽어요.',
    impact: '막으면 그림 생성, 이미지·PDF 이해를 못 해요.',
  },
  {
    deny: ['group:automation'],
    label: '예약 작업·Gateway 관리',
    description: '정해진 시간에 작업을 돌리고(cron), OpenClaw 설정·플러그인을 다뤄요.',
    impact: '막으면 "매일 아침 9시에 …" 같은 예약 작업을 못 만들어요. 일반 사용자 에이전트는 막아도 돼요.',
  },
  {
    deny: ['group:sessions'],
    label: '다른 대화·하위 에이전트',
    description: '다른 세션을 읽거나 메시지를 보내고, 하위 에이전트를 만들어 일을 나눠요.',
    impact: '막으면 큰 작업을 여러 에이전트로 나누지 못해요.',
  },
  {
    deny: ['group:messaging'],
    label: '외부 메시지 보내기',
    description: '연결된 메신저 채널(Slack 등)로 메시지를 보내요.',
    impact: '메신저 채널을 연결하지 않았다면 막아도 영향이 없어요.',
  },
];

/** Splits a stored deny list into checked blocks and the rest (shown under 고급). */
export function splitDeny(deny: string[]) {
  const checked = TOOL_BLOCKS.filter((b) => b.deny.every((d) => deny.includes(d)));
  const covered = new Set(checked.flatMap((b) => b.deny));
  return { checked: checked.map((b) => b.label), rest: deny.filter((d) => !covered.has(d)) };
}

/** Checked blocks + extra entries → `tools.deny` (no duplicates, stable order). */
export function joinDeny(checkedLabels: string[], rest: string[]) {
  const fromBlocks = TOOL_BLOCKS.filter((b) => checkedLabels.includes(b.label)).flatMap((b) => b.deny);
  return [...new Set([...fromBlocks, ...rest])];
}

/** Tool ids admins may type under 고급 (autocomplete). */
export const TOOL_IDS = [
  'group:runtime', 'group:fs', 'group:web', 'group:ui', 'group:media', 'group:automation', 'group:sessions', 'group:messaging',
  'group:memory', 'group:agents', 'group:nodes', 'group:plugins', 'bundle-mcp',
  'exec', 'process', 'code_execution', 'read', 'write', 'edit', 'apply_patch', 'web_search', 'web_fetch', 'browser', 'canvas',
  'view_image', 'image_generate', 'pdf', 'tts', 'automations', 'cron', 'gateway', 'message', 'memory_search', 'memory_get',
  'sessions_spawn', 'subagents', 'ask_user', 'progress_card',
];

export interface SkillRef {
  name: string;
  source: 'bundled' | 'upload';
  ref?: string;
}

/**
 * Stored skills → catalog checkboxes (`known`), bundled names not in the catalog (`custom`, shown under
 * "직접 입력"), and uploaded skills (kept untouched).
 */
export function splitSkills<T extends SkillRef>(skills: T[]) {
  const bundled = skills.filter((s) => s.source === 'bundled').map((s) => s.name);
  return {
    known: bundled.filter((n) => KNOWN_SKILLS.has(n)),
    custom: bundled.filter((n) => !KNOWN_SKILLS.has(n)),
    uploaded: skills.filter((s) => s.source !== 'bundled'),
  };
}

/** Inverse of `splitSkills`: catalog picks first (catalog order), then custom names, then uploads. No duplicates. */
export function joinSkills<T extends SkillRef>(known: string[], custom: string[], uploaded: T[]): (T | SkillRef)[] {
  const catalogOrder = [...KNOWN_SKILLS.keys()].filter((n) => known.includes(n));
  const names = [...new Set([...catalogOrder, ...custom])];
  return [...names.map((name) => ({ name, source: 'bundled' as const })), ...uploaded];
}
