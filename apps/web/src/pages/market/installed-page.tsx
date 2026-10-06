import { useNavigate } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/admin/page';
import { InstallsTable, SyncBanner } from '@/components/mcp/installs-table';
import { useTeamInstalls } from '@/lib/mcp/api';
import { MarketLayout } from './market-layout';

/** U-11 우리 팀 설치됨 — `/market/installed?team=`. */
export function InstalledPage({ team }: { team?: string }) {
  return (
    <MarketLayout tab="installed" requestedTeam={team}>
      {(ctx) =>
        ctx.team ? (
          <TeamInstalls team={ctx.team.name} />
        ) : (
          <div className="rounded-xl border">
            <EmptyState icon={Users} title="소속된 팀이 없어요" description="팀에 들어가면 그 팀에 설치된 MCP를 볼 수 있어요" />
          </div>
        )
      }
    </MarketLayout>
  );
}

/** U-11 body, also the U-15 MCP tab. Team admins (and platform admins) get the row menu. */
export function TeamInstalls({ team, actions }: { team: string; actions?: ReactNode }) {
  const navigate = useNavigate();
  const installs = useTeamInstalls(team);
  if (installs.isPending)
    return (
      <div className="rounded-xl border">
        <ListSkeleton />
      </div>
    );
  if (installs.isError)
    return (
      <div className="rounded-xl border">
        <ErrorState title="설치 목록을 불러오지 못했어요" error={installs.error} onRetry={() => void installs.refetch()} />
      </div>
    );
  const d = installs.data;
  return (
    <div className="flex flex-col gap-3">
      {actions}
      <SyncBanner teamRunning={d.teamRunning} lastSyncedAt={d.lastSyncedAt} />
      <InstallsTable
        team={team}
        items={d.items}
        canManage={d.canManage}
        onFindMarket={() => void navigate({ to: '/market', search: { team } })}
      />
    </div>
  );
}
