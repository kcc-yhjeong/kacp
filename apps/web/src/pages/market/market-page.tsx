import { MCP_CATEGORIES } from '@kacp/shared';
import { Link } from '@tanstack/react-router';
import { Check, Search, Store, Users, X } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/admin/page';
import { useDebounced } from '@/components/admin/user-picker';
import { McpIcon } from '@/components/mcp/badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMcpPackages, type MarketSort } from '@/lib/mcp/api';
import type { McpPackageSummary } from '@/lib/mcp/types';
import { MarketLayout } from './market-layout';

/** U-09 MCP 마켓 목록 — `/market`. */
export function MarketPage({ team }: { team?: string }) {
  return <MarketLayout tab="market" requestedTeam={team}>{(ctx) => <MarketList team={ctx.team?.name} />}</MarketLayout>;
}

function MarketList({ team }: { team?: string }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<MarketSort>('popular');
  const dq = useDebounced(q.trim());
  const list = useMcpPackages({ q: dq, category, sort, team });
  const filtered = dq !== '' || category !== '';
  const items = list.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[250px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·설명 검색" className="pl-8" aria-label="이름·설명 검색" />
        </div>
        <NativeSelect aria-label="분류" value={category} onChange={(e) => setCategory(e.target.value)} className="w-[140px]">
          <option value="">분류 · 전체</option>
          {MCP_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value === 'recent' ? 'recent' : 'popular')} className="w-[120px]">
          <option value="popular">인기순</option>
          <option value="recent">최신순</option>
        </NativeSelect>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setCategory('');
            }}
          >
            초기화
            <X />
          </Button>
        )}
      </div>

      {list.isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex h-[148px] flex-col gap-3 rounded-xl border p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border">
          <ErrorState title="마켓을 불러오지 못했어요" error={list.error} onRetry={() => void list.refetch()} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border">
          {filtered ? (
            <EmptyState icon={Search} title="조건에 맞는 MCP가 없어요" description="검색어나 분류를 바꿔 보세요" />
          ) : (
            <EmptyState
              icon={Store}
              title="아직 게시된 MCP가 없어요"
              description="직접 만든 MCP를 올리면 심사 후 여기에 보여요"
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link to="/market/mine" search={team ? { team } : {}}>
                    내 배포로
                  </Link>
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <li key={p.name}>
              <PackageCard pkg={p} team={team} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PackageCard({ pkg, team }: { pkg: McpPackageSummary; team?: string }) {
  return (
    <Link
      to="/market/$pkg"
      params={{ pkg: pkg.name }}
      search={team ? { team } : {}}
      className="flex h-full flex-col gap-3 rounded-xl border p-5 outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex items-start gap-3">
        <McpIcon icon={pkg.icon} name={pkg.displayName || pkg.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{pkg.displayName || pkg.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {pkg.name}
            {pkg.latestVersion ? ` · v${pkg.latestVersion}` : ''}
          </span>
        </div>
      </div>
      <p className="line-clamp-2 flex-1 text-[13px] text-pretty text-muted-foreground">{pkg.summary}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate">{pkg.isPlatform ? '플랫폼' : (pkg.owner?.name ?? '—')}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Users className="size-3" strokeWidth={1.75} />
          {pkg.installCount.toLocaleString()}팀
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Badge variant="outline" className="h-[18px] px-1.5 text-[11px] text-muted-foreground">
            {pkg.category}
          </Badge>
          {(pkg.isDefault || pkg.isPlatform) && (
            <Badge variant="secondary" className="h-[18px] px-1.5 text-[11px]">
              기본 제공
            </Badge>
          )}
          {pkg.installedInTeam && (
            <Badge variant="default" className="h-[18px] gap-1 px-1.5 text-[11px] [&>svg]:size-[11px]">
              <Check strokeWidth={2.5} />
              설치됨
            </Badge>
          )}
        </span>
      </div>
    </Link>
  );
}
