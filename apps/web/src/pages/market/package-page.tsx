import { Link } from '@tanstack/react-router';
import { BookOpen, Check, ChevronRight, History, MessageSquareQuote, Package, ShieldCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { ErrorState, PageContainer, SectionCard } from '@/components/admin/page';
import { Dot } from '@/components/apps/badges';
import { McpIcon, VersionStatusBadge } from '@/components/mcp/badges';
import { InstallDialog } from '@/components/mcp/install-dialog';
import { MarkdownView } from '@/components/mcp/markdown-view';
import { PermissionList, ToolList } from '@/components/mcp/parts';
import { PageLoader } from '@/components/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useMcpPackage } from '@/lib/mcp/api';
import type { McpPackageDetail } from '@/lib/mcp/types';
import { MarketLayout, type MarketContext } from './market-layout';

/** U-10 MCP 상세 + 설치 — `/market/{pkg}`. */
export function PackagePage({ pkg, team }: { pkg: string; team?: string }) {
  return <MarketLayout tab={null} requestedTeam={team}>{(ctx) => <PackageDetailView pkgName={pkg} ctx={ctx} />}</MarketLayout>;
}

function PackageDetailView({ pkgName, ctx }: { pkgName: string; ctx: MarketContext }) {
  const detail = useMcpPackage(pkgName, ctx.team?.name);
  const search = ctx.team ? { team: ctx.team.name } : {};

  if (detail.isPending) return <PageLoader />;
  if (detail.isError) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <PageContainer>
        <ErrorState
          title={notFound ? '찾을 수 없는 MCP예요' : 'MCP를 불러오지 못했어요'}
          error={notFound ? undefined : detail.error}
          onRetry={notFound ? undefined : () => void detail.refetch()}
        />
      </PageContainer>
    );
  }
  const p = detail.data;

  return (
    <PageContainer>
      <nav className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <Link to="/market" search={search} className="hover:text-foreground">
          MCP 마켓
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-mono text-foreground">{p.name}</span>
      </nav>
      <Head pkg={p} ctx={ctx} />
      {p.isPlatform ? (
        <SectionCard icon={BookOpen} title="소개" bodyClassName="p-5 text-[13.5px]">
          <p>{p.summary}</p>
          <p className="mt-2 text-muted-foreground">앱 실행·배포와 드라이브 도구를 제공해요. 모든 팀에 기본 설치돼 있어 따로 설치하지 않아요.</p>
        </SectionCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <SectionCard icon={BookOpen} title="README" bodyClassName="p-5">
              {p.readme.trim() ? <MarkdownView source={p.readme} /> : <span className="text-[13px] text-muted-foreground">README가 없어요</span>}
            </SectionCard>
            <SectionCard
              icon={Wrench}
              title="도구 목록"
              actions={<span className="text-xs text-muted-foreground">테스트에서 확인 · {p.tools.length}개</span>}
              bodyClassName="p-5"
            >
              <ToolList tools={p.tools} />
            </SectionCard>
            {(p.manifest?.examples.length ?? 0) > 0 && (
              <SectionCard icon={MessageSquareQuote} title="이렇게 말해 보세요" bodyClassName="flex flex-col gap-2 p-5">
                {p.manifest?.examples.map((ex) => (
                  <span key={ex} className="rounded-lg bg-muted px-3 py-2 text-[13px]">
                    “{ex}”
                  </span>
                ))}
              </SectionCard>
            )}
          </div>
          <div className="flex flex-col gap-4">
            <SectionCard icon={ShieldCheck} title="권한" bodyClassName="p-4">
              <PermissionList manifest={p.manifest} />
              <p className="mt-2 text-xs text-muted-foreground">비밀값은 팀 범위만 있어요. 팀 관리자가 설치할 때 입력해요.</p>
            </SectionCard>
            <SectionCard icon={History} title="버전 이력" bodyClassName="p-0">
              {p.versions.length === 0 ? (
                <div className="px-5 py-4 text-[13px] text-muted-foreground">이력이 없어요</div>
              ) : (
                <ul>
                  {p.versions.map((v) => (
                    <li key={v.id} className="flex items-center gap-3 border-b px-5 py-2.5 text-[13px] last:border-b-0">
                      <span className="font-mono font-medium tabular-nums">{v.version}</span>
                      {v.version === p.latestVersion ? <VersionStatusBadge status="published" /> : <span className="text-xs text-muted-foreground">이전 버전</span>}
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatTime(v.publishedAt ?? v.uploadedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function Head({ pkg, ctx }: { pkg: McpPackageDetail; ctx: MarketContext }) {
  const [open, setOpen] = useState(false);
  const current = ctx.team;
  const installedHere = pkg.installedInTeam && !!current;
  const otherTargets = pkg.canInstallTeams.filter((t) => !(installedHere && t === current?.name));
  const canInstall = !pkg.isPlatform && pkg.status === 'active' && otherTargets.length > 0;
  const label =
    installedHere ? '다른 팀에 설치' : current && pkg.canInstallTeams.includes(current.name) ? `${current.displayName}에 설치` : '설치';

  return (
    <div className="flex flex-wrap items-start gap-4">
      <McpIcon icon={pkg.icon} name={pkg.displayName || pkg.name} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
          {pkg.displayName || pkg.name}
          {(pkg.isDefault || pkg.isPlatform) && <Badge variant="secondary">기본 제공</Badge>}
          {pkg.status === 'suspended' && (
            <Badge variant="outline">
              <Dot dot="danger" />
              게시 중단
            </Badge>
          )}
        </h1>
        <p className="text-sm text-pretty">{pkg.summary}</p>
        <p className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
          <span className="font-mono">{pkg.name}</span>·<span>{pkg.isPlatform ? '플랫폼' : (pkg.owner?.name ?? '—')}</span>
          {pkg.latestVersion && (
            <>
              ·<span className="font-mono tabular-nums">v{pkg.latestVersion}</span>
            </>
          )}
          ·<span className="tabular-nums">{pkg.installCount.toLocaleString()}팀 설치</span>·<span>{pkg.category}</span>
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {installedHere && current && (
          <Badge variant="default" className="gap-1">
            <Check strokeWidth={2.5} />
            {current.displayName}에 설치됨
          </Badge>
        )}
        {pkg.isPlatform ? (
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Package className="size-4" strokeWidth={1.75} />
            모든 팀에 기본 설치돼요
          </span>
        ) : pkg.status === 'suspended' ? (
          <span className="text-[13px] text-muted-foreground">게시가 중단돼 새로 설치할 수 없어요</span>
        ) : canInstall ? (
          <Button onClick={() => setOpen(true)} variant={installedHere ? 'outline' : 'default'}>
            {label}
          </Button>
        ) : installedHere ? null : (
          <span className="text-[13px] text-muted-foreground">팀 관리자에게 설치를 요청하세요</span>
        )}
      </div>
      {canInstall && (
        <InstallDialog
          pkg={pkg}
          open={open}
          onOpenChange={setOpen}
          teams={ctx.teams}
          preferredTeam={installedHere ? otherTargets[0] : current?.name}
        />
      )}
    </div>
  );
}
