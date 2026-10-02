import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/admin/page';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { adminApi, adminKeys } from '@/lib/admin/api';
import type { UserRef } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface UserPickerProps {
  onPick: (user: UserRef) => void;
  /** Ids already chosen — shown disabled. */
  excludeIds?: ReadonlySet<string>;
  placeholder?: string;
  trigger?: ReactNode;
  className?: string;
  /** Keep the popover open after a pick (multi-add). */
  keepOpen?: boolean;
}

/** UserPicker (02 §5): Popover + search. Row = avatar + name + grey department + email. */
export function UserPicker({ onPick, excludeIds, placeholder = '사용자 검색', trigger, className, keepOpen = false }: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const results = useQuery({
    queryKey: adminKeys.userSearch(dq),
    queryFn: async () => (await adminApi.searchUsers(dq)).items,
    enabled: open && dq.length > 0,
    staleTime: 30_000,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={cn(
              'inline-flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              className,
            )}
          >
            <Search className="size-3.5" />
            <span className="flex-1 truncate">{placeholder}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 또는 이메일"
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {dq.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">이름이나 이메일을 입력하세요</div>}
          {dq.length > 0 && results.isPending && <div className="px-2 py-1.5 text-sm text-muted-foreground">찾는 중이에요</div>}
          {results.data?.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">일치하는 사용자가 없어요</div>}
          {results.data?.map((u) => {
            const taken = excludeIds?.has(u.id) ?? false;
            return (
              <button
                key={u.id}
                type="button"
                disabled={taken}
                onClick={() => {
                  onPick(u);
                  if (!keepOpen) setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Avatar name={u.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    {u.name}
                    {u.departmentName && <span className="text-xs text-muted-foreground"> · {u.departmentName}</span>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                </span>
                {taken ? (
                  <span className="text-xs text-muted-foreground">추가됨</span>
                ) : (
                  <UserPlus className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Chip for a chosen user with a remove button. */
export function UserChip({ user, onRemove }: { user: Pick<UserRef, 'name' | 'departmentName'>; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border pr-1 pl-1.5 text-[13px]">
      <Avatar name={user.name} className="size-5 text-[10px]" />
      {user.name}
      {user.departmentName && <span className="text-xs text-muted-foreground">· {user.departmentName}</span>}
      {onRemove && (
        <button type="button" aria-label={`${user.name} 빼기`} onClick={onRemove} className="rounded px-1 text-muted-foreground hover:text-foreground">
          ×
        </button>
      )}
    </span>
  );
}
