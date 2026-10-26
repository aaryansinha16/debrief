import type { ReactNode } from 'react';

export interface UnbuiltButtonProps {
  // The id of the visible line that says why the button does nothing yet.
  reason: string;
  icon?: ReactNode;
  children: ReactNode;
}

// A control for a page not built yet: dashed and muted with no glow or lift, text still at 4.5:1, never a dead link.
export function UnbuiltButton({ reason, icon, children }: UnbuiltButtonProps) {
  return (
    <button
      type="button"
      disabled
      aria-describedby={reason}
      className="inline-flex min-h-12 cursor-not-allowed items-center gap-2.5 rounded-pill border border-dashed border-line-strong px-[22px] font-medium text-text-muted"
      data-testid="unbuilt"
    >
      {icon === undefined ? null : (
        <span className="inline-flex" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
