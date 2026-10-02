import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { collapsePath } from '@/lib/admin/tree';
import { cn } from '@/lib/utils';

/** Department path: `›` separators, parents muted, last foreground. > 5 levels → first › … › last (… opens a menu). */
export function PathBreadcrumb({
  names,
  className,
  onSelectIndex,
}: {
  names: string[];
  className?: string;
  /** Click on a level (index into `names`). */
  onSelectIndex?: (index: number) => void;
}) {
  const crumbs = collapsePath(names);
  const last = names.length - 1;
  return (
    <nav aria-label="부서 경로" className={cn('flex min-w-0 flex-wrap items-center gap-1 text-[13px]', className)}>
      {crumbs.map((c, i) => (
        <Fragment key={c.kind === 'item' ? `i${c.index}` : 'ellipsis'}>
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />}
          {c.kind === 'item' ? (
            onSelectIndex && c.index !== last ? (
              <button type="button" className="truncate text-muted-foreground hover:text-foreground" onClick={() => onSelectIndex(c.index)}>
                {c.name}
              </button>
            ) : (
              <span className={cn('truncate', c.index === last ? 'text-foreground' : 'text-muted-foreground')}>{c.name}</span>
            )
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="가운데 경로 펼치기"
                className="rounded px-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                …
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {c.hidden.map((name, k) => (
                  <DropdownMenuItem
                    key={`${name}-${k}`}
                    onSelect={() => onSelectIndex?.(k + 1)}
                    style={{ paddingLeft: 8 + k * 12 }}
                  >
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
