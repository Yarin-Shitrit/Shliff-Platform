/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './pill';

describe('Pill', () => {
  it('renders the word', () => {
    render(<Pill tone="bad" dot>טרם שילם</Pill>);
    expect(screen.getByText('טרם שילם')).toBeTruthy();
  });

  it('hides the dot from assistive technology, because the word is the meaning', () => {
    const { container } = render(<Pill tone="ok" dot>שולם</Pill>);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeTruthy();
    expect(dot?.textContent).toBe('');
  });

  it('refuses a pill with no word (R3)', () => {
    expect(() => render(<Pill tone="warn">{'  '}</Pill>)).toThrow(/מילה/);
  });

  it('carries its tone as a class so the seven variants are distinguishable', () => {
    const { container } = render(<Pill tone="info">לידיעה</Pill>);
    expect(container.firstElementChild?.className).toContain('info');
  });
});
