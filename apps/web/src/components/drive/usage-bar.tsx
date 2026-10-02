import { Skeleton } from '@/components/ui/skeleton';
import { formatSize, usageLevel, usagePct } from '@/lib/drive/format';
import { useDriveUsage } from '@/lib/drive/queries';
import { cn } from '@/lib/utils';

const BAR: Record<ReturnType<typeof usageLevel>, string> = {
  normal: 'bg-primary',
  warn: 'bg-warning',
  danger: 'bg-danger',
};

/** Team usage under the tree: `12.4 GB / 20 GB` + bar (color only at ≥ 80% / ≥ 95%). */
export function UsageBar({ team }: { team: string }) {
  const usage = useDriveUsage(team);
  const u = usage.data;
  return (
    <div className="flex flex-col gap-2 border-t p-4">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">팀 사용량</span>
        {u ? (
          <span className="tabular-nums">
            {formatSize(u.usedBytes)} / {formatSize(u.limitBytes)}
          </span>
        ) : usage.isError ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Skeleton className="h-3 w-20" />
        )}
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="팀 저장 공간 사용량"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={u ? Math.round(usagePct(u.usedBytes, u.limitBytes)) : undefined}
      >
        {u && (
          <div
            className={cn('h-full', BAR[usageLevel(u.usedBytes, u.limitBytes)])}
            style={{ width: `${usagePct(u.usedBytes, u.limitBytes)}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** Banner above the list when the team is nearly full (mockup 4e). */
export function UsageNotice({ team }: { team: string }) {
  const u = useDriveUsage(team).data;
  if (!u || usageLevel(u.usedBytes, u.limitBytes) !== 'danger') return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b px-4 py-2.5 text-[13px]">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-danger" />
      팀 저장 공간이 거의 다 찼어요 ({Math.floor(usagePct(u.usedBytes, u.limitBytes))}%). 휴지통을 비우거나 필요 없는 파일을
      지워 주세요.
    </div>
  );
}
