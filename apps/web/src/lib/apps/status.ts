import type { App, AppCopy, AppDetail, AppHostInfo, AppStatus, DeployRequest, StopReason, TeamAppsResponse } from './types';

// Pure app helpers: copy state, list filters (02-design-system.md §6 파생 값), badges, C-04 view choice.

/** What a copy looks like on screen. `sleeping` = stopped + idle/limit, `admin` = stopped by a platform admin. */
export type CopyState = 'starting' | 'running' | 'sleeping' | 'stopped' | 'admin' | 'error';

export type Dot = 'success' | 'warning' | 'danger' | 'muted';

export function copyStateOf(copy: Pick<AppCopy, 'status' | 'stopReason'>): CopyState {
  return stateOf(copy.status, copy.stopReason);
}

export function stateOf(status: AppStatus, stopReason: StopReason | null): CopyState {
  switch (status) {
    case 'running':
      return 'running';
    case 'starting':
      return 'starting';
    case 'error':
      return 'error';
    default:
      if (stopReason === 'idle' || stopReason === 'limit') return 'sleeping';
      if (stopReason === 'admin') return 'admin';
      return 'stopped';
  }
}

/** Badge wording (02 §6 앱 app_status). */
export const COPY_STATE: Record<CopyState, { label: string; short: string; dot: Dot; blink?: boolean; muted?: boolean }> = {
  starting: { label: '시작 중', short: '시작 중', dot: 'warning', blink: true },
  running: { label: '실행 중', short: '실행 중', dot: 'success' },
  sleeping: { label: '잠듦 · 접속하면 켜져요', short: '잠듦', dot: 'muted', muted: true },
  stopped: { label: '멈춤', short: '멈춤', dot: 'muted' },
  admin: { label: '관리자가 중지함', short: '관리자가 중지함', dot: 'danger' },
  error: { label: '오류', short: '오류', dot: 'danger' },
};

// ── List filters (U-07 · A-05). Same values as the API query.

export type WorkFilter = 'running' | 'sleeping' | 'stopped' | 'error';
export type PublicFilter = 'none' | 'publish_pending' | 'update_pending' | 'live';

export const WORK_FILTERS: { value: WorkFilter; label: string }[] = [
  { value: 'running', label: '실행 중' },
  { value: 'sleeping', label: '잠듦' },
  { value: 'stopped', label: '멈춤' },
  { value: 'error', label: '오류' },
];

export const PUBLIC_FILTERS: { value: PublicFilter; label: string }[] = [
  { value: 'none', label: '미공개' },
  { value: 'publish_pending', label: '공개 승인 대기' },
  { value: 'update_pending', label: '업데이트 대기' },
  { value: 'live', label: '공개 중' },
];

export function isWorkFilter(v: unknown): v is WorkFilter {
  return WORK_FILTERS.some((f) => f.value === v);
}

export function isPublicFilter(v: unknown): v is PublicFilter {
  return PUBLIC_FILTERS.some((f) => f.value === v);
}

/** `running` includes `starting`; `stopped` covers manual and admin stops. */
export function workFilterOf(app: Pick<App, 'work'>): WorkFilter {
  const s = copyStateOf(app.work);
  if (s === 'running' || s === 'starting') return 'running';
  if (s === 'sleeping') return 'sleeping';
  if (s === 'error') return 'error';
  return 'stopped';
}

export function publicFilterOf(app: Pick<App, 'public' | 'pendingRequest'>): PublicFilter {
  if (app.pendingRequest?.kind === 'publish' && !app.public) return 'publish_pending';
  if (app.public && app.pendingRequest?.kind === 'update') return 'update_pending';
  if (app.public) return 'live';
  // A publish request is the only pending kind possible without a public copy.
  return app.pendingRequest ? 'publish_pending' : 'none';
}

export interface AppListFilter {
  work?: WorkFilter;
  public?: PublicFilter;
  q?: string;
}

/** Client-side filter (the search is always client-side; work/public mirror the API query). */
export function filterApps<T extends App>(apps: T[], f: AppListFilter): T[] {
  const q = f.q?.trim().toLowerCase() ?? '';
  return apps.filter(
    (a) =>
      (!f.work || workFilterOf(a) === f.work) &&
      (!f.public || publicFilterOf(a) === f.public) &&
      (!q || a.slug.toLowerCase().includes(q) || (a.public?.name.toLowerCase().includes(q) ?? false)),
  );
}

// ── Badges

/** `업데이트 대기 v2→v3` / `공개 승인 대기` / null. `short` drops the versions (app bar chips). */
export function pendingLabel(app: Pick<App, 'public' | 'pendingRequest'>, short = false): string | null {
  const f = publicFilterOf(app);
  if (f === 'publish_pending') return '공개 승인 대기';
  if (f === 'update_pending') {
    const v = app.public?.version;
    return short || v === undefined ? '업데이트 대기' : `업데이트 대기 v${v}→v${v + 1}`;
  }
  return null;
}

export type ChipBadge = { kind: 'public'; label: string } | { kind: 'pending'; label: string } | { kind: 'sleeping'; label: string };

/** U-02 chip: `Public vN` when public, a pending badge when a request waits, `잠듦` (dimmed chip) when asleep. */
export function chipView(app: App): { dimmed: boolean; state: CopyState; badges: ChipBadge[] } {
  const state = copyStateOf(app.work);
  const badges: ChipBadge[] = [];
  if (app.public) badges.push({ kind: 'public', label: `Public v${app.public.version}` });
  const pending = pendingLabel(app, true);
  if (pending) badges.push({ kind: 'pending', label: pending });
  if (state === 'sleeping') badges.push({ kind: 'sleeping', label: '잠듦' });
  return { dimmed: state === 'sleeping', state, badges };
}

/** Next public version an update request would create. */
export function nextVersion(req: Pick<DeployRequest, 'kind' | 'fromVersion'>, publicVersion?: number | null): number {
  if (req.kind === 'publish') return 1;
  const from = req.fromVersion ?? publicVersion ?? 0;
  return from + 1;
}

/** A-09 kind badge: `새 공개` / `업데이트 v2→v3`. */
export function deployKindLabel(req: Pick<DeployRequest, 'kind' | 'fromVersion'>, publicVersion?: number | null): string {
  if (req.kind === 'publish') return '새 공개';
  const from = req.fromVersion ?? publicVersion;
  return from === null || from === undefined ? '업데이트' : `업데이트 v${from}→v${from + 1}`;
}

/** U-03 shape. */
export type PublishShape = 'unpublished' | 'pending' | 'public';

export function publishShape(app: Pick<App, 'public' | 'pendingRequest'>): PublishShape {
  if (app.pendingRequest) return 'pending';
  return app.public ? 'public' : 'unpublished';
}

/** The most recent decision when it was a rejection and nothing is pending (U-03 "직전 반려"). */
export function lastRejection(detail: Pick<AppDetail, 'history' | 'pendingRequest'>): DeployRequest | null {
  if (detail.pendingRequest) return null;
  const decided = detail.history
    .filter((r) => r.status === 'approved' || r.status === 'rejected')
    .sort((a, b) => (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt));
  const last = decided[0];
  return last && last.status === 'rejected' ? last : null;
}

/** U-07 banner: "실행 중인 앱이 5개 중 4개예요" once one slot is left. */
export function nearLimit(limits: TeamAppsResponse['limits'] | null | undefined): boolean {
  if (!limits || limits.maxRunningWork <= 0) return false;
  return limits.runningWork >= limits.maxRunningWork - 1;
}

export function memPct(usage: AppCopy['usage']): number | null {
  if (!usage || !usage.memLimitBytes) return null;
  return Math.min(100, Math.max(0, (usage.memBytes / usage.memLimitBytes) * 100));
}

/** Hostname of a copy URL (`/app-hosts/{host}` takes the hostname without a port). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** URL without the scheme, for display. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// ── C-04 on app hosts

export type AppHostView =
  | { kind: 'not_found' }
  | { kind: 'login' }
  | { kind: 'forbidden' }
  /** Asleep or starting. `wake` = this page should POST wake first. */
  | { kind: 'waking'; reason: 'idle' | 'limit' | null; wake: boolean }
  | { kind: 'ready' }
  | { kind: 'stopped'; member: boolean }
  | { kind: 'admin'; member: boolean; reason: string | null }
  | { kind: 'error'; member: boolean };

/**
 * Which C-04 page to draw. `info.status` is null when the viewer is not logged in (only `exists` is given).
 * Work copies are for team members only.
 */
export function appHostView(info: AppHostInfo, isMember: boolean): AppHostView {
  if (!info.exists) return { kind: 'not_found' };
  if (info.status === null) return { kind: 'login' };
  if (info.copy === 'work' && !isMember) return { kind: 'forbidden' };
  const state = stateOf(info.status, info.stopReason);
  switch (state) {
    case 'running':
      return { kind: 'ready' };
    case 'starting':
      return { kind: 'waking', reason: sleepReason(info.stopReason), wake: false };
    case 'sleeping':
      return info.canWake
        ? { kind: 'waking', reason: sleepReason(info.stopReason), wake: true }
        : { kind: 'stopped', member: isMember };
    case 'admin':
      return { kind: 'admin', member: isMember, reason: info.statusDetail };
    case 'error':
      return { kind: 'error', member: isMember };
    default:
      return { kind: 'stopped', member: isMember };
  }
}

function sleepReason(r: StopReason | null): 'idle' | 'limit' | null {
  return r === 'idle' || r === 'limit' ? r : null;
}

/** Wake page description per reason (C-04 C4a / C4g). */
export function wakeDescription(reason: 'idle' | 'limit' | null): string {
  if (reason === 'limit') return '실행 중인 앱이 많아 잠시 쉬고 있던 앱이에요.';
  if (reason === 'idle') return '오래 쓰지 않아 잠들어 있던 앱이에요.';
  return '앱을 시작하고 있어요.';
}

/** `마케팅팀이` / `디자인가` → subject particle by the last Hangul syllable (이 after a final consonant). */
export function withSubject(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${word}이`;
  return code % 28 === 0 ? `${word}가` : `${word}이`;
}
