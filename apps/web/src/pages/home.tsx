import { Navigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { PageLoader } from '@/components/page-loader';
import { teamRoot } from '@/lib/host';
import { useMe, useMyTeams } from '@/lib/queries';

/** `/` on the app host: role-based routing after login (C-01). 401 is handled globally (→ /login). */
export function HomePage() {
  const me = useMe();
  const ready = !!me.data && !me.data.mustChangePassword;
  const teams = useMyTeams(ready);
  const first = teams.data?.[0];

  useEffect(() => {
    if (first) location.replace(teamRoot(first.url));
  }, [first]);

  if (me.data?.mustChangePassword) return <Navigate to="/password/setup" />;
  if (teams.data && teams.data.length === 0) return <Navigate to="/no-team" />;
  return <PageLoader />;
}
