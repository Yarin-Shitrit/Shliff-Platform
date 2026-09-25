import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
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
 *
 * The files are self-hosted, from `./fonts/`. They were `next/font/google`
 * until that loader's build-time download failed on a GitHub runner and took
 * a production deploy down with it (run 36139140426): a build must not depend
 * on a third party's CDN answering. They are Google's own files, byte for
 * byte — the css2 API's Hebrew and Latin subsets, the only two the layout
 * ever asked for. Each family's OFL.txt sits beside its files.
 *
 * How the calls are shaped, because none of it is obvious:
 *
 * - Google cuts a family into one file per subset and lets `unicode-range`
 *   pick between them. `next/font/local` applies `declarations` to every face
 *   a call emits, so one subset is one call, and the two halves of a family
 *   differ only in file and range. The ranges are Google's, verbatim, written
 *   out in full because the font compiler accepts literals only.
 * - Turbopack names a face after the **const** it is assigned to, and builds
 *   the custom property from that name, ignoring a `font-family` declaration.
 *   So the Latin half of each family is the call that owns the custom property
 *   and the metric-matched fallback face (those metrics are measured from Latin
 *   glyphs the Hebrew file lacks), and its const is named for the font:
 *   `--font-body` is `"Heebo", "Heebo Fallback"`, exactly what Google's loader
 *   rendered. A family whose name has spaces cannot be a const, so the other
 *   two render as `Frank_Ruhl_Libre` and `IBM_Plex_Mono`.
 * - The Hebrew half joins its family by declaring that const's name as its
 *   `font-family`. The string has to equal the const name; `layout.test.tsx`
 *   holds it there.
 * - Nothing reads a Hebrew half's binding. The call is the point: the compiler
 *   turns it into an import of the stylesheet that carries its faces.
 */
const Frank_Ruhl_Libre = localFont({
  src: [{ path: './fonts/frank-ruhl-libre/frank-ruhl-libre-500-latin.woff2', weight: '500' }],
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
  declarations: [
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
  variable: '--font-display',
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- emits the Hebrew faces; see above
const Frank_Ruhl_Libre_Hebrew = localFont({
  src: [{ path: './fonts/frank-ruhl-libre/frank-ruhl-libre-500-hebrew.woff2', weight: '500' }],
  display: 'swap',
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'Frank_Ruhl_Libre'" },
    { prop: 'unicode-range', value: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F' },
  ],
});

/** One variable file per subset serves all four weights, as it did from Google. */
const Heebo = localFont({
  src: [
    { path: './fonts/heebo/heebo-latin.woff2', weight: '400' },
    { path: './fonts/heebo/heebo-latin.woff2', weight: '500' },
    { path: './fonts/heebo/heebo-latin.woff2', weight: '600' },
    { path: './fonts/heebo/heebo-latin.woff2', weight: '700' },
  ],
  display: 'swap',
  adjustFontFallback: 'Arial',
  declarations: [
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
  variable: '--font-body',
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- emits the Hebrew faces; see above
const Heebo_Hebrew = localFont({
  src: [
    { path: './fonts/heebo/heebo-hebrew.woff2', weight: '400' },
    { path: './fonts/heebo/heebo-hebrew.woff2', weight: '500' },
    { path: './fonts/heebo/heebo-hebrew.woff2', weight: '600' },
    { path: './fonts/heebo/heebo-hebrew.woff2', weight: '700' },
  ],
  display: 'swap',
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'Heebo'" },
    { prop: 'unicode-range', value: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F' },
  ],
});

const IBM_Plex_Mono = localFont({
  src: [{ path: './fonts/ibm-plex-mono/ibm-plex-mono-400-latin.woff2', weight: '400' }],
  display: 'swap',
  adjustFontFallback: 'Arial',
  declarations: [
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
  variable: '--font-mono',
});
/**
 * `(home)/home.module.css` names the family as `'IBM Plex Mono'` rather than
 * through `--font-mono`, which Google's loader happened to satisfy. This keeps
 * that name resolving to the same file. It keeps the fallback flag the call
 * above has, because the flag is part of the emitted file name: with the same
 * flags both calls share one URL, and the browser downloads the file once.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- emits the face; see above
const IBM_Plex_Mono_ByName = localFont({
  src: [{ path: './fonts/ibm-plex-mono/ibm-plex-mono-400-latin.woff2', weight: '400' }],
  display: 'swap',
  adjustFontFallback: 'Arial',
  declarations: [
    { prop: 'font-family', value: "'IBM Plex Mono'" },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

/**
 * B8: a page sets its own name and this supplies the suffix. The suffix is
 * the wordmark — קופת שליף — because that is what the product calls itself
 * on screen; "פלטפורמת שליף" appeared nowhere but the title bar.
 */
export const metadata: Metadata = {
  title: { default: 'קופת שליף', template: '%s · קופת שליף' },
  description: 'ניהול נתוני הקאמפ',
  /* "Add to home screen" (2026-09-25). Safari on iPhone takes the icon from
     `apple-icon.png` beside this file (Next's file convention) and the name
     from here; Android and desktop Chrome read `manifest.ts`. The tab's
     icon (`icon.png`) is the same logo, so the home screen shows what the
     tab does. */
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'קופת שליף', statusBarStyle: 'default' },
};

/**
 * The colour the phone paints around the page — the status bar, the
 * launcher's splash — is the page's own canvas, light or dark with the OS
 * (`tokens.css` `--canvas`). Separate from `metadata` because Next reads
 * `themeColor` from `viewport`.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F4F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0E0D0C' },
  ],
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
      className={`${Frank_Ruhl_Libre.variable} ${Heebo.variable} ${IBM_Plex_Mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
