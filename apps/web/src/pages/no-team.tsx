import { Link, Navigate } from '@tanstack/react-router';
import { MessagesSquare, Store } from 'lucide-react';
import { toast } from 'sonner';
import { AppHeader } from '@/components/app-header';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
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
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold">아직 소속된 팀이 없어요</h1>
            <p className="text-sm text-muted-foreground">관리자에게 팀 배정을 요청하세요</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/community">
                <MessagesSquare strokeWidth={1.75} />
                커뮤니티 둘러보기
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/market">
                <Store strokeWidth={1.75} />
                MCP 마켓 둘러보기
              </Link>
            </Button>
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
