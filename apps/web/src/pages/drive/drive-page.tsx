import type { MyTeam } from '@kacp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { DriveTree, TrashTreeItem, treeKey } from '@/components/drive/drive-tree';
import { FolderView } from '@/components/drive/folder-view';
import { TrashView } from '@/components/drive/trash-view';
import { UploadTray } from '@/components/drive/upload-tray';
import { UsageBar } from '@/components/drive/usage-bar';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { driveUrl } from '@/lib/host';
import { driveSplat, parseDriveSplat, splitPath, type DriveLocation } from '@/lib/drive/path';
import { invalidateDrive } from '@/lib/drive/queries';
import { uploads } from '@/lib/drive/uploads';
import type { DriveSpace } from '@/lib/drive/types';
import { useMe, useMyTeams } from '@/lib/queries';

/** `/t/{team}/drive/{me|shared}/{...path}` (U-04 + U-05) and `/t/{team}/drive/trash` (U-06). */
export function DrivePage({ team, splat }: { team: string; splat: string }) {
  const me = useMe();
  const ready = !!me.data && !me.data.mustChangePassword;
  const teams = useMyTeams(ready);
  const loc = parseDriveSplat(splat);

  if (me.data?.mustChangePassword) return <Navigate to="/password/setup" />;
  if (!loc) return <Navigate to="/t/$team/drive/$" params={{ team, _splat: 'shared' }} replace />;
  if (!me.data || !teams.data) return <PageLoader />;

  const membership = teams.data.find((t) => t.name === team);
  const fallback = teams.data[0];
  const forbidden = <DriveForbidden href={fallback ? driveUrl(fallback.name, 'me') : null} />;
  // Keep the same drive page when switching teams (C-00 team switcher on drive pages).
  const teamHref = (t: MyTeam) => driveUrl(t.name, loc.kind === 'trash' ? 'trash' : loc.space);

  return (
    <div className="flex h-full flex-col">
      <AppHeader currentTeam={team} active="drive" teamHref={teamHref} />
      {membership ? (
        <DriveWorkspace team={team} loc={loc} me={me.data.id} isTeamAdmin={membership.teamRole === 'team_admin'} forbidden={forbidden} />
      ) : (
        <main className="flex flex-1 items-center justify-center">{forbidden}</main>
      )}
    </div>
  );
}

function DriveWorkspace({
  team,
  loc,
  me,
  isTeamAdmin,
  forbidden,
}: {
  team: string;
  loc: DriveLocation;
  me: string;
  isTeamAdmin: boolean;
  forbidden: ReactNode;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([treeKey('me', '/'), treeKey('shared', '/')]));

  const go = useCallback(
    (space: DriveSpace | 'trash', path = '/') =>
      void navigate({
        to: '/t/$team/drive/$',
        params: { team, _splat: space === 'trash' ? 'trash' : driveSplat(space, path) },
      }),
    [navigate, team],
  );

  // Open the tree down to the current folder.
  const space = loc.kind === 'folder' ? loc.space : null;
  const path = loc.kind === 'folder' ? loc.path : null;
  useEffect(() => {
    if (!space || path === null) return;
    const parts = splitPath(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(treeKey(space, '/'));
      for (let i = 1; i < parts.length; i++) next.add(treeKey(space, `/${parts.slice(0, i).join('/')}`));
      return next.size === prev.size ? prev : next;
    });
  }, [space, path]);

  // Refresh listings when uploads land (coalesced: a folder upload finishes many files at once).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    uploads.setOnFinished((t) => {
      if (t !== team) return;
      clearTimeout(timer);
      timer = setTimeout(() => void invalidateDrive(qc, team), 400);
    });
    return () => {
      clearTimeout(timer);
      uploads.setOnFinished(null);
    };
  }, [qc, team]);

  const toggle = (s: DriveSpace, p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const k = treeKey(s, p);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1">
      <aside aria-label="드라이브" className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-2 py-3">
          <DriveTree
            team={team}
            selected={loc.kind === 'folder' ? { space: loc.space, path: loc.path } : null}
            expanded={expanded}
            onToggle={toggle}
            onSelect={(s, p) => go(s, p)}
          />
          <TrashTreeItem active={loc.kind === 'trash'} onSelect={() => go('trash')} />
        </div>
        <UsageBar team={team} />
      </aside>
      <main className="flex min-w-0 flex-1">
        {loc.kind === 'trash' ? (
          <TrashView team={team} me={me} isTeamAdmin={isTeamAdmin} forbidden={forbidden} />
        ) : (
          <FolderView team={team} space={loc.space} path={loc.path} onNavigate={(s, p) => go(s, p)} forbidden={forbidden} />
        )}
      </main>
      <UploadTray />
    </div>
  );
}

/** 403 (List States / mockup 4i 권한 없음). */
function DriveForbidden({ href }: { href: string | null }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-muted">
        <Lock className="size-7 text-muted-foreground" strokeWidth={1.75} />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <span className="text-[15px] font-semibold">이 폴더를 볼 권한이 없어요</span>
        <span className="text-sm text-pretty text-muted-foreground">
          팀 공유 폴더는 그 팀 멤버만 열 수 있어요. 필요하면 그 팀의 팀 관리자에게 초대를 요청하세요.
        </span>
      </div>
      {href && (
        <Button variant="outline" size="sm" asChild>
          <a href={href}>내 드라이브로</a>
        </Button>
      )}
    </div>
  );
}
