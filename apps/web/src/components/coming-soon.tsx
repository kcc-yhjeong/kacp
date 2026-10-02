import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** A menu entry that is visible but not live yet in stage 2. */
export function ComingSoon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="link"
          aria-disabled="true"
          tabIndex={0}
          className={cn('cursor-not-allowed rounded-md px-2.5 py-1.5 text-muted-foreground/60 outline-none', className)}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>준비 중</TooltipContent>
    </Tooltip>
  );
}
