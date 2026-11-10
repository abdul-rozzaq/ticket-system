'use client';
// Small shadcn-style UI kit (hand-written; no Radix dependency).
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted border',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-white hover:opacity-90',
        outline: 'border bg-card hover:bg-muted',
      },
      size: { default: 'h-9 px-3.5', sm: 'h-8 px-2.5 text-xs', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...p }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...p} />
  ),
);
Button.displayName = 'Button';

const fieldCls =
  'w-full rounded-md border bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(fieldCls, 'h-9', className)} {...p} />,
);
Input.displayName = 'Input';
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(fieldCls, 'min-h-20', className)} {...p} />
));
Textarea.displayName = 'Textarea';
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => <select ref={ref} className={cn(fieldCls, 'h-9', className)} {...p} />,
);
Select.displayName = 'Select';

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...p} />;
}
export function CardHeader({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {actions}
    </div>
  );
}
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-4', className)} {...p} />
);

const badgeTone = {
  default: 'bg-secondary text-secondary-foreground',
  primary: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/20 text-foreground',
  danger: 'bg-destructive/15 text-destructive',
  muted: 'bg-muted text-muted-foreground',
} as const;
export function Badge({
  tone = 'default',
  className,
  ...p
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTone[tone],
        className,
      )}
      {...p}
    />
  );
}

export function Spinner() {
  return <div className="p-6 text-center text-sm text-muted-foreground">{t('common.loading')}</div>;
}
export function Empty({ text }: { text?: string }) {
  return <div className="p-6 text-center text-sm text-muted-foreground">{text ?? t('common.empty')}</div>;
}
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {msg}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm', className)} {...p} />
    </div>
  );
}
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn('border-b px-3 py-2 text-left text-xs font-medium text-muted-foreground', className)}
    {...p}
  />
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-b px-3 py-2 align-top', className)} {...p} />
);

/** Modal built on the native <dialog> element (focus trap + Esc come for free). */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-lg border bg-card p-0 text-card-foreground shadow-xl',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('common.close')}>
              <X size={16} />
            </Button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
}) {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm',
            value === i.value
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        role="switch"
        className="h-4 w-4 accent-[var(--primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
      <span>
        {t('common.total')}: {total}
      </span>
      <span className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('common.prev')}
        </Button>
        {page} / {pages}
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
        </Button>
      </span>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'danger' | 'warning' | 'success';
  sub?: string;
}) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums',
            tone === 'danger' && 'text-destructive',
            tone === 'warning' && 'text-warning',
            tone === 'success' && 'text-success',
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardBody>
    </Card>
  );
}
