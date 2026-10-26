export function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel rounded-lg border-contradicted/45 p-4 text-sm" role="alert">
      <p className="font-semibold text-contradicted">{title}</p>
      {children === undefined ? null : <div className="mt-2 text-text-muted">{children}</div>}
    </div>
  );
}
