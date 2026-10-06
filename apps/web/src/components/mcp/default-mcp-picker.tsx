import { Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMcpPackages } from '@/lib/mcp/api';
import { cn } from '@/lib/utils';
import { McpIcon } from './badges';

/** A-06 기본 MCP: multi-select among published packages (`GET /mcp/packages`), stored as package names. */
export function DefaultMcpPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const pkgs = useMcpPackages({ sort: 'popular' });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const options = (pkgs.data ?? []).filter((p) => !p.isPlatform && p.status === 'active');
  const known = new Map(options.map((p) => [p.name, p]));
  const needle = q.trim().toLowerCase();
  const shown = options.filter((p) => !needle || p.name.includes(needle) || p.displayName.toLowerCase().includes(needle));
  const toggle = (name: string, on: boolean) => onChange(on ? [...value.filter((n) => n !== name), name] : value.filter((n) => n !== name));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((n) => {
        const p = known.get(n);
        return (
          <span
            key={n}
            className={cn('inline-flex h-7 items-center gap-1.5 rounded-md bg-secondary pr-1 pl-2 text-xs', !p && pkgs.data && 'text-muted-foreground')}
            title={!p && pkgs.data ? '게시 중이 아닌 MCP예요. 할당해도 설치되지 않아요' : undefined}
          >
            <span className="font-mono">{n}</span>
            {!p && pkgs.data && <span>· 게시 안 됨</span>}
            <button type="button" aria-label={`${n} 빼기`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => toggle(n, false)}>
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setQ('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Plus className="size-3.5" />
            추가
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px]">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="게시된 MCP 검색"
              className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {pkgs.isPending && <div className="px-2 py-1.5 text-sm text-muted-foreground">불러오는 중이에요</div>}
            {pkgs.isError && <div className="px-2 py-1.5 text-sm text-muted-foreground">MCP 목록을 불러오지 못했어요</div>}
            {pkgs.data && shown.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">게시된 MCP가 없어요</div>}
            {shown.map((p) => (
              <label key={p.name} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent">
                <Checkbox checked={value.includes(p.name)} onCheckedChange={(c) => toggle(p.name, c === true)} />
                <McpIcon icon={p.icon} name={p.displayName || p.name} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{p.displayName || p.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {p.name}
                    {p.latestVersion ? ` · v${p.latestVersion}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
