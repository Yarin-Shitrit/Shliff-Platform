/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/fees', search: '' }));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));

import { SeasonSwitch } from '@/app/(admin)/shell/season-switch';

/**
 * b26's gate date is an instant whose UTC day and Israel day differ:
 * 22:30 UTC on 3 June is 01:30 on 4 June in Israel, and 4 June is the day a
 * lead set. b24 has no date at all.
 */
const SEASONS = [
  { id: 'b26', name: 'ברן 26', state: 'פעילה', startsOn: new Date('2026-06-03T22:30:00Z') },
  { id: 'b25', name: 'ברן 25', state: 'הסתיימה', startsOn: new Date('2025-06-05T00:00:00Z') },
  { id: 'b24', name: 'ברן 24', state: 'בלי דמי קאמפ', startsOn: null },
];

describe('SeasonSwitch', () => {
  beforeEach(() => {
    route.pathname = '/fees';
    route.search = '';
  });

  it('shows the newest season when the URL asks for none', () => {
    render(<SeasonSwitch seasons={SEASONS} />);
    expect(screen.getByRole('button', { name: /ברן 26/ })).toBeTruthy();
  });

  it('shows the season the URL asks for', () => {
    route.search = 'season=b25';
    render(<SeasonSwitch seasons={SEASONS} />);
    expect(screen.getByRole('button', { name: /ברן 25/ })).toBeTruthy();
  });

  it('opens a list of every season with its state', () => {
    render(<SeasonSwitch seasons={SEASONS} />);
    fireEvent.click(screen.getByRole('button', { name: /ברן 26/ }));
    expect(screen.getByText('הסתיימה')).toBeTruthy();
    expect(screen.getByText('בלי דמי קאמפ')).toBeTruthy();
  });

  it('rewrites ?season= on the route you are standing on (B4, R5)', () => {
    route.pathname = '/fees';
    route.search = 'view=unpaid';
    render(<SeasonSwitch seasons={SEASONS} />);
    fireEvent.click(screen.getByRole('button', { name: /ברן 26/ }));
    expect(screen.getByRole('link', { name: /ברן 25/ }).getAttribute('href'))
      .toBe('/fees?view=unpaid&season=b25');
  });

  it('says that camp-wide data does not belong to a season', () => {
    render(<SeasonSwitch seasons={SEASONS} />);
    fireEvent.click(screen.getByRole('button', { name: /ברן 26/ }));
    expect(screen.getByText('חשבונות, אנשים וחובות בלי שנה נשארים גלויים בכל שנה.'))
      .toBeTruthy();
  });

  it('closes on esc', () => {
    render(<SeasonSwitch seasons={SEASONS} />);
    fireEvent.click(screen.getByRole('button', { name: /ברן 26/ }));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByText('שנות פעילות')).toBeNull();
  });

  it('says so plainly when the camp has no seasons', () => {
    render(<SeasonSwitch seasons={[]} />);
    expect(screen.getByText('עדיין אין שנים')).toBeTruthy();
  });

  it('offers "שנה חדשה", opening the create drawer with no record id (R6)', () => {
    route.pathname = '/fees';
    route.search = '';
    render(<SeasonSwitch seasons={SEASONS} />);
    fireEvent.click(screen.getByRole('button', { name: /ברן 26/ }));
    expect(screen.getByRole('link', { name: 'שנה חדשה' }).getAttribute('href'))
      .toBe('/fees?act=season');
  });

  it('keeps the rest of the URL when opening the create drawer', () => {
    route.pathname = '/tasks';
    route.search = 'season=b25&view=gaps';
    render(<SeasonSwitch seasons={SEASONS} />);
    fireEvent.click(screen.getByRole('button', { name: /ברן 25/ }));
    expect(screen.getByRole('link', { name: 'שנה חדשה' }).getAttribute('href'))
      .toBe('/tasks?season=b25&view=gaps&act=season');
  });

  describe('the gate date — every figure links to what changes it', () => {
    it("shows the active season's gate date, as the Israel calendar day, linking to its drawer", () => {
      render(<SeasonSwitch seasons={SEASONS} />);
      fireEvent.click(screen.getByRole('button', { name: /ברן 26/ }));

      const link = screen.getByRole('link', { name: /פתיחת השער/ });
      expect(link.textContent).toContain('4 ביוני 2026');
      expect(link.getAttribute('href')).toBe('/fees?act=season-date');
    });

    it('shows the date of the season the URL names, not the newest', () => {
      route.pathname = '/tasks';
      route.search = 'season=b25&view=gaps';
      render(<SeasonSwitch seasons={SEASONS} />);
      fireEvent.click(screen.getByRole('button', { name: /ברן 25/ }));

      const link = screen.getByRole('link', { name: /פתיחת השער/ });
      expect(link.textContent).toContain('5 ביוני 2025');
      expect(link.getAttribute('href')).toBe('/tasks?season=b25&view=gaps&act=season-date');
    });

    it('invites setting a date when none is recorded, rather than showing a blank', () => {
      route.search = 'season=b24';
      render(<SeasonSwitch seasons={SEASONS} />);
      fireEvent.click(screen.getByRole('button', { name: /ברן 24/ }));

      const link = screen.getByRole('link', { name: /תאריך הפתיחה לא נרשם/ });
      expect(link.textContent).toContain('קביעה');
      expect(link.textContent).not.toMatch(/\d/);
      expect(link.getAttribute('href')).toBe('/fees?season=b24&act=season-date');
      expect(screen.queryByRole('link', { name: /פתיחת השער/ })).toBeNull();
    });
  });
});
