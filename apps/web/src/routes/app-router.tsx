import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Navigate, Outlet } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { ForbiddenPage, NotFoundPage } from '@/components/message-page';
import { PageLoader } from '@/components/page-loader';
import { currentHost } from '@/lib/host';
import { HomePage } from '@/pages/home';
import { LoginPage } from '@/pages/login';
import { NoTeamPage } from '@/pages/no-team';
import { PasswordSetupPage } from '@/pages/password-setup';
import { ProfilePage } from '@/pages/profile';

// Routes for `app.{base}` (05-urls-and-storage.md §4, stage 2 subset).

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => <NotFoundPage />,
});

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search.next === 'string' ? { next: search.next } : {},
  component: function LoginRoute() {
    const { next } = loginRoute.useSearch();
    return <LoginPage next={next} />;
  },
});

const passwordSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/password/setup',
  component: PasswordSetupPage,
});

const noTeamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/no-team', component: NoTeamPage });

const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forbidden',
  validateSearch: (search: Record<string, unknown>): { team?: string } =>
    typeof search.team === 'string' ? { team: search.team } : {},
  component: function ForbiddenRoute() {
    const { team } = forbiddenRoute.useSearch();
    // Show the address only, not the team's display name (C-04 403).
    const host = team && currentHost.base ? `${team}.${currentHost.base}` : undefined;
    return <ForbiddenPage host={host} />;
  },
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/not-found',
  component: () => <NotFoundPage />,
});

const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/me', component: ProfilePage });

// ── /t/{team}/drive/* (U-04 · U-05 · U-06). One splat route; the page parses `{me|shared}/{...path}` or `trash`.
// The drive code is its own lazy chunk.

const DrivePage = lazy(() => import('@/pages/drive/drive-page').then((m) => ({ default: m.DrivePage })));

const driveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$team/drive/$',
  component: function DriveRoute() {
    const { team, _splat } = driveRoute.useParams();
    return (
      <Suspense fallback={<PageLoader />}>
        <DrivePage team={team} splat={_splat ?? ''} />
      </Suspense>
    );
  },
});

const driveRootRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$team/drive',
  component: function DriveRootRoute() {
    const { team } = driveRootRoute.useParams();
    return <Navigate to="/t/$team/drive/$" params={{ team, _splat: 'shared' }} replace />;
  },
});

// ── /admin (A-*). Every screen is its own lazy chunk so the employee shell does not load admin code.

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: lazyRouteComponent(() => import('@/components/admin/admin-layout'), 'AdminLayout'),
});

const adminChild = <TPath extends string>(path: TPath, load: () => Promise<Record<string, unknown>>, name: string) =>
  createRoute({ getParentRoute: () => adminRoute, path, component: lazyRouteComponent(load as never, name as never) });

const adminDashboardRoute = adminChild('/', () => import('@/pages/admin/dashboard'), 'DashboardPage');
const adminOrgRoute = adminChild('/org', () => import('@/pages/admin/org'), 'OrgPage');
const adminImportRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/import',
  validateSearch: (search: Record<string, unknown>): { kind?: 'departments' | 'users' } =>
    search.kind === 'users' || search.kind === 'departments' ? { kind: search.kind } : {},
  component: lazyRouteComponent(() => import('@/pages/admin/import'), 'ImportPage'),
});
const adminUsersRoute = adminChild('/users', () => import('@/pages/admin/users'), 'UsersPage');
const adminUserNewRoute = adminChild('/users/new', () => import('@/pages/admin/user-new'), 'UserNewPage');
const adminUserRoute = adminChild('/users/$userId', () => import('@/pages/admin/user-detail'), 'UserDetailPage');
const adminTeamsRoute = adminChild('/teams', () => import('@/pages/admin/teams'), 'TeamsPage');
const adminTeamRoute = adminChild('/teams/$team', () => import('@/pages/admin/team-detail'), 'TeamDetailPage');
const adminAgentsRoute = adminChild('/agents', () => import('@/pages/admin/agents'), 'AgentsPage');
const adminAgentNewRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/agents/new',
  validateSearch: (search: Record<string, unknown>): { from?: string } =>
    typeof search.from === 'string' ? { from: search.from } : {},
  component: lazyRouteComponent(() => import('@/pages/admin/agent-editor'), 'AgentNewPage'),
});
const adminAgentRoute = adminChild('/agents/$templateId', () => import('@/pages/admin/agent-editor'), 'AgentEditPage');
const adminSettingsRoute = adminChild('/settings', () => import('@/pages/admin/settings'), 'SettingsPage');
const adminAuditRoute = adminChild('/audit', () => import('@/pages/admin/audit'), 'AuditPage');

const routeTree = rootRoute.addChildren([
  adminRoute.addChildren([
    adminDashboardRoute,
    adminOrgRoute,
    adminImportRoute,
    adminUsersRoute,
    adminUserNewRoute,
    adminUserRoute,
    adminTeamsRoute,
    adminTeamRoute,
    adminAgentsRoute,
    adminAgentNewRoute,
    adminAgentRoute,
    adminSettingsRoute,
    adminAuditRoute,
  ]),
  homeRoute,
  loginRoute,
  passwordSetupRoute,
  noTeamRoute,
  forbiddenRoute,
  notFoundRoute,
  profileRoute,
  driveRootRoute,
  driveRoute,
]);

export const appRouter = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter;
  }
}
