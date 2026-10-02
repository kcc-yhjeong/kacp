import { cn } from '@/lib/utils';

export function LogoMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center bg-primary font-bold text-primary-foreground',
        size === 'sm' ? 'size-6 rounded-md text-xs' : 'size-10 rounded-xl text-lg',
      )}
    >
      K
    </span>
  );
}

export function Logo({ href }: { href?: string }) {
  const content = (
    <>
      <LogoMark />
      <span className="font-semibold tracking-tight">KACP</span>
    </>
  );
  return href ? (
    <a href={href} className="flex items-center gap-2">
      {content}
    </a>
  ) : (
    <span className="flex items-center gap-2">{content}</span>
  );
}
