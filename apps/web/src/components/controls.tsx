import { TYPE } from '@debrief/ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'quiet' | 'ghost';

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    'border-cyan-dim bg-cyan/10 text-cyan hover:bg-cyan/20 hover:border-cyan focus-visible:border-cyan',
  quiet:
    'border-stage-edge bg-stage-raised text-text hover:border-text-muted focus-visible:border-cyan',
  ghost: 'border-transparent text-text-muted hover:text-text hover:bg-stage-raised',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

// One button: a bordered pill in three weights; an icon sits before the label when given.
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
      className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 font-mono text-[13px] transition-colors outline-none disabled:opacity-50 ${BUTTON[variant]} ${className}`}
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
      className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-stage-edge bg-stage-raised font-mono text-xs"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            className={`px-2.5 transition-colors outline-none focus-visible:text-cyan ${
              on ? 'bg-stage-edge text-text' : 'text-text-muted hover:text-text'
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
    <kbd className="rounded border border-stage-edge bg-stage-raised px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
      {children}
    </kbd>
  );
}
