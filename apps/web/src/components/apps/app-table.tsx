import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ActorBadge } from '@/components/drive/actor-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { COPY_STATE, copyStateOf, pendingLabel } from '@/lib/apps/status';
import type { App } from '@/lib/apps/types';
import { formatTime } from '@/lib/format';
import { AppStatusBadge, CopyStateDot, PendingBadge } from './badges';
import { MemBar, UrlLine } from './common';

/** U-07 · A-05 app table: one row per app, both copies in their own columns (01-screens.md U-07). */
export function AppTable({
  apps,
  linkToDetail = false,
  action,
}: {
  apps: App[];
  /** Name links to U-08 (employee side only). */
  linkToDetail?: boolean;
  /** Extra last column (A-05 force-stop link). */
  action?: { head: string; cell: (app: App) => ReactNode };
}) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            <TableHead>앱 이름</TableHead>
            <TableHead>작업본 주소</TableHead>
            <TableHead>작업본 상태</TableHead>
            <TableHead>공개 상태</TableHead>
            <TableHead>만든 이</TableHead>
            <TableHead>마지막 접속</TableHead>
            <TableHead>메모리</TableHead>
            {action && <TableHead>{action.head}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {apps.map((a) => (
            <TableRow key={a.id} className="h-12">
              <TableCell className="font-medium">
                {linkToDetail ? (
                  <Link
                    to="/t/$team/apps/$appId"
                    params={{ team: a.team, appId: a.id }}
                    className="hover:underline"
                  >
                    {a.slug}
                  </Link>
                ) : (
                  a.slug
                )}
              </TableCell>
              <TableCell className="max-w-[260px]">
                <UrlLine url={a.work.url} open={false} />
              </TableCell>
              <TableCell>
                <AppStatusBadge copy={a.work} short />
              </TableCell>
              <TableCell>
                <PublicCell app={a} />
              </TableCell>
              <TableCell>
                <ActorBadge actor={a.creator} className="text-[13px]" />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {a.work.lastAccessedAt ? formatTime(a.work.lastAccessedAt) : '—'}
              </TableCell>
              <TableCell>
                <MemBar usage={a.work.usage} />
              </TableCell>
              {action && <TableCell>{action.cell(a)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** `—` / `v2` + state dot / pending badge. */
export function PublicCell({ app }: { app: App }) {
  const pending = pendingLabel(app);
  if (!app.public && !pending) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {app.public && <PublicState app={app} />}
      {pending && <PendingBadge label={pending} />}
    </span>
  );
}

function PublicState({ app }: { app: App }) {
  if (!app.public) return null;
  const st = copyStateOf(app.public);
  return (
    <span className="flex items-center gap-1.5 text-[13px]" title={COPY_STATE[st].label}>
      <span className="font-medium tabular-nums">v{app.public.version}</span>
      <CopyStateDot state={st} />
      <span className="text-xs text-muted-foreground">{COPY_STATE[st].short}</span>
    </span>
  );
}
