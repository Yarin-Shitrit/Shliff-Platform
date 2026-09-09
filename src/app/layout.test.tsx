/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * `next/font/google` ships an empty module outside the Next.js compiler, which
 * rewrites these calls at build time. Under Vitest the real import resolves to
 * nothing, so the loaders are stubbed with the shape Next produces: a class
 * name plus the CSS custom property the stylesheets read.
 */
vi.mock('next/font/google', () => {
  const font = (options: { variable: string }) => ({
    className: `__mock_${options.variable}`,
    variable: `__mock_var_${options.variable}`,
    style: { fontFamily: options.variable },
  });
  return { Frank_Ruhl_Libre: font, Heebo: font };
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
});
