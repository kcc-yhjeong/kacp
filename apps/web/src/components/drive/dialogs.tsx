import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { baseName, displayLocation, isSameOrInside, nameProblem, parentPath, splitExt } from '@/lib/drive/path';
import type { DriveRef, DriveSpace } from '@/lib/drive/types';
import { DriveTree, treeKey } from './drive-tree';

/** New folder / rename. The name stem is preselected on rename so the extension survives a quick retype. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  initial = '',
  keepExtension = false,
  closeIfUnchanged = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  initial?: string;
  keepExtension?: boolean;
  /** Rename: submitting the same name just closes. New folder: the default name is submitted as is. */
  closeIfUnchanged?: boolean;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial);
    setError(null);
    setPending(false);
    const id = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const stem = keepExtension ? splitExt(initial)[0].length : initial.length;
      el.setSelectionRange(0, stem);
    });
    return () => cancelAnimationFrame(id);
  }, [open, initial, keepExtension]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const problem = nameProblem(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    if (closeIfUnchanged && trimmed === initial) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {error && <FormAlert message={error} />}
          <Input
            ref={inputRef}
            aria-label="이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={255}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Move/copy destination picker across both spaces (same lazy tree as the sidebar). */
export function TransferDialog({
  open,
  onOpenChange,
  team,
  mode,
  sources,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: string;
  mode: 'move' | 'copy';
  sources: { ref: DriveRef; isDir: boolean }[];
  initial: DriveRef;
  onSubmit: (to: DriveRef) => Promise<void>;
}) {
  const [target, setTarget] = useState<DriveRef>(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(initial);
    setError(null);
    setPending(false);
    // Open the path to the current folder.
    const keys = new Set<string>();
    const parts = initial.path.split('/').filter(Boolean);
    keys.add(treeKey(initial.space, '/'));
    for (let i = 1; i < parts.length; i++) keys.add(treeKey(initial.space, `/${parts.slice(0, i).join('/')}`));
    setExpanded(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opened or the start folder changes
  }, [open, initial.space, initial.path]);

  const isDisabled = (space: DriveSpace, path: string) =>
    sources.some((s) => s.isDir && s.ref.space === space && isSameOrInside(path, s.ref.path));

  const allInTarget = sources.every(
    (s) => s.ref.space === target.space && parentPath(s.ref.path) === target.path,
  );
  const blocked = isDisabled(target.space, target.path) || (mode === 'move' && allInTarget);
  const verb = mode === 'move' ? '이동' : '복사';

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onSubmit(target);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {sources.length === 1 ? `${baseName(sources[0]?.ref.path ?? '')} ${verb}` : `${sources.length}개 항목 ${verb}`}
          </DialogTitle>
          <DialogDescription>{verb}할 폴더를 고르세요.</DialogDescription>
        </DialogHeader>
        {error && <FormAlert message={error} />}
        <div className="h-72 overflow-y-auto rounded-md border p-2">
          <DriveTree
            team={team}
            selected={target}
            expanded={expanded}
            onToggle={(space, path) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                const k = treeKey(space, path);
                if (next.has(k)) next.delete(k);
                else next.add(k);
                return next;
              })
            }
            onSelect={(space, path) => {
              setTarget({ space, path });
              setExpanded((prev) => new Set(prev).add(treeKey(space, path)));
            }}
            isDisabled={isDisabled}
          />
        </div>
        <div className="truncate text-[13px] text-muted-foreground">
          대상: <span className="font-mono text-xs text-foreground">{displayLocation(target.space, target.path)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" disabled={pending || blocked} onClick={submit}>
            여기로 {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
