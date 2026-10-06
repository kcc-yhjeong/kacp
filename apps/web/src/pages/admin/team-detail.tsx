import { TEAM_ROLE_LABEL, type TeamRole } from '@kacp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronRight,
  Cpu,
  Database,
  ExternalLink,
  Info,
  MemoryStick,
  Pencil,
  Play,
  Plug,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AdminTeamStatusBadge, ApplyStatusBadge, TeamRoleBadge } from '@/components/admin/badges';
import { DepartmentBulkPicker } from '@/components/admin/department-bulk';
import { EmptyState, ErrorState, Field, PageContainer, SectionCard } from '@/components/admin/page';
import { UserPicker } from '@/components/admin/user-picker';
import { TeamAppsTab } from '@/pages/admin/team-apps';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi, adminKeys, useAdminSettings, useTemplates } from '@/lib/admin/api';
import { formatBytes, formatMb, formatPct } from '@/lib/admin/format';
import type { AdminTeamDetail, AdminUser, ResourceLimits, TeamAgent } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { currentHost } from '@/lib/host';
import { cn } from '@/lib/utils';

const route = getRouteApi('/admin/teams/$team');
const baseDomain = currentHost.base ?? 'kacp.cloud';

function teamUrl(team: string): string {
  return `${currentHost.protocol}//${team}.${baseDomain}${currentHost.portSuffix}/`;
}

/** A-05 team detail. */
export function TeamDetailPage() {
  const { team } = route.useParams();
  const detail = useQuery({
    queryKey: adminKeys.team(team),
    queryFn: () => adminApi.team(team),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const busy = d.status.status === 'starting' || d.status.status === 'stopping';
      const provisioning = d.provisionStage !== 'done' && d.provisionStage !== 'failed';
      const applying = d.agents.some((a) => a.applyStatus === 'pending');
      return busy || provisioning ? 2000 : applying ? 5000 : false;
    },
  });

  if (detail.isPending) return <PageLoader />;
  if (detail.isError)
    return (
      <PageContainer>
        <ErrorState title="팀을 불러오지 못했어요" error={detail.error} onRetry={() => void detail.refetch()} />
      </PageContainer>
    );
  return <TeamDetail team={detail.data} />;
}

function useRefreshTeam(name: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.team(name) });
    void queryClient.invalidateQueries({ queryKey: adminKeys.teams('') });
    void queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
    void queryClient.invalidateQueries({ queryKey: adminKeys.templates });
  };
}

function TeamDetail({ team }: { team: AdminTeamDetail }) {
  const [tab, setTab] = useState('members');
  return (
    <PageContainer>
      <TeamHeader team={team} />
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="members">멤버 {team.members.length}</TabsTrigger>
          <TabsTrigger value="agents">에이전트 할당 {team.agents.length}</TabsTrigger>
          <TabsTrigger value="resources">리소스</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="apps">앱</TabsTrigger>
          <TabsTrigger value="danger">위험 영역</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab team={team} />
        </TabsContent>
        <TabsContent value="agents">
          <AgentsTab team={team} />
        </TabsContent>
        <TabsContent value="resources">
          <ResourcesTab team={team} />
        </TabsContent>
        <TabsContent value="mcp">
          <div className="rounded-xl border">
            {(team.mcpInstalls?.length ?? 0) === 0 ? (
              <EmptyState icon={Plug} title="아직 설치된 MCP가 없어요" description="팀 관리자가 MCP 마켓에서 설치하면 여기에 보여요" />
            ) : (
              <div className="px-5 py-4 text-sm">설치된 MCP {team.mcpInstalls?.length}개</div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="apps">
          <TeamAppsTab team={team.name} />
        </TabsContent>
        <TabsContent value="danger">
          <DangerTab team={team} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function TeamHeader({ team }: { team: AdminTeamDetail }) {
  const refresh = useRefreshTeam(team.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(team.displayName);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'stop' | 'restart' | null>(null);
  const s = team.status.status;
  const provisioning = team.provisionStage !== 'done' && team.provisionStage !== 'failed';

  const rename = async () => {
    const v = draft.trim();
    if (!v || v === team.displayName) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await adminApi.renameTeam(team.name, v);
      toast.success('표시 이름을 바꿨어요');
      setEditing(false);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try {
      await adminApi.container(team.name, action);
      toast.success(action === 'start' ? '시작을 요청했어요' : action === 'stop' ? '정지를 요청했어요' : '재시작을 요청했어요');
      setConfirm(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <Link to="/admin/teams" className="hover:text-foreground">
          팀
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-mono text-foreground">{team.name}</span>
        <span className="ml-2">표시 이름만 고칠 수 있어요 · 팀 이름·주소는 바꿀 수 없어요</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="h-9 w-64 text-lg font-semibold"
                aria-label="표시 이름"
              />
              <Button size="icon" className="size-9" aria-label="저장" disabled={busy} onClick={() => void rename()}>
                <Check />
              </Button>
              <Button size="icon" variant="outline" className="size-9" aria-label="취소" onClick={() => setEditing(false)}>
                <X />
              </Button>
            </div>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              {team.displayName}
              <button
                type="button"
                aria-label="표시 이름 수정"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  setDraft(team.displayName);
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" strokeWidth={1.75} />
              </button>
            </h1>
          )}
          <div className="flex items-center gap-3 text-sm">
            <a href={teamUrl(team.name)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs underline underline-offset-2">
              {team.name}.{baseDomain}
              <ExternalLink className="size-3" />
            </a>
            <AdminTeamStatusBadge status={s} />
            {team.status.activeUsers > 0 && <span className="text-xs text-muted-foreground">접속 {team.status.activeUsers}명</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy || provisioning || s === 'running' || s === 'starting'} onClick={() => void control('start')}>
            <Play strokeWidth={1.75} />
            시작
          </Button>
          <Button variant="outline" size="sm" disabled={busy || provisioning || s === 'stopped' || s === 'stopping'} onClick={() => setConfirm('stop')}>
            <Square strokeWidth={1.75} />
            정지
          </Button>
          <Button variant="outline" size="sm" disabled={busy || provisioning || s === 'starting' || s === 'stopping'} onClick={() => setConfirm('restart')}>
            <RotateCw strokeWidth={1.75} />
            재시작
          </Button>
        </div>
      </div>
      {s === 'error' && team.status.detail && (
        <div className="flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
          <span className="font-mono text-xs whitespace-pre-wrap">{team.status.detail}</span>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm === 'stop' ? `${team.displayName} 팀 에이전트를 정지할까요?` : `${team.displayName} 팀 에이전트를 재시작할까요?`}
        description={
          team.status.activeUsers > 0
            ? `지금 접속 중인 ${team.status.activeUsers}명의 연결이 끊겨요.`
            : confirm === 'stop'
              ? '다음에 팀원이 접속하면 다시 켜져요.'
              : '잠깐 연결이 끊겼다가 다시 켜져요.'
        }
        confirmLabel={confirm === 'stop' ? '정지' : '재시작'}
        pending={busy}
        onConfirm={() => confirm && void control(confirm)}
      />
    </div>
  );
}

function MembersTab({ team }: { team: AdminTeamDetail }) {
  const refresh = useRefreshTeam(team.name);
  const [bulk, setBulk] = useState<AdminUser[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const memberIds = useMemo(() => new Set(team.members.map((m) => m.user.id)), [team.members]);
  const deptCount = new Set(team.members.map((m) => m.user.departmentName).filter(Boolean)).size;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setPending(true);
    try {
      await fn();
      toast.success(ok);
      await refresh();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title={
          <>
            멤버 {team.members.length}명 <span className="font-normal text-muted-foreground">· {deptCount}개 부서</span>
          </>
        }
        bodyClassName="grid grid-cols-1 gap-4 p-5 md:grid-cols-2"
      >
        <Field label="사람 검색">
          <UserPicker excludeIds={memberIds} keepOpen onPick={(u) => void run(() => adminApi.addMembers(team.name, [u.id]), `${u.name}을(를) 추가했어요`)} />
        </Field>
        <Field label="부서 단위로 추가">
          <DepartmentBulkPicker excludeIds={memberIds} onSelectionChange={setBulk} resetKey={resetKey} />
          {bulk.length > 0 && (
            <div>
              <Button
                size="sm"
                disabled={pending}
                onClick={async () => {
                  if (await run(() => adminApi.addMembers(team.name, bulk.map((u) => u.id)), `${bulk.length}명을 추가했어요`)) setResetKey((k) => k + 1);
                }}
              >
                {bulk.length}명 추가
              </Button>
            </div>
          )}
        </Field>
      </SectionCard>
      <div className="overflow-hidden rounded-xl border">
        {team.members.length === 0 ? (
          <EmptyState icon={Search} title="아직 멤버가 없어요" description="사람을 검색하거나 부서 단위로 추가하세요" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>부서</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>팀 역할</TableHead>
                <TableHead>추가된 날</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members.map((m) => (
                <TableRow key={m.user.id}>
                  <TableCell className="font-medium">
                    <Link to="/admin/users/$userId" params={{ userId: m.user.id }} className="hover:underline">
                      {m.user.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate">{m.user.departmentName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{m.user.email}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <TeamRoleBadge role={m.teamRole} />
                      <NativeSelect
                        aria-label={`${m.user.name} 팀 역할`}
                        value={m.teamRole}
                        disabled={pending}
                        className="[&_select]:h-7 [&_select]:text-xs"
                        onChange={(e) =>
                          void run(
                            () => adminApi.setMemberRole(team.name, m.user.id, e.target.value as TeamRole),
                            `${m.user.name}을(를) ${TEAM_ROLE_LABEL[e.target.value as TeamRole]}(으)로 바꿨어요`,
                          )
                        }
                      >
                        <option value="member">{TEAM_ROLE_LABEL.member}</option>
                        <option value="team_admin">{TEAM_ROLE_LABEL.team_admin}</option>
                      </NativeSelect>
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{formatTime(m.addedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setRemoving({ id: m.user.id, name: m.user.name })}>
                      제거
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`${removing?.name ?? ''}을(를) ${team.displayName}에서 뺄까요?`}
        description="팀 에이전트와 팀 드라이브를 더 쓸 수 없어요. 내 드라이브 파일은 남아요."
        confirmLabel="제거"
        destructive
        pending={pending}
        onConfirm={async () => {
          if (removing && (await run(() => adminApi.removeMember(team.name, removing.id), `${removing.name}을(를) 뺐어요`))) setRemoving(null);
        }}
      />
    </div>
  );
}

function AgentsTab({ team }: { team: AdminTeamDetail }) {
  const refresh = useRefreshTeam(team.name);
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassign, setUnassign] = useState<TeamAgent | null>(null);
  const [pending, setPending] = useState(false);
  const running = team.status.status === 'running';
  const lastApplied = team.agents
    .map((a) => a.appliedAt)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);

  const doUnassign = async () => {
    if (!unassign) return;
    setPending(true);
    try {
      await adminApi.unassignAgent(team.name, unassign.template.id);
      toast.success(`${unassign.template.name} 할당을 해제했어요`);
      setUnassign(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[13px] text-muted-foreground">{lastApplied ? `마지막 반영 ${formatTime(lastApplied)}` : ''}</span>
        <Button size="sm" onClick={() => setAssignOpen(true)}>
          <Plus strokeWidth={1.75} />
          에이전트 할당
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border">
        {team.agents.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="아직 할당된 에이전트가 없어요"
            description="템플릿을 할당하면 팀원이 셸에서 바로 쓸 수 있어요"
            action={
              <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                에이전트 할당
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>템플릿</TableHead>
                <TableHead>버전</TableHead>
                <TableHead>적용 상태</TableHead>
                <TableHead>마지막 반영</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.agents.map((a) => (
                <TableRow key={a.template.id}>
                  <TableCell>
                    <Link to="/admin/agents/$templateId" params={{ templateId: a.template.id }} className="flex items-center gap-2 hover:underline">
                      <span className="text-base">{a.template.icon || '🤖'}</span>
                      <span className="font-medium">{a.template.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums">
                    v{a.templateVersion}
                    {a.appliedVersion !== null && a.appliedVersion !== a.templateVersion && (
                      <span className="text-muted-foreground"> (반영 v{a.appliedVersion})</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      <ApplyStatusBadge status={a.applyStatus} />
                      {a.applyStatus === 'failed' && a.applyError && <span className="max-w-[260px] truncate text-xs text-muted-foreground">{a.applyError}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{a.appliedAt ? formatTime(a.appliedAt) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setUnassign(a)}>
                      해제
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {running && (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Info className="size-3.5" strokeWidth={1.75} />이 팀은 실행 중이에요. 할당을 바꾸면 팀 에이전트가 잠깐 재시작돼요.
        </p>
      )}
      <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} team={team} onDone={refresh} />
      <ConfirmDialog
        open={unassign !== null}
        onOpenChange={(v) => !v && setUnassign(null)}
        title={`${unassign?.template.name ?? ''} 할당을 해제할까요?`}
        description={running ? '팀 에이전트 목록에서 빠지고, 팀 에이전트가 잠깐 재시작돼요.' : '팀 에이전트 목록에서 빠져요.'}
        confirmLabel="해제"
        destructive
        pending={pending}
        onConfirm={() => void doUnassign()}
      />
    </div>
  );
}

function AssignDialog({
  open,
  onOpenChange,
  team,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  team: AdminTeamDetail;
  onDone: () => Promise<void>;
}) {
  const templates = useTemplates();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const assigned = new Set(team.agents.map((a) => a.template.id));
  const running = team.status.status === 'running';
  const list = (templates.data ?? []).filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()));

  useEffect(() => {
    if (!open) {
      setPicked(new Set());
      setQ('');
    }
  }, [open]);

  const submit = async () => {
    setPending(true);
    try {
      await adminApi.assignAgents(team.name, [...picked]);
      toast.success(`${picked.size}개를 할당했어요. 반영 대기로 표시돼요.`);
      onOpenChange(false);
      await onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>에이전트 할당</DialogTitle>
          <DialogDescription>{team.displayName}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="템플릿 검색" className="pl-8" />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {templates.isPending && <div className="px-3 py-2 text-sm text-muted-foreground">불러오는 중이에요</div>}
          {templates.isError && <div className="px-3 py-2 text-sm text-muted-foreground">{errorMessage(templates.error)}</div>}
          {templates.data?.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              아직 템플릿이 없어요.{' '}
              <Link to="/admin/agents/new" search={{}} className="underline">
                새 템플릿 만들기
              </Link>
            </div>
          )}
          {list.map((t) => {
            const done = assigned.has(t.id);
            return (
              <label
                key={t.id}
                className={cn('flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0', done ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50')}
              >
                <Checkbox
                  disabled={done}
                  checked={done || picked.has(t.id)}
                  onCheckedChange={(c) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (c === true) next.add(t.id);
                      else next.delete(t.id);
                      return next;
                    })
                  }
                />
                <span className="text-lg">{t.icon || '🤖'}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{t.description}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{done ? '할당됨' : `v${t.version}`}</span>
              </label>
            );
          })}
        </div>
        {running && picked.size > 0 && (
          <p className="flex items-start gap-1.5 text-[13px]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
            적용하면 팀 에이전트가 잠깐 재시작돼요.
            {team.status.activeUsers > 0 && ` 지금 접속 중인 ${team.status.activeUsers}명의 대화가 잠깐 끊겨요.`}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={picked.size === 0 || pending} onClick={() => void submit()}>
            {picked.size > 0 ? `${picked.size}개 할당` : '할당'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResourcesTab({ team }: { team: AdminTeamDetail }) {
  const refresh = useRefreshTeam(team.name);
  const settings = useAdminSettings();
  const defaults = settings.data?.limits.teamDefault;
  const [value, setValue] = useState<ResourceLimits>(team.resourceLimits);
  const [pending, setPending] = useState(false);
  useEffect(() => setValue(team.resourceLimits), [team.resourceLimits]);
  const dirty =
    value.cpu !== team.resourceLimits.cpu || value.memoryMb !== team.resourceLimits.memoryMb || value.diskGb !== team.resourceLimits.diskGb;
  const valid = value.cpu > 0 && value.memoryMb > 0 && value.diskGb > 0;
  const u = team.usage;

  const rows = [
    {
      key: 'cpu' as const,
      label: 'CPU',
      icon: Cpu,
      unit: '코어',
      step: 0.25,
      use: u ? formatPct(u.cpuPct) : '—',
      limit: `${team.resourceLimits.cpu}코어`,
      def: defaults ? `${defaults.cpu}코어` : '—',
    },
    {
      key: 'memoryMb' as const,
      label: '메모리',
      icon: MemoryStick,
      unit: 'MB',
      step: 256,
      use: u ? formatBytes(u.memBytes) : '—',
      limit: formatMb(team.resourceLimits.memoryMb),
      def: defaults ? formatMb(defaults.memoryMb) : '—',
    },
    {
      key: 'diskGb' as const,
      label: '디스크',
      icon: Database,
      unit: 'GB',
      step: 1,
      use: u ? formatBytes(u.diskBytes) : '—',
      limit: `${team.resourceLimits.diskGb}GB`,
      def: defaults ? `${defaults.diskGb}GB` : '—',
    },
  ];

  const save = async () => {
    setPending(true);
    try {
      await adminApi.resources(team.name, value);
      toast.success(team.status.status === 'running' ? '저장하고 실행 중인 팀에 바로 적용했어요' : '저장했어요');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-3 rounded-xl border p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{r.label}</span>
              <r.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
            </div>
            <span className="text-2xl font-semibold tabular-nums">
              {r.use} <span className="text-sm font-normal text-muted-foreground">/ {r.limit}</span>
            </span>
            <Field id={`res-${r.key}`} label={`한도 (${r.unit})`} hint={`기본값 ${r.def}`}>
              <Input
                id={`res-${r.key}`}
                type="number"
                min={r.step}
                step={r.step}
                value={value[r.key]}
                onChange={(e) => setValue((v) => ({ ...v, [r.key]: e.target.value === '' ? 0 : Number(e.target.value) }))}
              />
            </Field>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="text-[13px] text-muted-foreground">저장하면 실행 중인 팀에 바로 적용돼요</span>
        {defaults && (
          <Button variant="outline" onClick={() => setValue({ ...defaults })}>
            기본값으로
          </Button>
        )}
        <Button disabled={!dirty || !valid || pending} onClick={() => void save()}>
          저장
        </Button>
      </div>
    </div>
  );
}

function DangerTab({ team }: { team: AdminTeamDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const del = async () => {
    setPending(true);
    try {
      await adminApi.deleteTeam(team.name);
      toast.success(`${team.displayName}을(를) 삭제하고 있어요`);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: adminKeys.teamsAll });
      void navigate({ to: '/admin/teams' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex items-center gap-4 rounded-xl border border-destructive/40 p-5">
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-medium">팀 삭제</span>
        <span className="text-[13px] text-muted-foreground">컨테이너·라우트·앱(작업본과 공개본 모두)을 지워요. 데이터는 백업 폴더로 옮겨 30일 보관해요.</span>
      </div>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        팀 삭제
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${team.displayName}을(를) 삭제할까요?`}
        description={`멤버 ${team.members.length}명, 앱 ${team.apps?.length ?? 0}개가 함께 사라져요. 되돌릴 수 없어요.`}
        confirmLabel="팀 삭제"
        destructive
        typeToConfirm={team.name}
        pending={pending}
        onConfirm={() => void del()}
      />
    </div>
  );
}
