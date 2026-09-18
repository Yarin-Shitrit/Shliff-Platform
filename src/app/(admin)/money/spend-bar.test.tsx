/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SpendBar } from './spend-bar';
import styles from './money.module.css';

describe('SpendBar', () => {
  // SVG has no logical properties. A bar that grows from x=0 reads correctly
  // only in an LTR screenshot; `x={0}` here is the mutation this pins.
  it('grows from the inline-start edge — the right', () => {
    const { container } = render(<SpendBar spentAgorot={5000} plannedAgorot={10000} over={false} />);
    const mark = container.querySelectorAll('rect')[1];
    expect(Number(mark.getAttribute('width'))).toBeCloseTo(60);
    expect(Number(mark.getAttribute('x'))).toBeCloseTo(60);
  });

  it('clamps an overspent line to a full track instead of overflowing it', () => {
    const { container } = render(<SpendBar spentAgorot={20000} plannedAgorot={10000} over />);
    const mark = container.querySelectorAll('rect')[1];
    expect(Number(mark.getAttribute('width'))).toBeCloseTo(120);
    expect(Number(mark.getAttribute('x'))).toBeCloseTo(0);
  });

  it('marks an overspent line with the bad class, never with the brand accent', () => {
    const { container } = render(<SpendBar spentAgorot={20000} plannedAgorot={10000} over />);
    expect(container.querySelectorAll('rect')[1].getAttribute('class'))
      .toContain(styles.spendOver);
  });

  it('draws the ordinary mark in the status class, not a series hue', () => {
    const { container } = render(<SpendBar spentAgorot={5000} plannedAgorot={10000} over={false} />);
    const mark = container.querySelectorAll('rect')[1];
    expect(mark.getAttribute('class')).toContain(styles.spendMark);
    expect(mark.getAttribute('class')).not.toContain(styles.spendOver);
  });

  it('draws an empty track for a line with no plan rather than a NaN rect', () => {
    const { container } = render(<SpendBar spentAgorot={5000} plannedAgorot={0} over={false} />);
    const mark = container.querySelectorAll('rect')[1];
    expect(Number(mark.getAttribute('width'))).toBe(0);
  });

  it('is hidden from the reading order, because the row already carries the numbers', () => {
    const { container } = render(<SpendBar spentAgorot={5000} plannedAgorot={10000} over={false} />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});
