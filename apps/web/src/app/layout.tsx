import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';

import { Ambient } from '../components/ambient';
import { PageTransition } from '../components/page-transition';
import { Shell } from '../components/shell';
import './globals.css';

const serif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
});
const sans = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Debrief',
  description: 'Tamper-evident recorder for AI agents and verifiable incident reconstruction',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Ambient />
        <Shell>
          <PageTransition>{children}</PageTransition>
        </Shell>
      </body>
    </html>
  );
}
