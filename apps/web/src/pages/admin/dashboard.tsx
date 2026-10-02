import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AppWindow, ChevronRight, HardDrive, TriangleAlert, User, Users, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AdminTeamStatusBadge } from '@/components/admin/badges';
import { EmptyState, ErrorState, ListSkeleton, PageContainer, PageHeader, SectionCard } from '@/components/admin/page';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentList, SegmentTrigger, Tabs } from '@/components/ui/tabs';
import { adminApi, adminKeys, useAdminSettings } from '@/lib/admin/api';
import { formatBytes, formatPct } from '@/lib/admin/format';
import type { CapacityResource, Dashboard } from '@/lib/admin/types';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Range = '24h' | '7d';
type Level = 'warn' | 'danger' | null;

const RESOURCE_LABEL: Record<CapacityResource, string> = { cpu: 'CPU', memory: '메모리', disk: '디스크' };

/** A-01 dashboard. */
export function DashboardPage() {
  const [range, setRange] = useState<Range>('24h');
  const dashboard = useQuery({ queryKey: adminKeys.dashboard, queryFn: adminApi.dashboard, refetchInterval: 30_000 });
  const d = dashboard.data;

  return (
    <div className="flex flex-col">
      {d?.warnings.map((w) => (
        <div key={`${w.resource}-${w.level}`} className="flex h-10 items-center gap-2.5 border-b px-6 text-[13.5px]" role="alert">
          <TriangleAlert className={cn('size-4', w.level === 'danger' ? 'text-danger' : 'text-warning')} strokeWidth={1.75} />
          <span className="font-medium">{w.level === 'danger' ? '위험' : '주의'}</span>
          <span>{w.message}</span>
          <a href="#vm-resources" className="ml-auto text-[13px] underline underline-offset-2">
            리소스 보기
          </a>
        </div>
      ))}
      <PageContainer>
        <PageHeader
          title="대시보드"
          description="플랫폼 전체 상태예요."
          actions={
            <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
              <SegmentList>
                <SegmentTrigger value="24h">24시간</SegmentTrigger>
                <SegmentTrigger value="7d">7일</SegmentTrigger>
              </SegmentList>
            </Tabs>
          }
        />
        {dashboard.isError ? (
          <div className="rounded-xl border">
            <ErrorState title="대시보드를 불러오지 못했어요" error={dashboard.error} onRetry={() => void dashboard.refetch()} />
          </div>
        ) : (
          <>
            <StatRow d={d} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <VmCard d={d} />
              <TrendCard range={range} />
            </div>
            <TeamContainers d={d} loading={dashboard.isPending} />
          </>
        )}
      </PageContainer>
    </div>
  );
}

function StatRow({ d }: { d: Dashboard | undefined }) {
  return (
    <div className="grid grid-cols-2 rounded-xl border lg:grid-cols-4 [&>*]:border-b lg:[&>*]:border-b-0 [&>*:not(:last-child)]:lg:border-r">
      <Stat label="활성 팀" icon={Users}>
        {d ? (
          <>
            {d.teams.running} <span className="text-sm font-normal text-muted-foreground">/ {d.teams.total}팀</span>
          </>
        ) : null}
      </Stat>
      <Stat label="접속 중 사용자" icon={User}>
        {d?.activeUsers}
      </Stat>
      <Stat label="실행 중 앱" icon={AppWindow}>
        {d ? (
          <>
            작업본 {d.runningApps.work} <span className="font-normal text-chart-4">·</span> 공개본 {d.runningApps.public}
          </>
        ) : null}
      </Stat>
      <div className="flex flex-col gap-2.5 p-5">
        <span className="text-sm text-muted-foreground">처리 대기</span>
        <div className="flex gap-5">
          <PendingNum n={d?.pending.deployRequests} label="공개 승인" />
          <PendingNum n={d?.pending.mcpReviews} label="MCP 심사" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, icon: Icon, children }: { label: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 p-5">
      <div className="flex items-start justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="grid size-8 place-items-center rounded-md border">
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      </div>
      <span className="text-2xl font-semibold tabular-nums">{children ?? <Skeleton className="h-7 w-16" />}</span>
    </div>
  );
}

function PendingNum({ n, label }: { n: number | undefined; label: string }) {
  // A-07/A-09 come in later stages; the numbers stay but are not links yet.
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold tabular-nums">{n ?? <Skeleton className="h-7 w-8" />}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function levelOf(d: Dashboard | undefined, r: CapacityResource): Level {
  const ws = d?.warnings.filter((w) => w.resource === r) ?? [];
  if (ws.some((w) => w.level === 'danger')) return 'danger';
  if (ws.length > 0) return 'warn';
  return null;
}

const LEVEL_COLOR: Record<'warn' | 'danger' | 'none', string> = {
  none: 'var(--chart-1)',
  warn: 'var(--warning)',
  danger: 'var(--danger)',
};

function VmCard({ d }: { d: Dashboard | undefined }) {
  const items: { r: CapacityResource; pct: number | undefined }[] = [
    { r: 'cpu', pct: d?.vm.cpuPct },
    { r: 'memory', pct: d?.vm.memPct },
    { r: 'disk', pct: d?.vm.diskPct },
  ];
  return (
    <SectionCard id="vm-resources" icon={HardDrive} title="VM 리소스">
      <div className="grid grid-cols-3 justify-items-center px-3 py-4">
        {items.map(({ r, pct }) => (
          <Gauge key={r} label={RESOURCE_LABEL[r]} pct={pct} color={LEVEL_COLOR[levelOf(d, r) ?? 'none']} />
        ))}
      </div>
      <div className="flex flex-col gap-2.5 px-5 pb-4 text-[13.5px]">
        {items.map(({ r, pct }) => (
          <div key={r} className="flex items-center gap-2.5">
            <span className="h-3.5 w-[3px] rounded-sm" style={{ background: LEVEL_COLOR[levelOf(d, r) ?? 'none'] }} />
            <span className="flex-1">{RESOURCE_LABEL[r]}</span>
            <span className="font-medium tabular-nums">{formatPct(pct)}</span>
          </div>
        ))}
        <span className="mt-1 text-[11.5px] text-muted-foreground">자동 확장은 GKE 전환 단계 로드맵이에요</span>
      </div>
    </SectionCard>
  );
}

/** Tick ring gauge: filled ticks chart-1 (or warning/danger), rest chart-4. */
function Gauge({ label, pct, color }: { label: string; pct: number | undefined; color: string }) {
  const ticks = 40;
  const filled = Math.round((ticks * Math.min(100, Math.max(0, pct ?? 0))) / 100);
  const c = 50;
  return (
    <svg width="100" height="100" viewBox="0 0 100 100" role="img" aria-label={`${label} ${formatPct(pct)}`}>
      {Array.from({ length: ticks }, (_, i) => {
        const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
        return (
          <line
            key={i}
            x1={c + Math.cos(a) * 37}
            y1={c + Math.sin(a) * 37}
            x2={c + Math.cos(a) * 46}
            y2={c + Math.sin(a) * 46}
            stroke={i < filled ? color : 'var(--chart-4)'}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
      <text x={c} y={c - 4} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
        {label}
      </text>
      <text x={c} y={c + 13} textAnchor="middle" fontSize="17" fontWeight="600" fill="var(--foreground)">
        {formatPct(pct)}
      </text>
    </svg>
  );
}

const GB = 1024 ** 3;

function TrendCard({ range }: { range: Range }) {
  const metrics = useQuery({ queryKey: adminKeys.metrics(range), queryFn: () => adminApi.metrics(range), refetchInterval: 60_000 });
  const settings = useAdminSettings();
  const warnCpu = settings.data?.ops.capacityWarn.warn.cpu;
  const data = (metrics.data?.points ?? []).map((p) => ({
    t: new Date(p.ts).getTime(),
    cpu: Math.round(p.cpuPct * 10) / 10,
    memGb: Math.round((p.memBytes / GB) * 10) / 10,
  }));
  const tick = (t: number) => {
    const d = new Date(t);
    return range === '24h' ? `${String(d.getHours()).padStart(2, '0')}시` : `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <SectionCard
      title={range === '24h' ? '24시간 추이' : '7일 추이'}
      actions={
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {warnCpu !== undefined && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 border-t-[1.5px] border-dashed border-warning" />
              주의 {warnCpu}%
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-chart-1" />
            CPU %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 border-t-[1.5px] border-dashed border-chart-2" />
            메모리 GB
          </span>
        </div>
      }
      bodyClassName="px-3 pt-4 pb-2"
    >
      {metrics.isPending ? (
        <Skeleton className="mx-2 h-[200px]" />
      ) : metrics.isError ? (
        <ErrorState title="추이를 불러오지 못했어요" error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : data.length === 0 ? (
        <div className="grid h-[200px] place-items-center text-sm text-muted-foreground">아직 수집한 사용량이 없어요</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-5)" strokeDasharray="3 4" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tick}
              tick={{ fontSize: 11.5, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 11.5, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="gb" orientation="right" tick={{ fontSize: 11.5, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            {warnCpu !== undefined && (
              <ReferenceLine yAxisId="pct" y={warnCpu} stroke="var(--warning)" strokeDasharray="6 4" />
            )}
            <Tooltip
              cursor={{ stroke: 'var(--chart-3)', strokeDasharray: '3 3' }}
              labelFormatter={(t) => formatTime(new Date(Number(t)).toISOString())}
              formatter={(v, name) => (name === 'cpu' ? [`${v}%`, 'CPU'] : [`${v}GB`, '메모리'])}
              contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
            />
            <Line yAxisId="pct" type="monotone" dataKey="cpu" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              yAxisId="gb"
              type="monotone"
              dataKey="memGb"
              stroke="var(--chart-2)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}

function TeamContainers({ d, loading }: { d: Dashboard | undefined; loading: boolean }) {
  const rows = d?.teamContainers ?? [];
  const cols = 'grid grid-cols-[minmax(0,1fr)_110px_70px_160px_180px_100px_24px] items-center gap-x-3 px-5';
  return (
    <SectionCard icon={Users} title="팀 컨테이너">
      {loading ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="아직 팀이 없어요" description="첫 팀을 만들면 팀 주소와 에이전트가 준비돼요" />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className={cn(cols, 'h-10 border-b text-[12.5px] text-muted-foreground')}>
              <span>팀</span>
              <span>상태</span>
              <span>접속자</span>
              <span>CPU</span>
              <span>메모리</span>
              <span>마지막 활동</span>
              <span />
            </div>
            {rows.map((t) => (
              <Link
                key={t.team}
                to="/admin/teams/$team"
                params={{ team: t.team }}
                className={cn(cols, 'h-12 border-b text-[13.5px] last:border-b-0 hover:bg-muted/50')}
              >
                <span className="truncate font-mono text-[13px] font-medium">{t.team}</span>
                <span>
                  <AdminTeamStatusBadge status={t.status} />
                </span>
                <span className="tabular-nums">{t.activeUsers}</span>
                <Bar pct={t.cpuPct} text={formatPct(t.cpuPct)} />
                <Bar
                  pct={t.memLimitBytes > 0 ? (t.memBytes / t.memLimitBytes) * 100 : 0}
                  text={`${formatBytes(t.memBytes)} / ${formatBytes(t.memLimitBytes)}`}
                />
                <span className="text-xs text-muted-foreground tabular-nums">{t.lastActiveAt ? formatTime(t.lastActiveAt) : '—'}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function Bar({ pct, text }: { pct: number; text: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <span className="flex items-center gap-2">
      <span className="h-1 flex-1 overflow-hidden rounded-sm bg-muted">
        <span className="block h-full bg-primary" style={{ width: `${w}%` }} />
      </span>
      <span className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">{text}</span>
    </span>
  );
}
