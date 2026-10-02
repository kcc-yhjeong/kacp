import { RouterProvider } from '@tanstack/react-router';
import { Square, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { MessagePage, NotFoundPage } from '@/components/message-page';
import { PageLoader } from '@/components/page-loader';
import { useHostKind } from '@/lib/queries';
import { createTeamRouter } from '@/routes/team-router';

/**
 * Single-label hosts reach the SPA through `fallback-web`. `GET /names/{label}` decides:
 * team → agent shell, nothing → 404, app copy without a running container → stopped notice.
 */
export function HostResolver({ label, team }: { label: string; team: string | null }) {
  const kind = useHostKind(label);

  if (kind.isPending) return <PageLoader />;
  if (kind.isError) {
    return (
      <MessagePage
        icon={TriangleAlert}
        code="503"
        title="잠시 점검 중이에요"
        description="곧 다시 쓸 수 있어요. 잠시 후 다시 시도해 주세요."
        action={{ label: '다시 시도', href: location.href }}
      />
    );
  }
  const hostKind = kind.data?.hostKind ?? 'none';
  if (hostKind === 'team' && team) return <TeamApp team={team} />;
  if (hostKind === 'public_app' || hostKind === 'private_app') {
    // Wake / stop-reason handling (GET /app-hosts/{host}) arrives with app deploy (stage 5).
    return (
      <MessagePage
        icon={Square}
        code="멈춤"
        title="이 앱은 지금 멈춰 있어요"
        description="나중에 다시 열어 주세요."
      />
    );
  }
  return <NotFoundPage />;
}

function TeamApp({ team }: { team: string }) {
  const router = useMemo(() => createTeamRouter(team), [team]);
  return <RouterProvider router={router} />;
}
