import { AppWindow, Search, X } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton, PageContainer, PageHeader } from '@/components/admin/page';
import { AppTable } from '@/components/apps/app-table';
import { Dot } from '@/components/apps/badges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useTeamApps } from '@/lib/apps/api';
import {
  filterApps,
  isPublicFilter,
  isWorkFilter,
  nearLimit,
  PUBLIC_FILTERS,
  WORK_FILTERS,
  type PublicFilter,
  type WorkFilter,
  withSubject,
} from '@/lib/apps/status';
import { teamRoot } from '@/lib/host';
import { AppsLayout } from './apps-layout';

/** U-07 배포관리 목록 — `/t/{team}/apps`. */
export function AppsPage({ team }: { team: string }) {
  return <AppsLayout team={team}>{(m) => <AppsList team={team} teamLabel={m.displayName} teamUrl={m.url} />}</AppsLayout>;
}

function AppsList({ team, teamLabel, teamUrl }: { team: string; teamLabel: string; teamUrl: string }) {
  const apps = useTeamApps(team);
  const [q, setQ] = useState('');
  const [work, setWork] = useState<WorkFilter | ''>('');
  const [pub, setPub] = useState<PublicFilter | ''>('');
  const items = apps.data?.items ?? [];
  const shown = filterApps(items, { q, work: work || undefined, public: pub || undefined });
  const limits = apps.data?.limits;
  const filtered = q !== '' || work !== '' || pub !== '';

  return (
    <PageContainer>
      <PageHeader title="배포관리" description={`${withSubject(teamLabel)} 에이전트로 띄운 앱이에요.`} />
      {nearLimit(limits) && limits && (
        <div role="status" className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px]">
          <Dot dot="warning" />
          <span className="flex-1">
            실행 중인 앱이 {limits.maxRunningWork}개 중 {limits.runningWork}개예요. 오래 안 쓴 앱은 자동으로 잠들어요
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {limits.runningWork} / {limits.maxRunningWork}
          </span>
        </div>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-[250px]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="앱 이름으로 검색" className="pl-8" aria-label="앱 이름으로 검색" />
          </div>
          <NativeSelect
            aria-label="작업본 상태"
            value={work}
            onChange={(e) => setWork(isWorkFilter(e.target.value) ? e.target.value : '')}
            className="w-[150px]"
          >
            <option value="">작업본 · 전체</option>
            {WORK_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                작업본 · {f.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="공개 상태"
            value={pub}
            onChange={(e) => setPub(isPublicFilter(e.target.value) ? e.target.value : '')}
            className="w-[170px]"
          >
            <option value="">공개 · 전체</option>
            {PUBLIC_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                공개 · {f.label}
              </option>
            ))}
          </NativeSelect>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setWork('');
                setPub('');
              }}
            >
              초기화
              <X />
            </Button>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border">
        {apps.isPending ? (
          <ListSkeleton />
        ) : apps.isError ? (
          <ErrorState title="앱 목록을 불러오지 못했어요" error={apps.error} onRetry={() => void apps.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title="아직 실행한 앱이 없어요"
            description="에이전트에게 '이 폴더를 웹 앱으로 띄워줘'라고 말해 보세요"
            action={
              <Button size="sm" asChild>
                <a href={teamRoot(teamUrl)}>에이전트로 가기</a>
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={Search} title="조건에 맞는 앱이 없어요" description="검색어나 필터를 바꿔 보세요" />
        ) : (
          <AppTable apps={shown} linkToDetail />
        )}
      </div>
    </PageContainer>
  );
}
