export function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded border border-ember-dim bg-stage-raised p-4 text-sm" role="alert">
      <p className="font-semibold text-ember">{title}</p>
      {children === undefined ? null : <div className="mt-2 text-text-muted">{children}</div>}
    </div>
  );
}
