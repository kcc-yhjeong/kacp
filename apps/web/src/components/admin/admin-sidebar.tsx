import { Link, useRouterState } from '@tanstack/react-router';
import {
  BadgeCheck,
  Building2,
  History,
  LayoutDashboard,
  PanelLeft,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Fragment } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type AdminPath = '/admin' | '/admin/org' | '/admin/users' | '/admin/teams' | '/admin/agents' | '/admin/settings' | '/admin/audit';

interface Item {
  label: string;
  icon: LucideIcon;
  /** Missing = not live yet ("준비 중"). */
  to?: AdminPath;
  /** Extra path prefixes that count as this item (A-13 belongs to 조직). */
  also?: string[];
}

// Groups per 01-screens.md §5. Dashboard alone on top.
const GROUPS: { label: string | null; items: Item[] }[] = [
  { label: null, items: [{ label: '대시보드', icon: LayoutDashboard, to: '/admin' }] },
  {
    label: '사람',
    items: [
      { label: '조직', icon: Building2, to: '/admin/org', also: ['/admin/import'] },
      { label: '사용자', icon: User, to: '/admin/users' },
    ],
  },
  {
    label: '팀과 에이전트',
    items: [
      { label: '팀', icon: Users, to: '/admin/teams' },
      { label: '에이전트 템플릿', icon: Sparkles, to: '/admin/agents' },
    ],
  },
  {
    label: '심사·승인',
    items: [
      { label: 'MCP 심사', icon: ShieldCheck },
      { label: '배포 승인', icon: BadgeCheck },
    ],
  },
  {
    label: '운영',
    items: [
      { label: 'MCP 관리', icon: Plug },
      { label: '플랫폼 설정', icon: Settings, to: '/admin/settings' },
      { label: '활동 기록', icon: History, to: '/admin/audit' },
    ],
  },
];

function isActive(pathname: string, item: Item): boolean {
  if (!item.to) return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  if (item.to === '/admin') return p === '/admin';
  return [item.to, ...(item.also ?? [])].some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** AdminSidebar (02 §5): 16rem, collapses to 3rem icons. */
export function AdminSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r bg-sidebar text-[13.5px] text-sidebar-foreground transition-[width]',
        collapsed ? 'w-12 items-center' : 'w-64',
      )}
    >
      <nav aria-label="관리자 메뉴" className={cn('flex flex-1 flex-col gap-px overflow-y-auto py-3', collapsed ? 'px-0' : 'px-2')}>
        {GROUPS.map((g, gi) => (
          <Fragment key={g.label ?? gi}>
            {g.label &&
              (collapsed ? (
                <span aria-hidden className="mx-auto my-2 h-px w-5 bg-sidebar-border" />
              ) : (
                <span className="px-2 pt-3 pb-1.5 text-[11.5px] text-muted-foreground">{g.label}</span>
              ))}
            {g.items.map((item) => (
              <SidebarItem key={item.label} item={item} active={isActive(pathname, item)} collapsed={collapsed} />
            ))}
          </Fragment>
        ))}
      </nav>
      <div className={cn('border-t py-2', collapsed ? 'px-0' : 'px-2')}>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className={cn(
            'flex h-8 items-center gap-2.5 rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
            collapsed ? 'mx-auto w-8 justify-center' : 'w-full px-2',
          )}
        >
          <PanelLeft className="size-4" strokeWidth={1.75} />
          {!collapsed && <span>접기</span>}
        </button>
      </div>
    </aside>
  );
}

function SidebarItem({ item, active, collapsed }: { item: Item; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  const cls = cn(
    'flex h-8 items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    collapsed ? 'mx-auto w-8 justify-center' : 'px-2',
    active ? 'bg-sidebar-accent font-medium text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent',
  );
  const iconEl = <Icon className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} strokeWidth={1.75} />;

  if (!item.to) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="link"
            aria-disabled="true"
            tabIndex={0}
            className={cn(cls, 'cursor-not-allowed text-muted-foreground/60 hover:bg-transparent')}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            {!collapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                <span className="text-[11px]">준비 중</span>
              </>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{collapsed ? `${item.label} · 준비 중` : '준비 중'}</TooltipContent>
      </Tooltip>
    );
  }

  const link = (
    <Link to={item.to} className={cls} aria-current={active ? 'page' : undefined}>
      {iconEl}
      {!collapsed && <span className="flex-1">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
