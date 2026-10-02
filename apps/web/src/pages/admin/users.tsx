import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Building2, FileUp, Plus, Search, User, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PlatformRoleBadge, UserStatusBadge } from '@/components/admin/badges';
import { DepartmentSelect } from '@/components/admin/department-select';
import { DepartmentCell, EmptyState, ListState, PageContainer, PageHeader } from '@/components/admin/page';
import { useDebounced } from '@/components/admin/user-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi, adminKeys, useAdminTeams, useAdminUsers, type UserFilters } from '@/lib/admin/api';
import type { UserStatusFilter } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';

/** A-02 users. */
export function UsersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [role, setRole] = useState<'' | 'admin' | 'user'>('');
  const [status, setStatus] = useState<'' | UserStatusFilter>('');
  const [team, setTeam] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dq = useDebounced(q.trim());
  const teams = useAdminTeams();

  const filters: UserFilters = useMemo(
    () => ({
      q: dq || undefined,
      role: role || undefined,
      status: status || undefined,
      team: team || undefined,
      departmentId: departmentId ?? undefined,
      includeDescendants: departmentId ? includeDescendants : undefined,
    }),
    [dq, role, status, team, departmentId, includeDescendants],
  );
  const users = useAdminUsers(filters);
  const items = users.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(dq || role || status || team || departmentId);
  const allChecked = items.length > 0 && items.every((u) => selected.has(u.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const moveSelected = async (deptId: string | null, deptName: string) => {
    if (!deptId) return;
    try {
      await adminApi.bulkDepartment([...selected], deptId);
      toast.success(`${selected.size}명의 부서를 ${deptName}(으)로 바꿨어요`);
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
      void queryClient.invalidateQueries({ queryKey: adminKeys.departmentsAll });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const resetFilters = () => {
    setQ('');
    setDepartmentId(null);
    setRole('');
    setStatus('');
    setTeam('');
  };

  return (
    <PageContainer>
      <PageHeader
        title="사용자"
        description="사용자 계정은 관리자만 만들 수 있어요."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/admin/import" search={{ kind: 'users' }}>
                <FileUp strokeWidth={1.75} />
                가져오기(CSV)
              </Link>
            </Button>
            <Button asChild>
              <Link to="/admin/users/new">
                <Plus strokeWidth={1.75} />
                사용자 추가
              </Link>
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[250px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·이메일 검색"
            aria-label="이름·이메일 검색"
            className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <DepartmentSelect
          variant="filter"
          value={departmentId}
          onChange={(id) => setDepartmentId(id)}
          allowClear
          placeholder="부서"
          includeDescendants={includeDescendants}
          onIncludeDescendantsChange={setIncludeDescendants}
        />
        <NativeSelect aria-label="역할" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="[&_select]:h-8 [&_select]:text-[13px]">
          <option value="">역할 전체</option>
          <option value="admin">플랫폼 관리자</option>
          <option value="user">일반</option>
        </NativeSelect>
        <NativeSelect aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="[&_select]:h-8 [&_select]:text-[13px]">
          <option value="">상태 전체</option>
          <option value="active">활성</option>
          <option value="must_change_password">비밀번호 변경 대기</option>
          <option value="disabled">비활성</option>
        </NativeSelect>
        <NativeSelect aria-label="팀" value={team} onChange={(e) => setTeam(e.target.value)} className="[&_select]:h-8 [&_select]:text-[13px]">
          <option value="">팀 전체</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.name} value={t.name}>
              {t.displayName}
            </option>
          ))}
        </NativeSelect>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            필터 초기화
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex h-11 items-center gap-3 rounded-xl border px-4 text-[13.5px]">
          <span className="font-medium">{selected.size}명 선택됨</span>
          <DepartmentSelect
            value={null}
            onChange={(id, node) => void moveSelected(id, node?.name ?? '')}
            trigger={
              <Button variant="outline" size="sm">
                <Building2 strokeWidth={1.75} />
                부서 변경
              </Button>
            }
          />
          <button type="button" aria-label="선택 해제" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border">
        <ListState
          isPending={users.isPending}
          error={users.error}
          isEmpty={items.length === 0}
          errorTitle="사용자 목록을 불러오지 못했어요"
          onRetry={() => void users.refetch()}
          empty={
            filtered ? (
              <EmptyState
                icon={User}
                title="일치하는 사용자가 없어요"
                description="이름이나 이메일을 다시 확인해 주세요"
                action={
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    필터 초기화
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={User} title="아직 사용자가 없어요" description="직접 추가하거나 CSV로 가져오세요" />
            )
          }
        />
        {items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="전체 선택"
                    checked={allChecked ? true : selected.size > 0 ? 'indeterminate' : false}
                    onCheckedChange={(c) => setSelected(c === true ? new Set(items.map((u) => u.id)) : new Set())}
                  />
                </TableHead>
                <TableHead>이름</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>부서</TableHead>
                <TableHead>직위</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>소속 팀</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>마지막 로그인</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow
                  key={u.id}
                  data-state={selected.has(u.id) ? 'selected' : undefined}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => void navigate({ to: '/admin/users/$userId', params: { userId: u.id } })}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`${u.name} 선택`} checked={selected.has(u.id)} onCheckedChange={(c) => toggle(u.id, c === true)} />
                  </TableCell>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <DepartmentCell name={u.department?.name} path={u.department?.pathNames} />
                  </TableCell>
                  <TableCell>{u.title ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <PlatformRoleBadge role={u.platformRole} />
                  </TableCell>
                  <TableCell>
                    <span className="flex max-w-[200px] flex-wrap gap-1">
                      {u.teams.length === 0 && <span className="text-muted-foreground">—</span>}
                      {u.teams.map((t) => (
                        <Badge key={t.name} variant="secondary" className="font-mono text-[11px]">
                          {t.name}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    <UserStatusBadge user={u} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{u.lastLoginAt ? formatTime(u.lastLoginAt) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {users.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>
            더 보기
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
