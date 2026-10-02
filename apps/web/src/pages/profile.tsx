import { TEAM_ROLE_LABEL, type Me, type MyTeam } from '@kacp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { ExternalLink, Link2, Lock, User } from 'lucide-react';
import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AppHeader } from '@/components/app-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { PageLoader } from '@/components/page-loader';
import { ConfirmMatch, PasswordRules, passwordAcceptable, passwordErrorMessage } from '@/components/password-rules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, errorMessage } from '@/lib/api';
import { describeUserAgent, formatTime, initialOf } from '@/lib/format';
import { teamRoot } from '@/lib/host';
import { authApi, keys, useMe, useMySessions, useMyTeams } from '@/lib/queries';

/** U-14 profile (stage 2 subset). */
export function ProfilePage() {
  const me = useMe();
  const teams = useMyTeams(!!me.data && !me.data.mustChangePassword);

  if (!me.data) return <PageLoader />;
  if (me.data.mustChangePassword) return <Navigate to="/password/setup" />;

  return (
    <div className="flex h-full flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 p-6">
          <h1 className="text-2xl font-bold tracking-tight">내 정보</h1>
          <InfoCard me={me.data} teams={teams.data ?? []} />
          <PasswordCard email={me.data.email} />
          <ConnectedAccountsCard teams={teams.data ?? []} />
          <SessionsCard />
        </div>
      </main>
    </div>
  );
}

function InfoCard({ me, teams }: { me: Me; teams: MyTeam[] }) {
  const path = me.department?.pathNames ?? [];
  const rows: [string, ReactNode][] = [
    ['이름', <span className="font-medium">{me.name}</span>],
    ['이메일', me.email],
    [
      '부서',
      me.department ? (
        <span>
          {path.length > 1 && <span className="text-muted-foreground">{path.slice(0, -1).join(' › ')} › </span>}
          {me.department.name}
        </span>
      ) : (
        '—'
      ),
    ],
    ['직위', me.title ?? '—'],
    ['플랫폼 역할', me.platformRole === 'admin' ? '플랫폼 관리자' : '일반'],
    [
      '소속 팀',
      teams.length === 0 ? (
        '—'
      ) : (
        <span className="flex flex-wrap gap-x-4 gap-y-1.5">
          {teams.map((t) => (
            <span key={t.name} className="flex items-center gap-1.5 text-[13px]">
              {t.displayName}
              <Badge variant={t.teamRole === 'team_admin' ? 'default' : 'outline'} className="h-5 px-1.5 text-[11.5px]">
                {TEAM_ROLE_LABEL[t.teamRole]}
              </Badge>
            </span>
          ))}
        </span>
      ),
    ],
  ];

  return (
    <Card className="flex items-start gap-5 p-6">
      <div className="grid size-14 shrink-0 place-items-center rounded-full border bg-muted text-xl font-semibold">
        {initialOf(me.name)}
      </div>
      <dl className="grid flex-1 grid-cols-[96px_1fr] gap-y-2.5 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>
    </Card>
  );
}

function PasswordCard({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = current.length > 0 && passwordAcceptable(next, email) && next === confirm && !pending;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await authApi.changePassword(next, current);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('비밀번호를 바꿨어요. 다른 곳의 로그인은 끊었어요.');
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
    } catch (err) {
      setError(err instanceof ApiError ? passwordErrorMessage(err.code, err.message, err.details) : errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <Lock className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <CardTitle>비밀번호 변경</CardTitle>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 p-5">
        {error && <FormAlert message={error} />}
        <div className="grid grid-cols-3 items-start gap-3">
          <Field id="pw-current" label="현재 비밀번호" value={current} onChange={setCurrent} autoComplete="current-password" />
          <Field id="pw-new" label="새 비밀번호" value={next} onChange={setNext} autoComplete="new-password" />
          <div className="flex flex-col gap-1.5">
            <Field id="pw-confirm" label="새 비밀번호 확인" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <ConfirmMatch password={next} confirm={confirm} />
          </div>
        </div>
        <div className="flex items-end justify-between gap-4">
          <PasswordRules password={next} email={email} />
          <Button type="submit" size="sm" disabled={!canSubmit}>
            변경
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id} className="text-[13px]">
        {props.label}
      </Label>
      <Input
        id={props.id}
        type="password"
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function ConnectedAccountsCard({ teams }: { teams: MyTeam[] }) {
  return (
    <Card>
      <CardHeader>
        <Link2 className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <CardTitle className="flex-1">연결한 계정</CardTitle>
        <span className="text-xs text-muted-foreground">팀 에이전트마다 따로 관리해요</span>
      </CardHeader>
      {teams.length === 0 && <div className="border-b px-5 py-3 text-[13.5px] text-muted-foreground">소속된 팀이 없어요</div>}
      {teams.map((t) => (
        <div key={t.name} className="flex items-center gap-3 border-b px-5 py-3 text-[13.5px]">
          <span className="flex-1">{t.displayName}</span>
          <a
            href={`${teamRoot(t.url)}claw/`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium underline underline-offset-[3px]"
          >
            에이전트 화면에서 내 계정 관리
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </a>
        </div>
      ))}
      <div className="px-5 py-3 text-xs text-muted-foreground">설정 → 프로필 → Connected accounts 화면이 열려요.</div>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useMySessions();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const items = sessions.data ?? [];
  const hasOthers = items.some((s) => !s.current);

  const onConfirm = async () => {
    setPending(true);
    try {
      await authApi.logoutOtherSessions();
      toast.success('다른 곳의 로그인을 모두 끊었어요.');
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: keys.sessions });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <User className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <CardTitle className="flex-1">로그인 중인 세션</CardTitle>
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-[12.5px]" disabled={!hasOthers} onClick={() => setConfirmOpen(true)}>
          다른 곳에서 모두 로그아웃
        </Button>
      </CardHeader>
      {sessions.isPending && <div className="px-5 py-3 text-[13.5px] text-muted-foreground">불러오는 중이에요</div>}
      {sessions.isError && <div className="px-5 py-3 text-[13.5px] text-muted-foreground">{errorMessage(sessions.error)}</div>}
      {items.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-b px-5 py-3 text-[13.5px] last:border-b-0">
          <span className="flex-1">
            {describeUserAgent(s.userAgent)}
            {s.current && ' (지금 이 기기)'}
          </span>
          <span className="text-[12.5px] text-muted-foreground">{s.ip ?? ''}</span>
          <span className="flex w-[130px] items-center justify-end gap-1.5 text-[12.5px] text-muted-foreground tabular-nums">
            {s.current ? (
              <>
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                사용 중
              </>
            ) : (
              formatTime(s.lastSeenAt)
            )}
          </span>
        </div>
      ))}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="다른 곳의 로그인을 모두 끊을까요?"
        description="지금 이 기기만 로그인 상태로 남아요. 다른 곳에서는 다시 로그인해야 해요."
        confirmLabel="모두 로그아웃"
        pending={pending}
        onConfirm={onConfirm}
      />
    </Card>
  );
}
