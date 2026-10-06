import type { Me, MyTeam } from '@kacp/shared';
import { Link, Navigate } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import { PageContainer, PageHeader } from '@/components/admin/page';
import { AppHeader } from '@/components/app-header';
import { PageLoader } from '@/components/page-loader';
import { appOrigin } from '@/lib/host';
import { useTeamInstalls } from '@/lib/mcp/api';
import { canManageTeamMcp, pickMarketTeam, rememberMarketTeam } from '@/lib/mcp/market-team';
import { useMe, useMyTeams } from '@/lib/queries';
import { cn } from '@/lib/utils';

export type MarketTab = 'market' | 'installed' | 'mine';

export interface MarketContext {
  me: Me;
  teams: MyTeam[];
  /** Current team (installed badge, install target). Undefined when the user has no team. */
  team: MyTeam | undefined;
  /** Team admin of `team`, or a platform admin. */
  canManage: boolean;
}

/** Where the team switcher goes on market pages: same tab, other team. */
function marketHref(tab: MarketTab, team: string): string {
  const path = tab === 'market' ? '/market' : tab === 'installed' ? '/market/installed' : '/market/mine';
  return `${appOrigin}${path}?team=${encodeURIComponent(team)}`;
}

/** Frame for U-09 ~ U-12: C-00 header (MCP 마켓 active) + market tabs. `tab` null = a sub page (U-10, version detail). */
export function MarketLayout({
  tab,
  requestedTeam,
  children,
  title = true,
}: {
  tab: MarketTab | null;
  requestedTeam?: string;
  children: (ctx: MarketContext) => ReactNode;
  title?: boolean;
}) {
  const me = useMe();
  const ready = !!me.data && !me.data.mustChangePassword;
  const teams = useMyTeams(ready);
  const team = teams.data ? pickMarketTeam(teams.data, requestedTeam) : undefined;

  useEffect(() => {
    if (team) rememberMarketTeam(team.name);
  }, [team]);

  if (me.data?.mustChangePassword) return <Navigate to="/password/setup" />;
  if (!me.data || !teams.data) return <PageLoader />;
  const ctx: MarketContext = { me: me.data, teams: teams.data, team, canManage: canManageTeamMcp(team, me.data.platformRole) };

  return (
    <div className="flex h-full flex-col">
      <AppHeader currentTeam={team?.name} active="market" teamHref={(t) => marketHref(tab ?? 'market', t.name)} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === null ? (
          children(ctx)
        ) : (
          <PageContainer>
            {title && <PageHeader title="MCP 마켓" description="에이전트가 쓸 수 있는 도구를 찾아 팀에 설치해요." />}
            <MarketTabs tab={tab} team={team?.name} />
            {children(ctx)}
          </PageContainer>
        )}
      </main>
    </div>
  );
}

const tabClass = (on: boolean) =>
  cn(
    '-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    on ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
  );

function MarketTabs({ tab, team }: { tab: MarketTab; team: string | undefined }) {
  const installs = useTeamInstalls(team);
  const count = installs.data?.items.length;
  const search = team ? { team } : {};
  return (
    <nav aria-label="MCP 마켓 탭" className="flex items-center gap-1 border-b">
      <Link to="/market" search={search} className={tabClass(tab === 'market')} aria-current={tab === 'market' ? 'page' : undefined}>
        마켓
      </Link>
      <Link to="/market/installed" search={search} className={tabClass(tab === 'installed')} aria-current={tab === 'installed' ? 'page' : undefined}>
        우리 팀 설치됨
        {count !== undefined && <span className="text-muted-foreground tabular-nums">{count}</span>}
      </Link>
      <Link to="/market/mine" search={search} className={tabClass(tab === 'mine')} aria-current={tab === 'mine' ? 'page' : undefined}>
        내 배포
      </Link>
    </nav>
  );
}
