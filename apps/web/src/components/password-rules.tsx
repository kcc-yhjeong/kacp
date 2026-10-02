import { PASSWORD_RULE_LABELS, passwordProblems, type PasswordRule } from '@kacp/shared';
import { Check, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const CHECKED_RULES: PasswordRule[] = ['min_length', 'letter_and_digit', 'no_email_id'];

/** Live password policy list (06-auth.md §2). `not_previous` needs the stored hash, so it is info only. */
export function PasswordRules({ password, email }: { password: string; email: string }) {
  const problems = passwordProblems(password, email);
  return (
    <ul className="flex flex-col gap-2">
      {CHECKED_RULES.map((rule) => {
        const ok = password.length > 0 && !problems.includes(rule);
        const Icon = ok ? Check : X;
        return (
          <li key={rule} className={cn('flex items-center gap-2 text-[13px]', ok ? 'text-foreground' : 'text-muted-foreground')}>
            <Icon className="size-3.5" strokeWidth={2.25} />
            {PASSWORD_RULE_LABELS[rule]}
          </li>
        );
      })}
      <li className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Info className="size-3.5" strokeWidth={2.25} />
        {PASSWORD_RULE_LABELS.not_previous} · 저장할 때 확인해요
      </li>
    </ul>
  );
}

export function passwordAcceptable(password: string, email: string): boolean {
  return password.length > 0 && passwordProblems(password, email).length === 0;
}

export function ConfirmMatch({ password, confirm }: { password: string; confirm: string }) {
  if (!confirm) return null;
  const match = password === confirm;
  const Icon = match ? Check : X;
  return (
    <span className={cn('flex items-center gap-1 text-xs', match ? 'text-foreground' : 'text-muted-foreground')}>
      <Icon className="size-3.5" strokeWidth={2.25} />
      {match ? '일치해요' : '일치하지 않아요'}
    </span>
  );
}

/** Error copy for a failed password change. */
export function passwordErrorMessage(code: string, message: string, details?: Record<string, unknown>): string {
  const rules = Array.isArray(details?.rules) ? (details.rules as string[]) : [];
  if (code === 'AUTH_PASSWORD_POLICY' && rules.includes('not_previous')) {
    return '저장하지 못했어요. 직전 비밀번호와 같아요. 다른 비밀번호를 정해 주세요.';
  }
  return message;
}
