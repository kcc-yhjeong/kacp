import type { TeamRole, TeamStatus } from '@kacp/shared';
import { Loader2, MessageSquarePlus, RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { NotFoundPage } from '@/components/message-page';
import { TeamStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { appOrigin } from '@/lib/host';
import { useMe, useTeam } from '@/lib/queries';
import { useTeamSession } from '@/lib/use-team-session';

const CLAW_HOME = '/claw/';
const CLAW_NEW = '/claw/new';

/** U-01 agent shell on `{team}.{base}/`: header + thin bar + Control UI iframe. */
export function AgentShellPage({ team }: { team: string }) {
  const me = useMe();
  const allowed = !!me.data && !me.data.mustChangePassword;
  const detail = useTeam(team, allowed);
  const session = useTeamSession(team, !!detail.data);
  const forbidden = detail.error instanceof ApiError && detail.error.status === 403;

  useEffect(() => {
    if (me.data?.mustChangePassword) location.replace(`${appOrigin}/password/setup`);
  }, [me.data?.mustChangePassword]);

  useEffect(() => {
    if (forbidden) location.replace(`${appOrigin}/forbidden?team=${encodeURIComponent(team)}`);
  }, [forbidden, team]);

  if (detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />;

  const status = session.status;
  const running = status?.status === 'running' && !session.failure;

  return (
    <div className="flex h-full flex-col">
      <AppHeader currentTeam={team} currentStatus={status?.status} active="agent" />
      {running && detail.data ? (
        <RunningShell noAgents={detail.data.agents.length === 0} />
      ) : (
        <main className="flex flex-1 items-center justify-center p-6">
          <ShellState
            loading={!detail.data}
            status={status}
            failure={session.failure}
            role={detail.data?.myRole}
            onRetry={session.retry}
          />
        </main>
      )}
    </div>
  );
}

function RunningShell({ noAgents }: { noAgents: boolean }) {
  const [frame, setFrame] = useState({ src: CLAW_HOME, key: 0 });

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-[13px]">
        {/* U-02 app chips go here (stage 5). */}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">개인 대화는 새 세션에서 초안을 고르세요</span>
          <Button
            variant="outline"
            size="sm"
            className="h-[26px] px-2.5 text-[13px]"
            onClick={() => setFrame((f) => ({ src: CLAW_NEW, key: f.key + 1 }))}
          >
            <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />새 개인 대화
          </Button>
        </div>
      </div>
      {noAgents && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted px-4 text-[13px]">
          <span className="font-medium">아직 이 팀에 할당된 에이전트가 없어요</span>
          <span className="text-muted-foreground">· 플랫폼 관리자가 할당하면 바로 쓸 수 있어요</span>
        </div>
      )}
      <iframe key={frame.key} src={frame.src} title="팀 채팅" className="w-full flex-1 border-0" />
    </>
  );
}

interface ShellStateProps {
  loading: boolean;
  status: TeamStatus | null;
  failure: string | null;
  role: TeamRole | undefined;
  onRetry: () => void;
}

function ShellState({ loading, status, failure, role, onRetry }: ShellStateProps) {
  if (loading) return <Loader2 className="size-6 animate-spin text-muted-foreground" strokeWidth={1.75} />;
  if (failure) return <ErrorState description={failure} onRetry={onRetry} />;
  if (status?.status === 'stopping') return <StoppingState />;
  if (status?.status === 'error') {
    return role === 'team_admin' ? (
      <ErrorState description="다시 시도해 보세요. 플랫폼 관리자에게도 알렸어요." onRetry={onRetry} summary={status} />
    ) : (
      <ErrorState description="다시 시도해 보세요. 플랫폼 관리자에게 알렸어요." onRetry={onRetry} />
    );
  }
  return <StartingState />;
}

function StartingState() {
  return (
    <div className="flex w-[380px] max-w-full flex-col items-center gap-5 text-center" aria-live="polite">
      <Loader2 className="size-8 animate-spin" strokeWidth={1.75} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight">팀 에이전트를 준비하고 있어요</h1>
        <p className="text-sm text-pretty text-muted-foreground">보통 25초 안팎이에요. 이 창을 닫아도 준비는 계속돼요.</p>
      </div>
      <div className="h-1.5 w-[280px] max-w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="준비 중">
        <div className="h-full w-2/5 animate-indeterminate rounded-full bg-primary" />
      </div>
    </div>
  );
}

function StoppingState() {
  return (
    <div className="flex w-[380px] max-w-full flex-col items-center gap-5 text-center" aria-live="polite">
      <Loader2 className="size-8 animate-spin text-muted-foreground" strokeWidth={1.75} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight">팀 에이전트를 정리하고 있어요</h1>
        <p className="text-sm text-pretty text-muted-foreground">끝나면 다시 준비해요.</p>
      </div>
      <TeamStatusBadge status="stopping" />
    </div>
  );
}

function ErrorState({
  description,
  onRetry,
  summary,
}: {
  description: string;
  onRetry: () => void;
  summary?: TeamStatus;
}) {
  return (
    <div className="flex w-[440px] max-w-full flex-col items-center gap-5 text-center" role="alert">
      <div className="grid size-14 place-items-center rounded-full bg-muted">
        <TriangleAlert className="size-7 text-danger" strokeWidth={1.75} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight">에이전트를 시작하지 못했어요</h1>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      <Button onClick={onRetry}>
        <RotateCw strokeWidth={1.75} />
        다시 시도
      </Button>
      {summary && (
        <div className="w-full overflow-hidden rounded-xl border text-left">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-medium">오류 요약</span>
            <TeamStatusBadge status="error" />
          </div>
          <div className="flex flex-col gap-2.5 px-4 py-3.5 text-[13.5px]">
            <span>{summary.detail?.split('\n')[0] || '에이전트가 시작 도중 멈췄어요.'}</span>
            <div className="grid grid-cols-[88px_1fr] text-xs">
              <span className="text-muted-foreground">발생 시각</span>
              <span className="tabular-nums">{formatTime(summary.since)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
