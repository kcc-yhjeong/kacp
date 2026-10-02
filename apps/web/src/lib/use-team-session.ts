import type { TeamStatus } from '@kacp/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from './api';
import { loginUrl } from './host';
import { teamApi } from './queries';

const POLL_MS = 2_000;
const HEARTBEAT_MS = 60_000;

function handleAuthLoss(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) {
    location.href = loginUrl();
    return true;
  }
  return false;
}

/**
 * U-01 lifecycle: POST /session once, poll /status every 2 s until running or error,
 * re-request a start when a stop finishes, and heartbeat every 60 s while open.
 */
export function useTeamSession(team: string, enabled: boolean) {
  const [status, setStatus] = useState<TeamStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const inFlight = useRef(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    try {
      setStatus(await teamApi.startSession(team));
    } catch (err) {
      if (!handleAuthLoss(err)) setFailure(errorMessage(err));
    } finally {
      inFlight.current = false;
    }
  }, [team]);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void start();
  }, [enabled, start]);

  // Polling. `stopped` means a stop finished (or the container went idle): ask for a start again.
  useEffect(() => {
    if (!enabled || !status) return;
    const s = status.status;
    if (s === 'running' || s === 'error') return;
    if (s === 'stopped') {
      void start();
      return;
    }
    const id = setTimeout(async () => {
      try {
        setStatus(await teamApi.status(team));
      } catch (err) {
        if (!handleAuthLoss(err)) setPollTick((t) => t + 1);
      }
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [enabled, status, pollTick, start, team]);

  // Heartbeat keeps the team container from idling out. Sent even when the tab is hidden (01-screens U-01).
  const hasSession = status !== null;
  useEffect(() => {
    if (!enabled || !hasSession) return;
    const id = setInterval(() => {
      teamApi.heartbeat(team).catch(handleAuthLoss);
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [enabled, hasSession, team]);

  return { status, failure, retry: start };
}
