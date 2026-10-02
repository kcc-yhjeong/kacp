import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, errorMessage, setCsrfToken } from '@/lib/api';
import { currentHost, isSafeNext } from '@/lib/host';
import { authApi, keys } from '@/lib/queries';

/** C-01 login. */
export function LoginPage({ next }: { next?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; credentials: boolean } | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const me = await authApi.login(email.trim(), password);
      setCsrfToken(me.csrfToken);
      queryClient.setQueryData(keys.me, me);
      if (me.mustChangePassword) {
        await navigate({ to: '/password/setup' });
      } else if (isSafeNext(next, currentHost.base)) {
        location.href = next;
      } else {
        await navigate({ to: '/' });
      }
    } catch (err) {
      setError({
        message: errorMessage(err),
        credentials: err instanceof ApiError && err.code === 'AUTH_INVALID_CREDENTIALS',
      });
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar p-6">
      <div className="flex w-[380px] max-w-full flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark size="lg" />
          <div className="flex flex-col gap-1">
            <h1 className="text-[22px] font-bold tracking-tight">KACP에 로그인</h1>
            <p className="text-sm text-muted-foreground">팀 에이전트와 드라이브를 함께 써요</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border bg-card p-6" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">이메일</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error?.credentials || undefined}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error?.credentials || undefined}
            />
          </div>
          {error && <FormAlert message={error.message} />}
          <Button type="submit" disabled={pending || !email.trim() || !password}>
            로그인
          </Button>
        </form>
        <p className="text-center text-[13px] text-pretty text-muted-foreground">
          계정이 없거나 비밀번호를 잊었다면 관리자에게 문의하세요
        </p>
      </div>
    </div>
  );
}
