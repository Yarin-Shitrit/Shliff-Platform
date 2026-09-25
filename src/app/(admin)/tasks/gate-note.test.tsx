/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GateLink, GateNote, GateOpens } from './gate-note';

describe('GateNote', () => {
  it('reads "2 ימים לפני השער", with the number isolated', () => {
    render(<GateNote relation={{ kind: 'before', days: 2 }} />);
    expect(screen.getByText(/ימים לפני השער/)).toBeDefined();
    expect(screen.getByText('2').tagName).toBe('BDI');
  });

  it('says "יום אחד" rather than "1 ימים"', () => {
    render(<GateNote relation={{ kind: 'before', days: 1 }} />);
    expect(screen.getByText('יום אחד לפני השער')).toBeDefined();
    expect(screen.queryByText('1')).toBeNull();
  });

  it('reads after the gate', () => {
    render(<GateNote relation={{ kind: 'after', days: 8 }} />);
    expect(screen.getByText(/ימים אחרי השער/)).toBeDefined();
  });

  it('names the gate day', () => {
    render(<GateNote relation={{ kind: 'gate-day' }} />);
    expect(screen.getByText('ביום השער')).toBeDefined();
  });

  it('renders nothing when the season has no gate', () => {
    const { container } = render(<GateNote relation={{ kind: 'no-gate' }} />);
    expect(container.textContent).toBe('');
  });
});

describe('GateOpens', () => {
  const now = new Date('2026-09-16T10:00:00+03:00');

  it('counts down to the gate', () => {
    render(<GateOpens gate={new Date('2026-10-22T00:00:00+03:00')} now={now} />);
    expect(screen.getByText(/השער נפתח בעוד/)).toBeDefined();
    expect(screen.getByText('36').tagName).toBe('BDI');
  });

  it('says the gate opened, once it has', () => {
    render(<GateOpens gate={new Date('2026-09-10T00:00:00+03:00')} now={now} />);
    expect(screen.getByText(/השער נפתח לפני/)).toBeDefined();
  });

  it('says today, on the day', () => {
    render(<GateOpens gate={new Date('2026-09-16T00:00:00+03:00')} now={now} />);
    expect(screen.getByText('השער נפתח היום')).toBeDefined();
  });

  it('renders nothing for a season with no date', () => {
    const { container } = render(<GateOpens gate={null} now={now} />);
    expect(container.textContent).toBe('');
  });
});

/** Every figure links to what changes it — and an empty one invites filling it. */
describe('GateLink', () => {
  const now = new Date('2026-09-16T10:00:00+03:00');
  const href = '/tasks?season=s26&act=season-date';

  it('makes the countdown a link to the drawer that sets the date', () => {
    render(<GateLink gate={new Date('2026-10-22T00:00:00+03:00')} href={href} now={now} />);
    const link = screen.getByRole('link', { name: /השער נפתח בעוד/ });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.textContent).toBe('השער נפתח בעוד 36 ימים');
  });

  it('invites setting the date when none is recorded, linking to the same drawer', () => {
    render(<GateLink gate={null} href={href} now={now} />);
    const link = screen.getByRole('link', { name: 'תאריך הפתיחה לא נרשם · קביעה' });
    expect(link.getAttribute('href')).toBe(href);
  });
});
