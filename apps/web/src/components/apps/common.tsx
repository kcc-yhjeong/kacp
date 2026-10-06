import { Copy, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ActorBadge } from '@/components/drive/actor-badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBytes } from '@/lib/admin/format';
import { displayUrl, memPct } from '@/lib/apps/status';
import type { AppCopy } from '@/lib/apps/types';
import type { DriveUserRef } from '@/lib/drive/types';
import { cn } from '@/lib/utils';

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('주소를 복사했어요');
  } catch {
    toast.error('복사하지 못했어요. 직접 선택해 복사하세요.');
  }
}

/** Address in mono + open in a new tab + copy (icon buttons). */
export function UrlLine({ url, className, open = true }: { url: string; className?: string; open?: boolean }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{displayUrl(url)}</span>
      {open && (
        <IconAction label="새 탭으로 열기" onClick={() => window.open(url, '_blank', 'noopener')}>
          <ExternalLink />
        </IconAction>
      )}
      <IconAction label="주소 복사" onClick={() => void copyText(url)}>
        <Copy />
      </IconAction>
    </span>
  );
}

export function IconAction({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn('size-7 shrink-0 text-muted-foreground [&_svg]:size-3.5', className)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Small memory bar for app lists. Text only when the limit is unknown. */
export function MemBar({ usage }: { usage: AppCopy['usage'] }) {
  if (!usage) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = memPct(usage);
  return (
    <span className="flex items-center gap-2" title={pct === null ? undefined : `한도의 ${Math.round(pct)}%`}>
      {pct !== null && (
        <span className="h-1 w-14 overflow-hidden rounded-sm bg-muted">
          <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{formatBytes(usage.memBytes)}</span>
    </span>
  );
}

/** Requester: a person, or "에이전트 · 팀" when the agent asked (`requestedBy` null). */
export function Requester({ user, className }: { user: DriveUserRef | null; className?: string }) {
  return <ActorBadge actor={user ? { kind: 'user', user } : { kind: 'agent', user: null }} className={className} />;
}
