import { CloudOff, Copy, RotateCw, X, type LucideIcon } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { initialOf } from '@/lib/format';
import { cn } from '@/lib/utils';

// Admin page building blocks (02-design-system.md §4–5).

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6', className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {breadcrumb && <div className="flex items-center gap-1 text-[13px] text-muted-foreground">{breadcrumb}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Card with an icon + title head (SectionCard). */
export function SectionCard({
  icon: Icon,
  title,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('overflow-hidden rounded-xl border bg-card', className)}>
      <div className="flex min-h-12 items-center gap-2 border-b px-5 py-3">
        {Icon && <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />}
        <h2 className="flex-1 text-sm font-medium">{title}</h2>
        {actions}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span className="grid size-14 place-items-center rounded-full bg-muted">
        <Icon className="size-7 text-muted-foreground" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold">{title}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title, error, onRetry }: { title: string; error?: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-muted">
        <CloudOff className="size-7 text-danger" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">
          {error ? errorMessage(error) : '연결이 잠시 끊겼어요. 다시 시도해 주세요.'}
        </span>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw strokeWidth={1.75} />
          다시 시도
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const widths = ['40%', '52%', '34%', '46%', '30%'];
  return (
    <div className="flex flex-col" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-6 border-b px-5 last:border-b-0">
          <Skeleton className="h-3.5" style={{ width: widths[i % widths.length] }} />
          <Skeleton className="ml-auto h-3.5 w-[14%]" />
        </div>
      ))}
    </div>
  );
}

/** Loading / error / empty slots for a list card. Returns null when there is data to show. */
export function ListState({
  isPending,
  error,
  isEmpty,
  errorTitle,
  onRetry,
  empty,
}: {
  isPending: boolean;
  error: unknown;
  isEmpty: boolean;
  errorTitle: string;
  onRetry?: () => void;
  empty: ReactNode;
}) {
  if (isPending) return <ListSkeleton />;
  if (error) return <ErrorState title={errorTitle} error={error} onRetry={onRetry} />;
  if (isEmpty) return <>{empty}</>;
  return null;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full border bg-muted text-xs font-semibold',
        className,
      )}
    >
      {initialOf(name)}
    </span>
  );
}

/** Lowest department name, full path in a tooltip (부서 표기 규칙, admin tables). */
export function DepartmentCell({ name, path }: { name: string | null | undefined; path?: string[] }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  const full = path && path.length > 1 ? path.join(' › ') : null;
  if (!full) return <span className="block max-w-[160px] truncate">{name}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-[160px] truncate">{name}</span>
      </TooltipTrigger>
      <TooltipContent>{full}</TooltipContent>
    </Tooltip>
  );
}

/** Read-only value + copy button (temporary passwords, addresses). */
export function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('복사했어요');
    } catch {
      toast.error('복사하지 못했어요. 직접 선택해 복사하세요.');
    }
  };
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className={cn('bg-muted', mono && 'font-mono')} onFocus={(e) => e.target.select()} />
      <Button type="button" variant="outline" size="icon" className="size-9" aria-label="복사" onClick={onCopy}>
        <Copy strokeWidth={1.75} />
      </Button>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Tag list + input; Enter or comma adds. */
export function TagInput({
  value,
  onChange,
  placeholder,
  validate,
  mono = true,
  disabled,
  ariaLabel,
  suggestions,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Autocomplete candidates (native datalist). */
  suggestions?: string[];
  /** Returns an error message to block the tag. */
  validate?: (tag: string) => string | null;
  mono?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = () => {
    const tag = draft.trim();
    if (!tag) return;
    if (value.includes(tag)) {
      setDraft('');
      return;
    }
    const problem = validate?.(tag);
    if (problem) {
      toast.error(problem);
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        disabled && 'opacity-50',
      )}
    >
      {value.map((tag) => (
        <span key={tag} className={cn('inline-flex h-6 items-center gap-1 rounded-md bg-secondary pr-1 pl-2 text-xs', mono && 'font-mono')}>
          {tag}
          {!disabled && (
            <button
              type="button"
              aria-label={`${tag} 빼기`}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        aria-label={ariaLabel ?? placeholder}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        list={suggestions ? listId : undefined}
        placeholder={value.length === 0 ? placeholder : ''}
        className="h-6 min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}
