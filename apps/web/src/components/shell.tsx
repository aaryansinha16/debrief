import Link from 'next/link';
import type { ReactNode } from 'react';

import { Nav } from './nav';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-edge-light bg-stage/85">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-sm tracking-[0.25em] text-text uppercase"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm bg-ember shadow-[0_0_12px_var(--color-ember)]"
              aria-hidden="true"
            />
            debrief
          </Link>
          <Nav />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-edge-light px-6 py-4 text-center text-xs text-text-muted">
        tamper-evident recorder · every glyph verifies against a signed checkpoint
      </footer>
    </div>
  );
}
