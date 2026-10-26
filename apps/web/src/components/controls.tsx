import { TYPE } from '@debrief/ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'quiet' | 'ghost';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'border-text bg-text font-medium text-ground hover:shadow-cta',
  quiet: 'border-line-strong text-text hover:bg-line',
  ghost: 'border-transparent text-text-muted hover:bg-line hover:text-text',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

// One button, the canvas pill in three weights; an icon sits before the label when given.
export function Button({
  variant = 'quiet',
  icon,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-8 items-center gap-2 rounded-pill border px-3.5 font-sans text-[13px] transition-[color,background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${BUTTON[variant]} ${className}`}
      {...rest}
    >
      {icon === undefined ? null : (
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current">
      <path d="M2 1.5v9l8-4.5z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current">
      <path d="M2 1.5h3v9H2zM7 1.5h3v9H7z" />
    </svg>
  );
}

export interface SegmentedProps<T extends string | number> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

// A row of mutually exclusive choices; the chosen one is lit. Replaces every native select in the app.
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-8 items-stretch gap-0.5 rounded-pill border border-line p-0.5 font-mono text-xs"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            className={`rounded-pill px-2.5 transition-[color,background-color] duration-200 ${
              on ? 'bg-line text-text' : 'text-text-subtle hover:text-text'
            }`}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`${TYPE.label} ${className}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
      {children}
    </kbd>
  );
}
