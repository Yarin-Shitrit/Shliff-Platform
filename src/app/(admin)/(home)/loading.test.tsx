/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomeLoading from './loading';
import styles from './home.module.css';

describe('HomeLoading', () => {
  it('is the shape of the screen it stands in for', () => {
    const { container } = render(<HomeLoading />);
    // Four figure placeholders and three panels — the same bands the page
    // renders, so nothing jumps when the content arrives.
    expect(container.querySelectorAll(`.${styles.skelTile}`)).toHaveLength(4);
    expect(container.querySelectorAll(`.${styles.skelPanel}`)).toHaveLength(3);
  });

  it('shows no number at all', () => {
    const { container } = render(<HomeLoading />);
    // A skeleton that renders a zero teaches the reader that a zero on this
    // screen means "not yet" — and then the real zeroes stop being read.
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('announces itself without taking focus', () => {
    render(<HomeLoading />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('טוען');
    expect(status.querySelector('button, a, input')).toBeNull();
  });

  it('hides the shapes themselves from a screen reader', () => {
    const { container } = render(<HomeLoading />);
    // The one thing a reader should hear is the sentence. Announcing a dozen
    // empty boxes to somebody who cannot see them is noise, not information.
    for (const band of container.querySelectorAll(
      `.${styles.figures}, .${styles.columns}, .${styles.head}`,
    )) {
      expect(band.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
