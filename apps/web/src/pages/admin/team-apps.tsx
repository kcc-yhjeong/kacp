import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AppWindow } from 'lucide-react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/admin/page';
import { AppTable } from '@/components/apps/app-table';
import { adminDeployApi, appKeys } from '@/lib/apps/api';
import { copyStateOf } from '@/lib/apps/status';
import type { App } from '@/lib/apps/types';

/** A-05 앱 탭: that team's apps (U-07 columns). Force-stop / resume of public copies happens in A-09. */
export function TeamAppsTab({ team }: { team: string }) {
  const q = useQuery({
    queryKey: appKeys.adminApps({ team }),
    queryFn: async () => (await adminDeployApi.apps({ team })).items,
  });
  return (
    <div className="overflow-hidden rounded-xl border">
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState title="앱 목록을 불러오지 못했어요" error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={AppWindow} title="아직 앱이 없어요" description="팀 에이전트가 웹 앱을 띄우면 여기에 보여요" />
      ) : (
        <AppTable apps={q.data} action={{ head: '공개본', cell: (a) => <PublicAction app={a} /> }} />
      )}
    </div>
  );
}

function PublicAction({ app }: { app: App }) {
  if (!app.public) return <span className="text-muted-foreground">—</span>;
  const admin = copyStateOf(app.public) === 'admin';
  return (
    <Link
      to="/admin/deploy"
      search={{ tab: 'public' }}
      className={admin ? 'text-[13px] hover:underline' : 'text-[13px] text-destructive hover:underline'}
    >
      {admin ? '해제는 배포 승인에서' : '공개본 강제 중지'}
    </Link>
  );
}
