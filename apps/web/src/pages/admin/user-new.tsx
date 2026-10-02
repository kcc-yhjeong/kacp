import type { PlatformRole, TeamRole } from '@kacp/shared';
import { TEAM_ROLE_LABEL } from '@kacp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, ChevronRight, Plus, RotateCw, TriangleAlert, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DepartmentSelect } from '@/components/admin/department-select';
import { CopyField, Field, PageContainer, PageHeader } from '@/components/admin/page';
import { FormAlert } from '@/components/form-alert';
import { PasswordRules, passwordAcceptable } from '@/components/password-rules';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SegmentList, SegmentTrigger, Tabs } from '@/components/ui/tabs';
import { adminApi, adminKeys, useAdminTeams } from '@/lib/admin/api';
import { generatePassword } from '@/lib/admin/format';
import { errorMessage } from '@/lib/api';

/** A-03 add user. */
export function UserNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const teams = useAdminTeams();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [platformRole, setPlatformRole] = useState<PlatformRole>('user');
  const [password, setPassword] = useState(() => generatePassword());
  const [memberships, setMemberships] = useState<{ team: string; teamRole: TeamRole }[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; name: string; email: string; password: string } | null>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pwOk = passwordAcceptable(password, email.trim());
  const canSubmit = emailOk && name.trim().length > 0 && departmentId !== null && pwOk && !pending;
  const usedTeams = new Set(memberships.map((m) => m.team));
  const freeTeams = (teams.data ?? []).filter((t) => !usedTeams.has(t.name));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !departmentId) return;
    setPending(true);
    setError(null);
    try {
      const res = await adminApi.createUser({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        departmentId,
        title: title.trim() || undefined,
        employeeNo: employeeNo.trim() || undefined,
        platformRole,
        initialPassword: password,
        teams: memberships.filter((m) => m.team),
      });
      void queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
      void queryClient.invalidateQueries({ queryKey: adminKeys.teamsAll });
      setResult({ id: res.user.id, name: res.user.name, email: res.user.email, password: res.initialPassword || password });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/admin/users" className="hover:text-foreground">
              사용자
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">사용자 추가</span>
          </>
        }
        title="사용자 추가"
        description="만든 뒤 초기 비밀번호를 한 번만 보여줘요. 첫 로그인 때 바꿔야 해요."
      />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 rounded-xl border p-6">
        {error && <FormAlert message={error} />}
        <div className="grid grid-cols-2 gap-4">
          <Field id="u-email" label="이메일" hint="만든 뒤에는 바꿀 수 없어요">
            <Input id="u-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={email.length > 0 && !emailOk} />
          </Field>
          <Field id="u-name" label="이름">
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="u-dept" label="부서 *" className="col-span-2">
            <DepartmentSelect id="u-dept" value={departmentId} onChange={(id) => setDepartmentId(id)} />
          </Field>
          <Field id="u-title" label="직위 (선택)">
            <Input id="u-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="u-emp" label="사번 (선택)">
            <Input id="u-emp" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} />
          </Field>
          <Field label="플랫폼 역할" className="col-span-2">
            <Tabs value={platformRole} onValueChange={(v) => setPlatformRole(v as PlatformRole)}>
              <SegmentList>
                <SegmentTrigger value="user">일반</SegmentTrigger>
                <SegmentTrigger value="admin">플랫폼 관리자</SegmentTrigger>
              </SegmentList>
            </Tabs>
          </Field>
          <Field id="u-pw" label="초기 비밀번호" className="col-span-2">
            <div className="flex gap-2">
              <Input id="u-pw" className="font-mono" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>
                <RotateCw strokeWidth={1.75} />
                자동 생성
              </Button>
            </div>
            <PasswordRules password={password} email={email.trim()} />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">
            소속 팀 <span className="font-normal text-muted-foreground">(선택 · 부서와 별개예요)</span>
          </span>
          {memberships.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <NativeSelect
                aria-label="팀"
                className="flex-1"
                value={m.team}
                onChange={(e) => setMemberships((prev) => prev.map((x, k) => (k === i ? { ...x, team: e.target.value } : x)))}
              >
                <option value="">팀 선택</option>
                {(teams.data ?? [])
                  .filter((t) => t.name === m.team || !usedTeams.has(t.name))
                  .map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.displayName} ({t.name})
                    </option>
                  ))}
              </NativeSelect>
              <NativeSelect
                aria-label="팀 역할"
                value={m.teamRole}
                onChange={(e) => setMemberships((prev) => prev.map((x, k) => (k === i ? { ...x, teamRole: e.target.value as TeamRole } : x)))}
              >
                <option value="member">{TEAM_ROLE_LABEL.member}</option>
                <option value="team_admin">{TEAM_ROLE_LABEL.team_admin}</option>
              </NativeSelect>
              <Button type="button" variant="ghost" size="icon" aria-label="빼기" onClick={() => setMemberships((prev) => prev.filter((_, k) => k !== i))}>
                <X />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={freeTeams.length === 0}
              onClick={() => setMemberships((prev) => [...prev, { team: '', teamRole: 'member' }])}
            >
              <Plus strokeWidth={1.75} />
              팀 추가
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" asChild>
            <Link to="/admin/users">취소</Link>
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            만들기
          </Button>
        </div>
      </form>

      <Dialog open={result !== null}>
        <DialogContent hideClose onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          {result && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Check className="size-4 text-success" strokeWidth={2.25} />
                  {result.name} 님 계정을 만들었어요
                </DialogTitle>
                <DialogDescription>{result.email}</DialogDescription>
              </DialogHeader>
              <Field label="초기 비밀번호">
                <CopyField value={result.password} />
              </Field>
              <p className="flex items-center gap-1.5 text-[13px]">
                <TriangleAlert className="size-3.5 text-warning" strokeWidth={1.75} />이 창을 닫으면 다시 볼 수 없어요. 지금 전달해 주세요.
              </p>
              <DialogFooter>
                <Button onClick={() => void navigate({ to: '/admin/users/$userId', params: { userId: result.id } })}>전달했어요</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
