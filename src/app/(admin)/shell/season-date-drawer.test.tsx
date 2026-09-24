/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const route = vi.hoisted(() => ({ pathname: '/fees', search: '' }));
const { replace, setSeasonStartsOnAction } = vi.hoisted(() => ({
  replace: vi.fn(),
  setSeasonStartsOnAction: vi.fn<(seasonId: string, startsOn: string) => Promise<ActionResult>>(
    async () => ({ ok: true }),
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ setSeasonStartsOnAction }));

import { SeasonDateDrawer } from './season-date-drawer';

/**
 * b26's stored instant is 22:30 UTC on 3 June — 01:30 on 4 June in Israel.
 * The day a lead set, and the day the drawer must show, is 4 June.
 */
const SEASONS = [
  { id: 'b26', name: 'ברן 26', startsOn: new Date('2026-06-03T22:30:00Z') },
  { id: 'b25', name: 'ברן 25', startsOn: null },
];

/**
 * This box runs on Israel time, where reading the instant in the process's
 * own timezone happens to give the right day too. Pinning the process to UTC
 * makes that shortcut fail here as it would on CI, so the prefill test
 * separates "the Israel calendar day" from "whatever day this machine is on".
 */
let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

function dateInput(): HTMLInputElement {
  return screen.getByLabelText('תאריך הפתיחה') as HTMLInputElement;
}

describe('SeasonDateDrawer', () => {
  beforeEach(() => {
    route.pathname = '/fees';
    route.search = '';
    replace.mockClear();
    setSeasonStartsOnAction.mockClear();
    setSeasonStartsOnAction.mockResolvedValue({ ok: true });
  });

  it('renders nothing when the URL does not ask for it', () => {
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("stays shut for the create drawer's act", () => {
    route.search = 'act=season';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a dialog named "פתיחת השער", naming the season it edits (R6)', () => {
    route.search = 'act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    const dialog = screen.getByRole('dialog', { name: 'פתיחת השער' });
    expect(within(dialog).getByText('ברן 26')).toBeTruthy();
  });

  it('is prefilled with the calendar day in Israel, not the UTC day', () => {
    expect(new Date('2026-06-03T22:30:00Z').getDate()).toBe(3); // the pin above took hold
    route.search = 'act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(dateInput().type).toBe('date');
    expect(dateInput().value).toBe('2026-06-04');
  });

  it('edits the season ?season= names, and starts empty when it has no date', () => {
    route.search = 'season=b25&act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(within(screen.getByRole('dialog')).getByText('ברן 25')).toBeTruthy();
    expect(dateInput().value).toBe('');
  });

  it('falls back to the newest season for an unknown ?season=, as the switcher does', () => {
    route.search = 'season=gone&act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(within(screen.getByRole('dialog')).getByText('ברן 26')).toBeTruthy();
  });

  it('says in one line why the date matters, tied to the field', () => {
    route.search = 'act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    const why = screen.getByText('הצל לפי שעה במפת הקאמפ מחושב ליום הזה.');
    expect(dateInput().getAttribute('aria-describedby')).toBe(why.id);
  });

  it('saves the typed date for that season and closes back to where it was', async () => {
    route.pathname = '/tasks';
    route.search = 'season=b26&act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);

    fireEvent.change(dateInput(), { target: { value: '2026-06-11' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    expect(setSeasonStartsOnAction).toHaveBeenCalledWith('b26', '2026-06-11');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tasks?season=b26'));
  });

  it('offers to clear a date that exists, sending an explicit blank', async () => {
    route.search = 'act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'הסרת התאריך' }));

    expect(setSeasonStartsOnAction).toHaveBeenCalledWith('b26', '');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/fees'));
  });

  it('offers no clear when there is nothing to clear', () => {
    route.search = 'season=b25&act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(screen.queryByRole('button', { name: 'הסרת התאריך' })).toBeNull();
  });

  it('shows the refusal in Hebrew and keeps the drawer open', async () => {
    route.search = 'act=season-date';
    setSeasonStartsOnAction.mockResolvedValueOnce({ ok: false, error: 'תאריך פתיחת השער אינו תקין.' });
    render(<SeasonDateDrawer seasons={SEASONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'תאריך פתיחת השער אינו תקין.');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('with no seasons at all, invites creating one instead of editing nothing', () => {
    route.search = 'act=season-date';
    render(<SeasonDateDrawer seasons={[]} />);
    expect(screen.getByText('עדיין אין שנים.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'שנה חדשה' }).getAttribute('href'))
      .toBe('/fees?act=season');
    expect(screen.queryByLabelText('תאריך הפתיחה')).toBeNull();
  });

  it('draws no Latin letter, in its text or in any name, title or placeholder', () => {
    route.search = 'act=season-date';
    const { container } = render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(container.ownerDocument.body.textContent).not.toMatch(/[A-Za-z]/);
    const named = [...container.ownerDocument.body.querySelectorAll('[aria-label],[title],[placeholder]')]
      .flatMap((el) => ['aria-label', 'title', 'placeholder'].map((attr) => el.getAttribute(attr) ?? ''));
    expect(named.filter((text) => /[A-Za-z]/.test(text))).toEqual([]);
  });
});
