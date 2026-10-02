import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  /** When set, the user must type this exact text (team/user deletion — C-05). */
  typeToConfirm?: string;
  onConfirm: () => void;
}

/** C-05 confirm modal for irreversible actions. The caller closes it when the action finishes. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  typeToConfirm,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const blocked = typeToConfirm !== undefined && typed !== typeToConfirm;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('');
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {typeToConfirm !== undefined && (
          <div className="flex flex-col gap-2">
            <span className="text-sm">
              확인하려면 <span className="font-mono text-xs font-medium">{typeToConfirm}</span>을(를) 입력하세요
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={blocked || pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
