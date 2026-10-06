import { TEAM_ROLE_LABEL, type Member, type MyTeam, type TeamDetail, type TeamRole } from '@kacp/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { Lock, Plus, Search, Store } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { TeamRoleBadge } from '@/components/admin/badges';
import { DepartmentBulkPicker, type BulkUser } from '@/components/admin/department-bulk';
import { EmptyState, ErrorState, Field, ListSkeleton, PageContainer, SectionCard } from '@/components/admin/page';
import { UserPicker } from '@/components/admin/user-picker';
import { AppHeader, teamSettingsUrl } from '@/components/app-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ManualAddDialog } from '@/components/mcp/manual-add-dialog';
import { PageLoader } from '@/components/page-loader';
import { TeamStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/admin/api';
import { formatMb } from '@/lib/admin/format';
import { api, errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { appOrigin, hostOf } from '@/lib/host';
import { keys, useMe, useMyTeams, useTeam } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { TeamInstalls } from '@/pages/market/installed-page';

export type SettingsTab = 'members' | 'mcp' | 'info';

export function isSettingsTab(v: unknown): v is SettingsTab {
  return v === 'members' || v === 'mcp' || v === 'info';
}

const membersKey = (team: string) => ['teams', team, 'members'] as const;

/** U-15 팀 설정 — `/t/{team}/settings/{members|mcp|info}` (team admins; platform admins who are members). */
export function TeamSettingsPage({ team, tab }: { team: string; tab: SettingsTab }) {
  const me = useMe();
  const ready = !!me.data && !me.data.mustChangePassword;
  const teams = useMyTeams(ready);

  if (me.data?.mustChangePassword) return <Navigate to="/password/setup" />;
  if (!me.data || !teams.data) return <PageLoader />;
  const membership = teams.data.find((t) => t.name === team);
  const isPlatformAdmin = me.data.platformRole === 'admin';
  const allowed = !!membership && (membership.teamRole === 'team_admin' || isPlatformAdmin);

  return (
    <div className="flex h-full flex-col">
      <AppHeader currentTeam={team} teamHref={(t) => teamSettingsUrl(t.name, tab)} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {allowed && membership ? (
          <Settings team={membership} tab={tab} />
        ) : (
          <EmptyState
            icon={Lock}
            className="py-20"
            title={membership ? '팀 관리자만 볼 수 있어요' : '이 팀 멤버만 볼 수 있어요'}
            description={
              membership
                ? '멤버나 MCP를 바꾸려면 팀 관리자에게 요청하세요.'
                : isPlatformAdmin
                  ? '멤버가 아닌 팀은 관리자 화면의 팀 상세에서 관리해요.'
                  : '필요하면 그 팀의 팀 관리자에게 요청하세요.'
            }
            action={
              !membership && isPlatformAdmin ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/admin/teams/$team" params={{ team }}>
                    관리자 화면에서 열기
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </main>
    </div>
  );
}

const tabClass = (on: boolean) =>
  cn(
    '-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    on ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
  );

function Settings({ team, tab }: { team: MyTeam; tab: SettingsTab }) {
  const members = useQuery({
    queryKey: membersKey(team.name),
    queryFn: async () => (await api.get<{ items: Member[] }>(`/teams/${encodeURIComponent(team.name)}/members`)).items,
  });
  const tabs: { value: SettingsTab; label: string; count?: number }[] = [
    { value: 'members', label: '멤버', count: members.data?.length },
    { value: 'mcp', label: 'MCP' },
    { value: 'info', label: '정보' },
  ];
  return (
    <PageContainer>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">팀 설정</h1>
        <p className="text-sm text-muted-foreground">
          {team.displayName} · <span className="font-mono text-xs">{hostOf(team.url)}</span>
        </p>
      </div>
      <nav aria-label="팀 설정 탭" className="flex items-center gap-1 border-b">
        {tabs.map((t) => (
          <Link
            key={t.value}
            to="/t/$team/settings/$tab"
            params={{ team: team.name, tab: t.value }}
            className={tabClass(tab === t.value)}
            aria-current={tab === t.value ? 'page' : undefined}
          >
            {t.label}
            {t.count !== undefined && <span className="text-muted-foreground tabular-nums">{t.count}</span>}
          </Link>
        ))}
      </nav>
      {tab === 'members' && <MembersTab team={team} members={members} />}
      {tab === 'mcp' && <McpTab team={team} />}
      {tab === 'info' && <InfoTab team={team} />}
    </PageContainer>
  );
}

function MembersTab({ team, members }: { team: MyTeam; members: UseQueryResult<Member[]> }) {
  const qc = useQueryClient();
  const [bulk, setBulk] = useState<BulkUser[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const list = members.data ?? [];
  const memberIds = useMemo(() => new Set(list.map((m) => m.user.id)), [list]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setPending(true);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: membersKey(team.name) });
      void qc.invalidateQueries({ queryKey: keys.myTeams });
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
      <SectionCard title="멤버 추가" bodyClassName="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
        <Field label="사람 검색" hint="없는 사람은 플랫폼 관리자가 계정을 만들어야 해요">
          <UserPicker
            excludeIds={memberIds}
            keepOpen
            placeholder="이름 또는 이메일로 검색"
            onPick={(u) => void run(() => adminApi.addMembers(team.name, [u.id]), `${u.name}을(를) 추가했어요`)}
          />
        </Field>
        <Field label="부서 단위로 추가">
          <DepartmentBulkPicker source="search" excludeIds={memberIds} onSelectionChange={setBulk} resetKey={resetKey} />
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
        {members.isPending ? (
          <ListSkeleton />
        ) : members.isError ? (
          <ErrorState title="멤버를 불러오지 못했어요" error={members.error} onRetry={() => void members.refetch()} />
        ) : list.length === 0 ? (
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
              {list.map((m) => (
                <TableRow key={m.user.id}>
                  <TableCell className="font-medium">{m.user.name}</TableCell>
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

function McpTab({ team }: { team: MyTeam }) {
  const [manual, setManual] = useState(false);
  return (
    <>
      <TeamInstalls
        team={team.name}
        actions={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`${appOrigin}/market?team=${encodeURIComponent(team.name)}`}>
                <Store strokeWidth={1.75} />
                마켓에서 찾기
              </a>
            </Button>
            <Button size="sm" onClick={() => setManual(true)}>
              <Plus strokeWidth={1.75} />
              직접 추가
            </Button>
          </div>
        }
      />
      <ManualAddDialog team={team.name} open={manual} onOpenChange={setManual} />
    </>
  );
}

/** Template names from `TeamDetail.agents` (typed `unknown[]` in the contract). */
export function agentNames(agents: TeamDetail['agents']): { name: string; icon: string | null }[] {
  return agents.flatMap((a) => {
    if (!a || typeof a !== 'object') return [];
    const o = a as { name?: unknown; icon?: unknown; template?: { name?: unknown; icon?: unknown } };
    const src = o.template && typeof o.template === 'object' ? o.template : o;
    return typeof src.name === 'string' ? [{ name: src.name, icon: typeof src.icon === 'string' ? src.icon : null }] : [];
  });
}

function InfoTab({ team }: { team: MyTeam }) {
  const detail = useTeam(team.name);
  if (detail.isPending)
    return (
      <div className="rounded-xl border">
        <ListSkeleton rows={4} />
      </div>
    );
  if (detail.isError)
    return (
      <div className="rounded-xl border">
        <ErrorState title="팀 정보를 불러오지 못했어요" error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  const d = detail.data;
  const agents = agentNames(d.agents);
  const rows: { label: string; value: ReactNode }[] = [
    { label: '팀 이름', value: d.displayName },
    { label: '팀 ID', value: <span className="font-mono text-xs">{d.name}</span> },
    {
      label: '주소',
      value: (
        <a href={d.url} className="font-mono text-xs underline underline-offset-2">
          {hostOf(d.url)}
        </a>
      ),
    },
    { label: '에이전트 상태', value: <TeamStatusBadge status={d.status.status} /> },
    {
      label: '할당된 에이전트',
      value:
        agents.length === 0 ? (
          <span className="text-muted-foreground">{d.agents.length > 0 ? `${d.agents.length}개` : '없음'}</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <span key={a.name} className="inline-flex h-6 items-center gap-1 rounded-md bg-secondary px-2 text-xs">
                {a.icon && <span>{a.icon}</span>}
                {a.name}
              </span>
            ))}
          </span>
        ),
    },
    {
      label: '리소스 한도',
      value: (
        <span className="tabular-nums">
          CPU {d.resourceLimits.cpu}코어 · 메모리 {formatMb(d.resourceLimits.memoryMb)} · 디스크 {d.resourceLimits.diskGb}GB
        </span>
      ),
    },
    { label: '내 역할', value: TEAM_ROLE_LABEL[d.myRole] },
  ];
  return (
    <div className="flex flex-col gap-2">
      <dl className="divide-y rounded-xl border">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-4 px-5 py-3 text-[13.5px]">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <span className="text-xs text-muted-foreground">팀 이름·주소·에이전트·리소스는 플랫폼 관리자가 바꿔요.</span>
    </div>
  );
}
