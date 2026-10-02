import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/form-alert';
import { PageLoader } from '@/components/page-loader';
import { ConfirmMatch, PasswordRules, passwordAcceptable, passwordErrorMessage } from '@/components/password-rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, errorMessage } from '@/lib/api';
import { authApi, keys, logoutAndLeave, useMe } from '@/lib/queries';

/** C-02 first-login password change. */
export function PasswordSetupPage() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me.data) return <PageLoader />;
  if (!me.data.mustChangePassword) return <Navigate to="/" />;
  const email = me.data.email;
  const canSubmit = passwordAcceptable(password, email) && password === confirm && !pending;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await authApi.changePassword(password);
      await queryClient.invalidateQueries({ queryKey: keys.me });
      await navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof ApiError ? passwordErrorMessage(err.code, err.message, err.details) : errorMessage(err));
      setPending(false);
    }
  };

  const onLogout = async () => {
    try {
      await logoutAndLeave();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar p-6">
      <div className="flex w-[400px] max-w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-[22px] font-bold tracking-tight">새 비밀번호를 정해 주세요</h1>
          <p className="text-sm text-muted-foreground">비밀번호를 바꿔야 다른 화면을 쓸 수 있어요.</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border bg-card p-6" noValidate>
          {error && <FormAlert message={error} />}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">새 비밀번호</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
          <PasswordRules password={password} email={email} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <ConfirmMatch password={password} confirm={confirm} />
          </div>
          <Button type="submit" disabled={!canSubmit}>
            저장하고 시작하기
          </Button>
        </form>
        <button
          type="button"
          onClick={onLogout}
          className="self-center text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
