import { ChevronDown, ChevronRight, Folder, HardDrive, Loader2, Trash2, Users, type LucideIcon } from 'lucide-react';
import { useDriveList } from '@/lib/drive/queries';
import { SPACE_LABEL } from '@/lib/drive/path';
import { DRIVE_SPACES, type DriveRef, type DriveSpace } from '@/lib/drive/types';
import { cn } from '@/lib/utils';

// FileTree (02-design-system.md §5, mockup DriveTree): two roots, folders load when expanded.

export const treeKey = (space: DriveSpace, path: string) => `${space}:${path}`;

interface TreeProps {
  team: string;
  /** Highlighted folder. */
  selected: DriveRef | null;
  expanded: ReadonlySet<string>;
  onToggle: (space: DriveSpace, path: string) => void;
  onSelect: (space: DriveSpace, path: string) => void;
  /** Folders that cannot be picked (moving a folder into itself); their subtree is not shown. */
  isDisabled?: (space: DriveSpace, path: string) => boolean;
}

const ROOT_ICON: Record<DriveSpace, LucideIcon> = { me: HardDrive, shared: Users };

export function DriveTree(props: TreeProps) {
  return (
    <div role="tree" aria-label="드라이브 폴더" className="flex flex-col gap-px">
      {DRIVE_SPACES.map((space, i) => (
        <div key={space} className={cn(i > 0 && 'mt-2.5')}>
          <TreeNode {...props} space={space} path="/" name={SPACE_LABEL[space]} icon={ROOT_ICON[space]} depth={0} />
        </div>
      ))}
    </div>
  );
}

function TreeNode({
  team,
  space,
  path,
  name,
  icon: Icon,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
  isDisabled,
}: TreeProps & { space: DriveSpace; path: string; name: string; icon: LucideIcon; depth: number }) {
  const open = expanded.has(treeKey(space, path));
  const disabled = isDisabled?.(space, path) ?? false;
  const list = useDriveList(team, space, path, open && !disabled);
  const folders = (list.data ?? []).filter((e) => e.isDir).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const isSelected = selected?.space === space && selected.path === path;
  const leaf = open && list.isSuccess && folders.length === 0;

  return (
    <div role="treeitem" aria-expanded={leaf ? undefined : open} aria-selected={isSelected}>
      <div
        className={cn(
          'flex h-[30px] items-center gap-1.5 rounded-md pr-2 text-[13.5px]',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent',
          isSelected && 'bg-accent font-medium',
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => !disabled && onSelect(space, path)}
      >
        <button
          type="button"
          aria-label={open ? `${name} 접기` : `${name} 펼치기`}
          tabIndex={-1}
          disabled={disabled}
          className={cn('grid size-3.5 shrink-0 place-items-center text-muted-foreground', leaf && 'invisible')}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(space, path);
          }}
        >
          {open && list.isFetching && !list.data ? (
            <Loader2 className="size-3 animate-spin" />
          ) : open ? (
            <ChevronDown className="size-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
        <Icon
          className={cn('size-4 shrink-0', isSelected ? 'text-foreground' : 'text-muted-foreground')}
          strokeWidth={1.75}
          aria-hidden
        />
        <button
          type="button"
          disabled={disabled}
          className="min-w-0 flex-1 truncate text-left outline-none focus-visible:underline"
          title={name}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onSelect(space, path);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && !open) onToggle(space, path);
            if (e.key === 'ArrowLeft' && open) onToggle(space, path);
          }}
        >
          {name}
        </button>
      </div>
      {open && !disabled && (
        <div role="group">
          {list.isError && (
            <div className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: 8 + (depth + 1) * 16 + 20 }}>
              불러오지 못했어요
            </div>
          )}
          {folders.map((f) => (
            <TreeNode
              key={f.path}
              team={team}
              space={space}
              path={f.path}
              name={f.name}
              icon={Folder}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              isDisabled={isDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TrashTreeItem({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[30px] w-full items-center gap-1.5 rounded-md pr-2 pl-2 text-left text-[13.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active && 'bg-accent font-medium',
      )}
    >
      <span className="size-3.5 shrink-0" />
      <Trash2 className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} strokeWidth={1.75} />
      휴지통
    </button>
  );
}
