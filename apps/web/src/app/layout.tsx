import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import { Ambient } from '../components/ambient';
import { PageTransition } from '../components/page-transition';
import { Shell } from '../components/shell';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'Debrief',
  description: 'Tamper-evident recorder for AI agents and verifiable incident reconstruction',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <Ambient />
        <Shell>
          <PageTransition>{children}</PageTransition>
        </Shell>
      </body>
    </html>
  );
}
