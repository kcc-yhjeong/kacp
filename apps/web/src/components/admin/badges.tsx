import { TEAM_ROLE_LABEL, TEAM_STATUS_LABEL_ADMIN, type TeamContainerStatus, type TeamRole } from '@kacp/shared';
import { TeamStatusDot } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import {
  APPLY_STATUS,
  IMPORT_ACTION,
  PLATFORM_ROLE_LABEL,
  USER_STATUS,
  userStatusOf,
  type Dot,
} from '@/lib/admin/labels';
import type { AdminUser, ApplyStatus, ImportRowAction } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

// StatusBadge family (02-design-system.md §6): white + border + colored dot + black text.

const DOT: Record<Dot, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted-foreground',
};

export function StatusDot({ dot, className }: { dot: Dot; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT[dot], className)} />;
}

export function DotBadge({ dot, label, className }: { dot: Dot; label: string; className?: string }) {
  return (
    <Badge variant="outline" className={className}>
      <StatusDot dot={dot} />
      {label}
    </Badge>
  );
}

export function AdminTeamStatusBadge({ status }: { status: TeamContainerStatus }) {
  return (
    <Badge variant="outline">
      <TeamStatusDot status={status} size={6} />
      {TEAM_STATUS_LABEL_ADMIN[status]}
    </Badge>
  );
}

export function ApplyStatusBadge({ status }: { status: ApplyStatus }) {
  const s = APPLY_STATUS[status];
  return <DotBadge dot={s.dot} label={s.label} />;
}

export function ImportActionBadge({ action }: { action: ImportRowAction }) {
  const s = IMPORT_ACTION[action];
  return <DotBadge dot={s.dot} label={s.label} />;
}

export function UserStatusBadge({ user }: { user: Pick<AdminUser, 'status' | 'mustChangePassword'> }) {
  const s = USER_STATUS[userStatusOf(user)];
  return <DotBadge dot={s.dot} label={s.label} />;
}

export function ArchivedBadge() {
  return <DotBadge dot="muted" label="보관됨" className="h-[18px] px-1.5 text-[11px]" />;
}

/** Role badge: team admin = black fill, member = outline, no dot. */
export function TeamRoleBadge({ role, className }: { role: TeamRole; className?: string }) {
  return (
    <Badge variant={role === 'team_admin' ? 'default' : 'outline'} className={className}>
      {TEAM_ROLE_LABEL[role]}
    </Badge>
  );
}

export function PlatformRoleBadge({ role }: { role: 'admin' | 'user' }) {
  return role === 'admin' ? (
    <Badge variant="default">{PLATFORM_ROLE_LABEL.admin}</Badge>
  ) : (
    <span className="text-muted-foreground">{PLATFORM_ROLE_LABEL.user}</span>
  );
}
