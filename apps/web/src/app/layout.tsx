import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Shell } from '../components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Debrief',
  description: 'Tamper-evident recorder for AI agents and verifiable incident reconstruction',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
