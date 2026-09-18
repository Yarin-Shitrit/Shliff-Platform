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

const SEASONS = [
  { id: 'b26', name: 'ברן 26', state: 'פעילה' },
  { id: 'b25', name: 'ברן 25', state: 'הסתיימה' },
  { id: 'b24', name: 'ברן 24', state: 'בלי דמי קאמפ' },
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
});
