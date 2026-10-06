import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Copy, ExternalLink, Eye, Globe, Info, Moon, Play, RotateCw, Square, TriangleAlert, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { errorMessage } from '@/lib/api';
import { appKeys, useTeamApps } from '@/lib/apps/api';
import { appHostView, chipView, copyStateOf, displayUrl, hostnameOf } from '@/lib/apps/status';
import type { App } from '@/lib/apps/types';
import { useAppHost } from '@/lib/apps/use-app-host';
import { useCopyControl } from '@/lib/apps/use-copy-control';
import { cn } from '@/lib/utils';
import { AppStatusBadge, CopyStateDot, PrivateBadge, PublicBadge } from './badges';
import { copyText, IconAction } from './common';
import { WakingView } from './wake-view';

const PublishDialog = lazy(() => import('./publish-dialog').then((m) => ({ default: m.PublishDialog })));

const COLLAPSE_KEY = 'kacp.shell.appBarCollapsed';
const WIDTH_KEY = 'kacp.shell.previewWidth';
const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 520;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Per-viewer convenience only.
  }
}

/**
 * U-02 state for the shell: team apps polled every 10 s while visible, a toast for each new app,
 * the preview panel target and the dialogs opened from chips.
 */
export function useShellApps(team: string) {
  const query = useTeamApps(team, { poll: true });
  const apps = query.data?.items ?? [];
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [publishApp, setPublishApp] = useState<App | null>(null);
  const [stopApp, setStopApp] = useState<App | null>(null);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    const items = query.data?.items;
    if (!items) return;
    const ids = new Set(items.map((a) => a.id));
    if (known.current) {
      for (const a of items) {
        if (!known.current.has(a.id)) {
          toast(`새 앱이 실행됐어요: ${a.slug}`, { action: { label: '미리보기', onClick: () => setPreviewId(a.id) } });
        }
      }
    }
    known.current = ids;
  }, [query.data]);

  const preview = previewId ? (apps.find((a) => a.id === previewId) ?? null) : null;
  return { apps, preview, setPreviewId, publishApp, setPublishApp, stopApp, setStopApp };
}

export type ShellApps = ReturnType<typeof useShellApps>;

/** Chips on the left of the shell bar (hidden when the team has no apps). */
export function AppChips({ s }: { s: ShellApps }) {
  const [collapsed, setCollapsed] = useState(() => readStorage(COLLAPSE_KEY) === '1');
  if (s.apps.length === 0) return null;
  const toggle = () =>
    setCollapsed((c) => {
      writeStorage(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="mr-1 shrink-0 text-xs text-muted-foreground">우리 팀 앱 {s.apps.length}</span>
      {!collapsed && (
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1">
          {s.apps.map((a) => (
            <AppChip key={a.id} app={a} s={s} />
          ))}
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        aria-label={collapsed ? '앱 막대 펼치기' : '앱 막대 접기'}
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        {collapsed ? <ChevronDown /> : <ChevronUp />}
      </Button>
    </div>
  );
}

function AppChip({ app, s }: { app: App; s: ShellApps }) {
  const v = chipView(app);
  const control = useCopyControl(app);
  const canStop = v.state === 'running' || v.state === 'starting';
  const canStart = v.state === 'stopped' || v.state === 'error';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={v.dimmed ? '잠듦 · 접속하면 켜져요' : undefined}
        className={cn(
          'flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent',
          v.dimmed && 'border-dashed opacity-50',
          s.preview?.id === app.id && 'bg-accent',
        )}
      >
        <CopyStateDot state={v.state} />
        <span className="font-medium">{app.slug}</span>
        {v.badges.map((b) =>
          b.kind === 'public' ? (
            <PublicBadge key={b.kind} version={app.public?.version} small />
          ) : b.kind === 'pending' ? (
            <span key={b.kind} className="flex h-[18px] items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium">
              <span aria-hidden className="size-[5px] rounded-full bg-warning" />
              {b.label}
            </span>
          ) : (
            <span key={b.kind} className="flex items-center gap-0.5 text-muted-foreground">
              <Moon className="size-3" strokeWidth={1.75} />
              {b.label}
            </span>
          ),
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[216px]">
        <DropdownMenuItem onSelect={() => s.setPreviewId(app.id)}>
          <Eye className="text-muted-foreground" strokeWidth={1.75} />
          작업본 미리보기
        </DropdownMenuItem>
        {app.public && (
          <DropdownMenuItem onSelect={() => window.open(app.public?.url, '_blank', 'noopener')}>
            <ExternalLink className="text-muted-foreground" strokeWidth={1.75} />
            공개본 열기
            <span className="ml-auto text-xs text-muted-foreground">v{app.public.version}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => s.setPublishApp(app)}>
          <Globe className="text-muted-foreground" strokeWidth={1.75} />
          공개 설정
        </DropdownMenuItem>
        {(canStop || canStart) && <DropdownMenuSeparator />}
        {canStop && (
          <DropdownMenuItem onSelect={() => s.setStopApp(app)}>
            <Square className="text-muted-foreground" strokeWidth={1.75} />
            작업본 중지
          </DropdownMenuItem>
        )}
        {canStart && (
          <DropdownMenuItem disabled={control.busy !== null} onSelect={() => void control.run('work', 'start')}>
            <Play className="text-muted-foreground" strokeWidth={1.75} />
            작업본 시작
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Dialogs opened from chips (U-03, C-05 stop confirm). */
export function AppBarDialogs({ s }: { s: ShellApps }) {
  return (
    <>
      {s.publishApp && (
        <Suspense fallback={null}>
          <PublishDialog app={s.publishApp} open onOpenChange={(o) => !o && s.setPublishApp(null)} />
        </Suspense>
      )}
      {s.stopApp && <StopWorkDialog app={s.stopApp} onClose={() => s.setStopApp(null)} />}
    </>
  );
}

export function StopWorkDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const control = useCopyControl(app);
  const tail = app.public ? ` 공개본 v${app.public.version}은 계속 동작해요.` : '';
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${app.slug} 작업본을 멈출까요?`}
      description={`팀원이 이 주소로 들어오면 멈춤 안내가 보여요.${tail}`}
      confirmLabel="작업본 중지"
      pending={control.busy !== null}
      onConfirm={async () => {
        if (await control.run('work', 'stop')) onClose();
      }}
    />
  );
}

/** Right panel with the work copy in an iframe; width is draggable (U-02 2b/2c). */
export function PreviewPanel({ app, s }: { app: App; s: ShellApps }) {
  const [width, setWidth] = useState(() => Number(readStorage(WIDTH_KEY)) || DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const state = copyStateOf(app.work);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !panelRef.current) return;
    const right = panelRef.current.getBoundingClientRect().right;
    const parent = panelRef.current.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
    setWidth(Math.round(Math.min(Math.max(right - e.clientX, MIN_WIDTH), parent - 320)));
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    writeStorage(WIDTH_KEY, String(width));
  };

  return (
    <aside
      ref={panelRef}
      aria-label={`${app.slug} 작업본 미리보기`}
      className="relative flex shrink-0 flex-col border-l bg-background"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="패널 폭 조절"
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-border/60"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {/* Iframes swallow pointer events; cover the whole viewport while dragging. */}
      {dragging && <div className="fixed inset-0 z-20 cursor-col-resize" />}
      <div className="flex items-center gap-2 border-b py-2.5 pr-3 pl-5">
        <span className="truncate text-[15px] font-semibold">{app.slug}</span>
        <PrivateBadge />
        <AppStatusBadge copy={app.work} short />
        <div className="ml-auto flex gap-0.5">
          <IconAction label="공개 설정" onClick={() => s.setPublishApp(app)} className="size-8 [&_svg]:size-4">
            <Globe />
          </IconAction>
          {state === 'running' && (
            <IconAction label="새로고침" onClick={() => setFrameKey((k) => k + 1)} className="size-8 [&_svg]:size-4">
              <RotateCw />
            </IconAction>
          )}
          <IconAction label="새 탭으로 열기" onClick={() => window.open(app.work.url, '_blank', 'noopener')} className="size-8 [&_svg]:size-4">
            <ExternalLink />
          </IconAction>
          <IconAction label="닫기" onClick={() => s.setPreviewId(null)} className="size-8 [&_svg]:size-4">
            <X />
          </IconAction>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b py-2 pr-3 pl-5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{displayUrl(app.work.url)}</span>
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => void copyText(app.work.url)}>
          <Copy className="size-3.5" strokeWidth={1.75} />
          주소 복사
        </Button>
      </div>
      <div className="flex items-center gap-2 border-b px-5 py-2 text-[12.5px] text-muted-foreground">
        <Info className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span>
          작업본이에요. 에이전트가 고치면 바로 바뀌어요.
          {app.public && ` 공개본(v${app.public.version})은 따로 있어요.`}
        </span>
      </div>
      {state === 'running' ? (
        <iframe key={frameKey} src={app.work.url} title={`${app.slug} 작업본`} className="w-full flex-1 border-0" />
      ) : (
        <PreviewWake app={app} />
      )}
    </aside>
  );
}

/** Not running: the same wake flow as C-04, inside the panel. */
function PreviewWake({ app }: { app: App }) {
  const qc = useQueryClient();
  const host = hostnameOf(app.work.url);
  const { info, query, wakeError, retry } = useAppHost(host);
  const control = useCopyControl(app);
  const view = info ? appHostView(info, true) : null;

  // The host says running before the 10 s list poll does: refresh the list so the iframe shows.
  useEffect(() => {
    if (view?.kind === 'ready') void qc.invalidateQueries({ queryKey: appKeys.team(app.team) });
  }, [view?.kind, qc, app.team]);

  const start = async (action: 'start' | 'restart') => {
    if (await control.run('work', action)) retry();
  };

  let body;
  if (query.isError || wakeError) {
    body = (
      <PanelMessage
        title="앱을 깨우지 못했어요"
        description={errorMessage(query.error ?? wakeError)}
        action={<Button variant="outline" size="sm" onClick={retry}>다시 시도</Button>}
      />
    );
  } else if (!view || view.kind === 'waking' || view.kind === 'ready') {
    body = (
      <WakingView
        reason={view?.kind === 'waking' ? view.reason : null}
        footnote="켜지면 바로 화면이 나와요"
      />
    );
  } else if (view.kind === 'error') {
    body = (
      <PanelMessage
        icon
        title="작업본이 오류로 멈췄어요"
        description={app.work.statusDetail?.split('\n')[0] || '다시 시작해 보세요.'}
        action={
          <Button size="sm" disabled={control.busy !== null} onClick={() => void start('restart')}>
            <RotateCw strokeWidth={1.75} />
            재시작
          </Button>
        }
      />
    );
  } else {
    body = (
      <PanelMessage
        title="작업본이 멈춰 있어요"
        description="팀원이 작업본을 멈췄어요. 다시 시작하면 여기에 바로 보여요."
        action={
          <Button size="sm" disabled={control.busy !== null} onClick={() => void start('start')}>
            <Play strokeWidth={1.75} />
            작업본 시작
          </Button>
        }
      />
    );
  }
  return <div className="flex flex-1 items-center justify-center p-6">{body}</div>;
}

function PanelMessage({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: boolean;
}) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-4 text-center">
      {icon && (
        <span className="grid size-14 place-items-center rounded-full bg-muted">
          <TriangleAlert className="size-7 text-danger" strokeWidth={1.75} />
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
