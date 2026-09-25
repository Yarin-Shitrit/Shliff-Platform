/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const route = vi.hoisted(() => ({ pathname: '/fees', search: '' }));
const { replace, createSeasonAction } = vi.hoisted(() => ({
  replace: vi.fn(),
  createSeasonAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ createSeasonAction }));

import { NewSeasonDrawer } from './new-season-drawer';

describe('NewSeasonDrawer', () => {
  beforeEach(() => {
    route.pathname = '/fees';
    route.search = '';
    replace.mockClear();
    createSeasonAction.mockClear();
    createSeasonAction.mockResolvedValue({ ok: true });
  });

  it('renders nothing when the URL does not ask for it', () => {
    render(<NewSeasonDrawer />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a dialog named "שנה חדשה" when the URL asks for it (R6)', () => {
    route.search = 'act=season';
    render(<NewSeasonDrawer />);
    expect(screen.getByRole('dialog', { name: 'שנה חדשה' })).toBeTruthy();
  });

  it('closes back to where it was, dropping only act', () => {
    route.pathname = '/tasks';
    route.search = 'season=s-1&act=season';
    render(<NewSeasonDrawer />);
    expect(screen.getByRole('link', { name: 'סגירה' }).getAttribute('href'))
      .toBe('/tasks?season=s-1');
  });

  it('asks for name, calendar year and camp dues as required, and offers planned size and gate date', () => {
    route.search = 'act=season';
    render(<NewSeasonDrawer />);
    // The three required fields carry a trailing, `aria-hidden` "*" inside
    // their own <label> (Field's own required marker), so the query matches
    // the label's leading text rather than an exact string.
    expect(screen.getByLabelText(/^שם/)).toBeTruthy();
    expect(screen.getByLabelText(/^שנה קלנדרית/)).toBeTruthy();
    expect(screen.getByLabelText(/^דמי קאמפ/)).toBeTruthy();
    expect(screen.getByLabelText('גודל מחנה מתוכנן')).toBeTruthy();
    expect(screen.getByLabelText('פתיחת השער')).toBeTruthy();
  });

  it('creates a season with the values typed and closes back to where it was', async () => {
    route.pathname = '/tasks';
    route.search = 'act=season';
    render(<NewSeasonDrawer />);

    fireEvent.change(screen.getByLabelText(/^שם/), { target: { value: 'ברן 23' } });
    fireEvent.change(screen.getByLabelText(/^שנה קלנדרית/), { target: { value: '2023' } });
    fireEvent.change(screen.getByLabelText(/^דמי קאמפ/), { target: { value: '1350' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת שנה' }));

    expect(createSeasonAction).toHaveBeenCalledWith({
      name: 'ברן 23', year: '2023', flatRate: '1350', plannedSize: '', startsOn: '',
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tasks'));
  });

  it('passes planned size and gate date through when they are given', () => {
    route.search = 'act=season';
    render(<NewSeasonDrawer />);

    fireEvent.change(screen.getByLabelText(/^שם/), { target: { value: 'ברן 25' } });
    fireEvent.change(screen.getByLabelText(/^שנה קלנדרית/), { target: { value: '2025' } });
    fireEvent.change(screen.getByLabelText(/^דמי קאמפ/), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText('גודל מחנה מתוכנן'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('פתיחת השער'), { target: { value: '2025-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת שנה' }));

    expect(createSeasonAction).toHaveBeenCalledWith({
      name: 'ברן 25', year: '2025', flatRate: '1500', plannedSize: '40', startsOn: '2025-08-01',
    });
  });

  it('shows the action refusal in Hebrew and keeps the drawer open', async () => {
    route.search = 'act=season';
    createSeasonAction.mockResolvedValueOnce({ ok: false, error: 'יש להזין דמי קאמפ.' });
    render(<NewSeasonDrawer />);

    fireEvent.change(screen.getByLabelText(/^שם/), { target: { value: 'ברן 23' } });
    fireEvent.change(screen.getByLabelText(/^שנה קלנדרית/), { target: { value: '2023' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת שנה' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'יש להזין דמי קאמפ.');
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * Chromium reports a half-typed or impossible date (31/02, a year still
   * being typed) as `value === ''` with `validity.badInput` set. The gate
   * date is optional, so that empty value used to create the season with no
   * date at all — silently, with a date on screen. jsdom never sets
   * `badInput`, so it is stubbed on the element.
   */
  it('refuses a half-typed or impossible gate date, in Hebrew, and creates nothing', () => {
    route.search = 'act=season';
    render(<NewSeasonDrawer />);

    fireEvent.change(screen.getByLabelText(/^שם/), { target: { value: 'ברן 26' } });
    fireEvent.change(screen.getByLabelText(/^שנה קלנדרית/), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText(/^דמי קאמפ/), { target: { value: '1200' } });
    const gate = screen.getByLabelText('פתיחת השער') as HTMLInputElement;
    Object.defineProperty(gate, 'validity', {
      configurable: true,
      value: { ...gate.validity, badInput: true, valid: false },
    });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת שנה' }));

    expect(screen.getByRole('alert').textContent).toBe('תאריך פתיחת השער אינו תקין.');
    expect(createSeasonAction).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  /**
   * The rail hosts this drawer, and below 1024px a closed rail is moved
   * off-screen with a `transform` — the containing block of every
   * `position: fixed` element inside it. `?act=season` loaded on a phone
   * (a refresh, a pasted link) would open the drawer inside that off-screen
   * box while its focus trap made the page inert.
   */
  it('renders outside whatever hosts it, so a closed phone rail cannot carry it off-screen', () => {
    route.search = 'act=season';
    const { container } = render(<div data-rail><NewSeasonDrawer /></div>);
    const dialog = screen.getByRole('dialog', { name: 'שנה חדשה' });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
  });
});
