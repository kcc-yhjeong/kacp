import { Loader2 } from 'lucide-react';

export function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center" aria-busy="true">
      <Loader2 className="size-6 animate-spin text-muted-foreground" strokeWidth={1.75} />
    </div>
  );
}
