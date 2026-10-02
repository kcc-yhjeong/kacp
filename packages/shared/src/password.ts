// Password policy (06-auth.md §2). "Different from the previous password" needs the stored
// hash, so the api checks that rule separately.

export type PasswordRule = 'min_length' | 'letter_and_digit' | 'no_email_id';

export const PASSWORD_MIN_LENGTH = 10;

export function passwordProblems(password: string, email: string): PasswordRule[] {
  const problems: PasswordRule[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push('min_length');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) problems.push('letter_and_digit');
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length > 0 && password.toLowerCase().includes(localPart)) problems.push('no_email_id');
  return problems;
}

export const PASSWORD_RULE_LABELS: Record<PasswordRule | 'not_previous', string> = {
  min_length: '10자 이상',
  letter_and_digit: '영문·숫자 포함',
  no_email_id: '이메일 아이디(@ 앞) 포함 불가',
  not_previous: '직전 비밀번호와 다름',
};
