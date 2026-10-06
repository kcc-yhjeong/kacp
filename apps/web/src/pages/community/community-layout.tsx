import type { Me, MyTeam } from '@kacp/shared';
import { Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { PageLoader } from '@/components/page-loader';
import { pickMarketTeam } from '@/lib/mcp/market-team';
import { useMe, useMyTeams } from '@/lib/queries';

export interface CommunityContext {
  me: Me;
  teams: MyTeam[];
  /** Last used team (install target, `installedInTeam`). Undefined when the user has no team. */
  team: MyTeam | undefined;
  isAdmin: boolean;
}

/** Frame for U-13: C-00 header (커뮤니티 active). Works for users without a team (C-03 links here). */
export function CommunityLayout({ children }: { children: (ctx: CommunityContext) => ReactNode }) {
  const me = useMe();
  const ready = !!me.data && !me.data.mustChangePassword;
  const teams = useMyTeams(ready);

  if (me.data?.mustChangePassword) return <Navigate to="/password/setup" />;
  if (!me.data || !teams.data) return <PageLoader />;
  const team = pickMarketTeam(teams.data, undefined);
  const ctx: CommunityContext = { me: me.data, teams: teams.data, team, isAdmin: me.data.platformRole === 'admin' };

  return (
    <div className="flex h-full flex-col">
      <AppHeader currentTeam={team?.name} active="community" />
      <main className="min-h-0 flex-1 overflow-y-auto">{children(ctx)}</main>
    </div>
  );
}
