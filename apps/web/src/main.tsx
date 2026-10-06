import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotFoundPage } from '@/components/message-page';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { currentHost } from '@/lib/host';
import { createQueryClient } from '@/lib/queries';
import { AppHost, HostResolver } from '@/pages/host-resolver';
import { appRouter } from '@/routes/app-router';
import './index.css';

const queryClient = createQueryClient();

/** Pick the screen set from the hostname (01-screens.md §2). */
function hostApp(): ReactNode {
  const hc = currentHost.hostClass;
  switch (hc.kind) {
    case 'app':
      return <RouterProvider router={appRouter} />;
    case 'name':
      return <HostResolver label={hc.name} team={hc.name} />;
    case 'work':
      // `{slug}--{team}` is always a work copy: no `/names` lookup (C-04 app flow).
      return <AppHost />;
    default:
      return <NotFoundPage />;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        {hostApp()}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
