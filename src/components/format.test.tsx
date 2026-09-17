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
});
