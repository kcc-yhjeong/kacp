import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Archive, ArrowDown, ArrowUp, Building2, FileUp, FolderInput, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArchivedBadge, UserStatusBadge } from '@/components/admin/badges';
import { DepartmentSelect } from '@/components/admin/department-select';
import { DepartmentTree } from '@/components/admin/department-tree';
import { Avatar, EmptyState, ErrorState, Field, ListSkeleton, PageContainer, PageHeader } from '@/components/admin/page';
import { PathBreadcrumb } from '@/components/admin/path-breadcrumb';
import { UserChip, UserPicker } from '@/components/admin/user-picker';
import { FormAlert } from '@/components/form-alert';
import { PageLoader } from '@/components/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi, adminKeys, useDepartmentMembers, useDepartments } from '@/lib/admin/api';
import { countDescendants, findNode, pathTo, searchTree } from '@/lib/admin/tree';
import type { DepartmentNode, UserRef } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';

function useRefreshOrg() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.departmentsAll });
    void queryClient.invalidateQueries({ queryKey: adminKeys.deptMembersAll });
    void queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
  };
}

/** A-12 organization. */
export function OrgPage() {
  const [showArchived, setShowArchived] = useState(false);
  const departments = useDepartments(showArchived);
  const refresh = useRefreshOrg();
  const roots = departments.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [move, setMove] = useState<{ dragId: string; targetId: string | null } | null>(null);
  const [moving, setMoving] = useState(false);

  // Expand top-level and pick the first department once data arrives.
  useEffect(() => {
    if (roots.length === 0) return;
    setExpanded((prev) => (prev.size === 0 ? new Set(roots.map((r) => r.id)) : prev));
    setSelectedId((prev) => (prev && findNode(roots, prev) ? prev : (roots[0]?.id ?? null)));
  }, [roots]);

  const search = useMemo(() => searchTree(roots, q), [roots, q]);
  const visibleExpanded = useMemo(() => new Set([...expanded, ...search.expand]), [expanded, search]);
  const selected = selectedId ? findNode(roots, selectedId) : null;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doMove = async () => {
    if (!move) return;
    setMoving(true);
    try {
      await adminApi.moveDepartment(move.dragId, move.targetId);
      toast.success('부서를 옮겼어요');
      if (move.targetId) setExpanded((prev) => new Set([...prev, move.targetId as string]));
      setMove(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMoving(false);
    }
  };

  if (departments.isPending) return <PageLoader />;

  const header = (
    <PageHeader
      title="조직"
      description="실제 사내 소속(부서 트리)이에요. 에이전트 팀과는 따로 관리해요."
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to="/admin/import" search={{ kind: 'departments' }}>
              <FileUp strokeWidth={1.75} />
              가져오기(CSV)
            </Link>
          </Button>
          <Button onClick={() => setCreateParent(null)}>
            <Plus strokeWidth={1.75} />
            부서 추가
          </Button>
        </>
      }
    />
  );

  if (departments.isError)
    return (
      <PageContainer>
        {header}
        <div className="rounded-xl border">
          <ErrorState title="부서 목록을 불러오지 못했어요" error={departments.error} onRetry={() => void departments.refetch()} />
        </div>
      </PageContainer>
    );

  return (
    <PageContainer>
      {header}
      {roots.length === 0 && !showArchived ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Building2}
            title="아직 부서가 없어요"
            description="직접 추가하거나 CSV로 조직도를 가져오세요"
            action={
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link to="/admin/import" search={{ kind: 'departments' }}>
                    <FileUp strokeWidth={1.75} />
                    가져오기(CSV)
                  </Link>
                </Button>
                <Button onClick={() => setCreateParent(null)}>
                  <Plus strokeWidth={1.75} />
                  부서 추가
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="grid min-h-[560px] grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex flex-col overflow-hidden rounded-xl border">
            <div className="flex flex-col gap-2 border-b p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="부서명 검색" className="h-8 pr-14 pl-8 text-[13px]" aria-label="부서명 검색" />
                {q && (
                  <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground tabular-nums">{search.matches.size}개</span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              <DepartmentTree
                roots={roots}
                expanded={visibleExpanded}
                onToggle={toggle}
                selectedId={selectedId}
                onSelect={(n) => setSelectedId(n.id)}
                matches={search.matches}
                onMove={(dragId, targetId) => setMove({ dragId, targetId })}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 border-t px-3 py-2.5 text-[13px]">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              보관된 부서 보기
            </label>
          </aside>
          <section className="min-w-0 overflow-hidden rounded-xl border">
            {selected ? (
              <DepartmentDetail
                key={selected.id}
                dept={selected}
                roots={roots}
                onSelect={setSelectedId}
                onAddChild={() => setCreateParent(selected.id)}
              />
            ) : (
              <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">왼쪽에서 부서를 고르세요</div>
            )}
          </section>
        </div>
      )}
      <CreateDepartmentDialog
        parentId={createParent}
        onClose={() => setCreateParent(undefined)}
        onCreated={(id) => {
          setSelectedId(id);
          if (createParent) setExpanded((prev) => new Set([...prev, createParent]));
        }}
      />
      <MoveDialog roots={roots} move={move} pending={moving} onCancel={() => setMove(null)} onConfirm={() => void doMove()} />
    </PageContainer>
  );
}

function MoveDialog({
  roots,
  move,
  pending,
  onCancel,
  onConfirm,
}: {
  roots: DepartmentNode[];
  move: { dragId: string; targetId: string | null } | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const drag = move ? findNode(roots, move.dragId) : null;
  const target = move?.targetId ? findNode(roots, move.targetId) : null;
  const now = move ? pathTo(roots, move.dragId).map((n) => n.name) : [];
  const after = move && drag ? [...(move.targetId ? pathTo(roots, move.targetId).map((n) => n.name) : []), drag.name] : [];
  return (
    <Dialog open={!!move && !!drag} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        {drag && (
          <>
            <DialogHeader>
              <DialogTitle>
                {drag.name}을(를) {target ? `${target.name} 아래로` : '최상위로'} 옮길까요?
              </DialogTitle>
              <DialogDescription>
                하위 부서 {countDescendants(drag)}개·구성원 {drag.totalMemberCount}명이 함께 옮겨져요. 팀 소속은 바뀌지 않아요.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-[48px_1fr] gap-y-2 rounded-lg border p-3 text-[13px]">
              <span className="text-muted-foreground">지금</span>
              <PathBreadcrumb names={now} />
              <span className="text-muted-foreground">이후</span>
              <PathBreadcrumb names={after} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel} disabled={pending}>
                취소
              </Button>
              <Button onClick={onConfirm} disabled={pending}>
                옮기기
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** `parentId` undefined = closed, null = top level. */
function CreateDepartmentDialog({
  parentId,
  onClose,
  onCreated,
}: {
  parentId: string | null | undefined;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const refresh = useRefreshOrg();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = parentId !== undefined;

  useEffect(() => {
    if (open) {
      setName('');
      setCode('');
      setParent(parentId ?? null);
      setError(null);
    }
  }, [open, parentId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const d = await adminApi.createDepartment({ name: name.trim(), code: code.trim() || undefined, parentId: parent });
      toast.success(`${d.name}을(를) 추가했어요`);
      onClose();
      await refresh();
      onCreated(d.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>부서 추가</DialogTitle>
          </DialogHeader>
          {error && <FormAlert message={error} />}
          <Field id="nd-name" label="부서명">
            <Input id="nd-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="nd-code" label="부서 코드 (선택)" hint="CSV 가져오기에서 이 코드로 같은 부서를 찾아요">
            <Input id="nd-code" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
          </Field>
          <Field id="nd-parent" label="상위 부서">
            <DepartmentSelect id="nd-parent" value={parent} onChange={(id) => setParent(id)} allowClear placeholder="최상위" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              추가
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentDetail({
  dept,
  roots,
  onSelect,
  onAddChild,
}: {
  dept: DepartmentNode;
  roots: DepartmentNode[];
  onSelect: (id: string) => void;
  onAddChild: () => void;
}) {
  const path = pathTo(roots, dept.id);
  const archived = dept.status === 'archived';
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b px-5 py-4">
        <PathBreadcrumb names={path.map((n) => n.name)} onSelectIndex={(i) => path[i] && onSelect(path[i].id)} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{dept.name}</h2>
          {dept.code && <span className="font-mono text-xs text-muted-foreground">{dept.code}</span>}
          {archived && <ArchivedBadge />}
          <span className="ml-auto flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">부서장</span>
            {dept.head ? (
              <>
                <Avatar name={dept.head.name} className="size-6 text-[11px]" />
                {dept.head.name}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </div>
      </div>
      <Tabs defaultValue="members" className="flex flex-col">
        <TabsList className="px-3">
          <TabsTrigger value="members">구성원 {dept.memberCount}</TabsTrigger>
          <TabsTrigger value="children">하위 부서 {dept.children.length}</TabsTrigger>
          <TabsTrigger value="info">정보</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab dept={dept} />
        </TabsContent>
        <TabsContent value="children">
          <ChildrenTab dept={dept} onSelect={onSelect} onAddChild={onAddChild} />
        </TabsContent>
        <TabsContent value="info">
          <InfoTab dept={dept} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MembersTab({ dept }: { dept: DepartmentNode }) {
  const refresh = useRefreshOrg();
  const [withDesc, setWithDesc] = useState(false);
  const members = useDepartmentMembers(dept.id, withDesc);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const items = members.data ?? [];

  const moveTo = async (targetId: string | null, targetName: string) => {
    if (!targetId) return;
    try {
      await adminApi.bulkDepartment([...selected], targetId);
      toast.success(`${selected.size}명을 ${targetName}(으)로 옮겼어요`);
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center gap-3 border-b px-5 text-[13px]">
        {selected.size > 0 ? (
          <>
            <span className="font-medium">{selected.size}명 선택됨</span>
            <DepartmentSelect
              value={null}
              onChange={(id, node) => void moveTo(id, node?.name ?? '')}
              trigger={
                <Button variant="outline" size="sm">
                  <FolderInput strokeWidth={1.75} />
                  다른 부서로 이동
                </Button>
              }
            />
            <button type="button" aria-label="선택 해제" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
              <X className="size-4" />
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">{withDesc ? `하위 포함 ${dept.totalMemberCount}명` : `이 부서 ${dept.memberCount}명`}</span>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-2">
          <Switch checked={withDesc} onCheckedChange={setWithDesc} />
          하위 부서 포함
        </label>
      </div>
      {members.isPending ? (
        <ListSkeleton rows={4} />
      ) : members.isError ? (
        <ErrorState title="구성원을 불러오지 못했어요" error={members.error} onRetry={() => void members.refetch()} />
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13.5px] text-muted-foreground">구성원이 없어요</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="전체 선택"
                  checked={items.every((u) => selected.has(u.id)) ? true : selected.size > 0 ? 'indeterminate' : false}
                  onCheckedChange={(c) => setSelected(c === true ? new Set(items.map((u) => u.id)) : new Set())}
                />
              </TableHead>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              {withDesc && <TableHead>부서</TableHead>}
              <TableHead>직위</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>소속 팀</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((u) => (
              <TableRow key={u.id} data-state={selected.has(u.id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`${u.name} 선택`}
                    checked={selected.has(u.id)}
                    onCheckedChange={(c) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (c === true) next.add(u.id);
                        else next.delete(u.id);
                        return next;
                      })
                    }
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <Link to="/admin/users/$userId" params={{ userId: u.id }} className="hover:underline">
                    {u.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                {withDesc && <TableCell>{u.department?.name ?? '—'}</TableCell>}
                <TableCell>{u.title ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <UserStatusBadge user={u} />
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {u.teams.length === 0 && <span className="text-muted-foreground">—</span>}
                    {u.teams.map((t) => (
                      <Badge key={t.name} variant="secondary" className="font-mono text-[11px]">
                        {t.name}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ChildrenTab({ dept, onSelect, onAddChild }: { dept: DepartmentNode; onSelect: (id: string) => void; onAddChild: () => void }) {
  const refresh = useRefreshOrg();
  const [pending, setPending] = useState(false);
  const children = dept.children;

  /** Swap with the neighbour and renumber so sort orders stay distinct. */
  const reorder = async (i: number, d: -1 | 1) => {
    const order = [...children];
    const a = order[i];
    const b = order[i + d];
    if (!a || !b) return;
    order[i] = b;
    order[i + d] = a;
    setPending(true);
    try {
      const changes = order.map((c, k) => ({ c, sortOrder: (k + 1) * 10 })).filter(({ c, sortOrder }) => c.sortOrder !== sortOrder);
      for (const { c, sortOrder } of changes) await adminApi.updateDepartment(c.id, { sortOrder });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center gap-3 border-b px-5 text-[13px]">
        <span className="flex-1 text-muted-foreground">
          {dept.name} 아래 {children.length}개 · 화살표로 순서를 바꿔요
        </span>
        <Button size="sm" variant="outline" onClick={onAddChild} disabled={dept.status === 'archived'}>
          <Plus strokeWidth={1.75} />
          하위 부서 추가
        </Button>
      </div>
      {children.length === 0 && <div className="px-5 py-8 text-center text-[13.5px] text-muted-foreground">하위 부서가 없어요</div>}
      {children.map((c, i) => (
        <div key={c.id} className="flex h-12 items-center gap-3 border-b px-5 text-[13.5px] last:border-b-0">
          <span className="flex flex-col">
            <button type="button" aria-label="위로" disabled={pending || i === 0} onClick={() => void reorder(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="아래로"
              disabled={pending || i === children.length - 1}
              onClick={() => void reorder(i, 1)}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </span>
          <button type="button" className="flex-1 truncate text-left font-medium hover:underline" onClick={() => onSelect(c.id)}>
            {c.name}
          </button>
          {c.status === 'archived' && <ArchivedBadge />}
          <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
          <span className="w-24 truncate text-[13px] text-muted-foreground">{c.head?.name ?? '—'}</span>
          <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{c.totalMemberCount}명</span>
        </div>
      ))}
    </div>
  );
}

function InfoTab({ dept }: { dept: DepartmentNode }) {
  const refresh = useRefreshOrg();
  const [name, setName] = useState(dept.name);
  const [code, setCode] = useState(dept.code ?? '');
  const [head, setHead] = useState<UserRef | null>(dept.head);
  const [sortOrder, setSortOrder] = useState(dept.sortOrder);
  const [pending, setPending] = useState(false);
  const archived = dept.status === 'archived';
  const activeChildren = dept.children.filter((c) => c.status === 'active').length;
  const blocked = !archived && (dept.totalMemberCount > 0 || activeChildren > 0);
  const dirty = name.trim() !== dept.name || code.trim() !== (dept.code ?? '') || (head?.id ?? null) !== (dept.head?.id ?? null) || sortOrder !== dept.sortOrder;

  const save = async () => {
    setPending(true);
    try {
      await adminApi.updateDepartment(dept.id, { name: name.trim(), code: code.trim(), headUserId: head?.id ?? null, sortOrder });
      toast.success('저장했어요');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const archive = async () => {
    setPending(true);
    try {
      await adminApi.archiveDepartment(dept.id, !archived);
      toast.success(archived ? '보관을 해제했어요' : '부서를 보관했어요');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="grid max-w-xl grid-cols-2 gap-4">
        <Field id="di-name" label="부서명">
          <Input id="di-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="di-code" label="부서 코드">
          <Input id="di-code" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
        </Field>
        <Field label="부서장">
          {head ? <UserChip user={head} onRemove={() => setHead(null)} /> : <UserPicker onPick={setHead} />}
        </Field>
        <Field id="di-sort" label="정렬">
          <Input id="di-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(Math.round(Number(e.target.value) || 0))} />
        </Field>
      </div>
      <div>
        <Button disabled={!dirty || !name.trim() || pending} onClick={() => void save()}>
          저장
        </Button>
      </div>
      <div className="flex items-center gap-4 rounded-xl border border-destructive/40 p-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{archived ? '보관 해제' : '부서 보관'}</span>
          <span className="text-[13px] text-muted-foreground">
            {archived
              ? '다시 사용 중으로 바꿔요. 선택 목록에 다시 보여요.'
              : blocked
                ? `먼저 구성원을 옮기세요. 지금 ${dept.totalMemberCount}명${activeChildren > 0 ? `, 하위 부서 ${activeChildren}개` : ''}가 있어요.`
                : '선택 목록에서 빠져요. 부서 삭제는 없고 보관만 해요.'}
          </span>
        </div>
        <Button variant={archived ? 'outline' : 'destructive'} disabled={blocked || pending} onClick={() => void archive()}>
          <Archive strokeWidth={1.75} />
          {archived ? '보관 해제' : '보관'}
        </Button>
      </div>
    </div>
  );
}
