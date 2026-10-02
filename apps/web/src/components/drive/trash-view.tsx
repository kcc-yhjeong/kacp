import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/admin/page';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError, errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { driveApi } from '@/lib/drive/api';
import { daysLeft, daysLeftLabel, PURGE_WARN_DAYS } from '@/lib/drive/format';
import { displayLocation, parentPath } from '@/lib/drive/path';
import { invalidateDrive, useTrash } from '@/lib/drive/queries';
import type { TrashItem } from '@/lib/drive/types';
import { ActorBadge, FileIcon } from './actor-badge';

const COLS = 'grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_128px_88px_176px]';

/** U-06 휴지통. `isTeamAdmin` only changes the "비우기" scope copy; the API decides what goes. */
export function TrashView({
  team,
  me,
  isTeamAdmin,
  forbidden,
}: {
  team: string;
  me: string | undefined;
  isTeamAdmin: boolean;
  forbidden: ReactNode;
}) {
  const qc = useQueryClient();
  const trash = useTrash(team);
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const items = [...(trash.data ?? [])].sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());

  // What "비우기" removes (06-auth §7): my deletions, plus every shared-space item for a team admin.
  const mine = items.filter((i) => i.deletedBy?.id === me);
  const othersShared = isTeamAdmin ? items.filter((i) => i.deletedBy?.id !== me && i.space === 'shared') : [];
  const emptyCount = mine.length + othersShared.length;
  const refresh = () => invalidateDrive(qc, team);

  const restore = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      const entry = await driveApi.restore(team, item.id);
      const where = displayLocation(item.space, parentPath(entry?.path ?? item.originalPath));
      toast.success(`${entry?.name ?? item.name}을(를) ${where}에 복원했어요`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
      void refresh();
    }
  };

  const purge = async () => {
    if (!purging) return;
    setPending(true);
    try {
      await driveApi.purge(team, purging.id);
      toast.success('영구 삭제했어요');
      setPurging(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
      void refresh();
    }
  };

  const emptyTrash = async () => {
    setPending(true);
    try {
      await driveApi.emptyTrash(team);
      toast.success('휴지통을 비웠어요');
      setEmptyOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
      void refresh();
    }
  };

  if (trash.error instanceof ApiError && trash.error.status === 403) return <div className="flex-1">{forbidden}</div>;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="text-sm font-medium">휴지통</h1>
          <span className="truncate text-[13px] text-muted-foreground">지운 지 30일이 지나면 자동으로 영구 삭제돼요.</span>
        </div>
        <Button variant="outline" size="sm" disabled={emptyCount === 0} onClick={() => setEmptyOpen(true)}>
          <Trash2 strokeWidth={1.75} />
          {isTeamAdmin ? '휴지통 비우기' : '내가 지운 항목 비우기'}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {trash.isPending ? (
          <ListSkeleton rows={6} />
        ) : trash.isError ? (
          <ErrorState title="휴지통을 불러오지 못했어요" error={trash.error} onRetry={() => void trash.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={Trash2} title="휴지통이 비어 있어요" description="지운 파일은 여기에 30일 동안 남아요." className="py-20" />
        ) : (
          <div role="table" aria-label="휴지통 항목">
            <div
              role="row"
              className={`sticky top-0 z-10 grid h-10 items-center gap-x-3 border-b bg-background px-4 text-[12.5px] text-muted-foreground ${COLS}`}
            >
              <span role="columnheader">이름</span>
              <span role="columnheader">원래 위치</span>
              <span role="columnheader">지운 사람</span>
              <span role="columnheader">지운 시각</span>
              <span role="columnheader">자동 삭제</span>
              <span />
            </div>
            {items.map((item) => {
              const left = daysLeft(item.purgeAfter);
              return (
                <div
                  key={item.id}
                  role="row"
                  className={`grid h-12 items-center gap-x-3 border-b px-4 text-[13.5px] hover:bg-accent/60 ${COLS}`}
                >
                  <span role="cell" className="flex min-w-0 items-center gap-2.5">
                    <FileIcon entry={{ name: item.name, isDir: item.isDir }} />
                    <span className="truncate" title={item.name}>
                      {item.name}
                    </span>
                  </span>
                  <span role="cell" className="truncate text-[12.5px] text-muted-foreground" title={displayLocation(item.space, parentPath(item.originalPath))}>
                    {displayLocation(item.space, parentPath(item.originalPath))}
                  </span>
                  <span role="cell" className="min-w-0 text-[12.5px]">
                    <ActorBadge actor={item.deletedBy ? { kind: 'user', user: item.deletedBy } : null} />
                  </span>
                  <span role="cell" className="text-[12.5px] text-muted-foreground">
                    {formatTime(item.deletedAt)}
                  </span>
                  <span role="cell" className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground tabular-nums">
                    {left <= PURGE_WARN_DAYS && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />}
                    {daysLeftLabel(left)}
                    {left <= PURGE_WARN_DAYS && <span className="sr-only">(곧 삭제)</span>}
                  </span>
                  <span role="cell" className="flex justify-end gap-1.5">
                    <Button variant="outline" size="sm" disabled={busyId === item.id} onClick={() => void restore(item)}>
                      <RotateCcw strokeWidth={1.75} />
                      복원
                    </Button>
                    <PurgeButton item={item} onClick={() => setPurging(item)} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(o) => !o && !pending && setPurging(null)}
        title={`${purging?.name ?? ''}을(를) 영구 삭제할까요?`}
        description="영구 삭제하면 되돌릴 수 없어요."
        confirmLabel="영구 삭제"
        destructive
        pending={pending}
        onConfirm={() => void purge()}
      />
      <ConfirmDialog
        open={emptyOpen}
        onOpenChange={(o) => !pending && setEmptyOpen(o)}
        title={isTeamAdmin ? '팀 공유 항목까지 비울까요?' : `내가 지운 항목 ${mine.length}개를 영구 삭제할까요?`}
        description={
          isTeamAdmin
            ? `내가 지운 항목 ${mine.length}개와 팀원이 팀 공유에서 지운 항목 ${othersShared.length}개, 모두 ${emptyCount}개를 영구 삭제해요. 팀원 내 드라이브에서 지운 항목은 건드리지 않아요. 되돌릴 수 없어요.`
            : '다른 사람이 지운 팀 공유 항목은 그대로 남아요. 되돌릴 수 없어요.'
        }
        confirmLabel={`${emptyCount}개 영구 삭제`}
        destructive
        pending={pending}
        onConfirm={() => void emptyTrash()}
      />
    </div>
  );
}

function PurgeButton({ item, onClick }: { item: TrashItem; onClick: () => void }) {
  const button = (
    <Button variant="ghost" size="sm" disabled={!item.canPurge} onClick={onClick} className="text-muted-foreground">
      영구 삭제
    </Button>
  );
  if (item.canPurge) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>지운 사람이나 팀 관리자만 영구 삭제할 수 있어요</TooltipContent>
    </Tooltip>
  );
}
