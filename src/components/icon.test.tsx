/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon } from '@/components/icon';

describe('Icon', () => {
  it('draws the glyph the name asks for', () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector('svg');
    expect(svg?.innerHTML).toContain('M20 6 9 17l-5-5');
  });

  /**
   * An icon beside a word is decoration: the word is already the label, and a
   * screen reader announcing both says everything twice.
   */
  it('stays out of the accessibility tree when it is decoration', () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  /** An icon that is the whole control carries the Hebrew name of that control. */
  it('takes a name when it stands alone', () => {
    render(<Icon name="x" label="סגירה" />);
    const labelled = screen.getByRole('img', { name: 'סגירה' });
    expect(labelled.getAttribute('aria-hidden')).toBeNull();
  });

  /**
   * C14: an icon that points along the line of text follows the line, and
   * `icon.module.css` mirrors it with `:dir(rtl)`. The component's job is to
   * declare which icons are directional, and that declaration is what this
   * test reads — the mirroring itself is the browser's.
   */
  it('declares a directional icon as directional', () => {
    const { container } = render(<Icon name="right" />);
    expect(container.querySelector('svg')?.getAttribute('data-direction')).toBe('inline');
  });

  it('leaves a checkmark, a clock and a media glyph alone', () => {
    for (const name of ['check', 'clock', 'skip'] as const) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.getAttribute('data-direction')).toBeNull();
    }
  });

  it('draws at the size it is given, with the one stroke width', () => {
    const { container } = render(<Icon name="search" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('defaults to 16', () => {
    const { container } = render(<Icon name="search" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16');
  });
});
