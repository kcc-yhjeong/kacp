import { TEAM_STATUS_LABEL_USER, type MyTeam, type TeamContainerStatus } from '@kacp/shared';
import { Bell, Check, ChevronsUpDown, LogOut, Settings, ShieldCheck, Undo2, User } from 'lucide-react';
import { toast } from 'sonner';
import { ComingSoon } from '@/components/coming-soon';
import { Logo } from '@/components/logo';
import { TeamStatusDot } from '@/components/status';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { initialOf } from '@/lib/format';
import { appOrigin, driveUrl, hostOf, teamRoot } from '@/lib/host';
import { logoutAndLeave, useMe, useMyTeams } from '@/lib/queries';

interface AppHeaderProps {
  /** `company` hides the team scope (C-03). */
  variant?: 'full' | 'company';
  /** Team name when on a team host. */
  currentTeam?: string;
  /** Live status of the current team (the shell knows it better than /me/teams). */
  currentStatus?: TeamContainerStatus;
  active?: 'agent' | 'drive' | 'apps';
  /** Where the team switcher goes for another team (drive pages keep the same drive page). Default: team root. */
  teamHref?: (team: MyTeam) => string;
}

const navClass = (on: boolean) =>
  on
    ? 'rounded-md px-2.5 py-1.5 font-medium text-foreground'
    : 'rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground';

/** C-00 header. Values from 02-design-system.md "헤더·셸 확정값". */
export function AppHeader({ variant = 'full', currentTeam, currentStatus, active, teamHref }: AppHeaderProps) {
  const teams = useMyTeams().data ?? [];
  const current = teams.find((t) => t.name === currentTeam);
  const homeHref = current ? teamRoot(current.url) : `${appOrigin}/`;
  // Team-scoped menus fall back to the first team on pages without a team (e.g. /me).
  const scopeTeam = current ?? teams[0];

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-background pr-3 pl-4 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <Logo href={homeHref} />
        {variant === 'full' && (
          <>
            <Separator orientation="vertical" />
            <TeamSwitcher teams={teams} current={current} currentStatus={currentStatus} teamHref={teamHref} />
            <nav className="flex items-center gap-0.5">
              <a href={homeHref} className={navClass(active === 'agent')} aria-current={active === 'agent' ? 'page' : undefined}>
                에이전트
              </a>
              {scopeTeam ? (
                <a
                  href={driveUrl(scopeTeam.name)}
                  className={navClass(active === 'drive')}
                  aria-current={active === 'drive' ? 'page' : undefined}
                >
                  드라이브
                </a>
              ) : (
                <ComingSoon>드라이브</ComingSoon>
              )}
              {scopeTeam ? (
                <a
                  href={`${appOrigin}/t/${encodeURIComponent(scopeTeam.name)}/apps`}
                  className={navClass(active === 'apps')}
                  aria-current={active === 'apps' ? 'page' : undefined}
                >
                  배포관리
                </a>
              ) : (
                <ComingSoon>배포관리</ComingSoon>
              )}
            </nav>
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        <nav className="flex items-center justify-end gap-0.5">
          <ComingSoon>커뮤니티</ComingSoon>
          <ComingSoon>MCP 마켓</ComingSoon>
        </nav>
        <Separator orientation="vertical" className="mx-2" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-disabled="true"
              aria-label="알림"
              tabIndex={0}
              className="grid size-8 cursor-not-allowed place-items-center rounded-md text-muted-foreground/60"
            >
              <Bell className="size-4" strokeWidth={1.75} />
            </span>
          </TooltipTrigger>
          <TooltipContent>준비 중</TooltipContent>
        </Tooltip>
        <ProfileMenu />
      </div>
    </header>
  );
}

function TeamSwitcher({
  teams,
  current,
  currentStatus,
  teamHref,
}: {
  teams: MyTeam[];
  current: MyTeam | undefined;
  currentStatus?: TeamContainerStatus;
  teamHref?: (team: MyTeam) => string;
}) {
  const statusOf = (t: MyTeam) => (t === current && currentStatus ? currentStatus : t.containerStatus);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 items-center gap-2 rounded-md px-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent">
        {current ? (
          <>
            <TeamStatusDot status={statusOf(current)} />
            <span className="font-medium">{current.displayName}</span>
          </>
        ) : (
          <span className="text-muted-foreground">팀 선택</span>
        )}
        <ChevronsUpDown className="size-4 text-muted-foreground" strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[272px]">
        <DropdownMenuLabel>내 팀</DropdownMenuLabel>
        {teams.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">소속된 팀이 없어요</div>}
        {teams.map((t) => (
          <DropdownMenuItem key={t.name} onSelect={() => location.assign(teamHref ? teamHref(t) : teamRoot(t.url))} className="gap-2.5">
            <TeamStatusDot status={statusOf(t)} />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate">{t.displayName}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{hostOf(t.url)}</span>
            </span>
            <span className="text-xs text-muted-foreground">{TEAM_STATUS_LABEL_USER[statusOf(t)]}</span>
            {t === current ? <Check className="size-4" /> : <span className="w-4" />}
          </DropdownMenuItem>
        ))}
        {current?.teamRole === 'team_admin' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <Settings className="text-muted-foreground" strokeWidth={1.75} />
              팀 설정
              <span className="ml-auto text-xs text-muted-foreground">준비 중</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Profile menu. `admin` mode (inside /admin) swaps "관리자 화면" for "사원 화면으로" (C-00). */
export function ProfileMenu({ admin = false }: { admin?: boolean }) {
  const me = useMe().data;
  const onLogout = async () => {
    try {
      await logoutAndLeave();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="프로필"
        className="ml-1 grid size-7 place-items-center rounded-full border bg-muted text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {me ? initialOf(me.name) : ''}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[232px]">
        {me && (
          <div className="flex flex-col gap-0.5 p-2">
            <span className="font-medium">{me.name}</span>
            <span className="truncate text-xs text-muted-foreground">{me.email}</span>
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => location.assign(`${appOrigin}/me`)}>
          <User className="text-muted-foreground" strokeWidth={1.75} />내 정보
        </DropdownMenuItem>
        {admin ? (
          <DropdownMenuItem onSelect={() => location.assign(`${appOrigin}/`)}>
            <Undo2 className="text-muted-foreground" strokeWidth={1.75} />
            사원 화면으로
          </DropdownMenuItem>
        ) : (
          me?.platformRole === 'admin' && (
            <DropdownMenuItem onSelect={() => location.assign(`${appOrigin}/admin`)}>
              <ShieldCheck className="text-muted-foreground" strokeWidth={1.75} />
              관리자 화면
            </DropdownMenuItem>
          )
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="text-muted-foreground" strokeWidth={1.75} />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
