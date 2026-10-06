import { useRouter } from '@tanstack/react-router';
import { Bell, Bot, Globe, Plug, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { appOrigin, currentHost } from '@/lib/host';
import { useMarkRead, useNotifications, useUnreadCount } from '@/lib/notifications/api';
import {
  notificationVisual,
  resolveNotificationLink,
  unreadBadge,
  type NotificationIcon,
  type NotificationItem,
} from '@/lib/notifications/logic';
import { cn } from '@/lib/utils';

const ICONS: Record<NotificationIcon, LucideIcon> = {
  globe: Globe,
  plug: Plug,
  alert: TriangleAlert,
  bot: Bot,
  shield: ShieldCheck,
  bell: Bell,
};

/** C-06: bell + unread badge in the C-00 header (app host and team host shell). */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const badge = unreadBadge(unread.data);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={badge ? `알림 ${badge}개 안 읽음` : '알림'}
        className="relative grid size-8 place-items-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent"
      >
        <Bell className="size-4" strokeWidth={1.75} />
        {badge && (
          <span className="absolute top-0.5 right-px h-4 min-w-4 rounded-md border-2 border-background bg-primary px-1 text-center text-[9.5px] leading-3 font-semibold text-primary-foreground tabular-nums">
            {badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] overflow-hidden">
        {open && <NotificationPanel onClose={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const list = useNotifications(true);
  const markRead = useMarkRead();
  const items = list.data?.items ?? [];
  const hasUnread = (list.data?.unread ?? 0) > 0 || items.some((n) => !n.readAt);

  const onAllRead = () => {
    markRead.mutate({ all: true }, { onError: (err) => toast.error(errorMessage(err)) });
  };

  const onItem = async (n: NotificationItem) => {
    const target = resolveNotificationLink(n.link, currentHost.hostClass.kind === 'app', appOrigin);
    if (!n.readAt) {
      try {
        // Wait so a full page navigation does not cancel the request.
        await markRead.mutateAsync({ ids: [n.id] });
      } catch {
        // Reading state is not worth blocking the navigation.
      }
    }
    if (target.kind === 'router') {
      onClose();
      router.history.push(target.path);
    } else if (target.kind === 'href') {
      window.location.href = target.href;
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b py-2.5 pr-3 pl-4">
        <span className="text-sm font-semibold">알림</span>
        <button
          type="button"
          onClick={onAllRead}
          disabled={!hasUnread || markRead.isPending}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          모두 읽음
        </button>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {list.isPending ? (
          <div className="flex flex-col" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5 pt-1">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <div role="alert" className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[13px] text-muted-foreground">
            알림을 불러오지 못했어요
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void list.refetch()}>
              다시 시도
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[13px] text-muted-foreground">
            <Bell className="size-5" strokeWidth={1.75} />새 알림이 없어요
          </div>
        ) : (
          <ul>
            {items.map((n) => (
              <li key={n.id} className="border-b last:border-b-0">
                <NotificationRow n={n} onClick={() => void onItem(n)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotificationRow({ n, onClick }: { n: NotificationItem; onClick: () => void }) {
  const v = notificationVisual(n.type);
  const Icon = ICONS[v.icon];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
        <Icon className={cn('size-4', v.danger && 'text-danger')} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('truncate text-[13.5px] leading-snug', !n.readAt && 'font-medium')} title={n.title}>
          {n.title}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{formatTime(n.createdAt)}</span>
      </span>
      {!n.readAt && <span aria-label="안 읽음" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}
