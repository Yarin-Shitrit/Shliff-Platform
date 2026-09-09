import type { Metadata } from 'next';
import { Frank_Ruhl_Libre, Heebo } from 'next/font/google';
import './globals.css';

/**
 * The fonts are instantiated here, at the root, and their custom properties
 * are applied to `<html>`.
 *
 * Custom properties inherit downward only, so declaring them on a per-page
 * wrapper leaves everything rendered *above* that wrapper — the admin nav in
 * particular — without them. The nav's wordmark then fell through to Georgia,
 * which has no Hebrew glyphs, so "קופת שליף" rendered in an arbitrary browser
 * fallback on every admin page.
 */
const display = Frank_Ruhl_Libre({
  subsets: ['hebrew', 'latin'],
  weight: ['500'],
  variable: '--font-display',
});
const body = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'פלטפורמת שליף',
  description: 'ניהול נתוני הקאמפ',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
