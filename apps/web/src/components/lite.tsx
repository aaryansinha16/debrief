'use client';

import { useEffect } from 'react';

// Perf pages measure a canvas: no blur, no ambient field, no entrance animations behind the numbers.
export function Lite() {
  useEffect(() => {
    document.documentElement.dataset.lite = '1';
    return () => {
      delete document.documentElement.dataset.lite;
    };
  }, []);
  return null;
}
