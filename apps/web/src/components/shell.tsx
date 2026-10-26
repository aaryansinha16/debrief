import Link from 'next/link';
import type { ReactNode } from 'react';

import { Nav } from './nav';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ground/85">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-display text-[27px] leading-none text-text"
          >
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="16" cy="16" r="5" className="fill-holds" />
              <path d="M3 16h6M23 16h6" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            Debrief
          </Link>
          <Nav />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-line px-6 py-4 text-center font-mono text-xs text-label">
        tamper-evident recorder · every glyph verifies against a signed checkpoint
      </footer>
    </div>
  );
}
