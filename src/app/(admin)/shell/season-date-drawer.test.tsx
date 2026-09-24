/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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

import { SeasonDateDrawer, SAVED_DWELL_MS } from './season-date-drawer';

/**
 * b26's stored instant is 22:30 UTC on 3 June — 01:30 on 4 June in Israel.
 * The day a lead set, and the day the drawer must show, is 4 June.
 */
const SEASONS = [
  { id: 'b26', name: 'ברן 26', startsOn: new Date('2026-06-03T22:30:00Z') },
  { id: 'b25', name: 'ברן 25', startsOn: null },
];

const INVALID = 'תאריך פתיחת השער אינו תקין.';

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

/**
 * What Chromium reports for a half-typed or impossible date (31/02, or a
 * year still being typed): `value` is `''` and `validity.badInput` is true.
 * jsdom never sets `badInput`, so it is stubbed on the element.
 */
function typeHalfADate(input: HTMLInputElement) {
  fireEvent.change(input, { target: { value: '' } });
  Object.defineProperty(input, 'validity', {
    configurable: true,
    value: { ...input.validity, badInput: true, valid: false },
  });
}

/** Lets the mocked action resolve and React commit what follows it. */
async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
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

  /**
   * The rail hosts this drawer, and below 1024px a closed rail is moved
   * off-screen with a `transform` — which makes it the containing block of
   * every `position: fixed` element inside it. A drawer opened from a page
   * link (/tasks, the camp map) would open inside that off-screen box while
   * its focus trap made the page behind it inert.
   */
  it('renders outside whatever hosts it, so a closed phone rail cannot carry it off-screen', () => {
    route.search = 'act=season-date';
    const { container } = render(<div data-rail><SeasonDateDrawer seasons={SEASONS} /></div>);
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
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

  it('says in one line what the date drives — the tasks countdown and the shade by hour', () => {
    route.search = 'act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    const why = screen.getByText('הספירה לאחור במשימות והצל לפי שעה במפת הקאמפ מחושבים לפי היום הזה.');
    expect(dateInput().getAttribute('aria-describedby')).toBe(why.id);
  });

  describe('refusing before anything is sent', () => {
    it('refuses a half-typed or impossible date, rather than sending the empty value it leaves', () => {
      route.search = 'act=season-date';
      render(<SeasonDateDrawer seasons={SEASONS} />);

      typeHalfADate(dateInput());
      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

      expect(screen.getByRole('alert').textContent).toBe(INVALID);
      expect(setSeasonStartsOnAction).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('refuses an empty save when a date exists — clearing is the button\'s job, never save\'s', () => {
      route.search = 'act=season-date';
      render(<SeasonDateDrawer seasons={SEASONS} />);

      fireEvent.change(dateInput(), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

      expect(screen.getByRole('alert').textContent).toBe('יש לבחור תאריך, או ללחוץ על "הסרת התאריך".');
      expect(setSeasonStartsOnAction).not.toHaveBeenCalled();
    });

    it('refuses an empty save when there is no date either', () => {
      route.search = 'season=b25&act=season-date';
      render(<SeasonDateDrawer seasons={SEASONS} />);

      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

      expect(screen.getByRole('alert').textContent).toBe('יש לבחור תאריך.');
      expect(setSeasonStartsOnAction).not.toHaveBeenCalled();
    });
  });

  describe('after the action answers', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('shows the day it saved, then closes back to where it was', async () => {
      route.pathname = '/tasks';
      route.search = 'season=b26&act=season-date';
      render(<SeasonDateDrawer seasons={SEASONS} />);
      // A live region that exists before it speaks: one inserted together
      // with its sentence is not reliably announced.
      expect(screen.getByRole('status').textContent).toBe('');

      fireEvent.change(dateInput(), { target: { value: '2026-06-11' } });
      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
      await settle();

      expect(setSeasonStartsOnAction).toHaveBeenCalledWith('b26', '2026-06-11');
      expect(screen.getByRole('status').textContent).toBe('נשמר: 11 ביוני 2026');
      expect(replace).not.toHaveBeenCalled();

      await settle(SAVED_DWELL_MS);
      expect(replace).toHaveBeenCalledWith('/tasks?season=b26');
    });

    it('clears through its own button, says so, then closes', async () => {
      route.search = 'act=season-date';
      render(<SeasonDateDrawer seasons={SEASONS} />);

      fireEvent.click(screen.getByRole('button', { name: 'הסרת התאריך' }));
      await settle();

      expect(setSeasonStartsOnAction).toHaveBeenCalledWith('b26', '');
      expect(screen.getByRole('status').textContent).toBe('התאריך הוסר.');

      await settle(SAVED_DWELL_MS);
      expect(replace).toHaveBeenCalledWith('/fees');
    });

    it('does not navigate later if the drawer was closed while it showed the saved day', async () => {
      route.search = 'act=season-date';
      const { unmount } = render(<SeasonDateDrawer seasons={SEASONS} />);

      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
      await settle();
      unmount();

      await settle(SAVED_DWELL_MS * 2);
      expect(replace).not.toHaveBeenCalled();
    });

    it('shows the refusal in Hebrew and keeps the drawer open', async () => {
      route.search = 'act=season-date';
      setSeasonStartsOnAction.mockResolvedValueOnce({ ok: false, error: INVALID });
      render(<SeasonDateDrawer seasons={SEASONS} />);

      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
      await settle(SAVED_DWELL_MS * 2);

      expect(screen.getByRole('alert').textContent).toBe(INVALID);
      expect(screen.getByRole('status').textContent).toBe('');
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  it('offers no clear when there is nothing to clear', () => {
    route.search = 'season=b25&act=season-date';
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(screen.queryByRole('button', { name: 'הסרת התאריך' })).toBeNull();
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
    render(<SeasonDateDrawer seasons={SEASONS} />);
    expect(document.body.textContent).not.toMatch(/[A-Za-z]/);
    const named = [...document.body.querySelectorAll('[aria-label],[title],[placeholder]')]
      .flatMap((el) => ['aria-label', 'title', 'placeholder'].map((attr) => el.getAttribute(attr) ?? ''));
    expect(named.filter((text) => /[A-Za-z]/.test(text))).toEqual([]);
  });
});
