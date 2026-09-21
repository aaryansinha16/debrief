import type { ReactNode } from 'react';

import { Lite } from '../../components/lite';

export default function PerfLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Lite />
      {children}
    </>
  );
}
