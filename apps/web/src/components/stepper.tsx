import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StepState = 'done' | 'current' | 'todo' | 'failed';

export interface Step {
  label: string;
  state: StepState;
  sub?: string;
}

/** Stepper (02-design-system.md §5): done = black + check, current = black ring, todo = border, failed = danger X. */
export function Stepper({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn('flex w-full items-start', className)}>
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        return (
          <li key={s.label} className="relative flex min-w-0 flex-1 flex-col items-center gap-2" aria-current={s.state === 'current' ? 'step' : undefined}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn('absolute top-[11px] right-1/2 z-0 h-0.5 w-full', prev?.state === 'done' ? 'bg-primary' : 'bg-border')}
              />
            )}
            <StepDot state={s.state} />
            <span className="flex flex-col items-center gap-0.5 text-center">
              <span
                className={cn(
                  'text-[12.5px] whitespace-nowrap',
                  s.state === 'current' || s.state === 'failed' ? 'font-medium' : '',
                  s.state === 'todo' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {s.label}
              </span>
              {s.sub && <span className="text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{s.sub}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepDot({ state }: { state: StepState }) {
  const base = 'relative z-10 grid size-6 place-items-center rounded-full';
  switch (state) {
    case 'done':
      return (
        <span className={cn(base, 'bg-primary text-primary-foreground')}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      );
    case 'current':
      return (
        <span className={cn(base, 'border-2 border-primary bg-background')}>
          <span className="size-2 rounded-full bg-primary" />
        </span>
      );
    case 'failed':
      return (
        <span className={cn(base, 'bg-danger text-white')}>
          <X className="size-3.5" strokeWidth={3} />
        </span>
      );
    default:
      return <span className={cn(base, 'border-2 border-border bg-background')} />;
  }
}
