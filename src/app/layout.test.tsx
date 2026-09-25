/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

type FontCall = {
  src: Array<{ path: string; weight?: string }>;
  variable?: string;
  adjustFontFallback?: string | false;
  declarations?: Array<{ prop: string; value: string }>;
};

/**
 * The loaders run at module import time, so the record has to exist before
 * the mock factory is hoisted above the import of the layout. A plain
 * top-level `const` here throws a hoisting ReferenceError.
 */
const fontCalls = vi.hoisted(() => [] as FontCall[]);

/**
 * `next/font/local` throws outside the Next.js compiler, which rewrites these
 * calls at build time. Under Vitest the loader is stubbed with the shape Next
 * produces: a class name, plus the CSS custom property the stylesheets read
 * when the call asks for one.
 */
vi.mock('next/font/local', () => ({
  default: (options: FontCall) => {
    fontCalls.push(options);
    return {
      className: `__mock_${options.variable ?? 'face'}`,
      ...(options.variable ? { variable: `__mock_var_${options.variable}` } : {}),
      style: { fontFamily: options.variable ?? 'face' },
    };
  },
}));

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'shliff_theme' && cookieValue.current !== undefined
        ? { name, value: cookieValue.current }
        : undefined,
  }),
}));

import RootLayout from '@/app/layout';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const declared = (call: FontCall, prop: string) =>
  call.declarations?.find((declaration) => declaration.prop === prop)?.value;
const inFolder = (folder: string) =>
  fontCalls.filter((call) => call.src.every((file) => file.path.startsWith(`./fonts/${folder}/`)));

/**
 * Each call paired with the const it is assigned to. The calls run at module
 * scope, top to bottom, so source order is call order.
 */
const namedCalls = () => {
  const names = [...read('src/app/layout.tsx').matchAll(/^const (\w+) = localFont\(/gm)]
    .map((match) => match[1]);
  expect(names).toHaveLength(fontCalls.length);
  return names.map((name, index) => ({ name, call: fontCalls[index] }));
};

describe('RootLayout', () => {
  it('renders the document right-to-left in Hebrew', async () => {
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      lang: string; dir: string;
    }>;
    expect(element.props.lang).toBe('he');
    expect(element.props.dir).toBe('rtl');
  });

  /**
   * The font custom properties must be declared at the root, not on a per-page
   * wrapper: they inherit downward only, and the admin nav renders above every
   * page. Without them the Hebrew wordmark falls through to Georgia, which has
   * no Hebrew glyphs.
   */
  it('declares the font custom properties on <html>, above every page', async () => {
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      className: string;
    }>;
    expect(element.props.className).toContain('__mock_var_--font-display');
    expect(element.props.className).toContain('__mock_var_--font-body');
  });

  it('declares the mono face for spreadsheet cell references', async () => {
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      className: string;
    }>;
    expect(element.props.className).toContain('__mock_var_--font-mono');
  });

  /**
   * A5. Heebo carries the whole interface, so it needs the four weights the
   * kit uses: 400 body, 500 labels and nav, 600 headings and figures, 700 for
   * the few places a figure has to shout. Frank Ruhl Libre is down to the
   * wordmark and the sign-in page and needs one.
   *
   * Every call for a family is checked, not just one: a Hebrew half missing a
   * weight would render its Hebrew synthesised from a neighbouring weight
   * while the Latin beside it is true.
   */
  it('loads each face at the weights its job needs, in every subset', () => {
    const weights = (folder: string) =>
      inFolder(folder).map((call) => call.src.map((file) => file.weight));
    expect(weights('heebo')).toEqual([
      ['400', '500', '600', '700'],
      ['400', '500', '600', '700'],
    ]);
    expect(weights('frank-ruhl-libre')).toEqual([['500'], ['500']]);
    expect(weights('ibm-plex-mono')).toEqual([['400'], ['400']]);
  });

  /**
   * Turbopack names a face after the const its call is assigned to, so a
   * Hebrew half joins its family only while its declared `font-family` spells
   * that const's name. Rename one and not the other and nothing fails: Hebrew
   * quietly renders in the fallback face. Each half must also carry its own
   * subset's range, or the browser cannot choose between the two files.
   */
  it('puts each Hebrew half in the family its Latin half owns', () => {
    const calls = namedCalls();
    const hebrew = calls.filter(({ call }) =>
      call.src.every((file) => file.path.endsWith('-hebrew.woff2')));
    expect(hebrew.map(({ name }) => name)).toEqual(['Frank_Ruhl_Libre_Hebrew', 'Heebo_Hebrew']);

    for (const half of hebrew) {
      const folder = half.call.src[0].path.split('/')[2];
      const owner = calls.find(({ call }) =>
        call.variable !== undefined && inFolder(folder).includes(call));
      expect(owner, `no call owns a custom property for ${folder}`).toBeDefined();
      expect(declared(half.call, 'font-family')).toBe(`'${owner!.name}'`);
      expect(declared(half.call, 'unicode-range')).toContain('U+0590-05FF');
      expect(declared(owner!.call, 'unicode-range')).toContain('U+0000-00FF');
    }
  });

  /**
   * `(home)/home.module.css` names Plex Mono literally, and Google's loader
   * used to satisfy that name. If the stylesheet moves to `--font-mono`, this
   * test's first expectation fails; `IBM_Plex_Mono_ByName` can then go too.
   */
  it("keeps the family home.module.css names as 'IBM Plex Mono'", () => {
    expect(read('src/app/(admin)/(home)/home.module.css')).toContain("'IBM Plex Mono'");

    const owner = fontCalls.find((call) => call.variable === '--font-mono');
    const byName = fontCalls.find((call) => declared(call, 'font-family') === "'IBM Plex Mono'");
    expect(byName?.src).toEqual(owner?.src);
    // The fallback flag is part of the emitted file name: equal flags, one URL.
    expect(byName?.adjustFontFallback).toBe(owner?.adjustFontFallback);
  });
});

describe('RootLayout theme', () => {
  /**
   * A13: the choice is on <html> before the first byte of body renders, so
   * there is no flash of the palette the reader did not choose.
   */
  it('puts the chosen theme on <html>', async () => {
    cookieValue.current = 'dark';
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBe('dark');
  });

  it('carries an explicit light choice too, so it can beat the OS preference', async () => {
    cookieValue.current = 'light';
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBe('light');
  });

  /**
   * No cookie means no attribute, which is what lets the guarded
   * `prefers-color-scheme` rule in tokens.css apply.
   */
  it('leaves the attribute off when nobody has chosen', async () => {
    cookieValue.current = undefined;
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBeUndefined();
  });

  it('ignores a cookie value that is not a theme', async () => {
    cookieValue.current = 'midnight';
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBeUndefined();
  });
});
