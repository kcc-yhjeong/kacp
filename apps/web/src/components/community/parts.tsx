import type { MyTeam } from '@kacp/shared';
import { Link } from '@tanstack/react-router';
import { AppWindow, Check, ExternalLink, Plug, Users } from 'lucide-react';
import { useState } from 'react';
import { PublicBadge } from '@/components/apps/badges';
import { McpIcon } from '@/components/mcp/badges';
import { InstallDialog } from '@/components/mcp/install-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryLabel } from '@/lib/community/logic';
import type { AttachedApp } from '@/lib/community/types';
import { hostOf } from '@/lib/host';
import { useMcpPackage } from '@/lib/mcp/api';
import type { McpPackageSummary } from '@/lib/mcp/types';
import { cn } from '@/lib/utils';

const SMALL = 'h-[18px] gap-1 px-1.5 text-[11px] [&>svg]:size-[11px]';

/** Category badge: 공지 is black-filled, the rest outline (no semantic color). */
export function CategoryBadge({ category, small, className }: { category: string; small?: boolean; className?: string }) {
  return (
    <Badge variant={category === 'notice' ? 'default' : 'outline'} className={cn(small && SMALL, category !== 'notice' && 'text-muted-foreground', className)}>
      {categoryLabel(category)}
    </Badge>
  );
}

export function AttachmentBadges({ hasPackage, hasApp }: { hasPackage: boolean; hasApp: boolean }) {
  return (
    <>
      {hasPackage && (
        <Badge variant="secondary" className={SMALL}>
          <Plug strokeWidth={2} />
          MCP
        </Badge>
      )}
      {hasApp && (
        <Badge variant="secondary" className={SMALL}>
          <AppWindow strokeWidth={2} />
          앱
        </Badge>
      )}
    </>
  );
}

/**
 * Attached MCP: market card look + "설치" (U-10 install modal) for those who can install,
 * "팀 관리자에게 설치를 요청하세요" for the rest, "자세히" → U-10.
 */
export function AttachedPackageCard({ pkg, team, teams }: { pkg: McpPackageSummary; team: MyTeam | undefined; teams: MyTeam[] }) {
  const [open, setOpen] = useState(false);
  const detail = useMcpPackage(pkg.name, team?.name);
  const d = detail.data;
  const installedHere = (d?.installedInTeam ?? pkg.installedInTeam) && !!team;
  const targets = d ? d.canInstallTeams.filter((t) => !(installedHere && t === team?.name)) : [];
  const canInstall = !!d && !d.isPlatform && d.status === 'active' && targets.length > 0;
  const search = team ? { team: team.name } : {};

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <McpIcon icon={pkg.icon} name={pkg.displayName || pkg.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{pkg.displayName || pkg.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {pkg.name}
            {pkg.latestVersion ? ` · v${pkg.latestVersion}` : ''}
          </span>
        </div>
        {installedHere && team && (
          <Badge variant="default" className={SMALL}>
            <Check strokeWidth={2.5} />
            설치됨
          </Badge>
        )}
      </div>
      {pkg.summary && <p className="line-clamp-2 text-[13px] text-pretty text-muted-foreground">{pkg.summary}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate">{pkg.isPlatform ? '플랫폼' : (pkg.owner?.name ?? '—')}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Users className="size-3" strokeWidth={1.75} />
          {pkg.installCount.toLocaleString()}팀
        </span>
        <span aria-hidden>·</span>
        <span>{pkg.category}</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {detail.isPending ? (
          <Skeleton className="h-8 w-20" />
        ) : pkg.isPlatform ? (
          <span className="mr-auto text-[13px] text-muted-foreground">모든 팀에 기본 설치돼요</span>
        ) : d?.status === 'suspended' ? (
          <span className="mr-auto text-[13px] text-muted-foreground">게시가 중단돼 새로 설치할 수 없어요</span>
        ) : canInstall ? null : installedHere ? null : (
          <span className="mr-auto text-[13px] text-muted-foreground">팀 관리자에게 설치를 요청하세요</span>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link to="/market/$pkg" params={{ pkg: pkg.name }} search={search}>
            자세히
          </Link>
        </Button>
        {canInstall && (
          <Button size="sm" variant={installedHere ? 'outline' : 'default'} onClick={() => setOpen(true)}>
            {installedHere ? '다른 팀에 설치' : '설치'}
          </Button>
        )}
      </div>
      {canInstall && d && (
        <InstallDialog
          pkg={d}
          open={open}
          onOpenChange={setOpen}
          teams={teams}
          preferredTeam={installedHere ? targets[0] : team?.name}
        />
      )}
    </div>
  );
}

/** Attached public app: name, team, version, "열기" in a new tab. Gone apps say so. */
export function AttachedAppCard({ app }: { app: AttachedApp }) {
  if (!app.available || !app.url || !app.name) {
    return (
      <div className="flex items-center gap-3 rounded-xl border p-5 text-[13px] text-muted-foreground">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
          <AppWindow className="size-5" strokeWidth={1.75} />
        </span>
        공개가 중지된 앱이에요
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
        <AppWindow className="size-5" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 font-medium">
          <span className="truncate">{app.name}</span>
          <PublicBadge version={app.version} small />
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {hostOf(app.url)}
          {app.team ? ` · ${app.team}` : ''}
        </span>
      </div>
      <Button size="sm" asChild>
        <a href={app.url} target="_blank" rel="noopener noreferrer">
          열기
          <ExternalLink strokeWidth={1.75} />
        </a>
      </Button>
    </div>
  );
}
