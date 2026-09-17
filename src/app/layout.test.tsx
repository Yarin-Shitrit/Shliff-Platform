/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * The loaders run at module import time, so the record has to exist before
 * the mock factory is hoisted above the import of the layout. A plain
 * top-level `const` here throws a hoisting ReferenceError.
 */
const fontCalls = vi.hoisted(() => [] as Array<{ family: string; weight?: string[] }>);

/**
 * `next/font/google` ships an empty module outside the Next.js compiler, which
 * rewrites these calls at build time. Under Vitest the real import resolves to
 * nothing, so the loaders are stubbed with the shape Next produces: a class
 * name plus the CSS custom property the stylesheets read.
 */
vi.mock('next/font/google', () => {
  const loader = (family: string) =>
    (options: { variable: string; weight?: string[] }) => {
      fontCalls.push({ family, weight: options.weight });
      return {
        className: `__mock_${options.variable}`,
        variable: `__mock_var_${options.variable}`,
        style: { fontFamily: options.variable },
      };
    };
  return {
    Frank_Ruhl_Libre: loader('Frank_Ruhl_Libre'),
    Heebo: loader('Heebo'),
    IBM_Plex_Mono: loader('IBM_Plex_Mono'),
  };
});

import RootLayout from '@/app/layout';

describe('RootLayout', () => {
  it('renders the document right-to-left in Hebrew', () => {
    const element = RootLayout({ children: null }) as React.ReactElement<{
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
  it('declares the font custom properties on <html>, above every page', () => {
    const element = RootLayout({ children: null }) as React.ReactElement<{
      className: string;
    }>;
    expect(element.props.className).toContain('__mock_var_--font-display');
    expect(element.props.className).toContain('__mock_var_--font-body');
  });

  it('declares the mono face for spreadsheet cell references', () => {
    const element = RootLayout({ children: null }) as React.ReactElement<{
      className: string;
    }>;
    expect(element.props.className).toContain('__mock_var_--font-mono');
  });

  /**
   * A5. Heebo carries the whole interface, so it needs the four weights the
   * kit uses: 400 body, 500 labels and nav, 600 headings and figures, 700 for
   * the few places a figure has to shout. Frank Ruhl Libre is down to the
   * wordmark and the sign-in page and needs one.
   */
  it('loads each face at the weights its job needs', () => {
    expect(fontCalls.find((call) => call.family === 'Heebo')?.weight)
      .toEqual(['400', '500', '600', '700']);
    expect(fontCalls.find((call) => call.family === 'Frank_Ruhl_Libre')?.weight)
      .toEqual(['500']);
    expect(fontCalls.find((call) => call.family === 'IBM_Plex_Mono')?.weight)
      .toEqual(['400']);
  });
});
