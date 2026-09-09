/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import RootLayout from '@/app/layout';

describe('RootLayout', () => {
  it('renders the document right-to-left in Hebrew', () => {
    const element = RootLayout({ children: null }) as React.ReactElement<{
      lang: string; dir: string;
    }>;
    expect(element.props.lang).toBe('he');
    expect(element.props.dir).toBe('rtl');
  });
});
