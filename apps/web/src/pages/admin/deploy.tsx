import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ExternalLink, File, FileMinus, FilePen, FilePlus, Globe, History, Inbox, Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton, PageContainer, PageHeader } from '@/components/admin/page';
import { AppStatusBadge, Dot, DotBadge, PendingBadge, PrivateBadge, PublicBadge } from '@/components/apps/badges';
import { Requester, UrlLine } from '@/components/apps/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { adminDeployApi, appKeys, usePendingDeployRequests } from '@/lib/apps/api';
import { copyStateOf, deployKindLabel, displayUrl, nextVersion, pendingLabel, type Dot as DotKind } from '@/lib/apps/status';
import type { AdminDeployRequest, App, DeployRequest } from '@/lib/apps/types';
import { formatTime } from '@/lib/format';
import { currentHost } from '@/lib/host';
import { cn } from '@/lib/utils';

const route = getRouteApi('/admin/deploy');

export type DeployTab = 'requests' | 'public' | 'history';

export function isDeployTab(v: unknown): v is DeployTab {
  return v === 'requests' || v === 'public' || v === 'history';
}

/** A-09 배포 승인 — `/admin/deploy`. */
export function DeployPage() {
  const { tab = 'requests' } = route.useSearch();
  const navigate = useNavigate();
  const pending = usePendingDeployRequests();
  const publicApps = useQuery({
    queryKey: appKeys.adminApps({ public: true }),
    queryFn: async () => (await adminDeployApi.apps({ public: true })).items,
  });

  return (
    <PageContainer>
      <PageHeader title="배포 승인" description="승인하면 그 시점의 작업본이 공개본 새 버전이 돼요." />
      <Tabs
        value={tab}
        onValueChange={(v) => void navigate({ to: '/admin/deploy', search: isDeployTab(v) && v !== 'requests' ? { tab: v } : {} })}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="requests">공개 요청 {pending.data ? pending.data.length : ''}</TabsTrigger>
          <TabsTrigger value="public">공개 중인 앱 {publicApps.data ? publicApps.data.length : ''}</TabsTrigger>
          <TabsTrigger value="history">처리 이력</TabsTrigger>
        </TabsList>
        <TabsContent value="requests">
          <RequestsTab query={pending} />
        </TabsContent>
        <TabsContent value="public">
          <PublicAppsTab query={publicApps} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function useRefreshDeploy() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: appKeys.adminAll });
    void qc.invalidateQueries({ queryKey: appKeys.all });
  };
}

function KindBadge({ req }: { req: AdminDeployRequest | (DeployRequest & { app?: AdminDeployRequest['app'] }) }) {
  const label = deployKindLabel(req, req.app?.publicVersion);
  return req.kind === 'publish' ? <Badge variant="secondary">{label}</Badge> : <Badge variant="outline">{label}</Badge>;
}

// ── 공개 요청

function RequestsTab({ query }: { query: ReturnType<typeof usePendingDeployRequests> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = query.data ?? [];
  const selected = items.find((r) => r.id === selectedId) ?? items[0] ?? null;

  if (query.isPending) return <div className="rounded-xl border"><ListSkeleton /></div>;
  if (query.isError) {
    return (
      <div className="rounded-xl border">
        <ErrorState title="공개 요청을 불러오지 못했어요" error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState icon={Inbox} title="검토할 공개 요청이 없어요" description="팀이 공개나 업데이트를 요청하면 여기에 보여요" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <ul className="flex flex-col self-start overflow-hidden rounded-xl border">
        {items.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setSelectedId(r.id)}
              aria-current={selected?.id === r.id ? 'true' : undefined}
              className={cn(
                'flex w-full flex-col gap-1.5 border-b border-l-2 border-l-transparent px-4 py-3 text-left outline-none last:border-b-0 hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                selected?.id === r.id && 'border-l-primary bg-muted',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="truncate font-mono text-[13.5px] font-medium">{r.app.slug}</span>
                <KindBadge req={r} />
              </span>
              <span className="line-clamp-2 text-[13px] text-pretty">{r.reason}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {r.app.team} · <Requester user={r.requestedBy} /> · {formatTime(r.requestedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <RequestDetail key={selected.id} req={selected} />}
    </div>
  );
}

function RequestDetail({ req }: { req: AdminDeployRequest }) {
  const refresh = useRefreshDeploy();
  const [approving, setApproving] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const version = nextVersion(req, req.app.publicVersion);
  const base = currentHost.base ?? 'kacp.cloud';

  const approve = async () => {
    setApproving(true);
    try {
      await adminDeployApi.approve(req.id);
      toast.success(`${req.app.slug} v${version}를 승인했어요. 공개본을 준비하고 있어요`);
      setConfirmApprove(false);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setApproving(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-xl border p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{req.app.slug}</h2>
            <KindBadge req={req} />
          </span>
          <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
            {req.app.team} · <Requester user={req.requestedBy} /> · {formatTime(req.requestedAt)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setRejectOpen(true)}>
            반려
          </Button>
          <Button onClick={() => setConfirmApprove(true)}>v{version} 승인</Button>
        </div>
      </div>

      {req.kind === 'publish' ? (
        <>
          <Section title="요청한 공개 이름">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-sm font-medium">{req.requestedName ?? req.app.slug}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {currentHost.protocol}//{req.requestedName ?? req.app.slug}.{base}
              </span>
            </div>
          </Section>
          <CopyLink kind="work" url={req.app.workUrl} />
          <Section title="공개 이유">
            <p className="text-[13.5px] text-pretty whitespace-pre-wrap">{req.reason}</p>
          </Section>
          <Section title={`원본 폴더 · 파일 ${req.sourceFiles?.length ?? 0}개`}>
            {req.sourceFiles && req.sourceFiles.length > 0 ? (
              <ul className="max-h-64 overflow-y-auto rounded-lg border">
                {req.sourceFiles.map((f) => (
                  <li key={f} className="flex items-center gap-2 border-b px-3 py-1.5 font-mono text-xs last:border-b-0">
                    <File className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="truncate">{f}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[13px] text-muted-foreground">파일 목록이 없어요</span>
            )}
          </Section>
        </>
      ) : (
        <>
          <Section title="변경 내용">
            <p className="text-[13.5px] text-pretty whitespace-pre-wrap">{req.reason}</p>
          </Section>
          <div className="grid gap-3 md:grid-cols-2">
            <CopyLink kind="work" url={req.app.workUrl} />
            {req.app.publicUrl && <CopyLink kind="public" url={req.app.publicUrl} version={req.app.publicVersion} />}
          </div>
          <DiffView req={req} />
        </>
      )}

      <ConfirmDialog
        open={confirmApprove}
        onOpenChange={setConfirmApprove}
        title={`${req.app.slug} v${version}를 승인할까요?`}
        description={
          req.kind === 'publish'
            ? `지금 작업본이 공개본 v1로 복사되고 ${req.requestedName ?? req.app.slug}.${base}가 로그인한 모든 사원에게 열려요.`
            : `지금 작업본이 공개본 v${version}이 돼요. 공개본은 끊김 없이 바뀌고 공개본 데이터는 그대로 남아요.`
        }
        confirmLabel={`v${version} 승인`}
        pending={approving}
        onConfirm={() => void approve()}
      />
      <RejectDialog req={req} open={rejectOpen} onOpenChange={setRejectOpen} onDone={refresh} />
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      {children}
    </div>
  );
}

function CopyLink({ kind, url, version }: { kind: 'work' | 'public'; url: string; version?: number | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border px-3.5 py-3">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {kind === 'work' ? '작업본 · 새 버전' : '공개본 · 현재'}
        {kind === 'work' ? <PrivateBadge small /> : <PublicBadge version={version} small />}
      </span>
      <span className="truncate font-mono text-xs">{displayUrl(url)}</span>
      <Button variant="outline" size="sm" className="self-start" asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink strokeWidth={1.75} />
          {kind === 'work' ? '작업본 열기' : '공개본 열기'}
        </a>
      </Button>
    </div>
  );
}

function DiffView({ req }: { req: AdminDeployRequest }) {
  const d = req.diffSummary;
  const from = req.fromVersion ?? req.app.publicVersion;
  const rows: { k: string; icon: typeof File; p: string; dot: DotKind }[] = d
    ? [
        ...d.added.map((p) => ({ k: '추가', icon: FilePlus, p, dot: 'success' as const })),
        ...d.modified.map((p) => ({ k: '수정', icon: FilePen, p, dot: 'muted' as const })),
        ...d.removed.map((p) => ({ k: '삭제', icon: FileMinus, p, dot: 'danger' as const })),
      ]
    : [];
  return (
    <Section title={`파일 변경${from ? ` · v${from} 대비` : ''}`}>
      {!d ? (
        <span className="text-[13px] text-muted-foreground">변경 목록을 계산하지 못했어요</span>
      ) : (
        <>
          <div className="flex gap-2">
            <DotBadge dot="success" label={`추가 ${d.added.length}`} />
            <DotBadge dot="muted" label={`수정 ${d.modified.length}`} />
            <DotBadge dot="danger" label={`삭제 ${d.removed.length}`} />
          </div>
          {rows.length === 0 ? (
            <span className="text-[13px] text-muted-foreground">바뀐 파일이 없어요</span>
          ) : (
            <ul className="max-h-64 overflow-y-auto rounded-lg border">
              {rows.map((r) => (
                <li key={`${r.k}:${r.p}`} className="flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
                  <Dot dot={r.dot} />
                  <span className="w-8 shrink-0 text-muted-foreground">{r.k}</span>
                  <span className="truncate font-mono">{r.p}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function RejectDialog({
  req,
  open,
  onOpenChange,
  onDone,
}: {
  req: AdminDeployRequest;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!note.trim()) return;
    setPending(true);
    setError(null);
    try {
      await adminDeployApi.reject(req.id, note.trim());
      toast.success(`${req.app.slug} 요청을 반려했어요. 팀에 사유가 보여요`);
      onOpenChange(false);
      setNote('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{req.app.slug} 요청을 반려할까요?</DialogTitle>
          <DialogDescription>
            {req.kind === 'update' && req.app.publicVersion
              ? `공개본 v${req.app.publicVersion}은 그대로 공개돼요. 팀은 사유를 보고 다시 요청할 수 있어요.`
              : '팀은 사유를 보고 고친 뒤 다시 요청할 수 있어요.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-note" className="text-[13px]">
            반려 사유 <span className="text-danger">*</span>
          </Label>
          <Textarea id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
        </div>
        {error && <FormAlert message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            취소
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!note.trim() || pending}>
            {pending && <Loader2 className="animate-spin" />}
            반려
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 공개 중인 앱

function PublicAppsTab({ query }: { query: { data?: App[]; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const [stopApp, setStopApp] = useState<App | null>(null);
  const [resumeApp, setResumeApp] = useState<App | null>(null);
  const items = query.data ?? [];

  return (
    <div className="overflow-hidden rounded-xl border">
      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <ErrorState title="공개 중인 앱을 불러오지 못했어요" error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Globe} title="공개 중인 앱이 없어요" description="공개 요청을 승인하면 여기에 보여요" />
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>앱</TableHead>
                <TableHead>팀</TableHead>
                <TableHead>버전</TableHead>
                <TableHead>승인자</TableHead>
                <TableHead>승인 시각</TableHead>
                <TableHead>상태</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => {
                const pub = a.public;
                if (!pub) return null;
                const admin = copyStateOf(pub) === 'admin';
                const pending = pendingLabel(a);
                return (
                  <TableRow key={a.id} className="h-12">
                    <TableCell>
                      <div className="flex min-w-0 flex-col">
                        <span className="font-mono text-[13px] font-medium">{pub.name}</span>
                        <UrlLine url={pub.url} />
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">{a.team}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <PublicBadge version={pub.version} />
                        {pending && <PendingBadge label={pending} />}
                      </span>
                    </TableCell>
                    <TableCell>{pub.approvedBy?.name ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{formatTime(pub.publishedAt)}</TableCell>
                    <TableCell>
                      <AppStatusBadge copy={pub} short />
                    </TableCell>
                    <TableCell className="text-right">
                      {admin ? (
                        <Button variant="outline" size="sm" onClick={() => setResumeApp(a)}>
                          강제 중지 해제
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setStopApp(a)}>
                          강제 중지
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {stopApp && <ForceStopDialog app={stopApp} onClose={() => setStopApp(null)} />}
      {resumeApp && <ResumeDialog app={resumeApp} onClose={() => setResumeApp(null)} />}
    </div>
  );
}

function ForceStopDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const refresh = useRefreshDeploy();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pub = app.public;
  const submit = async () => {
    if (!reason.trim()) return;
    setPending(true);
    setError(null);
    try {
      await adminDeployApi.forceStop(app.id, reason.trim());
      toast.success(`${app.slug} 공개본을 강제 중지했어요`);
      refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{app.slug} 공개본 강제 중지</DialogTitle>
          <DialogDescription>
            {pub ? `${displayUrl(pub.url)} 공개본 v${pub.version}를 내려요. ` : ''}작업본에는 영향 없음 — {app.team} 팀은 계속 쓸 수
            있어요. 팀에 사유와 함께 알림이 가요.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="force-stop-reason" className="text-[13px]">
            사유 <span className="text-danger">*</span>
          </Label>
          <Textarea id="force-stop-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
        </div>
        {error && <FormAlert message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!reason.trim() || pending}>
            {pending && <Loader2 className="animate-spin" />}
            공개본 강제 중지
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResumeDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const refresh = useRefreshDeploy();
  const [pending, setPending] = useState(false);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${app.slug} 강제 중지를 해제할까요?`}
      description={`공개본 v${app.public?.version ?? ''}가 다시 열려요. ${app.team} 팀에 알림이 가요.${
        app.public?.statusDetail ? ` 중지 사유: ${app.public.statusDetail}` : ''
      }`}
      confirmLabel="강제 중지 해제"
      pending={pending}
      onConfirm={async () => {
        setPending(true);
        try {
          await adminDeployApi.resume(app.id);
          toast.success(`${app.slug} 공개본을 다시 열고 있어요`);
          refresh();
          onClose();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

// ── 처리 이력

const RESULT: Record<DeployRequest['status'], { label: string; dot: DotKind }> = {
  pending: { label: '검토 중', dot: 'warning' },
  approved: { label: '승인', dot: 'success' },
  rejected: { label: '반려', dot: 'danger' },
  cancelled: { label: '취소됨', dot: 'muted' },
};

function HistoryTab() {
  const q = useQuery({
    queryKey: appKeys.adminRequests('decided'),
    queryFn: async () => (await adminDeployApi.requests('decided')).items,
  });
  const items = [...(q.data ?? [])].sort((a, b) => (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt));
  return (
    <div className="overflow-hidden rounded-xl border">
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState title="처리 이력을 불러오지 못했어요" error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={History} title="아직 처리한 요청이 없어요" />
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>처리 시각</TableHead>
                <TableHead>앱</TableHead>
                <TableHead>종류</TableHead>
                <TableHead>결과</TableHead>
                <TableHead>처리자</TableHead>
                <TableHead>메모</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => {
                const res = RESULT[r.status];
                const memo =
                  r.status === 'approved'
                    ? r.kind === 'publish'
                      ? `v${r.approvedVersion ?? 1} 공개`
                      : `v${r.fromVersion ?? '?'}→v${r.approvedVersion ?? '?'}`
                    : r.status === 'cancelled'
                      ? '요청자가 취소'
                      : (r.decisionNote ?? '—');
                return (
                  <TableRow key={r.id} className="h-12">
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{formatTime(r.decidedAt ?? r.requestedAt)}</TableCell>
                    <TableCell>
                      <span className="font-mono text-[13px] font-medium">{r.app.slug}</span>
                      <span className="text-xs text-muted-foreground"> · {r.app.team}</span>
                    </TableCell>
                    <TableCell>
                      <KindBadge req={{ ...r, fromVersion: r.fromVersion }} />
                    </TableCell>
                    <TableCell>
                      <DotBadge dot={res.dot} label={res.label} />
                    </TableCell>
                    <TableCell>{r.decidedBy?.name ?? (r.status === 'cancelled' ? <Requester user={r.requestedBy} /> : '—')}</TableCell>
                    <TableCell className="max-w-[320px] truncate text-[13px]" title={memo}>
                      {memo}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
