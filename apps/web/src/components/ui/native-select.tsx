import { ChevronDown } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Styled native select (outline look, like shadcn NativeSelect). */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <select
        data-slot="native-select"
        className="h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-background py-1 pr-8 pl-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
