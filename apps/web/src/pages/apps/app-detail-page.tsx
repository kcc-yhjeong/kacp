import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Download, FolderOpen, Globe, Lock, Play, RotateCw, Square } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageContainer } from '@/components/admin/page';
import { AppStatusBadge, DotBadge, PendingBadge, PrivateBadge, PublicBadge } from '@/components/apps/badges';
import { Requester, UrlLine } from '@/components/apps/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ActorBadge } from '@/components/drive/actor-badge';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SegmentList, SegmentTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytes, formatPct } from '@/lib/admin/format';
import { ApiError, errorMessage } from '@/lib/api';
import { appApi, appKeys, invalidateApp, useAppDetail, type CopyAction } from '@/lib/apps/api';
import { copyStateOf, deployKindLabel, nextVersion, pendingLabel, type Dot } from '@/lib/apps/status';
import type { AppCopy, AppCopyKind, AppDetail, DeployRequest } from '@/lib/apps/types';
import { useCopyControl } from '@/lib/apps/use-copy-control';
import { SPACE_LABEL } from '@/lib/drive/path';
import { formatTime } from '@/lib/format';
import { driveUrl } from '@/lib/host';
import { cn } from '@/lib/utils';
import { AppsLayout } from './apps-layout';

const PublishDialog = lazy(() => import('@/components/apps/publish-dialog').then((m) => ({ default: m.PublishDialog })));

/** U-08 앱 상세 — `/t/{team}/apps/{appId}`. */
export function AppDetailPage({ team, appId }: { team: string; appId: string }) {
  return <AppsLayout team={team}>{() => <Detail team={team} appId={appId} />}</AppsLayout>;
}

function Detail({ team, appId }: { team: string; appId: string }) {
  const detail = useAppDetail(appId);
  const [publishOpen, setPublishOpen] = useState(false);

  if (detail.isPending) return <PageLoader />;
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <PageContainer>
          <EmptyState
            icon={Square}
            title="앱을 찾을 수 없어요"
            description="삭제됐거나 주소가 바뀌었을 수 있어요."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link to="/t/$team/apps" params={{ team }}>
                  배포관리로
                </Link>
              </Button>
            }
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState title="앱을 불러오지 못했어요" error={detail.error} onRetry={() => void detail.refetch()} />
      </PageContainer>
    );
  }
  const app = detail.data;

  return (
    <PageContainer>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
          <Link to="/t/$team/apps" params={{ team }} className="hover:text-foreground">
            배포관리
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">{app.slug}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-mono text-2xl font-bold tracking-tight">{app.slug}</h1>
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <ActorBadge actor={app.creator} />이 만듦
            </span>
          </div>
          <Button variant="outline" onClick={() => setPublishOpen(true)}>
            <Globe strokeWidth={1.75} />
            공개 설정
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <WorkCard app={app} />
        <PublicCard app={app} onPublish={() => setPublishOpen(true)} />
      </div>
      <DetailTabs app={app} />
      {publishOpen && (
        <Suspense fallback={null}>
          <PublishDialog app={app} open onOpenChange={setPublishOpen} />
        </Suspense>
      )}
    </PageContainer>
  );
}

// ── AppCopyCard

function CopyControls({
  app,
  target,
  copy,
  disabled,
}: {
  app: AppDetail;
  target: AppCopyKind;
  copy: AppCopy;
  disabled?: boolean;
}) {
  const control = useCopyControl(app);
  const [confirmStop, setConfirmStop] = useState(false);
  const state = copyStateOf(copy);
  const on = state === 'running' || state === 'starting';
  const busy = control.busy !== null;
  const run = (a: CopyAction) => void control.run(target, a);
  const stopText =
    target === 'work'
      ? `팀원이 이 주소로 들어오면 멈춤 안내가 보여요.${app.public ? ` 공개본 v${app.public.version}은 계속 동작해요.` : ''}`
      : '사원이 이 주소로 들어오면 멈춤 안내가 보여요. 작업본은 계속 동작해요.';

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled || busy || on} onClick={() => run('start')}>
        <Play strokeWidth={1.75} />
        시작
      </Button>
      <Button variant="outline" size="sm" disabled={disabled || busy || !on} onClick={() => setConfirmStop(true)}>
        <Square strokeWidth={1.75} />
        중지
      </Button>
      <Button variant="outline" size="sm" disabled={disabled || busy || state === 'starting'} onClick={() => run('restart')}>
        <RotateCw strokeWidth={1.75} />
        재시작
      </Button>
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`${app.slug} ${target === 'work' ? '작업본' : '공개본'}을 멈출까요?`}
        description={stopText}
        confirmLabel={target === 'work' ? '작업본 중지' : '공개본 중지'}
        pending={busy}
        onConfirm={async () => {
          if (await control.run(target, 'stop')) setConfirmStop(false);
        }}
      />
    </div>
  );
}

function CardShell({ title, badges, children }: { title: string; badges: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badges}
      </div>
      {children}
    </section>
  );
}

function WorkCard({ app }: { app: AppDetail }) {
  const src = `${app.source.space}${app.source.path}`;
  return (
    <CardShell
      title="작업본"
      badges={
        <>
          <PrivateBadge />
          <AppStatusBadge copy={app.work} />
        </>
      }
    >
      <UrlLine url={app.work.url} />
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">원본 폴더</dt>
        <dd className="min-w-0">
          <a href={driveUrl(app.team, src)} className="flex items-center gap-1.5 hover:underline">
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="truncate">{sourceLabel(app)}</span>
          </a>
        </dd>
        <dt className="text-muted-foreground">마지막 접속</dt>
        <dd>
          {app.work.lastAccessedAt ? formatTime(app.work.lastAccessedAt) : '—'}
          <span className="text-muted-foreground"> · 에이전트가 고치면 바로 반영돼요</span>
        </dd>
        {app.work.status === 'error' && app.work.statusDetail && (
          <>
            <dt className="text-muted-foreground">오류</dt>
            <dd className="text-pretty">{app.work.statusDetail.split('\n')[0]}</dd>
          </>
        )}
      </dl>
      <CopyControls app={app} target="work" copy={app.work} />
    </CardShell>
  );
}

function PublicCard({ app, onPublish }: { app: AppDetail; onPublish: () => void }) {
  const pub = app.public;
  const pending = pendingLabel(app);
  if (!pub) {
    return (
      <CardShell title="공개본" badges={pending ? <PendingBadge label={pending} /> : null}>
        <p className="text-[13px] text-pretty text-muted-foreground">
          {pending
            ? '공개 요청을 플랫폼 관리자가 검토하고 있어요. 승인되면 그 시점의 작업본이 공개본 v1이 돼요.'
            : '아직 공개되지 않았어요. 공개하면 로그인한 모든 사원이 볼 수 있어요.'}
        </p>
        <div>
          <Button size="sm" variant={pending ? 'outline' : 'default'} onClick={onPublish}>
            {pending ? '요청 보기' : '공개 요청'}
          </Button>
        </div>
      </CardShell>
    );
  }
  const adminStopped = copyStateOf(pub) === 'admin';
  return (
    <CardShell
      title="공개본"
      badges={
        <>
          <PublicBadge version={pub.version} />
          <AppStatusBadge copy={pub} />
          {pending && <PendingBadge label={pending} />}
        </>
      }
    >
      <UrlLine url={pub.url} />
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">공개</dt>
        <dd>
          {formatTime(pub.publishedAt)} 승인 · {pub.approvedBy?.name ?? '플랫폼 관리자'}
        </dd>
        <dt className="text-muted-foreground">마지막 접속</dt>
        <dd>{pub.lastAccessedAt ? formatTime(pub.lastAccessedAt) : '—'}</dd>
      </dl>
      {adminStopped && (
        <div className="flex flex-col gap-1.5 rounded-lg border px-3.5 py-3 text-[13px]">
          <span className="flex gap-2">
            <span className="w-10 shrink-0 text-muted-foreground">사유</span>
            <span className="text-pretty">{pub.statusDetail ?? '—'}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            플랫폼 관리자가 중지했어요. 작업본은 그대로 있어요. 고친 뒤 업데이트를 요청하세요.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <CopyControls app={app} target="public" copy={pub} disabled={adminStopped} />
        <span className="text-xs text-muted-foreground">팀원 누구나</span>
      </div>
    </CardShell>
  );
}

function sourceLabel(app: AppDetail): string {
  const path = app.source.path.split('/').filter(Boolean).join('/');
  return path ? `${SPACE_LABEL[app.source.space]}/${path}` : SPACE_LABEL[app.source.space];
}

// ── Tabs

function DetailTabs({ app }: { app: AppDetail }) {
  const [tab, setTab] = useState('overview');
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="overview">개요</TabsTrigger>
        <TabsTrigger value="resources">리소스</TabsTrigger>
        <TabsTrigger value="logs">로그</TabsTrigger>
        <TabsTrigger value="data">데이터</TabsTrigger>
        <TabsTrigger value="history">공개 이력</TabsTrigger>
        {app.canManage && <TabsTrigger value="danger">위험 영역</TabsTrigger>}
      </TabsList>
      <TabsContent value="overview">
        <OverviewTab app={app} />
      </TabsContent>
      <TabsContent value="resources">
        <ResourcesTab app={app} />
      </TabsContent>
      <TabsContent value="logs">
        <LogsTab app={app} />
      </TabsContent>
      <TabsContent value="data">
        <DataTab app={app} />
      </TabsContent>
      <TabsContent value="history">
        <HistoryTab app={app} />
      </TabsContent>
      {app.canManage && (
        <TabsContent value="danger">
          <DangerTab app={app} />
        </TabsContent>
      )}
    </Tabs>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 text-[13.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function OverviewTab({ app }: { app: AppDetail }) {
  const pending = pendingLabel(app);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border p-5">
        <Rows
          rows={[
            ['만든 이', <ActorBadge key="c" actor={app.creator} />],
            ['런타임', <span key="r" className="font-mono text-[13px]">{app.runSpec.runtime}</span>],
            ['원본 폴더', sourceLabel(app)],
            ['실행 명령', <code key="cmd" className="font-mono text-[13px]">{app.runSpec.command || '—'}</code>],
            ['포트', <span key="p" className="tabular-nums">{app.runSpec.port}</span>],
            ['만든 시각', app.createdAt ? formatTime(app.createdAt) : '—'],
          ]}
        />
      </section>
      <section className="rounded-xl border p-5">
        <Rows
          rows={[
            ['공개본', app.public ? <PublicBadge key="v" version={app.public.version} /> : '—'],
            ['승인자', app.public?.approvedBy?.name ?? (app.public ? '플랫폼 관리자' : '—')],
            ['승인 시각', app.public ? formatTime(app.public.publishedAt) : '—'],
            ['대기 중', pending ? <PendingBadge key="w" label={pending} /> : '—'],
          ]}
        />
      </section>
    </div>
  );
}

function CopySegment({
  app,
  value,
  onChange,
}: {
  app: AppDetail;
  value: AppCopyKind;
  onChange: (v: AppCopyKind) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v === 'public' ? 'public' : 'work')}>
      <SegmentList>
        <SegmentTrigger value="work">작업본</SegmentTrigger>
        <SegmentTrigger value="public" disabled={!app.public}>
          {app.public ? `공개본 v${app.public.version}` : '공개본 —'}
        </SegmentTrigger>
      </SegmentList>
    </Tabs>
  );
}

function ResourcesTab({ app }: { app: AppDetail }) {
  const [target, setTarget] = useState<AppCopyKind>('work');
  const copy = target === 'public' && app.public ? app.public : app.work;
  const stats = useQuery({
    queryKey: appKeys.stats(app.id, target),
    queryFn: () => appApi.stats(app.id, target),
    refetchInterval: 60_000,
  });
  const usage = copy.usage;
  const memLimit = usage?.memLimitBytes ?? (app.resourceLimits ? app.resourceLimits.memoryMb * 1024 * 1024 : null);
  const memPctValue = usage && memLimit ? (usage.memBytes / memLimit) * 100 : null;
  const data = (stats.data?.points ?? []).map((p) => ({
    t: new Date(p.ts).getTime(),
    cpu: Math.round(p.cpuPct * 10) / 10,
    memMb: Math.round(p.memBytes / 1024 / 1024),
  }));

  return (
    <div className="flex flex-col gap-4">
      <CopySegment app={app} value={target} onChange={setTarget} />
      <div className="grid divide-x rounded-xl border sm:grid-cols-2">
        <div className="flex flex-col gap-1 p-5">
          <span className="text-sm text-muted-foreground">CPU</span>
          <span className="text-2xl font-semibold tabular-nums">{usage?.cpuPct !== undefined ? formatPct(usage.cpuPct) : '—'}</span>
          <span className="text-xs text-muted-foreground">{app.resourceLimits ? `한도 ${app.resourceLimits.cpu}코어` : '한도 —'}</span>
        </div>
        <div className="flex flex-col gap-1 p-5">
          <span className="text-sm text-muted-foreground">메모리</span>
          <span className="text-2xl font-semibold tabular-nums">
            {usage ? formatBytes(usage.memBytes) : '—'}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/ {formatBytes(memLimit)}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {memPctValue === null ? (usage ? '' : '꺼져 있어요') : `한도의 ${Math.round(memPctValue)}%`}
          </span>
        </div>
      </div>
      <section className="rounded-xl border">
        <div className="flex items-center gap-4 border-b px-5 py-3 text-sm">
          <span className="flex-1 font-medium">최근 1시간 · {target === 'work' ? '작업본' : '공개본'}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-0.5 w-3 bg-chart-1" />
            CPU %
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-3 border-t-[1.5px] border-dashed border-chart-2" />
            메모리 MB
          </span>
        </div>
        <div className="px-3 pt-4 pb-2">
          {stats.isPending ? (
            <Skeleton className="mx-2 h-[220px]" />
          ) : stats.isError ? (
            <ErrorState title="추이를 불러오지 못했어요" error={stats.error} onRetry={() => void stats.refetch()} />
          ) : data.length === 0 ? (
            <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">아직 수집한 사용량이 없어요</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-5)" strokeDasharray="3 4" />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(t: number) => new Date(t).toTimeString().slice(0, 5)}
                  tick={{ fontSize: 11.5, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 11.5, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="mb" orientation="right" tick={{ fontSize: 11.5, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ stroke: 'var(--chart-3)', strokeDasharray: '3 3' }}
                  labelFormatter={(t) => new Date(Number(t)).toTimeString().slice(0, 5)}
                  formatter={(v, name) => (name === 'cpu' ? [`${v}%`, 'CPU'] : [`${v}MB`, '메모리'])}
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                />
                <Line yAxisId="pct" type="monotone" dataKey="cpu" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line
                  yAxisId="mb"
                  type="monotone"
                  dataKey="memMb"
                  stroke="var(--chart-2)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
}

function LogsTab({ app }: { app: AppDetail }) {
  const [target, setTarget] = useState<AppCopyKind>('work');
  const [auto, setAuto] = useState(true);
  const logs = useQuery({
    queryKey: appKeys.logs(app.id, target),
    queryFn: () => appApi.logs(app.id, target, 500),
    // Only while this tab is mounted and the browser tab is visible (react-query pauses in the background).
    refetchInterval: auto ? 5_000 : false,
  });
  const boxRef = useRef<HTMLPreElement>(null);
  const lines = logs.data?.lines;

  useEffect(() => {
    const el = boxRef.current;
    if (el && auto) el.scrollTop = el.scrollHeight;
  }, [lines, auto]);

  const download = () => {
    const blob = new Blob([(lines ?? []).join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${app.slug}-${target}-log.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <CopySegment app={app} value={target} onChange={setTarget} />
        <label className="ml-auto flex items-center gap-2 text-[13px]">
          <Switch checked={auto} onCheckedChange={setAuto} />
          자동 새로고침
        </label>
        <Button variant="outline" size="sm" onClick={download} disabled={!lines || lines.length === 0}>
          <Download strokeWidth={1.75} />
          다운로드
        </Button>
      </div>
      {logs.isError ? (
        <div className="rounded-xl border">
          <ErrorState title="로그를 불러오지 못했어요" error={logs.error} onRetry={() => void logs.refetch()} />
        </div>
      ) : (
        <pre
          ref={boxRef}
          aria-label="로그"
          className="h-[420px] overflow-auto rounded-xl bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap"
        >
          {logs.isPending ? '불러오는 중…' : lines && lines.length > 0 ? lines.join('\n') : '아직 로그가 없어요'}
        </pre>
      )}
    </div>
  );
}

function DataTab({ app }: { app: AppDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl border px-5 py-4 text-[13.5px] text-pretty">
        작업본과 공개본은 데이터를 따로 저장해요. 팀이 작업본에서 입력한 내용은 공개본에 보이지 않고, 공개본을 업데이트해도 공개본
        데이터는 그대로 남아요.
      </p>
      <div className="grid divide-x rounded-xl border sm:grid-cols-2">
        <div className="flex flex-col gap-1 p-5">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-3.5" strokeWidth={1.75} />
            작업본 데이터
          </span>
          <span className="text-2xl font-semibold tabular-nums">{formatBytes(app.dataUsage.workBytes)}</span>
          <span className="text-xs text-muted-foreground">작업본 데이터 폴더 크기</span>
        </div>
        <div className="flex flex-col gap-1 p-5">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Globe className="size-3.5" strokeWidth={1.75} />
            공개본 데이터{app.public && ` · v${app.public.version}`}
          </span>
          <span className="text-2xl font-semibold tabular-nums">
            {app.dataUsage.publicBytes === null ? '—' : formatBytes(app.dataUsage.publicBytes)}
          </span>
          <span className="text-xs text-muted-foreground">
            {app.dataUsage.publicBytes === null ? '아직 공개되지 않았어요' : '공개본 데이터 폴더 크기'}
          </span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground">v1에서는 데이터를 열어 볼 수 없어요. 폴더 크기만 보여요.</span>
    </div>
  );
}

const REQ_RESULT: Record<DeployRequest['status'], { label: string; dot: Dot }> = {
  pending: { label: '검토 중', dot: 'warning' },
  approved: { label: '공개됨', dot: 'success' },
  rejected: { label: '반려됨', dot: 'danger' },
  cancelled: { label: '취소됨', dot: 'muted' },
};

function historyTitle(r: DeployRequest): string {
  if (r.status === 'approved') {
    const v = r.approvedVersion ?? nextVersion(r);
    return r.kind === 'publish' ? `v${v} 첫 공개` : `v${v} 공개`;
  }
  const kind = r.kind === 'publish' ? '공개 요청' : `${deployKindLabel(r).replace('업데이트', '업데이트 요청')}`;
  return r.status === 'rejected' ? `${kind} 반려` : r.status === 'cancelled' ? `${kind} 취소` : kind;
}

function HistoryTab({ app }: { app: AppDetail }) {
  const items = [...app.history].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  if (items.length === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState icon={Globe} title="아직 공개 이력이 없어요" description="공개를 요청하면 여기에 기록돼요" />
      </div>
    );
  }
  return (
    <ol className="flex flex-col rounded-xl border">
      {items.map((r) => {
        const res = REQ_RESULT[r.status];
        const live = r.status === 'approved' && app.public && r.approvedVersion === app.public.version;
        return (
          <li key={r.id} className="flex gap-4 border-b px-5 py-4 last:border-b-0">
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
                live ? 'bg-primary text-primary-foreground' : 'border',
              )}
            >
              {r.status === 'approved' ? `v${r.approvedVersion ?? '?'}` : '—'}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{historyTitle(r)}</span>
                <DotBadge dot={live ? 'success' : res.dot} label={live ? '공개 중' : res.label} />
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatTime(r.decidedAt ?? r.requestedAt)}</span>
              </div>
              <p className="text-[13px] text-pretty whitespace-pre-wrap">
                {r.status === 'rejected' && r.decisionNote ? `반려 사유: ${r.decisionNote}` : r.reason}
              </p>
              <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                요청 <Requester user={r.requestedBy} className="text-foreground" />
                {r.decidedBy && (
                  <>
                    · {r.status === 'rejected' ? '반려' : '승인'} {r.decidedBy.name}
                  </>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DangerTab({ app }: { app: AppDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const onDelete = async () => {
    setPending(true);
    try {
      await appApi.remove(app.id, app.public ? app.slug : undefined);
      toast.success(`${app.slug} 앱을 삭제하고 있어요. 원본 폴더는 드라이브에 남아요`);
      setOpen(false);
      void invalidateApp(qc, app);
      void navigate({ to: '/t/$team/apps', params: { team: app.team } });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex items-center gap-4 rounded-xl border px-5 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">
          앱 삭제 <span className="text-xs font-normal text-muted-foreground">· 팀 관리자만</span>
        </span>
        <span className="text-[13px] text-pretty text-muted-foreground">
          작업본·공개본, 두 주소, 두 데이터를 모두 지워요. 원본 폴더는 남아요.
        </span>
      </div>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        앱 삭제
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${app.slug} 앱을 삭제할까요?`}
        description={`작업본·공개본, 두 주소, 두 데이터를 모두 지워요. 되돌릴 수 없어요. 원본 폴더는 드라이브에 남아요.${
          app.public ? ' 공개 중인 앱이에요.' : ''
        }`}
        confirmLabel="앱 삭제"
        destructive
        pending={pending}
        typeToConfirm={app.public ? app.slug : undefined}
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}
