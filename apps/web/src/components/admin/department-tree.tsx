import { Ban, Building2, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ArchivedBadge } from '@/components/admin/badges';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DROP_PROBLEM_MESSAGE, dropProblem, flattenTree, type DropProblem } from '@/lib/admin/tree';
import type { DepartmentNode } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

interface DepartmentTreeProps {
  roots: DepartmentNode[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (node: DepartmentNode) => void;
  /** Search hits to highlight. */
  matches?: ReadonlySet<string>;
  /** Called after a valid drop (null = top level). */
  onMove?: (dragId: string, targetId: string | null) => void;
}

const ROOT = '__root__';

/** DepartmentTree (A-12): 30px rows, 12px indent per level, counts incl. descendants, drag to move. */
export function DepartmentTree({ roots, expanded, onToggle, selectedId, onSelect, matches, onMove }: DepartmentTreeProps) {
  const rows = flattenTree(roots, expanded);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; problem: DropProblem | null } | null>(null);

  const problemFor = (targetId: string) =>
    dragId ? dropProblem(roots, dragId, targetId === ROOT ? null : targetId) : null;

  const onDragOver = (e: DragEvent, targetId: string) => {
    if (!dragId) return;
    e.preventDefault();
    const problem = problemFor(targetId);
    e.dataTransfer.dropEffect = problem ? 'none' : 'move';
    if (over?.id !== targetId || over.problem !== problem) setOver({ id: targetId, problem });
  };

  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    const problem = problemFor(targetId);
    const id = dragId;
    setDragId(null);
    setOver(null);
    if (!id) return;
    if (problem) {
      if (problem !== 'same_parent') toast.error(DROP_PROBLEM_MESSAGE[problem]);
      return;
    }
    onMove?.(id, targetId === ROOT ? null : targetId);
  };

  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };

  return (
    <div role="tree" aria-label="부서 트리" className="flex flex-col py-1">
      {rows.map(({ node, level, hasChildren }) => {
        const open = expanded.has(node.id);
        const isOver = over?.id === node.id;
        const banned = isOver && over.problem !== null && over.problem !== 'same_parent';
        const archived = node.status === 'archived';
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-expanded={hasChildren ? open : undefined}
            aria-selected={selectedId === node.id}
            draggable={!!onMove}
            onDragStart={(e) => {
              setDragId(node.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', node.id);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => onDragOver(e, node.id)}
            onDragLeave={() => isOver && setOver(null)}
            onDrop={(e) => onDrop(e, node.id)}
            onClick={() => onSelect(node)}
            className={cn(
              'group relative flex h-[30px] cursor-pointer items-center gap-1 rounded-md pr-2 text-[13.5px] select-none hover:bg-accent',
              selectedId === node.id && 'bg-accent font-medium',
              archived && 'opacity-50',
              dragId === node.id && 'opacity-40',
              isOver && !banned && over.problem === null && 'ring-1 ring-primary ring-inset',
              banned && 'ring-1 ring-danger ring-inset',
            )}
            style={{ paddingLeft: 4 + (level - 1) * 12 }}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label={open ? '접기' : '펼치기'}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) onToggle(node.id);
              }}
              className={cn('grid size-5 shrink-0 place-items-center rounded text-muted-foreground', !hasChildren && 'invisible')}
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
            {level === 1 ? (
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('min-w-0 flex-1 truncate', matches?.has(node.id) && 'rounded-sm bg-border px-0.5')}>
                  {node.name}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">{node.name}</TooltipContent>
            </Tooltip>
            {archived && <ArchivedBadge />}
            {banned ? (
              <Tooltip open>
                <TooltipTrigger asChild>
                  <Ban className="size-3.5 shrink-0 text-danger" strokeWidth={1.75} />
                </TooltipTrigger>
                <TooltipContent side="right">{over.problem ? DROP_PROBLEM_MESSAGE[over.problem] : ''}</TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-xs text-muted-foreground tabular-nums">{node.totalMemberCount}</span>
            )}
          </div>
        );
      })}
      {onMove && dragId && (
        <div
          onDragOver={(e) => onDragOver(e, ROOT)}
          onDragLeave={() => over?.id === ROOT && setOver(null)}
          onDrop={(e) => onDrop(e, ROOT)}
          className={cn(
            'mt-1 flex h-[30px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground',
            over?.id === ROOT && over.problem === null && 'border-primary text-foreground',
            over?.id === ROOT && over.problem !== null && over.problem !== 'same_parent' && 'border-danger',
          )}
        >
          최상위로 옮기기
        </div>
      )}
    </div>
  );
}
