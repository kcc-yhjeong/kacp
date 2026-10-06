import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Download, FileText, GitCompare, Inbox, Loader2, ScanSearch, ShieldCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton, PageContainer, PageHeader, SectionCard } from '@/components/admin/page';
import { Dot } from '@/components/apps/badges';
import { Requester } from '@/components/apps/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { ScanCounts, VersionStatusBadge } from '@/components/mcp/badges';
import { FindingsTable, LogPanel, PermissionList, Section, ToolList } from '@/components/mcp/parts';
import { PageLoader } from '@/components/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { adminMcpApi, downloadVersionSource, mcpKeys, usePendingMcpReviews } from '@/lib/mcp/api';
import { changeCount } from '@/lib/mcp/status';
import type { AdminMcpVersionDetail } from '@/lib/mcp/types';

const detailRoute = getRouteApi('/admin/mcp/reviews/$versionId');

/** A-07 MCP 심사 목록 — `/admin/mcp/reviews`. */
export function McpReviewsPage() {
  const reviews = usePendingMcpReviews();
  const navigate = useNavigate();
  const items = reviews.data ?? [];
  return (
    <PageContainer>
      <PageHeader title="MCP 심사" description="빌드·보안 스캔·테스트를 통과한 버전이에요. 승인하면 마켓에 게시돼요." />
      <div className="overflow-hidden rounded-xl border">
        {reviews.isPending ? (
          <ListSkeleton />
        ) : reviews.isError ? (
          <ErrorState title="심사 목록을 불러오지 못했어요" error={reviews.error} onRetry={() => void reviews.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title="심사할 MCP가 없어요" description="개발자가 올린 버전이 검사를 통과하면 여기에 보여요" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>패키지</TableHead>
                <TableHead>버전</TableHead>
                <TableHead>올린 사람</TableHead>
                <TableHead>올린 시각</TableHead>
                <TableHead>보안 스캔</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((v) => (
                <TableRow
                  key={v.id}
                  className="cursor-pointer"
                  onClick={() => void navigate({ to: '/admin/mcp/reviews/$versionId', params: { versionId: v.id } })}
                >
                  <TableCell>
                    <Link
                      to="/admin/mcp/reviews/$versionId"
                      params={{ versionId: v.id }}
                      className="flex flex-col hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="font-medium">{v.manifest?.displayName ?? v.packageName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{v.packageName}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{v.version}</TableCell>
                  <TableCell className="text-[13px]">{v.uploadedBy ? <Requester user={v.uploadedBy} /> : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{formatTime(v.uploadedAt)}</TableCell>
                  <TableCell>
                    <ScanCounts summary={v.scanSummary} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageContainer>
  );
}

/** A-07 MCP 심사 상세 — `/admin/mcp/reviews/{versionId}`. */
export function McpReviewDetailPage() {
  const { versionId } = detailRoute.useParams();
  const q = useQuery({ queryKey: mcpKeys.adminVersion(versionId), queryFn: () => adminMcpApi.version(versionId) });
  if (q.isPending) return <PageLoader />;
  if (q.isError)
    return (
      <PageContainer>
        <ErrorState title="심사할 버전을 불러오지 못했어요" error={q.error} onRetry={() => void q.refetch()} />
      </PageContainer>
    );
  return <ReviewDetail v={q.data} />;
}

function ReviewDetail({ v }: { v: AdminMcpVersionDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const reviewable = v.status === 'in_review';
  const nChanges = changeCount(v.changes);

  const done = () => {
    void qc.invalidateQueries({ queryKey: mcpKeys.adminAll });
    void qc.invalidateQueries({ queryKey: mcpKeys.packagesAll });
    void navigate({ to: '/admin/mcp/reviews' });
  };

  const approve = async () => {
    setPending(true);
    try {
      await adminMcpApi.approve(v.id);
      toast.success(`${v.packageName} ${v.version}을(를) 게시했어요`);
      setApproveOpen(false);
      done();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadVersionSource(v.id, `${v.packageName}-${v.version}.zip`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <PageContainer>
      <div className="flex flex-col gap-2">
        <nav className="flex items-center gap-1 text-[13px] text-muted-foreground">
          <Link to="/admin/mcp/reviews" className="hover:text-foreground">
            MCP 심사
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="font-mono text-foreground">
            {v.packageName} {v.version}
          </span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
              <span className="font-mono">{v.packageName}</span>
              <span className="font-mono text-muted-foreground">{v.version}</span>
              <VersionStatusBadge status={v.status} />
            </h1>
            <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
              {v.uploadedBy ? <Requester user={v.uploadedBy} /> : '—'} · {formatTime(v.uploadedAt)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void download()} disabled={downloading}>
              {downloading ? <Loader2 className="animate-spin" /> : <Download strokeWidth={1.75} />}
              소스 zip
            </Button>
            {reviewable && (
              <>
                <Button variant="outline" onClick={() => setRejectOpen(true)}>
                  반려
                </Button>
                <Button onClick={() => setApproveOpen(true)}>승인</Button>
              </>
            )}
          </div>
        </div>
      </div>

      {!reviewable && (
        <div role="status" className="rounded-xl border px-4 py-3 text-[13px] text-muted-foreground">
          이미 처리된 버전이에요{v.reviewNote ? ` · ${v.reviewNote}` : ''}.
        </div>
      )}

      {v.previous && (
        <SectionCard
          icon={GitCompare}
          title={`이전 버전(${v.previous.version})과 달라진 점`}
          actions={
            nChanges > 0 ? (
              <Badge variant="outline">
                <Dot dot="warning" />
                권한·접속 대상 {nChanges}건
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">권한·접속 대상 변경 없음</span>
            )
          }
          bodyClassName={nChanges > 0 ? 'p-5' : 'hidden'}
        >
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {v.changes.networkAdded.map((d) => (
              <ChangeRow key={`na-${d}`} kind="add" label="접속 대상" value={d} />
            ))}
            {v.changes.secretsAdded.map((d) => (
              <ChangeRow key={`sa-${d}`} kind="add" label="비밀값" value={d} />
            ))}
            {v.changes.networkRemoved.map((d) => (
              <ChangeRow key={`nr-${d}`} kind="remove" label="접속 대상" value={d} />
            ))}
            {v.changes.secretsRemoved.map((d) => (
              <ChangeRow key={`sr-${d}`} kind="remove" label="비밀값" value={d} />
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard icon={ShieldCheck} title="매니페스트" bodyClassName="flex flex-col gap-3 p-5">
          {v.manifest && (
            <Section title="설명">
              <span className="text-[13px]">
                <span className="font-medium">{v.manifest.displayName}</span> · {v.manifest.summary}
              </span>
            </Section>
          )}
          <PermissionList manifest={v.manifest} highlight={{ secrets: v.changes.secretsAdded, network: v.changes.networkAdded }} />
        </SectionCard>
        <SectionCard icon={ScanSearch} title="보안 스캔" actions={<ScanCounts summary={v.scanSummary} />} bodyClassName="flex flex-col gap-3 p-5">
          <FindingsTable findings={v.findings} />
          <LogPanel pkg={v.packageName} ver={v.version} stage="scan" />
        </SectionCard>
      </div>

      <SectionCard icon={Wrench} title={`테스트 결과 · 도구 ${v.tools.length}개`} bodyClassName="flex flex-col gap-3 p-5">
        <ToolList tools={v.tools} />
        <LogPanel pkg={v.packageName} ver={v.version} stage="test" />
        <LogPanel pkg={v.packageName} ver={v.version} stage="build" />
      </SectionCard>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="size-3.5" strokeWidth={1.75} />
        승인하면 마켓에 바로 게시되고, 이미 설치한 팀은 팀 관리자가 다시 설치할 때까지 지금 버전을 써요.
      </p>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`${v.packageName} ${v.version}을(를) 승인할까요?`}
        description={
          nChanges > 0
            ? `이전 버전보다 권한·접속 대상이 ${nChanges}건 달라졌어요. 승인하면 마켓에 게시되고 팀 관리자가 설치할 수 있어요.`
            : '승인하면 마켓에 게시되고 팀 관리자가 설치할 수 있어요.'
        }
        confirmLabel="승인"
        pending={pending}
        onConfirm={() => void approve()}
      />
      <RejectDialog v={v} open={rejectOpen} onOpenChange={setRejectOpen} onDone={done} />
    </PageContainer>
  );
}

function ChangeRow({ kind, label, value }: { kind: 'add' | 'remove'; label: string; value: string }) {
  return (
    <li className="flex items-center gap-2">
      <Badge variant="outline" className="w-14 justify-center">
        <Dot dot={kind === 'add' ? 'warning' : 'muted'} />
        {kind === 'add' ? '추가' : '삭제'}
      </Badge>
      <span className="w-20 text-muted-foreground">{label}</span>
      <span className={kind === 'add' ? 'font-mono text-xs font-semibold' : 'font-mono text-xs text-muted-foreground line-through'}>{value}</span>
    </li>
  );
}

function RejectDialog({
  v,
  open,
  onOpenChange,
  onDone,
}: {
  v: AdminMcpVersionDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      await adminMcpApi.reject(v.id, note.trim());
      toast.success(`${v.packageName} ${v.version}을(를) 반려했어요. 올린 사람에게 사유가 보여요`);
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
          <DialogTitle>
            {v.packageName} {v.version} 반려
          </DialogTitle>
          <DialogDescription>올린 사람에게 사유와 함께 알려요. 설치한 팀은 이전 버전을 계속 써요.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mcp-reject-note" className="text-[13px]">
            반려 사유 <span className="text-danger">*</span>
          </Label>
          <Textarea id="mcp-reject-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
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
