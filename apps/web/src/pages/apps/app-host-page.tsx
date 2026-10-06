import type { MyTeam } from '@kacp/shared';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Square, TriangleAlert } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { WakingView } from '@/components/apps/wake-view';
import { Logo } from '@/components/logo';
import { ForbiddenPage, MessagePage, NotFoundPage } from '@/components/message-page';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { api, ApiError, errorMessage } from '@/lib/api';
import { appHostView } from '@/lib/apps/status';
import type { AppHostInfo } from '@/lib/apps/types';
import { useAppHost } from '@/lib/apps/use-app-host';
import { appOrigin, loginUrl } from '@/lib/host';

const RELOAD_KEY = 'kacp.appHost.reloadedAt';

/** Teams of the viewer, or [] when not logged in (no global 401 redirect: anonymous visitors still get C-04). */
function useMyTeamNames() {
  return useQuery({
    queryKey: ['app-host', 'my-teams'],
    queryFn: async () => {
      try {
        return (await api.get<{ items: MyTeam[] }>('/me/teams')).items.map((t) => t.name);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return [];
        throw err;
      }
    },
    staleTime: Infinity,
  });
}

function detailUrl(info: AppHostInfo): string | null {
  if (!info.team) return null;
  const base = `${appOrigin}/t/${encodeURIComponent(info.team)}/apps`;
  return info.appId ? `${base}/${encodeURIComponent(info.appId)}` : base;
}

/** Reload into the app once it runs. Guard against a loop when the route is not up yet (≤ once per 5 s). */
function reloadSoon(): void {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    // ignore
  }
  const wait = Math.max(0, last + 5_000 - Date.now());
  setTimeout(() => {
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    location.reload();
  }, wait);
}

/** C-04 on `{slug}--{team}.{base}` and public names when the copy is not serving (fallback-web). */
export function AppHostPage({ host = location.hostname }: { host?: string }) {
  const teams = useMyTeamNames();
  const { info, query, wakeError, retry } = useAppHost(host);
  const isMember = !!info?.team && !!teams.data?.includes(info.team);
  const view = info && teams.data ? appHostView(info, isMember) : null;

  useEffect(() => {
    if (view?.kind === 'ready') reloadSoon();
    if (view?.kind === 'login') location.replace(loginUrl());
  }, [view?.kind]);

  if (query.isError || teams.isError) {
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
  if (!view || !info) return <PageLoader />;

  const href = detailUrl(info);
  switch (view.kind) {
    case 'not_found':
      return <NotFoundPage />;
    case 'login':
      return <PageLoader />;
    case 'forbidden':
      return <ForbiddenPage />;
    case 'ready':
    case 'waking':
      return (
        <Frame>
          {wakeError ? (
            <div className="flex flex-col items-center gap-4 text-center" role="alert">
              <h1 className="text-lg font-semibold tracking-tight">앱을 깨우지 못했어요</h1>
              <p className="text-sm text-muted-foreground">{errorMessage(wakeError)}</p>
              <Button onClick={retry}>다시 시도</Button>
            </div>
          ) : (
            <WakingView reason={view.kind === 'waking' ? view.reason : null} />
          )}
        </Frame>
      );
    case 'stopped':
      return (
        <MessagePage
          icon={Square}
          code="멈춤"
          title="이 앱은 지금 멈춰 있어요"
          description={
            view.member
              ? '팀원이 앱을 멈췄어요. 배포관리에서 다시 시작할 수 있어요.'
              : '앱을 만든 팀이 잠시 멈췄어요. 나중에 다시 열어 주세요.'
          }
          action={view.member && href ? { label: '배포관리에서 보기', href } : undefined}
        />
      );
    case 'admin':
      return (
        <MessagePage
          icon={ShieldAlert}
          code="관리자가 중지함"
          title="이 앱은 지금 멈춰 있어요"
          description={
            view.member
              ? '작업본은 그대로 있어요. 사유를 고친 뒤 다시 요청하세요.'
              : '플랫폼 관리자가 이 앱의 공개를 멈췄어요.'
          }
          detail={
            view.reason ? (
              <div className="w-full rounded-xl border px-4 py-3 text-left text-[13.5px]">
                <span className="text-xs text-muted-foreground">사유</span>
                <p className="mt-1 text-pretty">{view.reason}</p>
              </div>
            ) : undefined
          }
          action={view.member && href ? { label: '다시 요청', href } : undefined}
        />
      );
    case 'error':
      return (
        <MessagePage
          icon={TriangleAlert}
          code="오류"
          title="앱이 오류로 멈췄어요"
          description={
            view.member ? '배포관리에서 로그를 보고 다시 시작해 보세요.' : '앱을 만든 팀에 알려 주세요. 나중에 다시 열어 주세요.'
          }
          action={view.member && href ? { label: '배포관리에서 보기', href } : undefined}
        />
      );
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-sm">
        <Logo href={`${appOrigin}/`} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">{location.host}</span>
      </div>
      <main className="flex flex-1 items-center justify-center p-6">{children}</main>
    </div>
  );
}
