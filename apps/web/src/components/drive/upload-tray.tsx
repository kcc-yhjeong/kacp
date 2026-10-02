import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { isActive, uploads, useUploads, type UploadItem } from '@/lib/drive/uploads';
import { cn } from '@/lib/utils';
import { FileIcon } from './actor-badge';

const STATUS_LABEL: Record<UploadItem['status'], string> = {
  queued: '대기',
  uploading: '',
  done: '완료',
  error: '실패',
  canceled: '취소됨',
};

/** UploadTray (02 §5): fixed bottom right, per-file progress, cancel, errors. */
export function UploadTray() {
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === 'done').length;
  const active = items.some(isActive);
  const failed = items.filter((i) => i.status === 'error').length;
  const title = active
    ? `업로드 중 · ${done} / ${items.length}`
    : failed > 0
      ? `${failed}개 업로드하지 못했어요`
      : `업로드 완료 · ${done}개`;

  return (
    <section
      aria-label="업로드 진행"
      className="fixed right-4 bottom-4 z-40 flex w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border bg-background"
    >
      <div className="flex h-11 items-center gap-1 border-b pr-2 pl-4">
        <span className="flex-1 truncate text-[13px] font-medium" aria-live="polite">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={collapsed ? '펼치기' : '접기'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronUp strokeWidth={1.75} /> : <ChevronDown strokeWidth={1.75} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={active ? '모두 취소' : '닫기'}
          onClick={() => {
            if (active) uploads.cancelAll();
            else uploads.clearFinished();
          }}
        >
          <X strokeWidth={1.75} />
        </Button>
      </div>
      {!collapsed && (
        <ul className="max-h-72 overflow-y-auto">
          {items.map((it) => (
            <UploadRow key={it.id} item={it} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const pct = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;
  const showBar = item.status === 'uploading' || item.status === 'queued';
  return (
    <li className="flex flex-col gap-1.5 border-b px-4 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2.5 text-[13px]">
        <FileIcon entry={{ name: item.name, isDir: false }} />
        <span className="min-w-0 flex-1 truncate" title={item.relativePath ?? item.name}>
          {item.relativePath ?? item.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {item.status === 'done' && <span aria-hidden className="size-1.5 rounded-full bg-success" />}
          {item.status === 'error' && <span aria-hidden className="size-1.5 rounded-full bg-danger" />}
          {item.status === 'uploading' ? `${pct}%` : STATUS_LABEL[item.status]}
        </span>
        {isActive(item) && (
          <button
            type="button"
            aria-label={`${item.name} 업로드 취소`}
            className="shrink-0 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => uploads.cancel(item.id)}
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
      {showBar && (
        <div className="ml-[26px] h-1 overflow-hidden rounded-full bg-border">
          <div className={cn('h-full bg-primary transition-[width]')} style={{ width: `${pct}%` }} />
        </div>
      )}
      {item.status === 'error' && item.error && (
        <span className="ml-[26px] text-xs text-muted-foreground">{item.error}</span>
      )}
    </li>
  );
}
