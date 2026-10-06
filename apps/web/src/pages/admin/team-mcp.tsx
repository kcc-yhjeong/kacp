import { ErrorState, ListSkeleton } from '@/components/admin/page';
import { InstallsTable } from '@/components/mcp/installs-table';
import { useAdminMcpInstalls } from '@/lib/mcp/api';

/** A-05 MCP 탭: that team's installs (source included), read-only + 강제 제거. */
export function TeamMcpTab({ team }: { team: string }) {
  const q = useAdminMcpInstalls({ team });
  if (q.isPending)
    return (
      <div className="rounded-xl border">
        <ListSkeleton />
      </div>
    );
  if (q.isError)
    return (
      <div className="rounded-xl border">
        <ErrorState title="MCP 목록을 불러오지 못했어요" error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  return <InstallsTable team={team} items={q.data} canManage mode="admin" />;
}
