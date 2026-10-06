import { ShieldAlert } from 'lucide-react';
import { Dot } from '@/components/apps/badges';
import { Badge } from '@/components/ui/badge';
import {
  INSTALL_SOURCE_LABEL,
  INSTALL_STATUS,
  PACKAGE_STATUS,
  SEVERITIES,
  SEVERITY_LABEL,
  VERSION_STATUS,
} from '@/lib/mcp/status';
import type { McpInstallSource, McpInstallStatus, McpPackageStatus, McpVersionStatus, ScanSummary } from '@/lib/mcp/types';
import { cn } from '@/lib/utils';

// MCP badges (02-design-system.md §6 MCP 버전·패키지·설치·출처). Color lives on the dot only.

export function VersionStatusBadge({ status, className }: { status: McpVersionStatus; className?: string }) {
  const s = VERSION_STATUS[status];
  return (
    <Badge variant="outline" className={cn(status === 'superseded' && 'text-muted-foreground', className)}>
      <Dot dot={s.dot} blink={s.blink} />
      {s.label}
    </Badge>
  );
}

export function InstallStatusBadge({ status, className }: { status: McpInstallStatus; className?: string }) {
  const s = INSTALL_STATUS[status];
  return (
    <Badge variant="outline" className={className}>
      <Dot dot={s.dot} blink={s.blink} />
      {s.label}
    </Badge>
  );
}

export function PackageStatusBadge({ status }: { status: McpPackageStatus }) {
  const s = PACKAGE_STATUS[status];
  return (
    <Badge variant="outline">
      <Dot dot={s.dot} />
      {s.label}
    </Badge>
  );
}

/** ScopeBadge (02 §5): 마켓 / 기본 제공 = secondary; 직접 추가 · 검토되지 않음 = outline + warning dot + ShieldAlert. */
export function ScopeBadge({ source, small, className }: { source: McpInstallSource; small?: boolean; className?: string }) {
  const size = small ? 'h-[18px] gap-1 px-1.5 text-[11px] [&>svg]:size-[11px]' : undefined;
  if (source === 'manual') {
    return (
      <Badge variant="outline" className={cn(size, className)}>
        <Dot dot="warning" />
        <ShieldAlert strokeWidth={2} />
        {INSTALL_SOURCE_LABEL.manual}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={cn(size, className)}>
      {INSTALL_SOURCE_LABEL[source]}
    </Badge>
  );
}

/** Package icon: the manifest emoji, else the first letter in a square. */
export function McpIcon({ icon, name, size = 'md' }: { icon?: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-12 text-2xl rounded-xl' : size === 'sm' ? 'size-7 text-sm rounded-md' : 'size-10 text-lg rounded-lg';
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center border bg-muted font-semibold', box)}>
      {icon || (Array.from(name)[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** `Critical 0 · High 1 …` as small dot badges; Critical/High with a danger dot when > 0. */
export function ScanCounts({ summary, className }: { summary: ScanSummary | null | undefined; className?: string }) {
  if (!summary) return <span className="text-xs text-muted-foreground">스캔 결과 없음</span>;
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {SEVERITIES.map((k) => {
        const n = summary[k] ?? 0;
        const dot = n === 0 ? 'muted' : k === 'critical' || k === 'high' ? 'danger' : k === 'medium' ? 'warning' : 'muted';
        return (
          <Badge key={k} variant="outline" className={cn('tabular-nums', n === 0 && 'text-muted-foreground')}>
            <Dot dot={dot} />
            {SEVERITY_LABEL[k]} {n}
          </Badge>
        );
      })}
    </span>
  );
}
