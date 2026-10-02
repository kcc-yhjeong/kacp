import { useQuery } from '@tanstack/react-query';
import { Download, FileQuestion, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError, errorMessage } from '@/lib/api';
import { downloadUrl, startDownload } from '@/lib/drive/api';
import { previewKind, TEXT_PREVIEW_MAX_BYTES, typeLabel } from '@/lib/drive/file-type';
import { formatSize } from '@/lib/drive/format';
import type { DriveEntry } from '@/lib/drive/types';
import { FileIcon } from './actor-badge';

/** Text preview: first 1 MB only (Range when the server honors it, sliced either way). */
async function fetchText(url: string, size: number): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(url, { credentials: 'include', headers: { Range: `bytes=0-${TEXT_PREVIEW_MAX_BYTES - 1}` } });
  if (!res.ok) throw new ApiError(res.status, 'INTERNAL', '파일을 불러오지 못했어요. 다시 시도해 주세요.');
  const buf = await res.arrayBuffer();
  const truncated = size > TEXT_PREVIEW_MAX_BYTES || buf.byteLength > TEXT_PREVIEW_MAX_BYTES;
  const text = new TextDecoder('utf-8').decode(buf.slice(0, TEXT_PREVIEW_MAX_BYTES));
  return { text, truncated };
}

export function PreviewDialog({
  team,
  entry,
  onClose,
}: {
  team: string;
  entry: DriveEntry | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[min(86vh,820px)] max-w-[min(92vw,1080px)] flex-col gap-3 p-0">
        {entry && <PreviewBody team={team} entry={entry} />}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ team, entry }: { team: string; entry: DriveEntry }) {
  const kind = previewKind(entry.name, entry.mimeType);
  const inline = downloadUrl(team, entry.space, entry.path, true);
  const text = useQuery({
    queryKey: ['drive-preview', team, entry.space, entry.path, entry.modifiedAt],
    queryFn: () => fetchText(inline, entry.size),
    enabled: kind === 'text',
    staleTime: Infinity,
    retry: false,
  });
  const download = () => startDownload(downloadUrl(team, entry.space, entry.path), entry.name);

  return (
    <>
      <DialogHeader className="flex-row items-center gap-2.5 border-b py-3 pr-12 pl-5">
        <FileIcon entry={entry} />
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogTitle className="truncate text-sm">{entry.name}</DialogTitle>
          <DialogDescription className="text-xs">
            {typeLabel(entry)} · {formatSize(entry.size)}
          </DialogDescription>
        </div>
        <Button variant="outline" size="sm" onClick={download}>
          <Download strokeWidth={1.75} />
          다운로드
        </Button>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {kind === 'image' && (
          <div className="grid h-full place-items-center">
            <img src={inline} alt={entry.name} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {kind === 'pdf' && <iframe title={entry.name} src={inline} className="size-full rounded-md border" />}
        {kind === 'text' &&
          (text.isPending ? (
            <div className="grid h-full place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" strokeWidth={1.75} />
            </div>
          ) : text.isError ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">{errorMessage(text.error)}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {text.data.truncated && (
                <span className="text-xs text-muted-foreground">파일이 커서 앞부분 1MB만 보여요. 전체는 다운로드하세요.</span>
              )}
              <pre className="rounded-md bg-muted p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                {text.data.text}
              </pre>
            </div>
          ))}
        {kind === 'none' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-muted">
              <FileQuestion className="size-7 text-muted-foreground" strokeWidth={1.75} />
            </span>
            <span className="text-[15px] font-semibold">미리보기를 지원하지 않는 형식이에요</span>
            <Button size="sm" onClick={download}>
              <Download strokeWidth={1.75} />
              다운로드
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
