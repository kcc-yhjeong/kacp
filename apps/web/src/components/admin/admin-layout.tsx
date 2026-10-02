import { Link, Navigate, Outlet } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { ProfileMenu } from '@/components/app-header';
import { LogoMark } from '@/components/logo';
import { MessagePage } from '@/components/message-page';
import { PageLoader } from '@/components/page-loader';
import { Separator } from '@/components/ui/separator';
import { appOrigin } from '@/lib/host';
import { useMe } from '@/lib/queries';

const COLLAPSE_KEY = 'kacp.admin.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** `/admin` shell: C-00 header in admin mode ("관리자" + profile) and AdminSidebar. Platform admins only. */
export function AdminLayout() {
  const me = useMe();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  if (!me.data) return <PageLoader />;
  if (me.data.mustChangePassword) return <Navigate to="/password/setup" />;
  if (me.data.platformRole !== 'admin') {
    return (
      <MessagePage
        icon={ShieldAlert}
        code="403"
        title="플랫폼 관리자만 볼 수 있어요"
        description="관리자 화면은 플랫폼 관리자 계정으로만 열 수 있어요. 필요하면 플랫폼 관리자에게 요청하세요."
        action={{ label: '내 팀으로', href: `${appOrigin}/` }}
      />
    );
  }

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        // Per-viewer convenience only.
      }
      return !c;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-background pr-3 pl-4 text-sm">
        <div className="flex items-center gap-3">
          <Link to="/admin" className="flex items-center gap-2">
            <LogoMark />
            <span className="font-semibold tracking-tight">KACP</span>
          </Link>
          <span className="flex h-5 items-center rounded-md border px-1.5 text-[11.5px] font-medium">관리자</span>
        </div>
        <div className="flex items-center gap-1">
          <a href={`${appOrigin}/`} className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
            사원 화면으로
          </a>
          <Separator orientation="vertical" className="mx-2" />
          <ProfileMenu admin />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <AdminSidebar collapsed={collapsed} onToggle={toggle} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
