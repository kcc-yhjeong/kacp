import { Navigate } from '@tanstack/react-router';
import { MessagesSquare, Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { AppHeader } from '@/components/app-header';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { logoutAndLeave, useMe } from '@/lib/queries';

/** C-03 no team. Header shows the company scope only. */
export function NoTeamPage() {
  const me = useMe();
  if (!me.data) return <PageLoader />;
  if (me.data.mustChangePassword) return <Navigate to="/password/setup" />;

  const onLogout = async () => {
    try {
      await logoutAndLeave();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <AppHeader variant="company" />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-[440px] max-w-full flex-col items-center gap-5 text-center">
          <div className="grid h-[120px] w-[160px] place-items-center rounded-xl border-[1.5px] border-dashed border-chart-4 font-mono text-[11px] text-muted-foreground">
            일러스트 자리
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold">아직 소속된 팀이 없어요</h1>
            <p className="text-sm text-muted-foreground">관리자에게 팀 배정을 요청하세요</p>
          </div>
          <div className="flex gap-2">
            <SoonButton icon={<MessagesSquare strokeWidth={1.75} />} label="커뮤니티 둘러보기" />
            <SoonButton icon={<Store strokeWidth={1.75} />} label="MCP 마켓 둘러보기" />
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            로그아웃
          </button>
        </div>
      </main>
    </div>
  );
}

function SoonButton({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <Button variant="outline" disabled>
            {icon}
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>준비 중</TooltipContent>
    </Tooltip>
  );
}
