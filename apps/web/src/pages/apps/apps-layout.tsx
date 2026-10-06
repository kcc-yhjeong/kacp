import type { MyTeam } from '@kacp/shared';
import { Navigate } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/admin/page';
import { AppHeader } from '@/components/app-header';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { appOrigin } from '@/lib/host';
import { useMe, useMyTeams } from '@/lib/queries';

export function appsUrl(team: string): string {
  return `${appOrigin}/t/${encodeURIComponent(team)}/apps`;
}

/** Frame for U-07 / U-08 on the app host: C-00 header + team membership check. */
export function AppsLayout({ team, children }: { team: string; children: (membership: MyTeam) => ReactNode }) {
  const me = useMe();
  const ready = !!me.data && !me.data.mustChangePassword;
  const teams = useMyTeams(ready);

  if (me.data?.mustChangePassword) return <Navigate to="/password/setup" />;
  if (!me.data || !teams.data) return <PageLoader />;
  const membership = teams.data.find((t) => t.name === team);
  const fallback = teams.data[0];

  return (
    <div className="flex h-full flex-col">
      <AppHeader currentTeam={team} active="apps" teamHref={(t) => appsUrl(t.name)} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {membership ? (
          children(membership)
        ) : (
          <EmptyState
            icon={Lock}
            className="py-20"
            title="이 팀 멤버만 볼 수 있어요"
            description="이 팀의 앱은 그 팀 멤버만 볼 수 있어요. 필요하면 그 팀의 팀 관리자에게 요청하세요."
            action={
              fallback && (
                <Button variant="outline" size="sm" asChild>
                  <a href={appsUrl(fallback.name)}>내 팀 배포관리로</a>
                </Button>
              )
            }
          />
        )}
      </main>
    </div>
  );
}
