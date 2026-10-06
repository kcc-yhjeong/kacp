import { Lock, Search, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { appOrigin } from '@/lib/host';

interface MessagePageProps {
  host?: string;
  icon: LucideIcon;
  code: string;
  title: string;
  description: string;
  action?: { label: string; href: string };
  /** Extra block under the description (C-04 admin stop reason). */
  detail?: ReactNode;
}

/** C-04 layout: same frame, different copy. Uses plain links so it works outside a router. */
export function MessagePage({ host = location.host, icon: Icon, code, title, description, action, detail }: MessagePageProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-sm">
        <Logo href={`${appOrigin}/`} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">{host}</span>
      </div>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-[440px] max-w-full flex-col items-center gap-5 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-muted">
            <Icon className="size-8" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{code}</span>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
          </div>
          {detail}
          {action && (
            <Button asChild>
              <a href={action.href}>{action.label}</a>
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

export function NotFoundPage({ host }: { host?: string }) {
  return (
    <MessagePage
      host={host}
      icon={Search}
      code="404"
      title="페이지를 찾을 수 없어요"
      description="주소를 확인해 주세요. 앱 이름이 바뀌었을 수도 있어요."
      action={{ label: '홈으로', href: `${appOrigin}/` }}
    />
  );
}

export function ForbiddenPage({ host }: { host?: string }) {
  return (
    <MessagePage
      host={host}
      icon={Lock}
      code="403"
      title="이 팀 멤버만 볼 수 있어요"
      description="이 주소의 팀에 속해 있지 않아요. 필요하면 그 팀의 팀 관리자에게 요청하세요."
      action={{ label: '내 팀으로', href: `${appOrigin}/` }}
    />
  );
}
