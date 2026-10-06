import { Loader2 } from 'lucide-react';
import { wakeDescription } from '@/lib/apps/status';
import { cn } from '@/lib/utils';

/** "앱을 깨우고 있어요" + indeterminate bar (C-04 C4a/C4g, U-02 2c). */
export function WakingView({
  reason,
  footnote = '켜지면 자동으로 새로고침돼요',
  className,
}: {
  reason: 'idle' | 'limit' | null;
  footnote?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex w-[380px] max-w-full flex-col items-center gap-5 text-center', className)} aria-live="polite">
      <Loader2 className="size-8 animate-spin" strokeWidth={1.75} />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">앱을 깨우고 있어요</h2>
        <p className="text-sm text-pretty text-muted-foreground">{wakeDescription(reason)}</p>
      </div>
      <div className="h-1.5 w-[280px] max-w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="앱 시작 중">
        <div className="h-full w-2/5 animate-indeterminate rounded-full bg-primary" />
      </div>
      <span className="text-xs text-muted-foreground">{footnote}</span>
    </div>
  );
}
