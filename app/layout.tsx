import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Split bill',
  description:
    'Split a Malaysian restaurant bill and settle up by DuitNow. Only the person who paid needs an account.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The claim list is a long tap target list; let people zoom it.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfbf7' },
    { media: '(prefers-color-scheme: dark)', color: '#14110e' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
