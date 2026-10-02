import { TEAM_ROLE_LABEL, type PlatformRole, type TeamRole } from '@kacp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ChevronRight, History, KeyRound, LogIn, Plus, RotateCw, TriangleAlert, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { UserStatusBadge } from '@/components/admin/badges';
import { DepartmentSelect } from '@/components/admin/department-select';
import { Avatar, CopyField, ErrorState, Field, PageContainer, PageHeader, SectionCard } from '@/components/admin/page';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageLoader } from '@/components/page-loader';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SegmentList, SegmentTrigger, Tabs } from '@/components/ui/tabs';
import { adminApi, adminKeys, useAdminTeams } from '@/lib/admin/api';
import { auditActionLabel, auditTargetLabel } from '@/lib/admin/labels';
import type { AdminUserDetail, AuditEvent } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';

const route = getRouteApi('/admin/users/$userId');

/** A-03 user detail. */
export function UserDetailPage() {
  const { userId } = route.useParams();
  const user = useQuery({ queryKey: adminKeys.user(userId), queryFn: () => adminApi.user(userId) });

  if (user.isPending) return <PageLoader />;
  if (user.isError)
    return (
      <PageContainer>
        <ErrorState title="사용자를 불러오지 못했어요" error={user.error} onRetry={() => void user.refetch()} />
      </PageContainer>
    );
  return <UserDetail user={user.data} />;
}

function UserDetail({ user }: { user: AdminUserDetail }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [departmentId, setDepartmentId] = useState<string | null>(user.department?.id ?? null);
  const [title, setTitle] = useState(user.title ?? '');
  const [employeeNo, setEmployeeNo] = useState(user.employeeNo ?? '');
  const [role, setRole] = useState<PlatformRole>(user.platformRole);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(user.name);
    setDepartmentId(user.department?.id ?? null);
    setTitle(user.title ?? '');
    setEmployeeNo(user.employeeNo ?? '');
    setRole(user.platformRole);
  }, [user]);

  const dirty =
    name.trim() !== user.name ||
    departmentId !== (user.department?.id ?? null) ||
    title.trim() !== (user.title ?? '') ||
    employeeNo.trim() !== (user.employeeNo ?? '') ||
    role !== user.platformRole;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.user(user.id) });
    void queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
    void queryClient.invalidateQueries({ queryKey: adminKeys.auditAll });
  };

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.updateUser(user.id, {
        name: name.trim(),
        departmentId,
        title: title.trim() || null,
        employeeNo: employeeNo.trim() || null,
        platformRole: role,
      });
      toast.success('저장했어요');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const res = await adminApi.resetPassword(user.id);
      setConfirmReset(false);
      setTempPassword(res.temporaryPassword);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    try {
      await adminApi.enableUser(user.id);
      toast.success('계정을 다시 활성화했어요');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const path = user.department?.pathNames ?? [];

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/admin/users" className="hover:text-foreground">
              사용자
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">{user.name}</span>
          </>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar name={user.name} className="size-10 text-base" />
            {user.name}
            <UserStatusBadge user={user} />
          </span>
        }
        description={
          <>
            {user.email}
            {path.length > 0 && <> · {path.join(' › ')}</>} · 이메일은 바꿀 수 없어요
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmReset(true)} disabled={user.status === 'disabled'}>
              <RotateCw strokeWidth={1.75} />
              비밀번호 초기화
            </Button>
            {user.status === 'active' ? (
              <Button variant="outline" onClick={() => setDisableOpen(true)}>
                비활성화
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void enable()} disabled={busy}>
                재활성화
              </Button>
            )}
            <Button onClick={() => void save()} disabled={!dirty || saving || !name.trim()}>
              저장
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-2 gap-4 rounded-xl border p-6">
            <Field id="d-name" label="이름">
              <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="플랫폼 역할">
              <Tabs value={role} onValueChange={(v) => setRole(v as PlatformRole)}>
                <SegmentList>
                  <SegmentTrigger value="user">일반</SegmentTrigger>
                  <SegmentTrigger value="admin">플랫폼 관리자</SegmentTrigger>
                </SegmentList>
              </Tabs>
            </Field>
            <Field id="d-dept" label="부서 *" className="col-span-2">
              <DepartmentSelect id="d-dept" value={departmentId} onChange={(id) => setDepartmentId(id)} />
            </Field>
            <Field id="d-title" label="직위">
              <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field id="d-emp" label="사번">
              <Input id="d-emp" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} />
            </Field>
          </section>
          <TeamsCard user={user} onChanged={refresh} />
        </div>
        <div className="flex flex-col gap-4">
          <SectionCard icon={LogIn} title="최근 로그인">
            {user.recentLogins.length === 0 ? (
              <div className="px-5 py-4 text-[13.5px] text-muted-foreground">아직 로그인한 적이 없어요</div>
            ) : (
              user.recentLogins.map((l, i) => (
                <div key={`${l.at}-${i}`} className="flex items-center gap-3 border-b px-5 py-2.5 text-[13px] last:border-b-0">
                  <span className="tabular-nums">{formatTime(l.at)}</span>
                  <span className="flex-1 text-muted-foreground">{l.ip}</span>
                  <span className={l.success ? '' : 'text-danger'}>{l.success ? '성공' : '실패'}</span>
                </div>
              ))
            )}
          </SectionCard>
          <ActivityCard userId={user.id} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`${user.name}의 비밀번호를 초기화할까요?`}
        description="새 임시 비밀번호를 만들고 기존 세션을 모두 끊어요. 첫 로그인 때 바꿔야 해요."
        confirmLabel="비밀번호 초기화"
        pending={busy}
        onConfirm={() => void reset()}
      />
      <Dialog open={tempPassword !== null}>
        <DialogContent hideClose onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4" strokeWidth={1.75} />새 임시 비밀번호
            </DialogTitle>
            <DialogDescription>
              이 창을 닫으면 다시 볼 수 없어요. {user.name}에게 직접 전달해 주세요. 첫 로그인 때 바꿔야 해요.
            </DialogDescription>
          </DialogHeader>
          {tempPassword && <CopyField value={tempPassword} />}
          <span className="text-[13px] text-muted-foreground">기존 세션은 모두 끊겼어요.</span>
          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>복사했어요, 닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DisableDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        user={user}
        onDone={async () => {
          setDisableOpen(false);
          toast.success('계정을 비활성화했어요');
          await refresh();
        }}
      />
    </PageContainer>
  );
}

function DisableDialog({
  open,
  onOpenChange,
  user,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: AdminUserDetail;
  onDone: () => Promise<void>;
}) {
  const [restart, setRestart] = useState(false);
  const [pending, setPending] = useState(false);
  const teamNames = user.teams.map((t) => t.name).join(', ');
  const confirm = async () => {
    setPending(true);
    try {
      await adminApi.disableUser(user.id, restart);
      await onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{user.name} 계정을 비활성화할까요?</AlertDialogTitle>
          <AlertDialogDescription>모든 세션이 끊겨요. 다시 활성화할 때까지 로그인할 수 없어요.</AlertDialogDescription>
        </AlertDialogHeader>
        {user.teams.length > 0 && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-[13.5px]">
            <Checkbox className="mt-0.5" checked={restart} onCheckedChange={(c) => setRestart(c === true)} />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">소속 팀 컨테이너 재시작</span>
              <span className="text-xs text-muted-foreground">
                열린 에이전트 연결을 바로 끊어요. {teamNames}의 다른 팀원도 잠깐 연결이 끊겨요.
              </span>
            </span>
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>
            비활성화
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TeamsCard({ user, onChanged }: { user: AdminUserDetail; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const teams = useAdminTeams();
  const [adding, setAdding] = useState(false);
  const [newTeam, setNewTeam] = useState('');
  const [newRole, setNewRole] = useState<TeamRole>('member');
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mine = new Set(user.teams.map((t) => t.name));
  const displayName = (n: string) => teams.data?.find((t) => t.name === n)?.displayName ?? n;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setPending(true);
    try {
      await fn();
      toast.success(ok);
      void queryClient.invalidateQueries({ queryKey: adminKeys.teamsAll });
      await onChanged();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setPending(false);
    }
  };

  return (
    <SectionCard
      icon={Users}
      title="소속 팀"
      actions={
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <Plus strokeWidth={1.75} />팀 추가
        </Button>
      }
    >
      {adding && (
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <NativeSelect aria-label="팀" className="flex-1" value={newTeam} onChange={(e) => setNewTeam(e.target.value)}>
            <option value="">팀 선택</option>
            {(teams.data ?? [])
              .filter((t) => !mine.has(t.name))
              .map((t) => (
                <option key={t.name} value={t.name}>
                  {t.displayName} ({t.name})
                </option>
              ))}
          </NativeSelect>
          <NativeSelect aria-label="팀 역할" value={newRole} onChange={(e) => setNewRole(e.target.value as TeamRole)}>
            <option value="member">{TEAM_ROLE_LABEL.member}</option>
            <option value="team_admin">{TEAM_ROLE_LABEL.team_admin}</option>
          </NativeSelect>
          <Button
            size="sm"
            disabled={!newTeam || pending}
            onClick={async () => {
              if (await run(() => adminApi.addMembers(newTeam, [user.id], newRole), '팀에 추가했어요')) {
                setAdding(false);
                setNewTeam('');
                setNewRole('member');
              }
            }}
          >
            추가
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            취소
          </Button>
        </div>
      )}
      {user.teams.length === 0 && !adding && <div className="px-5 py-4 text-[13.5px] text-muted-foreground">소속된 팀이 없어요</div>}
      {user.teams.map((t) => (
        <div key={t.name} className="flex items-center gap-3 border-b px-5 py-2.5 text-[13.5px] last:border-b-0">
          <Link to="/admin/teams/$team" params={{ team: t.name }} className="flex-1 hover:underline">
            {displayName(t.name)} <span className="font-mono text-xs text-muted-foreground">{t.name}</span>
          </Link>
          <NativeSelect
            aria-label="팀 역할"
            value={t.teamRole}
            disabled={pending}
            onChange={(e) => void run(() => adminApi.setMemberRole(t.name, user.id, e.target.value as TeamRole), '팀 역할을 바꿨어요')}
            className="[&_select]:h-8"
          >
            <option value="member">{TEAM_ROLE_LABEL.member}</option>
            <option value="team_admin">{TEAM_ROLE_LABEL.team_admin}</option>
          </NativeSelect>
          <Button variant="ghost" size="sm" onClick={() => setRemoving(t.name)}>
            제거
          </Button>
        </div>
      ))}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`${removing ? displayName(removing) : ''}에서 ${user.name}을(를) 뺄까요?`}
        description="팀 에이전트와 팀 드라이브를 더 쓸 수 없어요."
        confirmLabel="제거"
        destructive
        pending={pending}
        onConfirm={async () => {
          if (removing && (await run(() => adminApi.removeMember(removing, user.id), '팀에서 뺐어요'))) setRemoving(null);
        }}
      />
    </SectionCard>
  );
}

/** "이 사람이 한 일" (actor) + "이 사람에게 일어난 일" (targetType=user), merged (04-api.md A-03). */
function ActivityCard({ userId }: { userId: string }) {
  const byActor = useQuery({
    queryKey: adminKeys.audit({ actor: userId }),
    queryFn: () => adminApi.audit({ actor: userId }, undefined, 20),
  });
  const onTarget = useQuery({
    queryKey: adminKeys.audit({ targetType: 'user', targetId: userId }),
    queryFn: () => adminApi.audit({ targetType: 'user', targetId: userId }, undefined, 20),
  });
  const events = useMemo(() => {
    const map = new Map<number, AuditEvent>();
    for (const e of [...(byActor.data?.items ?? []), ...(onTarget.data?.items ?? [])]) map.set(e.id, e);
    return [...map.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  }, [byActor.data, onTarget.data]);
  const error = byActor.error ?? onTarget.error;

  return (
    <SectionCard icon={History} title="활동 · 이 사람이 한 일과 이 사람에게 일어난 일">
      {(byActor.isPending || onTarget.isPending) && <div className="px-5 py-4 text-[13.5px] text-muted-foreground">불러오는 중이에요</div>}
      {error && (
        <div className="flex items-center gap-2 px-5 py-4 text-[13.5px] text-muted-foreground">
          <TriangleAlert className="size-4 text-danger" strokeWidth={1.75} />
          {errorMessage(error)}
        </div>
      )}
      {!byActor.isPending && !onTarget.isPending && !error && events.length === 0 && (
        <div className="px-5 py-4 text-[13.5px] text-muted-foreground">아직 기록이 없어요</div>
      )}
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-3 border-b px-5 py-2.5 text-[13px] last:border-b-0">
          <span className="w-[110px] shrink-0 text-xs text-muted-foreground tabular-nums">{formatTime(e.at)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span>
              <span className="font-medium">{e.actor?.name ?? '시스템'}</span> · {auditActionLabel(e.action)}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {auditTargetLabel(e.targetType)} · {e.targetLabel}
            </span>
          </span>
        </div>
      ))}
    </SectionCard>
  );
}
