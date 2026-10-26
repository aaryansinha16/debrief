import { useSyncExternalStore } from 'react';

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const query = (): MediaQueryList | undefined =>
  typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : undefined;

export const prefersReducedMotion = (): boolean => query()?.matches === true;

const subscribe = (onChange: () => void): (() => void) => {
  const list = query();
  list?.addEventListener('change', onChange);
  return () => {
    list?.removeEventListener('change', onChange);
  };
};

const SERVER_SNAPSHOT = (): boolean => false;

// The server renders motion; the client takes the reader's setting at hydration and follows it if it changes.
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, prefersReducedMotion, SERVER_SNAPSHOT);
