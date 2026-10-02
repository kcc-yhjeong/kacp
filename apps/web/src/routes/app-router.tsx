import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { ForbiddenPage, NotFoundPage } from '@/components/message-page';
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

const routeTree = rootRoute.addChildren([
  homeRoute,
  loginRoute,
  passwordSetupRoute,
  noTeamRoute,
  forbiddenRoute,
  notFoundRoute,
  profileRoute,
]);

export const appRouter = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter;
  }
}
