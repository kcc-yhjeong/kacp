import { useQueryClient } from '@tanstack/react-query';
import { Info, Loader2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { Stepper, type Step } from '@/components/stepper';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { appApi, invalidateApp, useAppDetail } from '@/lib/apps/api';
import { copyStateOf, hostnameOf, lastRejection, nextVersion, pendingLabel, publishShape } from '@/lib/apps/status';
import type { App, AppDetail, DeployRequest } from '@/lib/apps/types';
import { formatTime } from '@/lib/format';
import { currentHost } from '@/lib/host';
import { AppStatusBadge, DotBadge, PendingBadge, PrivateBadge, PublicBadge } from './badges';
import { Requester, UrlLine } from './common';
import { NameField, useNameCheck } from './name-field';

const base = () => currentHost.base ?? 'kacp.cloud';

/** U-03 공개 설정: three shapes by state — not public / request in review / public. No Private/Public radio. */
export function PublishDialog({
  app,
  open,
  onOpenChange,
}: {
  app: Pick<App, 'id' | 'slug' | 'team'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useAppDetail(app.id, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>공개 설정</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{app.slug}</span> · {app.team}
          </DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <div className="grid h-40 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : detail.isError ? (
          <>
            <FormAlert message={errorMessage(detail.error)} />
            <DialogFooter>
              <Button variant="outline" onClick={() => void detail.refetch()}>
                다시 시도
              </Button>
            </DialogFooter>
          </>
        ) : (
          <PublishBody detail={detail.data} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PublishBody({ detail, onClose }: { detail: AppDetail; onClose: () => void }) {
  const shape = publishShape(detail);
  if (shape === 'pending') return <PendingView detail={detail} onClose={onClose} />;
  if (shape === 'public') return <PublicView detail={detail} onClose={onClose} />;
  return <UnpublishedForm detail={detail} onClose={onClose} />;
}

function useRequest(detail: AppDetail) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (body: { name: string; reason: string } | { reason: string }) => {
    setPending(true);
    setError(null);
    try {
      await appApi.requestPublish(detail.id, body);
      toast.success('요청했어요. 플랫폼 관리자가 검토하면 알려 드려요');
      await invalidateApp(qc, detail);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'DEPLOY_ALREADY_PENDING') void invalidateApp(qc, detail);
    } finally {
      setPending(false);
    }
  };
  return { submit, pending, error };
}

// ── (1) Not public yet

function UnpublishedForm({ detail, onClose }: { detail: AppDetail; onClose: () => void }) {
  const [name, setName] = useState(detail.slug);
  const [reason, setReason] = useState('');
  const check = useNameCheck(name);
  const req = useRequest(detail);
  const rejected = lastRejection(detail);
  const canSubmit = check.state === 'ok' && reason.trim().length > 0 && !req.pending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) void req.submit({ name, reason: reason.trim() });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-pretty">
        팀 밖의 모든 사원에게 공개하려면 관리자 승인이 필요해요. 승인 전까지는 지금처럼 팀만 볼 수 있어요.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <CopyBox title="작업본 · 지금" badge={<PrivateBadge small />} host={hostnameOf(detail.work.url)} />
        <CopyBox title="공개본 · 승인되면 생겨요" badge={<PublicBadge version={1} small />} host={`${name || detail.slug}.${base()}`} muted />
      </div>
      {rejected && <RejectionBox req={rejected} />}
      <NameField id="publish-name" label="공개 주소 이름" value={name} onChange={setName} check={check} disabled={req.pending} />
      <ReasonField
        id="publish-reason"
        label="공개 이유"
        value={reason}
        onChange={setReason}
        placeholder="어떤 팀이 어떻게 쓰면 좋은지 적어 주세요"
        disabled={req.pending}
      />
      <Note>승인되는 순간의 작업본이 공개본 v1로 복사돼요. 이후 작업본을 고쳐도 공개본은 그대로예요.</Note>
      {req.error && <FormAlert message={req.error} />}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={req.pending}>
          취소
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {req.pending && <Loader2 className="animate-spin" />}
          공개 요청
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── (2) Request in review

export function requestSteps(req: Pick<DeployRequest, 'kind' | 'fromVersion' | 'requestedAt'>, publicVersion?: number | null): Step[] {
  return [
    { label: '요청됨', state: 'done', sub: formatTime(req.requestedAt) },
    { label: '검토 중', state: 'current' },
    { label: '승인', state: 'todo' },
    { label: `v${nextVersion(req, publicVersion)} 공개됨`, state: 'todo' },
  ];
}

function PendingView({ detail, onClose }: { detail: AppDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const req = detail.currentRequest;
  const kind = req?.kind ?? detail.pendingRequest?.kind ?? 'publish';
  const label = pendingLabel(detail) ?? '검토 중';
  const publicHost = detail.public ? hostnameOf(detail.public.url) : null;

  const onCancel = async () => {
    setCancelling(true);
    try {
      await appApi.cancelRequest(detail.id);
      toast.success('요청을 취소했어요');
      await invalidateApp(qc, detail);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {detail.public && <PublicBadge version={detail.public.version} />}
        <PendingBadge label={label} />
      </div>
      {req && <Stepper steps={requestSteps(req, detail.public?.version)} className="py-1" />}
      {req && (
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2.5 rounded-xl border px-4 py-3.5 text-[13.5px]">
          {kind === 'publish' ? (
            <>
              <dt className="text-muted-foreground">공개 주소</dt>
              <dd className="font-mono text-[13px]">
                {req.requestedName ?? detail.slug}.{base()}
              </dd>
              <dt className="text-muted-foreground">공개 이유</dt>
              <dd className="text-pretty whitespace-pre-wrap">{req.reason}</dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">변경 내용</dt>
              <dd className="text-pretty whitespace-pre-wrap">{req.reason}</dd>
            </>
          )}
          <dt className="text-muted-foreground">요청</dt>
          <dd className="flex items-center gap-1.5">
            <Requester user={req.requestedBy} />
            <span className="text-muted-foreground">· {formatTime(req.requestedAt)}</span>
          </dd>
        </dl>
      )}
      {kind === 'update' && detail.public ? (
        <Note>
          검토 중에도 v{detail.public.version}는 계속 공개돼요. 승인되면 <span className="font-mono">{publicHost}</span>가 v
          {detail.public.version + 1}로 바뀌어요.
        </Note>
      ) : (
        <Note>승인되면 그 시점의 작업본이 공개본 v1로 복사돼요. 요청은 팀원 누구나 취소할 수 있어요.</Note>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={cancelling}>
          {cancelling && <Loader2 className="animate-spin" />}
          요청 취소
        </Button>
        <Button onClick={onClose}>닫기</Button>
      </DialogFooter>
    </div>
  );
}

// ── (3) Public

function PublicView({ detail, onClose }: { detail: AppDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const pub = detail.public;
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const req = useRequest(detail);
  const rejected = lastRejection(detail);
  if (!pub) return null;
  const adminStopped = copyStateOf(pub) === 'admin';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim() && !req.pending) void req.submit({ reason: reason.trim() });
  };

  const onUnpublish = async () => {
    setUnpublishing(true);
    try {
      await appApi.unpublish(detail.id);
      toast.success(`${detail.slug} 공개를 중지했어요. 작업본은 그대로 있어요`);
      setConfirm(false);
      await invalidateApp(qc, detail);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUnpublishing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <PublicBadge version={pub.version} />
      </div>
      <div className="flex flex-col gap-3 rounded-xl border px-4 py-3.5 text-[13.5px]">
        <div className="flex items-center gap-2">
          <span className="font-medium">공개본</span>
          <AppStatusBadge copy={pub} />
        </div>
        <UrlLine url={pub.url} />
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2">
          <dt className="text-muted-foreground">버전</dt>
          <dd>v{pub.version} · 승인 시점 상태</dd>
          <dt className="text-muted-foreground">승인 시각</dt>
          <dd className="tabular-nums">{formatTime(pub.publishedAt)}</dd>
          <dt className="text-muted-foreground">승인자</dt>
          <dd>{pub.approvedBy?.name ?? '플랫폼 관리자'}</dd>
          {adminStopped && (
            <>
              <dt className="text-muted-foreground">중지 사유</dt>
              <dd className="text-pretty">{pub.statusDetail ?? '—'}</dd>
            </>
          )}
        </dl>
      </div>
      {rejected && <RejectionBox req={rejected} publicVersion={pub.version} />}
      <form onSubmit={onSubmit} className="flex flex-col gap-2.5 rounded-xl border px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{rejected ? '다시 요청' : '업데이트 요청'}</span>
          <span className="text-[13px] text-muted-foreground">
            작업본의 지금 내용으로 공개본을 갱신해요. 승인되면 v{pub.version + 1}이 돼요.
          </span>
        </div>
        <ReasonField
          id="update-reason"
          label="변경 내용"
          value={reason}
          onChange={setReason}
          placeholder="무엇이 바뀌었는지 적어 주세요"
          disabled={req.pending}
          rows={2}
        />
        {req.error && <FormAlert message={req.error} />}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!reason.trim() || req.pending}>
            {req.pending && <Loader2 className="animate-spin" />}
            {rejected ? '다시 요청' : '업데이트 요청'}
          </Button>
        </div>
      </form>
      {detail.canManage && (
        <div className="flex items-center gap-3 rounded-xl border px-4 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">
              공개 중지 <span className="text-xs font-normal text-muted-foreground">· 팀 관리자만</span>
            </span>
            <span className="text-[13px] text-pretty text-muted-foreground">
              공개본과 공개 주소만 없어져요. 작업본은 남아요. 다른 팀이 이 주소를 쓸 수 있게 돼요.
            </span>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setConfirm(true)}>
            공개 중지
          </Button>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
      </DialogFooter>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`${detail.slug} 공개를 중지할까요?`}
        description={`${hostnameOf(pub.url)} 공개본과 공개 데이터가 없어지고, 이 이름은 반납돼요. 작업본은 그대로 남아요.`}
        confirmLabel="공개 중지"
        destructive
        pending={unpublishing}
        onConfirm={() => void onUnpublish()}
      />
    </div>
  );
}

// ── Pieces

function CopyBox({ title, badge, host, muted }: { title: string; badge: ReactNode; host: string; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border px-3.5 py-3">
      <span className="text-xs text-muted-foreground">{title}</span>
      <span>{badge}</span>
      <span className={muted ? 'truncate font-mono text-xs text-muted-foreground' : 'truncate font-mono text-xs'}>{host}</span>
    </div>
  );
}

function RejectionBox({ req, publicVersion }: { req: DeployRequest; publicVersion?: number }) {
  const title =
    req.kind === 'publish'
      ? '공개 요청'
      : `업데이트 요청 v${req.fromVersion ?? publicVersion ?? '?'}→v${nextVersion(req, publicVersion)}`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border px-4 py-3.5 text-[13.5px]">
      <div className="flex items-center gap-2">
        <span className="font-medium">{title}</span>
        <DotBadge dot="danger" label="반려됨" />
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2">
        <dt className="text-muted-foreground">반려 사유</dt>
        <dd className="text-pretty whitespace-pre-wrap">{req.decisionNote ?? '—'}</dd>
        <dt className="text-muted-foreground">처리</dt>
        <dd>
          {req.decidedBy?.name ?? '플랫폼 관리자'}
          {req.decidedAt && <span className="text-muted-foreground"> · {formatTime(req.decidedAt)}</span>}
        </dd>
      </dl>
      {publicVersion !== undefined && (
        <span className="text-xs text-muted-foreground">공개본 v{publicVersion}은 그대로 공개되고 있어요.</span>
      )}
    </div>
  );
}

function ReasonField({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label} <span className="text-danger">*</span>
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={500}
        rows={rows}
        disabled={disabled}
        required
      />
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-[13px] text-pretty text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </p>
  );
}
