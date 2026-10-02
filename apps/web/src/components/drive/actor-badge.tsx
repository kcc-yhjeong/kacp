import { Bot, File, FileCode, FileImage, FileText, Folder } from 'lucide-react';
import { initialOf } from '@/lib/format';
import { fileIconKind, type FileIconKind } from '@/lib/drive/file-type';
import type { Actor } from '@/lib/drive/types';
import { cn } from '@/lib/utils';

/**
 * ActorBadge (02-design-system.md §5): person = initial avatar + name; agent = black Bot circle + "에이전트 · 팀".
 * `null` (no record) shows `empty`.
 */
export function ActorBadge({
  actor,
  empty = '—',
  className,
}: {
  actor: Actor | null | undefined;
  empty?: string;
  className?: string;
}) {
  if (!actor) return <span className={cn('text-muted-foreground', className)}>{empty}</span>;
  if (actor.kind === 'agent') {
    return (
      <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
        <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Bot className="size-3" strokeWidth={1.75} />
        </span>
        <span className="truncate">에이전트 · 팀</span>
      </span>
    );
  }
  const name = actor.kind === 'system' ? '시스템' : (actor.user?.name ?? '알 수 없음');
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-full border bg-muted text-[10px] font-semibold"
      >
        {initialOf(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

const ICONS: Record<FileIconKind, typeof File> = {
  folder: Folder,
  image: FileImage,
  text: FileText,
  code: FileCode,
  file: File,
};

export function FileIcon({
  entry,
  className,
}: {
  entry: { name: string; isDir: boolean; mimeType?: string };
  className?: string;
}) {
  const Icon = ICONS[fileIconKind(entry)];
  return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} strokeWidth={1.75} aria-hidden />;
}
