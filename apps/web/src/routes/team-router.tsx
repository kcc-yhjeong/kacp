import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { NotFoundPage } from '@/components/message-page';
import { AgentShellPage } from '@/pages/agent-shell';

// Routes for `{team}.{base}`: only `/` is the shell; `/claw/*` never reaches the SPA (Traefik).

export function createTeamRouter(team: string) {
  const rootRoute = createRootRoute({
    component: Outlet,
    notFoundComponent: () => <NotFoundPage />,
  });
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <AgentShellPage team={team} />,
  });
  return createRouter({ routeTree: rootRoute.addChildren([shellRoute]) });
}
