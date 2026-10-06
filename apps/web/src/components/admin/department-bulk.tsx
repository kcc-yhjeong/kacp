import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { DepartmentSelect } from '@/components/admin/department-select';
import { Checkbox } from '@/components/ui/checkbox';
import { adminApi, adminKeys, useDepartmentMembers } from '@/lib/admin/api';

/** What the picker hands back (AdminUser from the admin source, UserRef from the search source). */
export interface BulkUser {
  id: string;
  name: string;
  email: string;
  title?: string | null;
  status?: string;
}

/**
 * Department bulk add (A-04, A-05 멤버): pick a department → its active users (descendants included)
 * come checked; uncheck the ones to leave out.
 */
export function DepartmentBulkPicker({
  excludeIds,
  onSelectionChange,
  resetKey,
  source = 'admin',
}: {
  excludeIds?: ReadonlySet<string>;
  onSelectionChange: (users: BulkUser[]) => void;
  /** Change to clear the picker (after adding). */
  resetKey?: number;
  /**
   * `admin` = /admin/departments/{id}/members (platform admins). `search` = /users/search?departmentId= (any logged-in
   * user, active users only, max 20 — U-15 team admins).
   */
  source?: 'admin' | 'search';
}) {
  const [deptId, setDeptId] = useState<string | null>(null);
  const [deptName, setDeptName] = useState('');
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const adminMembers = useDepartmentMembers(source === 'admin' ? deptId : null, true);
  const searchMembers = useQuery({
    queryKey: adminKeys.userSearch('', deptId ?? ''),
    queryFn: async () => (await adminApi.searchUsers('', deptId ?? '')).items,
    enabled: source === 'search' && deptId !== null,
  });
  const members = source === 'admin' ? adminMembers : searchMembers;

  useEffect(() => {
    setDeptId(null);
    setUnchecked(new Set());
  }, [resetKey]);

  const candidates = useMemo(
    () => ((members.data ?? []) as BulkUser[]).filter((u) => (u.status ?? 'active') === 'active' && !(excludeIds?.has(u.id) ?? false)),
    [members.data, excludeIds],
  );
  const chosen = useMemo(() => candidates.filter((u) => !unchecked.has(u.id)), [candidates, unchecked]);

  useEffect(() => {
    onSelectionChange(deptId ? chosen : []);
    // onSelectionChange is a setter from the parent; ignore identity changes.
  }, [chosen, deptId]);

  return (
    <div className="flex flex-col gap-2">
      <DepartmentSelect
        value={deptId}
        onChange={(id, node) => {
          setDeptId(id);
          setDeptName(node?.name ?? '');
          setUnchecked(new Set());
        }}
        placeholder="부서 단위로 추가"
      />
      {deptId && (
        <div className="overflow-hidden rounded-lg border">
          <label className="flex cursor-pointer items-center gap-2.5 border-b bg-muted/50 px-3 py-2 text-[13px]">
            <Checkbox
              checked={chosen.length === candidates.length && candidates.length > 0 ? true : chosen.length > 0 ? 'indeterminate' : false}
              onCheckedChange={(c) => setUnchecked(c === true ? new Set() : new Set(candidates.map((u) => u.id)))}
            />
            <span className="font-medium">{deptName} 전체</span>
            <span className="text-muted-foreground">
              · {candidates.length}명 중 {chosen.length}명
            </span>
            <span className="ml-auto text-xs text-muted-foreground">뺄 사람만 해제하세요</span>
          </label>
          <div className="max-h-56 overflow-y-auto">
            {members.isPending && <div className="px-3 py-2 text-[13px] text-muted-foreground">불러오는 중이에요</div>}
            {!members.isPending && candidates.length === 0 && (
              <div className="px-3 py-2 text-[13px] text-muted-foreground">더할 수 있는 사람이 없어요</div>
            )}
            {candidates.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-1.5 text-[13px] last:border-b-0">
                <Checkbox
                  checked={!unchecked.has(u.id)}
                  onCheckedChange={(c) =>
                    setUnchecked((prev) => {
                      const next = new Set(prev);
                      if (c === true) next.delete(u.id);
                      else next.add(u.id);
                      return next;
                    })
                  }
                />
                <span>{u.name}</span>
                <span className="text-xs text-muted-foreground">{u.title ?? ''}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{u.email}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
