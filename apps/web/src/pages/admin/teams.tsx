import { checkName, ERROR_MESSAGES } from '@kacp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, ChevronRight, Loader2, Plus, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AdminTeamStatusBadge } from '@/components/admin/badges';
import { DepartmentBulkPicker, type BulkUser } from '@/components/admin/department-bulk';
import { EmptyState, Field, ListState, PageContainer, PageHeader } from '@/components/admin/page';
import { useDebounced, UserChip, UserPicker } from '@/components/admin/user-picker';
import { FormAlert } from '@/components/form-alert';
import { Stepper, type Step } from '@/components/stepper';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi, adminKeys, useAdminSettings, useAdminTeams } from '@/lib/admin/api';
import { formatLimits } from '@/lib/admin/format';
import { PROVISION_STEPS } from '@/lib/admin/labels';
import type { AdminTeam, ProvisionStage, ResourceLimits, UserRef } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';
import { currentHost } from '@/lib/host';

const baseDomain = currentHost.base ?? 'kacp.cloud';

/** A-04 teams. */
export function TeamsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const teams = useAdminTeams(dq);
  const [createOpen, setCreateOpen] = useState(false);
  const items = teams.data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="팀"
        description="팀 이름이 곧 서브도메인이에요."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus strokeWidth={1.75} />팀 만들기
          </Button>
        }
      />
      <div className="relative w-[250px]">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="팀 이름 검색"
          aria-label="팀 이름 검색"
          className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      <div className="overflow-hidden rounded-xl border">
        <ListState
          isPending={teams.isPending}
          error={teams.error}
          isEmpty={items.length === 0}
          errorTitle="팀 목록을 불러오지 못했어요"
          onRetry={() => void teams.refetch()}
          empty={
            dq ? (
              <EmptyState icon={Search} title="찾는 팀이 없어요" description="다른 이름으로 검색해 보세요" />
            ) : (
              <EmptyState
                icon={Users}
                title="아직 팀이 없어요"
                description="첫 팀을 만들면 팀 주소와 에이전트가 준비돼요"
                action={
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    팀 만들기
                  </Button>
                }
              />
            )
          }
        />
        {items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>팀 이름</TableHead>
                <TableHead>표시 이름</TableHead>
                <TableHead>멤버</TableHead>
                <TableHead>팀 관리자</TableHead>
                <TableHead>에이전트</TableHead>
                <TableHead>컨테이너</TableHead>
                <TableHead>리소스 한도</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow
                  key={t.name}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => void navigate({ to: '/admin/teams/$team', params: { team: t.name } })}
                >
                  <TableCell className="font-mono text-[13px] font-medium">{t.name}</TableCell>
                  <TableCell>{t.displayName}</TableCell>
                  <TableCell className="tabular-nums">{t.memberCount}</TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {t.admins.length === 0 ? <span className="text-muted-foreground">—</span> : t.admins.map((a) => a.name).join(', ')}
                  </TableCell>
                  <TableCell className="tabular-nums">{t.agentCount}</TableCell>
                  <TableCell>
                    {t.provisionStage !== 'done' && t.provisionStage !== 'failed' ? (
                      <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        만드는 중
                      </span>
                    ) : (
                      <AdminTeamStatusBadge status={t.status.status} />
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground tabular-nums">{formatLimits(t.resourceLimits)}</TableCell>
                  <TableCell>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageContainer>
  );
}

type NameCheck = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; message: string };

function useNameCheck(name: string): NameCheck {
  const dn = useDebounced(name, 300);
  const local = name ? checkName(name) : null;
  const remote = useQuery({
    queryKey: ['names', 'check', dn],
    queryFn: () => adminApi.checkName(dn),
    enabled: dn.length > 0 && checkName(dn) === null,
    staleTime: 5_000,
  });
  if (!name) return { state: 'idle' };
  if (local) return { state: 'bad', message: ERROR_MESSAGES[local] };
  if (dn !== name || remote.isFetching || remote.isPending) return { state: 'checking' };
  if (remote.isError) return { state: 'bad', message: errorMessage(remote.error) };
  if (remote.data.available) return { state: 'ok' };
  const reason = remote.data.reason as keyof typeof ERROR_MESSAGES | null;
  return { state: 'bad', message: reason && reason in ERROR_MESSAGES ? ERROR_MESSAGES[reason] : '쓸 수 없는 이름이에요.' };
}

function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [created, setCreated] = useState<AdminTeam | null>(null);
  const [formKey, setFormKey] = useState(0);
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setCreated(null);
      setFormKey((k) => k + 1);
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl">
        {created ? (
          <ProvisionProgress team={created} onClose={() => close(false)} />
        ) : (
          <CreateTeamForm key={formKey} onCreated={setCreated} onCancel={() => close(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateTeamForm({ onCreated, onCancel }: { onCreated: (t: AdminTeam) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const settings = useAdminSettings();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [admins, setAdmins] = useState<UserRef[]>([]);
  const [individuals, setIndividuals] = useState<UserRef[]>([]);
  const [bulk, setBulk] = useState<BulkUser[]>([]);
  const [customLimits, setCustomLimits] = useState<ResourceLimits | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useNameCheck(name);
  const defaults = settings.data?.limits.teamDefault;
  const adminIds = useMemo(() => new Set(admins.map((a) => a.id)), [admins]);
  const memberIds = useMemo(() => {
    const ids = new Set<string>(individuals.map((u) => u.id));
    for (const u of bulk) ids.add(u.id);
    for (const id of adminIds) ids.delete(id);
    return ids;
  }, [individuals, bulk, adminIds]);

  const canSubmit = check.state === 'ok' && displayName.trim().length > 0 && admins.length > 0 && !pending;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const team = await adminApi.createTeam({
        name,
        displayName: displayName.trim(),
        adminEmails: admins.map((a) => a.email),
        memberUserIds: [...memberIds],
        resourceLimits: customLimits ?? undefined,
      });
      void queryClient.invalidateQueries({ queryKey: adminKeys.teamsAll });
      onCreated(team);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>팀 만들기</DialogTitle>
        <DialogDescription>만들면 팀 주소와 팀 에이전트가 준비돼요.</DialogDescription>
      </DialogHeader>
      {error && <FormAlert message={error} />}
      <Field
        id="t-name"
        label="팀 이름"
        hint="소문자·숫자·하이픈, 3~30자, 하이픈으로 시작·끝 불가, -- 불가, 예약어 불가 · 만든 뒤 바꿀 수 없어요"
      >
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-md border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <input
              id="t-name"
              value={name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value.toLowerCase())}
              className="h-9 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none"
              aria-invalid={check.state === 'bad'}
            />
            <span className="pr-3 font-mono text-xs text-muted-foreground">.{baseDomain}</span>
          </div>
        </div>
        <NameStatus check={check} />
      </Field>
      <Field id="t-display" label="표시 이름">
        <Input id="t-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="팀 관리자">
        {admins.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {admins.map((a) => (
              <UserChip key={a.id} user={a} onRemove={() => setAdmins((prev) => prev.filter((x) => x.id !== a.id))} />
            ))}
          </div>
        )}
        <UserPicker excludeIds={adminIds} onPick={(u) => setAdmins((prev) => [...prev, u])} />
      </Field>
      <Field label="초기 멤버 (선택)" hint="다른 부서 사람은 만든 뒤 멤버 탭에서 더할 수도 있어요">
        <DepartmentBulkPicker excludeIds={adminIds} onSelectionChange={setBulk} />
        {individuals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {individuals.map((u) => (
              <UserChip key={u.id} user={u} onRemove={() => setIndividuals((prev) => prev.filter((x) => x.id !== u.id))} />
            ))}
          </div>
        )}
        <UserPicker
          placeholder="한 명씩 추가"
          excludeIds={new Set([...adminIds, ...individuals.map((u) => u.id)])}
          onPick={(u) => setIndividuals((prev) => [...prev, u])}
        />
        {memberIds.size > 0 && <span className="text-xs text-muted-foreground">팀원 {memberIds.size}명을 함께 추가해요</span>}
      </Field>
      <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="flex-1">
            리소스 한도 {customLimits ? '' : '기본값'} · {formatLimits(customLimits ?? defaults)}
          </span>
          {defaults && (
            <button type="button" className="text-[13px] underline underline-offset-2" onClick={() => setCustomLimits(customLimits ? null : { ...defaults })}>
              {customLimits ? '기본값 쓰기' : '바꾸기'}
            </button>
          )}
        </div>
        {customLimits && <LimitsInputs value={customLimits} onChange={setCustomLimits} />}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          만들기
        </Button>
      </DialogFooter>
    </form>
  );
}

function LimitsInputs({ value, onChange }: { value: ResourceLimits; onChange: (v: ResourceLimits) => void }) {
  const num = (s: string) => (s === '' ? 0 : Number(s));
  return (
    <div className="grid grid-cols-3 gap-2">
      <Field id="l-cpu" label="CPU (코어)">
        <Input id="l-cpu" type="number" min={0.25} step={0.25} value={value.cpu} onChange={(e) => onChange({ ...value, cpu: num(e.target.value) })} />
      </Field>
      <Field id="l-mem" label="메모리 (MB)">
        <Input id="l-mem" type="number" min={256} step={256} value={value.memoryMb} onChange={(e) => onChange({ ...value, memoryMb: Math.round(num(e.target.value)) })} />
      </Field>
      <Field id="l-disk" label="디스크 (GB)">
        <Input id="l-disk" type="number" min={1} step={1} value={value.diskGb} onChange={(e) => onChange({ ...value, diskGb: Math.round(num(e.target.value)) })} />
      </Field>
    </div>
  );
}

function NameStatus({ check }: { check: NameCheck }) {
  if (check.state === 'idle') return null;
  if (check.state === 'checking')
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        확인하는 중이에요
      </span>
    );
  if (check.state === 'ok')
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <Check className="size-3.5 text-success" strokeWidth={2.25} />
        사용 가능
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs" role="alert">
      <X className="size-3.5 text-danger" strokeWidth={2.25} />
      사용 불가 · {check.message}
    </span>
  );
}

const STAGE_ORDER: ProvisionStage[] = ['name', 'storage', 'container', 'default_mcp', 'done'];

/** Polls GET /admin/teams/{team} until provisionStage is done or failed. */
function ProvisionProgress({ team, onClose }: { team: AdminTeam; onClose: () => void }) {
  const [lastStage, setLastStage] = useState<ProvisionStage>(team.provisionStage);
  const detail = useQuery({
    queryKey: adminKeys.team(team.name),
    queryFn: () => adminApi.team(team.name),
    refetchInterval: (q) => {
      const s = q.state.data?.provisionStage;
      return s === 'done' || s === 'failed' ? false : 1500;
    },
  });
  const stage = detail.data?.provisionStage ?? team.provisionStage;
  if (stage !== 'failed' && stage !== lastStage) setLastStage(stage);

  const failedAt = stage === 'failed' ? Math.max(0, STAGE_ORDER.indexOf(lastStage)) : -1;
  const currentIdx = stage === 'failed' ? failedAt : STAGE_ORDER.indexOf(stage);
  const steps: Step[] = PROVISION_STEPS.map((s, i) => ({
    label: s.label,
    state: stage === 'failed' && i === failedAt ? 'failed' : i < currentIdx || stage === 'done' ? 'done' : i === currentIdx ? 'current' : 'todo',
  }));
  const done = stage === 'done';
  const failed = stage === 'failed';
  const queryClient = useQueryClient();
  useEffect(() => {
    if (done || failed) void queryClient.invalidateQueries({ queryKey: adminKeys.teamsAll });
  }, [done, failed, queryClient]);

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>
          {done ? `${team.displayName}을(를) 만들었어요` : failed ? `${team.displayName}을(를) 만들지 못했어요` : `${team.displayName}을(를) 만들고 있어요`}
        </DialogTitle>
        <DialogDescription>
          {done
            ? `${team.name}.${baseDomain} 주소가 준비됐어요.`
            : failed
              ? detail.data?.status.detail || '팀 상세에서 상태를 확인하고 다시 시작해 보세요.'
              : '창을 닫아도 계속 진행돼요.'}
        </DialogDescription>
      </DialogHeader>
      <Stepper steps={steps} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
        {(done || failed) && (
          <Button asChild>
            <Link to="/admin/teams/$team" params={{ team: team.name }} onClick={onClose}>
              팀 상세로
            </Link>
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
