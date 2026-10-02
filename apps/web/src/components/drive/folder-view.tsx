import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Copy,
  Download,
  FolderInput,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/admin/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError, errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { downloadUrl, downloadZip, driveApi, startDownload } from '@/lib/drive/api';
import { sourcesFromDataTransfer, sourcesFromInput, type UploadSource } from '@/lib/drive/dnd';
import { previewKind } from '@/lib/drive/file-type';
import { formatSize } from '@/lib/drive/format';
import { baseName, breadcrumb, displayLocation, joinPath, parentPath, SPACE_LABEL, freeFolderName } from '@/lib/drive/path';
import { invalidateDrive, useDriveList, useDriveSearch } from '@/lib/drive/queries';
import { uploads } from '@/lib/drive/uploads';
import type { DriveEntry, DriveRef, DriveSpace } from '@/lib/drive/types';
import { cn } from '@/lib/utils';
import { ActorBadge, FileIcon } from './actor-badge';
import { DetailPanel } from './detail-panel';
import { NameDialog, TransferDialog } from './dialogs';
import { EntryMenu, type EntryActions } from './entry-menu';
import { PreviewDialog } from './preview-dialog';
import { UsageNotice } from './usage-bar';

type ViewMode = 'list' | 'grid';
const VIEW_KEY = 'kacp.drive.view';

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function saveView(v: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // ignore (private mode)
  }
}

function sortEntries(items: DriveEntry[]): DriveEntry[] {
  return [...items].sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, 'ko')));
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const COLS = 'grid-cols-[28px_minmax(0,1fr)_150px_128px_72px_32px]';

/** U-04 main area (top bar, list/grid, bulk actions, drag and drop) + U-05 panel. */
export function FolderView({
  team,
  space,
  path,
  onNavigate,
  forbidden,
}: {
  team: string;
  space: DriveSpace;
  path: string;
  onNavigate: (space: DriveSpace, path: string) => void;
  /** Rendered instead of the list on 403. */
  forbidden: ReactNode;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const q = useDebounced(draft.trim(), 300);
  const searching = q.length > 0;
  const [view, setView] = useState<ViewMode>(loadView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<DriveEntry | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renaming, setRenaming] = useState<DriveEntry | null>(null);
  const [transfer, setTransfer] = useState<{ mode: 'move' | 'copy'; entries: DriveEntry[] } | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const list = useDriveList(team, space, path, !searching);
  const search = useDriveSearch(team, space, q);
  const active = searching ? search : list;
  const items = useMemo(() => sortEntries(active.data ?? []), [active.data]);

  // New folder, new space or new search → fresh selection; search box clears on navigation.
  useEffect(() => {
    setSelected(new Set());
    setDraft('');
  }, [space, path]);
  useEffect(() => setSelected(new Set()), [q]);

  // Keep the selection to entries that still exist after a refetch.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(items.map((i) => i.path));
      const next = new Set([...prev].filter((p) => present.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const selectedEntries = items.filter((i) => selected.has(i.path));
  const single = selectedEntries.length === 1 ? selectedEntries[0] : undefined;
  const refresh = () => invalidateDrive(qc, team);

  const enqueue = (sources: UploadSource[]) => {
    if (sources.length === 0) return;
    uploads.enqueue(team, { space, path }, sources);
  };

  const download = async (entries: DriveEntry[]) => {
    const [first] = entries;
    if (!first) return;
    if (entries.length === 1) {
      startDownload(downloadUrl(team, first.space, first.path), first.isDir ? `${first.name}.zip` : first.name);
      return;
    }
    const zipName = `${baseName(path) || SPACE_LABEL[space]}.zip`;
    const id = toast.loading('압축 파일을 만들고 있어요');
    try {
      await downloadZip(team, space, entries.map((e) => e.path), zipName);
      toast.dismiss(id);
    } catch (err) {
      toast.error(errorMessage(err), { id });
    }
  };

  const trash = async (entries: DriveEntry[]) => {
    if (entries.length === 0) return;
    try {
      await driveApi.trash(team, space, entries.map((e) => e.path));
      setSelected(new Set());
      toast.success(entries.length === 1 ? `${entries[0]?.name}을(를) 휴지통으로 옮겼어요` : `${entries.length}개 항목을 휴지통으로 옮겼어요`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      void refresh();
    }
  };

  const actions: EntryActions = {
    open: (e) => (e.isDir ? onNavigate(e.space, e.path) : setPreview(e)),
    download: (e) => void download([e]),
    rename: setRenaming,
    move: (es) => setTransfer({ mode: 'move', entries: es }),
    copy: (es) => setTransfer({ mode: 'copy', entries: es }),
    trash: (es) => void trash(es),
  };

  const onRowClick = (e: MouseEvent, entry: DriveEntry) => {
    if (e.metaKey || e.ctrlKey) toggle(entry.path);
    else setSelected(new Set([entry.path]));
  };
  const toggle = (p: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const allChecked = items.length > 0 && selected.size === items.length;
  const someChecked = selected.size > 0 && !allChecked;

  // Drag and drop (files and folders). Only react to OS file drags.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth((d) => d + 1);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      setDragDepth((d) => Math.max(0, d - 1));
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth(0);
      // Read entries synchronously inside the event; flattening continues after.
      void sourcesFromDataTransfer(e.dataTransfer).then(enqueue);
    },
  };

  const err = active.error;
  const isForbidden = err instanceof ApiError && err.status === 403;
  const isMissing = err instanceof ApiError && err.code === 'DRIVE_NOT_FOUND';

  return (
    <div className="flex min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col" {...dropHandlers}>
        {selected.size > 0 ? (
          <BulkBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            onDownload={() => void download(selectedEntries)}
            onMove={() => actions.move(selectedEntries)}
            onCopy={() => actions.copy(selectedEntries)}
            onTrash={() => actions.trash(selectedEntries)}
          />
        ) : (
          <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <Breadcrumb space={space} path={path} searching={searching} onNavigate={(p) => onNavigate(space, p)} />
            <div className="relative w-[220px]">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.75}
              />
              <input
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setDraft('')}
                placeholder={`${SPACE_LABEL[space]}에서 검색`}
                aria-label={`${SPACE_LABEL[space]}에서 검색`}
                className="h-8 w-full rounded-md border border-input bg-transparent pr-7 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
              />
              {draft && (
                <button
                  type="button"
                  aria-label="검색 지우기"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setDraft('')}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <ViewToggle
              view={view}
              onChange={(v) => {
                setView(v);
                saveView(v);
              }}
            />
            <IconButton label="새 폴더" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus strokeWidth={1.75} />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Upload strokeWidth={1.75} />
                  업로드
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                  <Upload className="text-muted-foreground" strokeWidth={1.75} />
                  파일 업로드
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => folderInput.current?.click()}>
                  <FolderUp className="text-muted-foreground" strokeWidth={1.75} />
                  폴더 업로드
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <UsageNotice team={team} />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) enqueue(sourcesFromInput(e.target.files));
            e.target.value = '';
          }}
        />
        <input
          ref={(el) => {
            folderInput.current = el;
            // Non-standard attribute React does not type.
            if (el) el.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) enqueue(sourcesFromInput(e.target.files));
            e.target.value = '';
          }}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isForbidden ? (
            forbidden
          ) : active.isPending && (searching || !list.data) ? (
            view === 'list' ? (
              <ListSkeleton />
            ) : (
              <GridSkeleton />
            )
          ) : err ? (
            isMissing ? (
              <EmptyState
                icon={Search}
                title="폴더를 찾을 수 없어요"
                description="이름이 바뀌었거나 휴지통으로 옮겨졌을 수 있어요."
                action={
                  <Button variant="outline" size="sm" onClick={() => onNavigate(space, '/')}>
                    {SPACE_LABEL[space]}로
                  </Button>
                }
              />
            ) : (
              <ErrorState
                title={searching ? '검색하지 못했어요' : '폴더를 불러오지 못했어요'}
                error={err}
                onRetry={() => void active.refetch()}
              />
            )
          ) : items.length === 0 ? (
            searching ? (
              <EmptyState icon={Search} title="맞는 항목이 없어요" description={`'${q}'(으)로 찾은 파일이 없어요.`} />
            ) : (
              <EmptyState
                icon={Upload}
                title="이 폴더는 비어 있어요"
                description="파일이나 폴더를 여기로 끌어다 놓으면 올라가요."
                action={
                  <Button size="sm" onClick={() => fileInput.current?.click()}>
                    <Upload strokeWidth={1.75} />
                    파일 업로드
                  </Button>
                }
                className="py-20"
              />
            )
          ) : view === 'list' ? (
            <div role="grid" aria-label="파일 목록" aria-multiselectable="true">
              <div
                role="row"
                className={cn('sticky top-0 z-10 grid h-10 items-center gap-x-2 border-b bg-background px-4 text-[12.5px] text-muted-foreground', COLS)}
              >
                <span role="columnheader" className="grid place-items-center">
                  <Checkbox
                    aria-label="모두 선택"
                    checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                    onCheckedChange={(c) => setSelected(c === true ? new Set(items.map((i) => i.path)) : new Set())}
                  />
                </span>
                <span role="columnheader">이름</span>
                <span role="columnheader">만든 사람</span>
                <span role="columnheader">수정</span>
                <span role="columnheader" className="text-right">
                  크기
                </span>
                <span />
              </div>
              {items.map((entry) => (
                <ListRow
                  key={entry.path}
                  entry={entry}
                  checked={selected.has(entry.path)}
                  showLocation={searching}
                  actions={actions}
                  onClick={(e) => onRowClick(e, entry)}
                  onToggle={() => toggle(entry.path)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Checkbox
                  aria-label="모두 선택"
                  checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                  onCheckedChange={(c) => setSelected(c === true ? new Set(items.map((i) => i.path)) : new Set())}
                />
                모두 선택
              </div>
              <div role="grid" aria-label="파일 목록" className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                {items.map((entry) => (
                  <GridCard
                    key={entry.path}
                    team={team}
                    entry={entry}
                    checked={selected.has(entry.path)}
                    actions={actions}
                    onClick={(e) => onRowClick(e, entry)}
                    onToggle={() => toggle(entry.path)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {dragDepth > 0 && (
          <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-foreground/40 bg-background/80">
            <div className="flex flex-col items-center gap-2 text-sm">
              <Upload className="size-8 text-muted-foreground" strokeWidth={1.75} />
              <span className="font-medium">여기에 놓으면 {displayLocation(space, path)}에 올라가요</span>
            </div>
          </div>
        )}
      </div>

      {single && (
        <DetailPanel
          key={`${single.space}:${single.path}`}
          team={team}
          entry={single}
          menu={<EntryMenu entry={single} actions={actions} />}
          onClose={() => setSelected(new Set())}
          onPreview={() => setPreview(single)}
        />
      )}

      <PreviewDialog team={team} entry={preview} onClose={() => setPreview(null)} />
      <NameDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title="새 폴더"
        confirmLabel="만들기"
        initial={freeFolderName(items.map((e) => e.name))}
        onSubmit={async (name) => {
          await driveApi.createFolder(team, { space, path: joinPath(path, name) });
          toast.success('폴더를 만들었어요');
          void refresh();
        }}
      />
      <NameDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="이름 변경"
        confirmLabel="변경"
        initial={renaming?.name ?? ''}
        keepExtension={!renaming?.isDir}
        closeIfUnchanged
        onSubmit={async (name) => {
          if (!renaming) return;
          const wasSelected = selected.has(renaming.path);
          const updated = await driveApi.rename(team, { space: renaming.space, path: renaming.path }, name);
          if (wasSelected) setSelected(new Set([updated?.path ?? joinPath(parentPath(renaming.path), name)]));
          toast.success('이름을 바꿨어요');
          void refresh();
        }}
      />
      {transfer && (
        <TransferDialog
          open
          onOpenChange={(o) => !o && setTransfer(null)}
          team={team}
          mode={transfer.mode}
          sources={transfer.entries.map((e) => ({ ref: { space: e.space, path: e.path }, isDir: e.isDir }))}
          initial={{ space, path }}
          onSubmit={async (to: DriveRef) => {
            const from = transfer.entries.map((e) => ({ space: e.space, path: e.path }));
            const n = from.length;
            if (transfer.mode === 'move') {
              await driveApi.move(team, from, to);
              setSelected(new Set());
              toast.success(n === 1 ? '옮겼어요' : `${n}개 항목을 옮겼어요`, {
                action: { label: '열기', onClick: () => onNavigate(to.space, to.path) },
              });
            } else {
              await driveApi.copy(team, from, to);
              toast.success(n === 1 ? '복사했어요' : `${n}개 항목을 복사했어요`, {
                action: { label: '열기', onClick: () => onNavigate(to.space, to.path) },
              });
            }
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function Breadcrumb({
  space,
  path,
  searching,
  onNavigate,
}: {
  space: DriveSpace;
  path: string;
  searching: boolean;
  onNavigate: (path: string) => void;
}) {
  const crumbs = breadcrumb(space, path);
  // More than 5 levels: root › … › parent › current.
  const shown = crumbs.length > 5 ? [crumbs[0], null, ...crumbs.slice(-2)] : crumbs;
  return (
    <nav aria-label="폴더 경로" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
      {shown.map((c, i) => {
        const last = i === shown.length - 1 && !searching;
        return (
          <span key={c ? c.path : 'ellipsis'} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />}
            {c === null || c === undefined ? (
              <span className="text-muted-foreground">…</span>
            ) : last ? (
              <span className="truncate font-medium" aria-current="page">
                {c.label}
              </span>
            ) : (
              <button
                type="button"
                className="truncate text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
                onClick={() => onNavigate(c.path)}
              >
                {c.label}
              </button>
            )}
          </span>
        );
      })}
      {searching && (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <span className="shrink-0 font-medium">검색 결과</span>
        </>
      )}
    </nav>
  );
}

function BulkBar({
  count,
  onClear,
  onDownload,
  onMove,
  onCopy,
  onTrash,
}: {
  count: number;
  onClear: () => void;
  onDownload: () => void;
  onMove: () => void;
  onCopy: () => void;
  onTrash: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b bg-muted/50 px-4">
      <Button variant="ghost" size="icon" aria-label="선택 해제" onClick={onClear}>
        <X strokeWidth={1.75} />
      </Button>
      <span className="mr-2 text-sm font-medium">{count}개 선택됨</span>
      <Button variant="outline" size="sm" onClick={onDownload}>
        <Download strokeWidth={1.75} />
        다운로드
      </Button>
      <Button variant="outline" size="sm" onClick={onMove}>
        <FolderInput strokeWidth={1.75} />
        이동
      </Button>
      <Button variant="outline" size="sm" onClick={onCopy}>
        <Copy strokeWidth={1.75} />
        복사
      </Button>
      <Button variant="outline" size="sm" onClick={onTrash}>
        <Trash2 strokeWidth={1.75} />
        휴지통으로
      </Button>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="보기" className="flex h-8 items-center rounded-md border p-0.5">
      {(
        [
          ['list', '목록', List],
          ['grid', '격자', LayoutGrid],
        ] as const
      ).map(([v, label, Icon]) => (
        <Tooltip key={v}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={view === v}
              aria-label={`${label} 보기`}
              onClick={() => onChange(v)}
              className={cn(
                'grid size-6 place-items-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                view === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label} 보기</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ListRow({
  entry,
  checked,
  showLocation,
  actions,
  onClick,
  onToggle,
}: {
  entry: DriveEntry;
  checked: boolean;
  showLocation: boolean;
  actions: EntryActions;
  onClick: (e: MouseEvent) => void;
  onToggle: () => void;
}) {
  return (
    <div
      role="row"
      aria-selected={checked}
      tabIndex={0}
      className={cn(
        'grid h-12 cursor-default items-center gap-x-2 border-b px-4 text-[13.5px] outline-none select-none hover:bg-accent/60 focus-visible:bg-accent',
        COLS,
        checked && 'bg-accent hover:bg-accent',
      )}
      onClick={onClick}
      onDoubleClick={() => actions.open(entry)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') actions.open(entry);
        if (e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span role="gridcell" className="grid place-items-center" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <Checkbox aria-label={`${entry.name} 선택`} checked={checked} onCheckedChange={onToggle} />
      </span>
      <span role="gridcell" className="flex min-w-0 items-center gap-2.5">
        <FileIcon entry={entry} />
        <span className="flex min-w-0 flex-col">
          <span className={cn('truncate', entry.isDir && 'font-medium')} title={entry.name}>
            {entry.name}
          </span>
          {showLocation && (
            <span className="truncate text-xs text-muted-foreground">{displayLocation(entry.space, parentPath(entry.path))}</span>
          )}
        </span>
      </span>
      <span role="gridcell" className="min-w-0 text-[12.5px]">
        <ActorBadge actor={entry.createdBy} />
      </span>
      <span role="gridcell" className="truncate text-[12.5px] text-muted-foreground">
        {formatTime(entry.modifiedAt)}
      </span>
      <span role="gridcell" className="text-right text-[12.5px] text-muted-foreground tabular-nums">
        {entry.isDir ? '—' : formatSize(entry.size)}
      </span>
      <span role="gridcell" className="flex justify-end">
        <EntryMenu entry={entry} actions={actions} />
      </span>
    </div>
  );
}

function GridCard({
  team,
  entry,
  checked,
  actions,
  onClick,
  onToggle,
}: {
  team: string;
  entry: DriveEntry;
  checked: boolean;
  actions: EntryActions;
  onClick: (e: MouseEvent) => void;
  onToggle: () => void;
}) {
  const isImage = !entry.isDir && previewKind(entry.name, entry.mimeType) === 'image';
  return (
    <div
      role="gridcell"
      aria-selected={checked}
      tabIndex={0}
      className={cn(
        'group relative flex cursor-default flex-col overflow-hidden rounded-xl border bg-card outline-none select-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        checked && 'border-foreground/40 bg-accent hover:bg-accent',
      )}
      onClick={onClick}
      onDoubleClick={() => actions.open(entry)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') actions.open(entry);
        if (e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="grid h-28 place-items-center overflow-hidden border-b bg-sidebar">
        {isImage ? (
          <img
            src={downloadUrl(team, entry.space, entry.path, true)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <FileIcon entry={entry} className="size-8" />
        )}
      </div>
      <div className="flex items-center gap-1 py-1.5 pr-1 pl-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-[13px]', entry.isDir && 'font-medium')} title={entry.name}>
            {entry.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {entry.isDir ? formatTime(entry.modifiedAt) : `${formatSize(entry.size)} · ${formatTime(entry.modifiedAt)}`}
          </span>
        </div>
        <EntryMenu entry={entry} actions={actions} />
      </div>
      <span
        className={cn('absolute top-2 left-2', !checked && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Checkbox aria-label={`${entry.name} 선택`} checked={checked} onCheckedChange={onToggle} />
      </span>
    </div>
  );
}

function ListSkeleton() {
  const widths = ['38%', '52%', '30%', '46%', '60%', '34%', '42%', '28%'];
  return (
    <div aria-busy="true" aria-label="불러오는 중">
      <div className={cn('grid h-10 items-center gap-x-2 border-b px-4', COLS)} />
      {widths.map((w, i) => (
        <div key={i} className={cn('grid h-12 items-center gap-x-2 border-b px-4', COLS)}>
          <Skeleton className="mx-auto size-4" />
          <span className="flex items-center gap-2.5">
            <Skeleton className="size-4" />
            <Skeleton className="h-3.5" style={{ width: w }} />
          </span>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="ml-auto h-3.5 w-10" />
          <span />
        </div>
      ))}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div aria-busy="true" aria-label="불러오는 중" className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3 p-4 pt-10">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}

