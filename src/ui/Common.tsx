import {
  ChevronRight,
  CircleAlert,
  Info,
  X,
  type LucideIcon
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react';
import { classNames } from './utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'tonal' | 'outline' | 'ghost' | 'danger';
  fullWidth?: boolean;
  icon?: LucideIcon;
}

export function Button({
  tone = 'primary',
  fullWidth = false,
  icon: Icon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames('bc-button', `bc-button--${tone}`, fullWidth && 'bc-button--full', className)}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" size={20} strokeWidth={2} /> : null}
      <span>{children}</span>
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: LucideIcon;
}

export function IconButton({ label, icon: Icon, className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={classNames('bc-icon-button', className)}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon aria-hidden="true" size={22} />
    </button>
  );
}

export interface TopBarProps {
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
}

export function TopBar({ title, leading, actions }: TopBarProps) {
  return (
    <header className="bc-top-bar">
      <div className="bc-top-bar__leading">{leading}</div>
      <h1>{title}</h1>
      <div className="bc-top-bar__actions">{actions}</div>
    </header>
  );
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={classNames('bc-screen', className)}>{children}</section>;
}

export interface StatusLineProps {
  label: string;
  value: string;
  positive?: boolean;
  icon?: LucideIcon;
}

export function StatusLine({ label, value, positive, icon: Icon }: StatusLineProps) {
  return (
    <div className="bc-status-line">
      <span className="bc-status-line__label">
        {Icon ? <Icon aria-hidden="true" size={19} /> : null}
        {label}
      </span>
      <span className="bc-status-line__value">
        {positive === undefined ? null : (
          <span className={classNames('bc-status-dot', positive ? 'is-positive' : 'is-negative')} aria-hidden="true" />
        )}
        {value}
      </span>
    </div>
  );
}

export interface MetricBlockProps {
  label: string;
  value: string;
  prominent?: boolean;
}

export function MetricBlock({ label, value, prominent = false }: MetricBlockProps) {
  return (
    <div className={classNames('bc-metric', prominent && 'bc-metric--prominent')}>
      <span className="bc-metric__label">{label}</span>
      <strong className="bc-metric__value">{value}</strong>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="bc-section-title">{children}</h2>;
}

export interface EmptyStateProps {
  title: string;
  body: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

export function EmptyState({ title, body, icon: Icon = Info, action }: EmptyStateProps) {
  return (
    <div className="bc-empty-state">
      <div className="bc-empty-state__icon"><Icon aria-hidden="true" size={28} /></div>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

export interface DialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss: () => void;
  icon?: LucideIcon;
  variant?: 'dialog' | 'sheet';
  dismissLabel?: string;
  className?: string;
}

export function Dialog({
  open,
  title,
  children,
  actions,
  onDismiss,
  icon: Icon,
  variant = 'dialog',
  dismissLabel = 'Close',
  className
}: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')?.focus();
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onDismiss, open]);

  if (!open) return null;

  return (
    <div className="bc-dialog-layer" role="presentation" onMouseDown={onDismiss}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={classNames('bc-dialog', `bc-dialog--${variant}`, className)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="bc-dialog__header">
          {Icon ? <span className="bc-dialog__icon"><Icon aria-hidden="true" size={24} /></span> : null}
          <h2 id={titleId}>{title}</h2>
          <IconButton label={dismissLabel} icon={X} onClick={onDismiss} />
        </div>
        {children ? <div className="bc-dialog__body">{children}</div> : null}
        {actions ? <div className="bc-dialog__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export interface InlineNoticeProps {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
}

export function InlineNotice({ children, tone = 'info', title }: InlineNoticeProps) {
  const NoticeIcon = tone === 'error' || tone === 'warning' ? CircleAlert : Info;
  return (
    <div className={classNames('bc-notice', `bc-notice--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <NoticeIcon aria-hidden="true" size={20} />
      <div>
        {title ? <strong>{title}</strong> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  summary?: string;
}

export function SwitchRow({ label, checked, onChange, disabled = false, summary }: SwitchRowProps) {
  return (
    <label className={classNames('bc-switch-row', disabled && 'is-disabled')}>
      <span className="bc-switch-row__copy">
        <span>{label}</span>
        {summary ? <small>{summary}</small> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="bc-switch" aria-hidden="true"><span /></span>
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  return (
    <fieldset className="bc-segmented">
      <legend>{label}</legend>
      <div className="bc-segmented__track">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={value === option.value ? 'is-selected' : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export interface ActionRowProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  detail?: string;
}

export function ActionRow({ label, icon: Icon, onClick, destructive = false, disabled = false, detail }: ActionRowProps) {
  return (
    <button
      type="button"
      className={classNames('bc-action-row', destructive && 'bc-action-row--danger')}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon aria-hidden="true" size={21} />
      <span>
        <span>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
      <ChevronRight aria-hidden="true" size={20} />
    </button>
  );
}

export interface ToastProps {
  message: string | null;
  onDismiss?: () => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  if (!message) return <div className="bc-toast-region" aria-live="polite" />;
  return (
    <div className="bc-toast-region" aria-live="polite">
      <div className="bc-toast">
        <span>{message}</span>
        {onDismiss ? <IconButton label="Dismiss message" icon={X} onClick={onDismiss} /> : null}
      </div>
    </div>
  );
}

export function LoadingOverlay({ visible, label = 'Working…' }: { visible: boolean; label?: string }) {
  if (!visible) return null;
  return (
    <div className="bc-loading-overlay" role="status" aria-live="polite">
      <span className="bc-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
