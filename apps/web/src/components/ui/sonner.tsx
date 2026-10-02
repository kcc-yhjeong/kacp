import { Toaster as Sonner, type ToasterProps } from 'sonner';

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'rounded-lg! border! border-border! bg-popover! text-popover-foreground! shadow-float! font-sans!',
          description: 'text-muted-foreground!',
        },
      }}
      {...props}
    />
  );
}
