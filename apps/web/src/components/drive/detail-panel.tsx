import { Copy, Lock, Users, X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { downloadUrl } from '@/lib/drive/api';
import { previewKind, typeLabel } from '@/lib/drive/file-type';
import { formatSize } from '@/lib/drive/format';
import { historyLabel, sortHistory } from '@/lib/drive/labels';
import { displayLocation, parentPath } from '@/lib/drive/path';
import { useDriveMeta } from '@/lib/drive/queries';
import type { DriveEntry } from '@/lib/drive/types';
import { cn } from '@/lib/utils';
import { ActorBadge, FileIcon } from './actor-badge';

/** U-05 side panel (400px, right). Shown for a single selection. */
export function DetailPanel({
  team,
  entry,
  menu,
  onClose,
  onPreview,
}: {
  team: string;
  entry: DriveEntry;
  menu?: ReactNode;
  onClose: () => void;
  onPreview: () => void;
}) {
  const meta = useDriveMeta(team, entry.space, entry.path);
  const m = meta.data;
  const location = displayLocation(entry.space, parentPath(entry.path));

  const copyLocation = async () => {
    try {
      await navigator.clipboard.writeText(displayLocation(entry.space, entry.path));
      toast.success('위치를 복사했어요');
    } catch {
      toast.error('복사하지 못했어요. 직접 선택해 복사하세요.');
    }
  };

  const rows: [string, ReactNode][] = [
    ['종류', entry.isDir ? '폴더' : `${typeLabel(entry)} · ${formatSize(entry.size)}`],
    [
      '위치',
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-[11.5px]" title={location}>
          {location}
        </span>
        <button
          type="button"
          aria-label="위치 복사"
          className="shrink-0 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={copyLocation}
        >
          <Copy className="size-3.5" strokeWidth={1.75} />
        </button>
      </span>,
    ],
    ['만든 사람', <ActorBadge actor={m ? m.createdBy : entry.createdBy} empty="기록 없음" />],
    ['만든 시각', m ? (m.createdAt ? formatTime(m.createdAt) : '기록 없음') : <Skeleton className="h-3.5 w-20" />],
    ['수정', formatTime(m?.modifiedAt ?? entry.modifiedAt)],
    [
      '권한',
      (m?.access ?? (entry.space === 'me' ? 'only_me' : 'team')) === 'only_me' ? (
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5" strokeWidth={1.75} />
          나만
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <Users className="size-3.5" strokeWidth={1.75} />팀 전체
        </span>
      ),
    ],
  ];

  const history = m ? sortHistory(m.history ?? []) : [];

  return (
    <aside aria-label="파일 상세" className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l bg-background">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b pr-3 pl-5">
        <FileIcon entry={entry} className="text-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={entry.name}>
          {entry.name}
        </span>
        {menu}
        <Button variant="ghost" size="icon" aria-label="상세 닫기" onClick={onClose}>
          <X strokeWidth={1.75} />
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        <Thumbnail team={team} entry={entry} onPreview={onPreview} />
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13px]">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </Fragment>
          ))}
        </dl>
        <section className="flex flex-col gap-3">
          <h3 className="text-[13px] font-medium">변경 기록</h3>
          {meta.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ) : meta.isError ? (
            <span className="text-[13px] text-muted-foreground">{errorMessage(meta.error)}</span>
          ) : history.length === 0 ? (
            <span className="text-[13px] text-muted-foreground">기록 없음</span>
          ) : (
            <ol className="flex flex-col">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex gap-3">
                  <div className="flex w-2 flex-col items-center">
                    <span
                      aria-hidden
                      className={cn('mt-[5px] size-2 shrink-0 rounded-full', i === 0 ? 'bg-primary' : 'bg-chart-4')}
                    />
                    {i < history.length - 1 && <span aria-hidden className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5 pb-3 text-[13px]">
                    <span className="break-words">{historyLabel(h)}</span>
                    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                      {h.actor.kind === 'agent' ? '에이전트 · 팀' : h.actor.kind === 'system' ? '시스템' : (h.actor.user?.name ?? '알 수 없음')}
                      {' · '}
                      {formatTime(h.at)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  );
}

function Thumbnail({ team, entry, onPreview }: { team: string; entry: DriveEntry; onPreview: () => void }) {
  const kind = entry.isDir ? 'none' : previewKind(entry.name, entry.mimeType);
  if (kind === 'image') {
    return (
      <button
        type="button"
        onClick={onPreview}
        aria-label="미리보기"
        className="grid h-40 place-items-center overflow-hidden rounded-xl border bg-sidebar outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <img
          src={downloadUrl(team, entry.space, entry.path, true)}
          alt=""
          loading="lazy"
          className="max-h-full max-w-full object-contain"
        />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onPreview}
      disabled={entry.isDir}
      aria-label={entry.isDir ? undefined : '미리보기'}
      className="grid h-28 place-items-center rounded-xl border bg-sidebar outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent"
    >
      <FileIcon entry={entry} className="size-8" />
    </button>
  );
}
