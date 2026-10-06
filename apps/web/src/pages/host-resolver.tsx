import { RouterProvider } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useMemo } from 'react';
import { MessagePage, NotFoundPage } from '@/components/message-page';
import { PageLoader } from '@/components/page-loader';
import { useHostKind } from '@/lib/queries';
import { createTeamRouter } from '@/routes/team-router';

const AppHostPage = lazy(() => import('@/pages/apps/app-host-page').then((m) => ({ default: m.AppHostPage })));

/** C-04 for app copies (`{slug}--{team}` work copies and public names) — its own lazy chunk. */
export function AppHost() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AppHostPage />
    </Suspense>
  );
}

/**
 * Single-label hosts reach the SPA through `fallback-web`. `GET /names/{label}` decides:
 * team → agent shell, nothing → 404, public app without a serving container → C-04 app flow.
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
  if (hostKind === 'public_app' || hostKind === 'private_app') return <AppHost />;
  return <NotFoundPage />;
}

function TeamApp({ team }: { team: string }) {
  const router = useMemo(() => createTeamRouter(team), [team]);
  return <RouterProvider router={router} />;
}
