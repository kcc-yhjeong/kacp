import { Building2, Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDepartments } from '@/lib/admin/api';
import { filterTree, findNode, flattenTree, isSelfOrDescendant, pathTo, searchTree } from '@/lib/admin/tree';
import type { DepartmentNode } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

interface DepartmentSelectProps {
  value: string | null;
  onChange: (id: string | null, node: DepartmentNode | null) => void;
  /** Shows the "하위 부서 포함" checkbox when given. */
  includeDescendants?: boolean;
  onIncludeDescendantsChange?: (v: boolean) => void;
  /** Adds an "전체 부서" option (filters). */
  allowClear?: boolean;
  placeholder?: string;
  /** Hide this department and everything below it (move targets). */
  excludeSubtreeOf?: string;
  /** Filter look (dashed outline, compact) vs form field. */
  variant?: 'field' | 'filter';
  className?: string;
  id?: string;
  disabled?: boolean;
  /** Custom trigger element (e.g. a toolbar button). */
  trigger?: ReactNode;
}

/** DepartmentSelect (02 §5): Popover + search + tree, optional "하위 부서 포함". Active departments only. */
export function DepartmentSelect({
  value,
  onChange,
  includeDescendants,
  onIncludeDescendantsChange,
  allowClear = false,
  placeholder = '부서 선택',
  excludeSubtreeOf,
  variant = 'field',
  className,
  id,
  disabled,
  trigger,
}: DepartmentSelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const departments = useDepartments(false);

  const roots = useMemo(() => {
    const all = departments.data ?? [];
    const exclude = excludeSubtreeOf ? findNode(all, excludeSubtreeOf) : null;
    return filterTree(all, (n) => n.status === 'active' && !(exclude && isSelfOrDescendant(exclude, n.id)));
  }, [departments.data, excludeSubtreeOf]);

  const selectedPath = value ? pathTo(departments.data ?? [], value).map((n) => n.name) : [];
  const search = useMemo(() => searchTree(roots, q), [roots, q]);
  const searching = q.trim().length > 0;
  const rows = useMemo(() => {
    if (!searching) return flattenTree(roots, expanded);
    const visible = new Set([...search.expand]);
    return flattenTree(roots, visible).filter((r) => search.matches.has(r.node.id) || search.expand.has(r.node.id));
  }, [roots, expanded, searching, search]);

  const toggle = (nodeId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && value) {
      // Open the tree down to the current selection.
      const path = pathTo(roots, value);
      setExpanded((prev) => new Set([...prev, ...path.slice(0, -1).map((n) => n.id)]));
    }
    if (!next) setQ('');
  };

  const label =
    selectedPath.length === 0
      ? placeholder
      : variant === 'filter'
        ? selectedPath[selectedPath.length - 1]
        : selectedPath.slice(-2).join(' › ');

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <button
            type="button"
            id={id}
            className={cn(
              'inline-flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
              variant === 'field'
                ? 'h-9 w-full border border-input bg-background px-3 text-left'
                : 'h-8 border border-dashed bg-background px-2.5 text-[13px] hover:bg-accent',
              className,
            )}
          >
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className={cn('min-w-0 flex-1 truncate', selectedPath.length === 0 && 'text-muted-foreground')}>
              {variant === 'filter' && selectedPath.length > 0 ? (
                <>
                  <span className="text-muted-foreground">부서 </span>
                  {label}
                  {includeDescendants && <span className="text-muted-foreground"> +하위</span>}
                </>
              ) : (
                label
              )}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="부서 찾기"
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {allowClear && (
            <Row
              label="전체 부서"
              level={1}
              selected={value === null}
              onClick={() => {
                onChange(null, null);
                setOpen(false);
              }}
            />
          )}
          {departments.isPending && <div className="px-2 py-1.5 text-sm text-muted-foreground">불러오는 중이에요</div>}
          {!departments.isPending && rows.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{searching ? '찾는 부서가 없어요' : '아직 부서가 없어요'}</div>
          )}
          {rows.map(({ node, level, hasChildren }) => (
            <Row
              key={node.id}
              label={node.name}
              level={level}
              count={node.totalMemberCount}
              hasChildren={hasChildren && !searching}
              open={expanded.has(node.id)}
              onToggle={() => toggle(node.id)}
              highlight={search.matches.has(node.id)}
              selected={value === node.id}
              onClick={() => {
                onChange(node.id, node);
                setOpen(false);
              }}
            />
          ))}
        </div>
        {onIncludeDescendantsChange && (
          <label className="flex cursor-pointer items-center gap-2 border-t px-3 py-2 text-[13px]">
            <Checkbox checked={!!includeDescendants} onCheckedChange={(c) => onIncludeDescendantsChange(c === true)} />
            하위 부서 포함
          </label>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Row(props: {
  label: string;
  level: number;
  count?: number;
  hasChildren?: boolean;
  open?: boolean;
  onToggle?: () => void;
  highlight?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={props.selected}
      onClick={props.onClick}
      className="flex h-[30px] cursor-pointer items-center gap-1 rounded-md pr-2 text-[13px] hover:bg-accent"
      style={{ paddingLeft: 4 + (props.level - 1) * 12 }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={props.open ? '접기' : '펼치기'}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle?.();
        }}
        className={cn('grid size-5 place-items-center text-muted-foreground', !props.hasChildren && 'invisible')}
      >
        {props.open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      <span className={cn('min-w-0 flex-1 truncate', props.highlight && 'rounded-sm bg-border px-0.5')}>{props.label}</span>
      {props.count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{props.count}</span>}
      {props.selected ? <Check className="size-3.5" /> : <span className="w-3.5" />}
    </div>
  );
}
