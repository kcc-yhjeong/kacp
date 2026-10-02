import { TEAM_STATUS_LABEL_USER, type TeamContainerStatus } from '@kacp/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Dot colors per 02-design-system.md §6 (team_container_status).
const DOT_CLASS: Record<TeamContainerStatus, string> = {
  stopped: 'bg-muted-foreground',
  starting: 'bg-warning animate-blink',
  running: 'bg-success',
  stopping: 'bg-muted-foreground',
  error: 'bg-danger',
};

export function TeamStatusDot({ status, size = 8 }: { status: TeamContainerStatus; size?: 6 | 8 }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', size === 8 ? 'size-2' : 'size-1.5', DOT_CLASS[status])}
    />
  );
}

export function TeamStatusBadge({ status }: { status: TeamContainerStatus }) {
  return (
    <Badge variant="outline">
      <TeamStatusDot status={status} size={6} />
      {TEAM_STATUS_LABEL_USER[status]}
    </Badge>
  );
}
