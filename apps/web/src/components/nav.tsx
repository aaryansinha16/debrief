'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV = [
  { href: '/runs', label: 'Runs' },
  { href: '/live', label: 'Live' },
] as const;

// The section you are in is lit; a run page counts as Runs.
export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 text-sm" aria-label="primary">
      {NAV.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={`rounded-pill px-3.5 py-1.5 transition-[color,background-color] duration-200 ${
              current ? 'bg-line font-medium text-text' : 'text-text-subtle hover:text-text'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
