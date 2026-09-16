import type { Metadata, Viewport } from 'next';

import { PressFeedback } from '@/components/press-feedback';

import './globals.css';

export const metadata: Metadata = {
  title: 'Split bill',
  description:
    'Split a Malaysian restaurant bill and settle up by DuitNow. Only the person who paid needs an account.',
  // Opened from a WhatsApp link and lived in from the home screen, so it should
  // behave like something installed rather than a page that happens to be open.
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Split bill' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The claim list is a long tap target list; let people zoom it.
  maximumScale: 5,
  // The chrome is translucent and the content runs under it, so the layout has
  // to own the whole screen including the area behind the notch and the home
  // indicator. Every fixed edge below pads itself back out with the safe-area
  // insets.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfbf7' },
    { media: '(prefers-color-scheme: dark)', color: '#14110e' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <PressFeedback />
        {children}
      </body>
    </html>
  );
}
