import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { BookOpen, ChevronDown, ChevronRight, FileArchive, Loader2, Package, TriangleAlert, Upload, X } from 'lucide-react';
import { Fragment, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/admin/page';
import { McpIcon, PackageStatusBadge, VersionStatusBadge } from '@/components/mcp/badges';
import { HowToDialog } from '@/components/mcp/parts';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes } from '@/lib/admin/format';
import { ApiError } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { mcpKeys, uploadMcpZip, useMyMcpPackages, type McpUploadHandle } from '@/lib/mcp/api';
import { uploadErrorView, zipProblem, type UploadErrorView } from '@/lib/mcp/status';
import type { MyMcpPackage } from '@/lib/mcp/types';
import { cn } from '@/lib/utils';
import { MarketLayout } from './market-layout';

/** U-12 내 배포 — `/market/mine`. */
export function MinePage({ team }: { team?: string }) {
  return <MarketLayout tab="mine" requestedTeam={team}>{() => <Mine />}</MarketLayout>;
}

function Mine() {
  const mine = useMyMcpPackages();
  const [howTo, setHowTo] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <UploadCard onHowTo={() => setHowTo(true)} />
      <div className="overflow-hidden rounded-xl border">
        {mine.isPending ? (
          <ListSkeleton />
        ) : mine.isError ? (
          <ErrorState title="내 패키지를 불러오지 못했어요" error={mine.error} onRetry={() => void mine.refetch()} />
        ) : mine.data.length === 0 ? (
          <EmptyState
            icon={Package}
            title="아직 올린 MCP가 없어요"
            description="create-platform-mcp로 만들고 zip으로 묶어 위에 올려 보세요"
            action={
              <Button size="sm" variant="outline" onClick={() => setHowTo(true)}>
                만드는 방법
              </Button>
            }
          />
        ) : (
          <PackageTable items={mine.data} />
        )}
      </div>
      <HowToDialog open={howTo} onOpenChange={setHowTo} />
    </div>
  );
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string; loaded: number; total: number }
  | { kind: 'error'; name: string | null; view: UploadErrorView };

function UploadCard({ onHowTo }: { onHowTo: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const handle = useRef<McpUploadHandle | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const busy = state.kind === 'uploading';

  const start = async (file: File) => {
    const problem = zipProblem(file);
    if (problem) {
      setState({ kind: 'error', name: file.name, view: { title: problem, problems: [] } });
      return;
    }
    setState({ kind: 'uploading', name: file.name, loaded: 0, total: file.size });
    const h = uploadMcpZip(file, (loaded, total) => setState({ kind: 'uploading', name: file.name, loaded, total }));
    handle.current = h;
    try {
      const v = await h.promise;
      setState({ kind: 'idle' });
      toast.success(`${v.packageName} ${v.version}을(를) 올렸어요. 검증을 시작해요`);
      void qc.invalidateQueries({ queryKey: mcpKeys.mine });
      void navigate({ to: '/market/mine/$pkg/$ver', params: { pkg: v.packageName, ver: v.version } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ABORTED') setState({ kind: 'idle' });
      else setState({ kind: 'error', name: file.name, view: uploadErrorView(err) });
    } finally {
      handle.current = null;
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const file = e.dataTransfer.files[0];
    if (file) void start(file);
  };

  const pct = state.kind === 'uploading' && state.total > 0 ? Math.round((state.loaded / state.total) * 100) : 0;

  return (
    <section
      aria-label="새 버전 올리기"
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn('flex flex-col gap-3 rounded-xl border border-dashed p-5', over && 'border-primary bg-muted/50')}
    >
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid size-10 place-items-center rounded-full bg-muted">
          <Upload className="size-5 text-muted-foreground" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">새 버전 올리기</span>
          <span className="text-[13px] text-muted-foreground">
            <span className="font-mono">create-platform-mcp pack</span>으로 만든 zip을 끌어다 놓으세요 · 50MB 이하
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onHowTo}>
          <BookOpen strokeWidth={1.75} />
          만드는 방법
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          파일 선택
        </Button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void start(f);
          }}
        />
      </div>
      {state.kind === 'uploading' && (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px]">
          <FileArchive className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{state.name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {pct < 100 ? `${formatBytes(state.loaded)} / ${formatBytes(state.total)}` : (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                확인 중
              </span>
            )}
          </span>
          <Button variant="ghost" size="icon" className="size-7" aria-label="업로드 취소" onClick={() => handle.current?.abort()}>
            <X />
          </Button>
        </div>
      )}
      {state.kind === 'error' && (
        <div role="alert" className="flex gap-2 rounded-lg border px-3 py-2.5 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span>
              {state.name && <span className="font-mono text-xs text-muted-foreground">{state.name} · </span>}
              {state.view.title}
            </span>
            {state.view.problems.length > 0 && (
              <ul className="flex list-disc flex-col gap-0.5 pl-4 font-mono text-xs">
                {state.view.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="ghost" size="icon" className="size-7" aria-label="닫기" onClick={() => setState({ kind: 'idle' })}>
            <X />
          </Button>
        </div>
      )}
    </section>
  );
}

function PackageTable({ items }: { items: MyMcpPackage[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(items[0] ? [items[0].name] : []));
  const toggle = (n: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>패키지</TableHead>
          <TableHead>최신 버전</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="text-right">설치 팀</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((p) => {
          const latest = p.versions[0];
          const expanded = open.has(p.name);
          return (
            <Fragment key={p.name}>
              <TableRow className="cursor-pointer" onClick={() => toggle(p.name)}>
                <TableCell>
                  <span className="flex items-center gap-2.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded ? '버전 접기' : '버전 펼치기'}
                      className="text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(p.name);
                      }}
                    >
                      {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                    <McpIcon icon={p.icon} name={p.displayName || p.name} size="sm" />
                    <span className="flex flex-col">
                      <span className="font-medium">{p.displayName || p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.name}</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{latest?.version ?? '—'}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    {latest && <VersionStatusBadge status={latest.status} />}
                    {p.status === 'suspended' && <PackageStatusBadge status="suspended" />}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.installCount.toLocaleString()}</TableCell>
              </TableRow>
              {expanded &&
                p.versions.map((v) => (
                  <TableRow key={v.id} className="bg-muted/30">
                    <TableCell className="pl-14">
                      <Link
                        to="/market/mine/$pkg/$ver"
                        params={{ pkg: p.name, ver: v.version }}
                        className="font-mono text-[13px] underline-offset-2 hover:underline"
                      >
                        {v.version}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{formatTime(v.uploadedAt)}</TableCell>
                    <TableCell>
                      <VersionStatusBadge status={v.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/market/mine/$pkg/$ver" params={{ pkg: p.name, ver: v.version }}>
                          자세히
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
