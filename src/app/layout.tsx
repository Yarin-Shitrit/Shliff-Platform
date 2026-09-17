import type { Metadata } from 'next';
import { Frank_Ruhl_Libre, Heebo, IBM_Plex_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
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
 *
 * A5 assigns each face one job. Heebo is the interface: it has the Hebrew
 * coverage, it carries tabular numerals, and it is the only face a table,
 * a form or a figure is ever set in. Frank Ruhl Libre is a display serif and
 * is kept for the wordmark and the sign-in page and nowhere else — a serif at
 * 12.5px in a table is a legibility cost with nothing bought for it. IBM Plex
 * Mono exists for one thing: a spreadsheet cell reference such as
 * `תנועות קופה!A14`, where the Latin run has to line up like the workbook
 * shows it. Its Hebrew sheet name falls through to the system mono, which is
 * correct — Plex Mono has no Hebrew.
 */
const display = Frank_Ruhl_Libre({
  subsets: ['hebrew', 'latin'],
  weight: ['500'],
  variable: '--font-display',
});
const body = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'פלטפורמת שליף',
  description: 'ניהול נתוני הקאמפ',
};

/**
 * A13. The theme is read from the cookie on the server and written onto
 * <html> before anything renders, so the first paint is already the palette
 * the reader chose. With no cookie the attribute is omitted entirely, which
 * is what lets tokens.css's guarded `prefers-color-scheme` rule decide.
 *
 * This is a request-time read, so it opts every route into dynamic rendering.
 * Every route here is already dynamic: they are all behind requireAdmin() and
 * they all read the database.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="he"
      dir="rtl"
      data-theme={theme ?? undefined}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
