import { TriangleAlert } from 'lucide-react';

/** Inline error box used by forms (C-01, C-02, U-14). */
export function FormAlert({ message }: { message: string }) {
  return (
    <div role="alert" className="flex gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-normal">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
      <span>{message}</span>
    </div>
  );
}
