/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money, DateText } from '@/components/format';

describe('Money', () => {
  /**
   * The isolate is the behaviour under test, so the assertion names the
   * element. A11: an amount inside a Hebrew sentence reorders without one,
   * and the symbol ends up leading the number.
   */
  it('puts the whole amount inside one bidi isolate', () => {
    const { container } = render(<Money agorot={120000} />);
    const isolate = container.querySelector('bdi');
    expect(isolate?.textContent).toBe('1,200 ₪');
  });

  /**
   * The optional leading mark in the regex below is a real, ICU-emitted
   * left-to-right mark (U+200E), not slack in the assertion — see the
   * fuller note beside the equivalent case in `src/lib/money.test.ts`
   * ("never lets a minus sign come off its digits") for the
   * `formatToParts` evidence before touching this regex.
   */
  it('keeps a negative amount whole', () => {
    const { container } = render(<Money agorot={-45050} />);
    expect(container.querySelectorAll('bdi')).toHaveLength(1);
    expect(container.querySelector('bdi')?.textContent).toMatch(/^‎?[-−]450\.50 ₪$/);
  });

  it('reads as one amount beside Hebrew words', () => {
    render(<p>נותרו <Money agorot={240000} /> לגבייה</p>);
    expect(screen.getByText('2,400 ₪')).toBeDefined();
  });

  /**
   * A no-op today — see the comment above `Money` in `format.tsx` for why —
   * but the attribute must be present regardless, as the explicit defence.
   */
  it('pins the isolate to ltr explicitly', () => {
    const { container } = render(<Money agorot={120000} />);
    expect(container.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
  });
});

describe('DateText', () => {
  const evening = new Date('2026-09-07T16:30:00Z');

  it('writes the table form by default', () => {
    const { container } = render(<DateText at={evening} />);
    expect(container.querySelector('bdi')?.textContent).toBe('07/09/26');
  });

  it('writes each form it is asked for', () => {
    expect(render(<DateText at={evening} form="full" />)
      .container.querySelector('bdi')?.textContent).toBe('07/09/2026');
    expect(render(<DateText at={evening} form="prose" />)
      .container.querySelector('bdi')?.textContent).toBe('7 בספט׳ 2026');
    expect(render(<DateText at={evening} form="time" />)
      .container.querySelector('bdi')?.textContent).toBe('19:30');
    expect(render(<DateText at={evening} form="datetime" />)
      .container.querySelector('bdi')?.textContent).toBe('07/09/26 19:30');
  });

  /**
   * The same explicit-defence pin as `Money`, on every form whose string
   * cannot contain a strong RTL character.
   */
  it('pins dir=ltr on every numeric form', () => {
    for (const form of ['short', 'full', 'time', 'datetime'] as const) {
      const { container } = render(<DateText at={evening} form={form} />);
      expect(container.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
    }
  });

  /**
   * The one form this plan would break by applying `dir="ltr"` uniformly:
   * `prose` contains Hebrew letters and resolves `rtl` correctly on its own.
   */
  it('leaves the prose form with no dir', () => {
    const { container } = render(<DateText at={evening} form="prose" />);
    expect(container.querySelector('bdi')?.hasAttribute('dir')).toBe(false);
  });
});
