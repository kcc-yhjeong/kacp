import { Globe, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { COPY_STATE, copyStateOf, type CopyState, type Dot } from '@/lib/apps/status';
import type { AppCopy } from '@/lib/apps/types';
import { cn } from '@/lib/utils';

// App badges (02-design-system.md §6 app_status, AppCopyBadge). Color lives on the dot only.

const DOT: Record<Dot, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted-foreground',
};

export function Dot({ dot, blink, className }: { dot: Dot; blink?: boolean; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT[dot], blink && 'animate-blink', className)} />;
}

export function CopyStateDot({ state, className }: { state: CopyState; className?: string }) {
  const s = COPY_STATE[state];
  return <Dot dot={s.dot} blink={s.blink} className={className} />;
}

/** Status badge for one copy. `short` = list wording (`잠듦` without "· 접속하면 켜져요"). */
export function AppStatusBadge({
  copy,
  state,
  short = false,
  className,
}: {
  copy?: Pick<AppCopy, 'status' | 'stopReason'>;
  state?: CopyState;
  short?: boolean;
  className?: string;
}) {
  const st = state ?? (copy ? copyStateOf(copy) : 'stopped');
  const s = COPY_STATE[st];
  return (
    <Badge variant="outline" className={cn(s.muted && 'text-muted-foreground', className)}>
      <CopyStateDot state={st} />
      {short ? s.short : s.label}
    </Badge>
  );
}

const SMALL = 'h-[18px] gap-1 px-1.5 text-[11px] [&>svg]:size-[11px]';

/** `Private · 팀만` (secondary + Lock). */
export function PrivateBadge({ small, className }: { small?: boolean; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(small && SMALL, className)}>
      <Lock strokeWidth={2} />
      Private · 팀만
    </Badge>
  );
}

/** `Public v2` (black fill + Globe). */
export function PublicBadge({ version, small, className }: { version?: number | null; small?: boolean; className?: string }) {
  return (
    <Badge variant="default" className={cn(small && SMALL, className)}>
      <Globe strokeWidth={2} />
      {version ? `Public v${version}` : 'Public'}
    </Badge>
  );
}

/** `공개 승인 대기` / `업데이트 대기 v2→v3` (outline + warning dot). */
export function PendingBadge({ label, small, className }: { label: string; small?: boolean; className?: string }) {
  return (
    <Badge variant="outline" className={cn(small && SMALL, className)}>
      <Dot dot="warning" className={small ? 'size-[5px]' : undefined} />
      {label}
    </Badge>
  );
}

export function DotBadge({ dot, label, className }: { dot: Dot; label: string; className?: string }) {
  return (
    <Badge variant="outline" className={className}>
      <Dot dot={dot} />
      {label}
    </Badge>
  );
}
