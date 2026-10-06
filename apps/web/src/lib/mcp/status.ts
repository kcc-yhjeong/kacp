import { ApiError } from '@/lib/api';
import type { Step } from '@/components/stepper';
import type {
  AdminMcpInstall,
  McpFailedStage,
  McpInstall,
  McpInstallSource,
  McpInstallStatus,
  McpManifest,
  McpPackageStatus,
  McpVersion,
  McpVersionStatus,
  ScanSummary,
  VersionChanges,
} from './types';

// Pure MCP helpers: badges (02-design-system.md §6 MCP 버전·설치·패키지·출처), the U-12 stepper,
// install consent, upload errors, the A-08 team × package matrix.

export type Dot = 'success' | 'warning' | 'danger' | 'muted';

export const PLATFORM_PACKAGE = 'platform-mcp';

// ── Version status

export const VERSION_STATUS: Record<McpVersionStatus, { label: string; dot: Dot; blink?: boolean }> = {
  uploaded: { label: '업로드됨', dot: 'muted' },
  validating: { label: '검증 중', dot: 'warning', blink: true },
  building: { label: '빌드 중', dot: 'warning', blink: true },
  scanning: { label: '보안 스캔 중', dot: 'warning', blink: true },
  testing: { label: '테스트 중', dot: 'warning', blink: true },
  in_review: { label: '심사 대기', dot: 'warning' },
  published: { label: '게시됨', dot: 'success' },
  rejected: { label: '반려됨', dot: 'danger' },
  failed: { label: '실패', dot: 'danger' },
  superseded: { label: '이전 버전', dot: 'muted' },
};

const BUSY: ReadonlySet<McpVersionStatus> = new Set(['uploaded', 'validating', 'building', 'scanning', 'testing']);

/** The pipeline is still running (poll every 3 s). */
export function isVersionBusy(status: McpVersionStatus): boolean {
  return BUSY.has(status);
}

export const VERSION_STEPS = ['업로드', '검증', '빌드', '보안 스캔', '테스트', '심사 대기', '게시됨'] as const;

const STAGE_INDEX: Record<McpFailedStage, number> = { validate: 1, build: 2, scan: 3, test: 4 };
export const FAILED_STAGE_LABEL: Record<McpFailedStage, string> = {
  validate: '검증',
  build: '빌드',
  scan: '보안 스캔',
  test: '테스트',
};

const CURRENT_INDEX: Partial<Record<McpVersionStatus, number>> = {
  uploaded: 0,
  validating: 1,
  building: 2,
  scanning: 3,
  testing: 4,
  in_review: 5,
};

/**
 * Stepper state (U-12): 업로드 → 검증 → 빌드 → 보안 스캔 → 테스트 → 심사 대기 → 게시됨.
 * `failed` stops with X at the failed stage, `rejected` with X at 심사 대기.
 */
export function versionSteps(status: McpVersionStatus, failedStage: McpFailedStage | null): Step[] {
  const n = VERSION_STEPS.length;
  let done = 0; // steps before this index are done
  let mark: { index: number; state: 'current' | 'failed' } | null = null;
  switch (status) {
    case 'published':
    case 'superseded':
      done = n;
      break;
    case 'failed': {
      const i = failedStage ? STAGE_INDEX[failedStage] : 1;
      done = i;
      mark = { index: i, state: 'failed' };
      break;
    }
    case 'rejected':
      done = 5;
      mark = { index: 5, state: 'failed' };
      break;
    default: {
      const i = CURRENT_INDEX[status] ?? 0;
      done = i;
      mark = { index: i, state: 'current' };
    }
  }
  return VERSION_STEPS.map((label, i) => ({
    label,
    state: mark && i === mark.index ? mark.state : i < done ? 'done' : 'todo',
  }));
}

/** "보안 스캔에서 멈췄어요" / "심사에서 반려됐어요" / null. */
export function stopTitle(v: Pick<McpVersion, 'status' | 'failedStage'>): string | null {
  if (v.status === 'rejected') return '심사에서 반려됐어요';
  if (v.status !== 'failed') return null;
  return `${FAILED_STAGE_LABEL[v.failedStage ?? 'validate']}에서 멈췄어요`;
}

/** Which log stage the version is on (to keep that log fresh while it runs). */
export function activeLogStage(status: McpVersionStatus): 'build' | 'scan' | 'test' | null {
  if (status === 'building') return 'build';
  if (status === 'scanning') return 'scan';
  if (status === 'testing') return 'test';
  return null;
}

// ── Install status / source / package status

export const INSTALL_STATUS: Record<McpInstallStatus, { label: string; dot: Dot; blink?: boolean }> = {
  installing: { label: '설치 중', dot: 'warning', blink: true },
  installed: { label: '설치됨', dot: 'success' },
  error: { label: '오류', dot: 'danger' },
  removing: { label: '제거 중', dot: 'muted', blink: true },
};

export const INSTALL_SOURCE_LABEL: Record<McpInstallSource, string> = {
  default: '기본 제공',
  market: '마켓',
  manual: '직접 추가 · 검토되지 않음',
};

export const PACKAGE_STATUS: Record<McpPackageStatus, { label: string; dot: Dot }> = {
  active: { label: '게시 중', dot: 'success' },
  suspended: { label: '게시 중단', dot: 'danger' },
};

/** Poll the install list every 3 s while something is moving. */
export function hasBusyInstall(items: Pick<McpInstall, 'status'>[]): boolean {
  return items.some((i) => i.status === 'installing' || i.status === 'removing');
}

/** platform-mcp is always there (409 on delete). */
export function canRemoveInstall(i: Pick<McpInstall, 'packageName' | 'status'>): boolean {
  return i.packageName !== PLATFORM_PACKAGE && i.status !== 'removing';
}

/** Re-entering secrets only makes sense for a market/manual install that has secret names. */
export function canReenterSecrets(i: Pick<McpInstall, 'source' | 'secretNames' | 'status' | 'packageName'>): boolean {
  return i.packageName !== PLATFORM_PACKAGE && i.secretNames.length > 0 && i.status !== 'removing';
}

// ── Install consent (U-10 step 2) and secrets (step 3)

export type ConsentKey = `net:${string}` | `secret:${string}`;

export interface ConsentItem {
  key: ConsentKey;
  kind: 'network' | 'secret';
  label: string;
  detail: string;
}

export function consentItems(manifest: Pick<McpManifest, 'network' | 'secrets'> | null | undefined): ConsentItem[] {
  if (!manifest) return [];
  return [
    ...(manifest.network ?? []).map((d) => ({
      key: `net:${d}` as const,
      kind: 'network' as const,
      label: d,
      detail: '이 주소로 접속해요',
    })),
    ...(manifest.secrets ?? []).map((s) => ({
      key: `secret:${s.name}` as const,
      kind: 'secret' as const,
      label: s.name,
      detail: s.description || '팀 비밀값을 써요',
    })),
  ];
}

/** Every consent checkbox is ticked (nothing to agree to = complete). */
export function consentComplete(items: ConsentItem[], checked: ReadonlySet<string>): boolean {
  return items.every((i) => checked.has(i.key));
}

/** Required secrets left empty (whitespace counts as empty). */
export function missingSecrets(
  secrets: Pick<McpManifest['secrets'][number], 'name' | 'required'>[] | undefined,
  values: Record<string, string>,
): string[] {
  return (secrets ?? []).filter((s) => s.required !== false && !(values[s.name] ?? '').trim()).map((s) => s.name);
}

/** Only non-empty values go to the api (values are never stored on our side). */
export function secretPayload(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v.trim()) out[k] = v;
  return out;
}

// ── Upload (U-12)

export const MCP_ZIP_MAX_BYTES = 50 * 1024 * 1024;

/** Client-side check before sending. Null = fine. */
export function zipProblem(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.zip$/i.test(file.name)) return '올리지 못했어요. create-platform-mcp pack으로 만든 .zip 파일만 올릴 수 있어요.';
  if (file.size > MCP_ZIP_MAX_BYTES) return '올리지 못했어요. 파일이 50MB를 넘어요.';
  if (file.size === 0) return '올리지 못했어요. 빈 파일이에요.';
  return null;
}

export interface UploadErrorView {
  title: string;
  problems: string[];
}

/** API error → what the upload card shows. 422 lists the manifest problems. */
export function uploadErrorView(err: unknown): UploadErrorView {
  if (!(err instanceof ApiError)) return { title: '올리지 못했어요. 잠시 후 다시 시도해 주세요.', problems: [] };
  switch (err.code) {
    case 'MCP_MANIFEST_INVALID': {
      const raw = err.details?.problems;
      const problems = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
      return { title: '올리지 못했어요. platform-plugin.yaml을 고쳐 주세요.', problems };
    }
    case 'MCP_VERSION_EXISTS':
      return { title: '올리지 못했어요. 이미 올린 버전이에요. platform-plugin.yaml의 version을 올려 주세요.', problems: [] };
    case 'FORBIDDEN':
      return { title: '올리지 못했어요. 다른 사람이 올린 패키지 이름이에요. name을 바꿔 주세요.', problems: [] };
    default:
      if (err.status === 413) return { title: '올리지 못했어요. 파일이 50MB를 넘어요.', problems: [] };
      return { title: err.message, problems: [] };
  }
}

// ── Scan

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const SEVERITY_LABEL: Record<(typeof SEVERITIES)[number], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function severityDot(sev: string): Dot {
  const s = sev.toLowerCase();
  if (s === 'critical' || s === 'high') return 'danger';
  if (s === 'medium') return 'warning';
  return 'muted';
}

/** `Critical 0 · High 1 · Medium 2 · Low 5`, or `—` without a scan. */
export function scanSummaryText(s: ScanSummary | null | undefined): string {
  if (!s) return '—';
  return SEVERITIES.map((k) => `${SEVERITY_LABEL[k]} ${s[k] ?? 0}`).join(' · ');
}

/** Sort findings: critical first. */
export function sortFindings<T extends { severity: string }>(items: T[]): T[] {
  const rank = (s: string) => {
    const i = (SEVERITIES as readonly string[]).indexOf(s.toLowerCase());
    return i < 0 ? SEVERITIES.length : i;
  };
  return [...items].sort((a, b) => rank(a.severity) - rank(b.severity));
}

// ── Review (A-07)

const INTERNAL_SUFFIXES = ['.internal', '.local', '.corp', '.intra', '.lan'];

/** 사내 / 외부 for a manifest network entry. `base` = the platform domain (e.g. kacp.cloud). */
export function networkKind(domain: string, base: string | null): 'internal' | 'external' {
  const d = domain.toLowerCase().replace(/^\*\./, '');
  if (INTERNAL_SUFFIXES.some((s) => d.endsWith(s))) return 'internal';
  if (base && (d === base || d.endsWith(`.${base}`))) return 'internal';
  return 'external';
}

export function changeCount(c: VersionChanges | null | undefined): number {
  if (!c) return 0;
  return c.secretsAdded.length + c.secretsRemoved.length + c.networkAdded.length + c.networkRemoved.length;
}

// ── A-08 team × package matrix

export interface MatrixCell {
  id: string;
  version: string | null;
  status: McpInstallStatus;
  source: McpInstallSource;
}

export interface InstallMatrix {
  /** Package keys (column order: platform-mcp first, then by install count, then name). */
  packages: string[];
  rows: { team: string; cells: Record<string, MatrixCell | undefined> }[];
}

/** Team × package table from `/admin/mcp/installs`. Manual installs are listed in their own tab. */
export function buildInstallMatrix(items: AdminMcpInstall[]): InstallMatrix {
  const market = items.filter((i) => i.source !== 'manual');
  const counts = new Map<string, number>();
  const byTeam = new Map<string, Record<string, MatrixCell | undefined>>();
  for (const i of market) {
    const key = i.packageName ?? i.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const row = byTeam.get(i.team) ?? {};
    row[key] = { id: i.id, version: i.version, status: i.status, source: i.source };
    byTeam.set(i.team, row);
  }
  const packages = [...counts.keys()].sort((a, b) => {
    if (a === PLATFORM_PACKAGE) return -1;
    if (b === PLATFORM_PACKAGE) return 1;
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
  });
  const rows = [...byTeam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([team, cells]) => ({ team, cells }));
  return { packages, rows };
}

/** Latest version per package in a matrix column (older cells are dimmed). */
export function latestInColumn(matrix: InstallMatrix, pkg: string): string | null {
  const versions = matrix.rows.map((r) => r.cells[pkg]?.version).filter((v): v is string => !!v);
  return versions.sort(compareSemver).at(-1) ?? null;
}

/** semver compare for display ordering (prerelease tags sort before the release). */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre] = v.split('-', 2);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre);
}

// ── Manual add (U-15)

/** `https://…` or `http://…` only. */
export function manualUrlProblem(url: string): string | null {
  const v = url.trim();
  if (!v) return '연결 주소를 입력하세요.';
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'http:// 또는 https://로 시작하는 주소만 쓸 수 있어요.';
    if (u.username || u.password) return '주소에 계정 정보를 넣지 말고 헤더로 입력하세요.';
    return null;
  } catch {
    return '주소 형식이 맞지 않아요. 예: https://mcp.example.com/mcp';
  }
}

/** Header rows → object; blank names are skipped, duplicate names keep the last value. */
export function headerObject(rows: { name: string; value: string }[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.name.trim();
    if (k) out[k] = r.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
