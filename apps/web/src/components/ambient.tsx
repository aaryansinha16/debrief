'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const AmbientCanvas = dynamic(
  () => import('../scenes/ambient-canvas').then((module) => module.AmbientCanvas),
  { ssr: false },
);

// Pages that measure their own canvas, or ask for less motion, get a still background.
export function wantsAmbient(pathname: string, reducedMotion: boolean): boolean {
  return !reducedMotion && !pathname.startsWith('/perf');
}

export function Ambient() {
  const pathname = usePathname();
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (): void => {
      setReduced(query.matches);
    };
    apply();
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
    };
  }, []);
  if (!wantsAmbient(pathname, reduced)) return null;
  return (
    <div className="ambient" aria-hidden="true" data-testid="ambient">
      <AmbientCanvas />
    </div>
  );
}
