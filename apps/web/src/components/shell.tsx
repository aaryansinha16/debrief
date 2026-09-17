import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/runs', label: 'Runs' },
  { href: '/live', label: 'Live' },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-stage-edge">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
          <Link href="/runs" className="font-mono text-sm tracking-widest text-text uppercase">
            debrief
          </Link>
          <nav className="flex gap-6 text-sm text-text-muted">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-text">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-stage-edge px-6 py-4 text-center text-xs text-text-muted">
        tamper-evident recorder · every glyph verifies against a signed checkpoint
      </footer>
    </div>
  );
}
