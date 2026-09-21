'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// Each route mounts fresh and rises in; the key is the path so a navigation replays the entrance.
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-rise" data-testid="page">
      {children}
    </div>
  );
}
