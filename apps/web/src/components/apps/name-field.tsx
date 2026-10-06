import { checkName, ERROR_MESSAGES } from '@kacp/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api';
import { appApi } from '@/lib/apps/api';
import { currentHost } from '@/lib/host';

export type NameCheck = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; message: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Local rules first, then `GET /names/check` (debounced). */
export function useNameCheck(name: string): NameCheck {
  const dn = useDebounced(name, 300);
  const local = name ? checkName(name) : null;
  const remote = useQuery({
    queryKey: ['names', 'check', dn],
    queryFn: () => appApi.checkName(dn),
    enabled: dn.length > 0 && checkName(dn) === null,
    staleTime: 5_000,
  });
  if (!name) return { state: 'idle' };
  if (local) return { state: 'bad', message: ERROR_MESSAGES[local] };
  if (dn !== name || remote.isFetching || remote.isPending) return { state: 'checking' };
  if (remote.isError) return { state: 'bad', message: errorMessage(remote.error) };
  if (remote.data.available) return { state: 'ok' };
  const reason = remote.data.reason as keyof typeof ERROR_MESSAGES | null;
  return { state: 'bad', message: reason && reason in ERROR_MESSAGES ? ERROR_MESSAGES[reason] : '쓸 수 없는 이름이에요.' };
}

/** NameField (02 §5): input + `.{base}` suffix + rules + live result. */
export function NameField({
  id,
  label,
  value,
  onChange,
  check,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  check: NameCheck;
  disabled?: boolean;
}) {
  const base = currentHost.base ?? 'kacp.cloud';
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      <div className="flex items-center overflow-hidden rounded-md border focus-within:ring-[3px] focus-within:ring-ring/50">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="border-0 font-mono shadow-none focus-visible:ring-0"
          aria-invalid={check.state === 'bad'}
          aria-describedby={`${id}-hint ${id}-result`}
        />
        <span className="shrink-0 border-l bg-muted px-3 py-2 font-mono text-[13px] text-muted-foreground">.{base}</span>
      </div>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        기본값은 앱 이름이에요. 소문자·숫자·하이픈, 3~30자, 하이픈으로 시작·끝 불가, -- 불가, 예약어 불가
      </span>
      <span id={`${id}-result`} aria-live="polite" className="text-xs">
        {check.state === 'checking' && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            확인하고 있어요
          </span>
        )}
        {check.state === 'ok' && (
          <span className="flex items-center gap-1">
            <Check className="size-3.5 text-success" strokeWidth={2.5} />
            사용할 수 있어요
          </span>
        )}
        {check.state === 'bad' && (
          <span className="flex items-center gap-1">
            <X className="size-3.5 text-danger" strokeWidth={2.5} />
            {check.message}
          </span>
        )}
      </span>
    </div>
  );
}
