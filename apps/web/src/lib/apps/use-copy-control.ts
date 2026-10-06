import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { appApi, invalidateApp, type CopyAction } from './api';
import type { AppCopyKind } from './types';

const TARGET: Record<AppCopyKind, string> = { work: '작업본', public: '공개본' };

const DONE: Record<CopyAction, (target: string) => string> = {
  start: (t) => `${t}을 시작하고 있어요`,
  stop: (t) => `${t}을 멈췄어요`,
  restart: (t) => `${t}을 다시 시작하고 있어요`,
};

/** Start / stop / restart one copy (`POST /apps/{id}/{work|public}/{action}`), then refresh lists. */
export function useCopyControl(app: { id: string; team: string; slug: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<`${AppCopyKind}:${CopyAction}` | null>(null);

  const run = async (target: AppCopyKind, action: CopyAction): Promise<boolean> => {
    setBusy(`${target}:${action}`);
    try {
      await appApi.control(app.id, target, action);
      toast.success(`${app.slug} ${DONE[action](TARGET[target])}`);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
      void invalidateApp(qc, app);
    }
  };

  return { busy, run };
}
