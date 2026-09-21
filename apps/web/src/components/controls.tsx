import { TYPE } from '@debrief/ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'quiet' | 'ghost';

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    'border-cyan-dim bg-cyan/10 text-cyan shadow-[0_0_0_0_transparent] hover:bg-cyan/20 hover:border-cyan hover:shadow-glow-cyan focus-visible:border-cyan',
  quiet:
    'border-edge-light bg-glass text-text hover:border-text-muted hover:bg-stage-raised focus-visible:border-cyan',
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
      className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 font-mono text-[13px] transition-[color,background-color,border-color,box-shadow,transform] duration-200 outline-none hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${BUTTON[variant]} ${className}`}
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
      className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-edge-light bg-glass font-mono text-xs"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            className={`px-2.5 transition-[color,background-color,box-shadow] duration-200 outline-none focus-visible:text-cyan ${
              on
                ? 'bg-stage-edge text-text shadow-[inset_0_-2px_0_var(--color-cyan)]'
                : 'text-text-muted hover:text-text'
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
