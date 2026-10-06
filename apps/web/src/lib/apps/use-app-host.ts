import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { loginUrl } from '@/lib/host';
import { appApi, appKeys } from './api';
import { stateOf } from './status';
import type { AppHostInfo } from './types';

const POLL_MS = 2_000;

function needsPoll(d: AppHostInfo | undefined): boolean {
  if (!d || !d.exists || d.status === null) return false;
  const s = stateOf(d.status, d.stopReason);
  return s === 'starting' || (s === 'sleeping' && d.canWake);
}

/**
 * C-04 "앱 깨우는 중" flow, shared by the app-host page and the U-02 preview panel:
 * `GET /app-hosts/{host}` → (asleep + canWake) `POST wake` once → poll every 2 s while starting.
 */
export function useAppHost(host: string, enabled = true) {
  const wakeSent = useRef(false);
  const [wakeError, setWakeError] = useState<unknown>(null);
  const query = useQuery({
    queryKey: appKeys.host(host),
    queryFn: () => appApi.host(host),
    enabled,
    staleTime: 0,
    refetchInterval: (q) => (needsPoll(q.state.data) ? POLL_MS : false),
  });
  const { data, refetch } = query;

  useEffect(() => {
    if (!enabled || !data || wakeSent.current || data.status === null) return;
    if (stateOf(data.status, data.stopReason) !== 'sleeping' || !data.canWake) return;
    wakeSent.current = true;
    appApi
      .wake(host)
      .then(() => void refetch())
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          location.href = loginUrl();
          return;
        }
        // 409: someone else already woke it or it changed state — just look again.
        if (err instanceof ApiError && err.status === 409) {
          void refetch();
          return;
        }
        setWakeError(err);
      });
  }, [data, enabled, host, refetch]);

  /** Wake again after an error, or after the copy was started by hand. */
  const retry = useCallback(() => {
    wakeSent.current = false;
    setWakeError(null);
    void refetch();
  }, [refetch]);

  return { query, info: data, wakeError, retry };
}
