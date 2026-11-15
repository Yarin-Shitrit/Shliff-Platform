/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import { createTestDb, type TestDb } from '@/test/db';
import { persons } from '@/db/schema/camp';
import { createSeason, addMember } from '@/lib/members/roster';
import { createEvent, setMark, setEventCancelled, addPersonalMark } from '@/lib/logistics/attendance';
import { unnamedControls } from '@/test/a11y';

/**
 * The page is rendered against a real PGlite database, through the same
 * proxy the other page tests use: each test builds its own instance after
 * the module has captured `db`. Nothing below the page is stubbed but
 * navigation and the admin guard.
 */
const { dbRef, dbProxy } = vi.hoisted(() => {
  const dbRef: { current: TestDb | null } = { current: null };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { dbRef, dbProxy };
});

vi.mock('@/db', () => ({ db: dbProxy }));
vi.mock('@/lib/auth/guard', () => ({
  requireAdmin: async () => ({ ok: true, email: 'lead@shliff.camp' }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/logistics/attendance',
  useSearchParams: () => new URLSearchParams(),
}));

import AttendancePage from './page';

const LEAD = 'lead@shliff.camp';

async function renderPage(params: Record<string, string> = {}) {
  render(<ToastProvider>{await AttendancePage({ searchParams: Promise.resolve(params) })}</ToastProvider>);
}

async function person(db: TestDb, displayName: string): Promise<string> {
  const [row] = await db.insert(persons).values({ displayName }).returning();
  return row.id;
}

describe('/logistics/attendance', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    dbRef.current = db;
  });

  it('invites a first season when the camp has none', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'נוכחות' })).toBeTruthy();
    expect(screen.getByText('אין כאן כלום עדיין')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ייבוא מהגיליון' })).toBeTruthy();
  });

  it('invites the first day of a season that has none, under that season’s name', async () => {
    const season = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 });
    await renderPage({ season: season.id });
    expect(screen.getByText('אין כאן כלום לשנה הזו')).toBeTruthy();
    expect(screen.getByText(/ימים בלוח הנוכחות ב/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'הוספת יום' }).getAttribute('href'))
      .toBe(`/logistics/attendance?season=${season.id}&act=event`);
  });

  it('draws the board for the season, with the figures explained and the day’s drawer by URL', async () => {
    const season = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 });
    const dana = await person(db, 'דנה');
    const avi = await person(db, 'אבי');
    await addMember(db, dana, season.id);
    await addMember(db, avi, season.id);
    const work = await createEvent(db, season.id, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    const shop = await createEvent(db, season.id, { kind: 'shopping', heldOn: '2027-03-21', title: 'קניות באיקאה', notes: null }, LEAD);
    await setMark(db, work, dana, true, LEAD);
    await setMark(db, shop, dana, true, LEAD);
    const gone = await createEvent(db, season.id, { kind: 'meeting', heldOn: '2027-02-01', title: null, notes: null }, LEAD);
    await setEventCancelled(db, gone, true, LEAD);

    await renderPage({ season: season.id, event: shop });

    // The tiles say what they count and where it came from.
    expect(screen.getByText('ימים בלוח').parentElement?.textContent).toMatch(/2.*1 יום עבודה · 1 קניות/);
    expect(screen.getByText('סימוני נוכחות').parentElement?.textContent).toMatch(/2.*נרשם ידנית/);
    expect(screen.getByText('חברים בלי אף סימון').parentElement?.textContent).toMatch(/1.*מתוך 2 ברשימת ברן 27/);

    // The board: a row per member, the cancelled day nowhere on it.
    const board = screen.getByRole('table', { name: 'לוח הנוכחות, לפי חבר ויום' });
    expect(within(board).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'שם', expect.stringContaining('יום עבודה'), expect.stringContaining('קניות באיקאה'),
      expect.stringContaining('סימונים אישיים'), 'סה״כ',
    ]);
    expect(within(board).queryByText(/פגישה/)).toBeNull();
    const row = within(board).getByRole('row', { name: /דנה/ });
    expect(within(row).getAllByRole('cell').at(-1)?.textContent).toBe('2');

    // The cancelled day is listed, not lost, with the way back.
    const cancelled = screen.getByRole('region', { name: 'ימים שבוטלו' });
    expect(within(cancelled).getByRole('link', { name: 'פגישה' }).getAttribute('href'))
      .toBe(`/logistics/attendance?season=${season.id}&event=${gone}`);

    // The drawer over the peeked day, with the roster as a checklist.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'קניות באיקאה' })).toBeTruthy();
    expect((within(dialog).getByLabelText('דנה') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('אבי') as HTMLInputElement).checked).toBe(false);
  });

  it('opens the create drawer on today, from the verb in the bar', async () => {
    const season = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 });
    await addMember(db, await person(db, 'דנה'), season.id);
    await createEvent(db, season.id, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);

    await renderPage({ season: season.id, act: 'event' });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'יום חדש בלוח הנוכחות' })).toBeTruthy();
    const today = new Date().toISOString().slice(0, 4);
    expect((within(dialog).getByLabelText(/באיזה יום/) as HTMLInputElement).value.slice(0, 4)).toBe(today);
    expect(screen.getAllByRole('link', { name: 'יום חדש' })[0].getAttribute('href'))
      .toBe(`/logistics/attendance?season=${season.id}&act=event`);
  });

  it('counts a personal mark in the figures, draws the board for it with no days at all, and opens the person’s drawer by URL', async () => {
    const season = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 });
    const dana = await person(db, 'דנה');
    const avi = await person(db, 'אבי');
    await addMember(db, dana, season.id);
    await addMember(db, avi, season.id);
    await addPersonalMark(db, season.id, { personId: dana, doneOn: '2027-04-01', title: 'הביאה את הגנרטור', notes: 'מחיפה' }, LEAD);

    await renderPage({ season: season.id, person: dana });

    expect(screen.getByText('ימים בלוח').parentElement?.textContent).toMatch(/0/);
    expect(screen.getByText('סימוני נוכחות').parentElement?.textContent)
      .toMatch(/1.*0 בימים של כולם · 1 סימונים אישיים · נרשם ידנית/);
    expect(screen.getByText('חברים בלי אף סימון').parentElement?.textContent).toMatch(/1.*מתוך 2/);

    // No days, but not the empty state: the board has one column to show.
    expect(screen.queryByText('אין כאן כלום לשנה הזו')).toBeNull();
    const board = screen.getByRole('table', { name: 'לוח הנוכחות, לפי חבר ויום' });
    const row = within(board).getByRole('row', { name: /דנה/ });
    expect(within(row).getByRole('link', { name: 'סימונים אישיים · דנה · 1' }).getAttribute('href'))
      .toBe(`/logistics/attendance?season=${season.id}&person=${dana}`);
    expect(within(row).getAllByRole('cell').at(-1)?.textContent).toBe('1');

    // Both verbs in the bar, and the drawer over the person with her mark listed.
    expect(screen.getAllByRole('link', { name: 'סימון אישי' })[0].getAttribute('href'))
      .toBe(`/logistics/attendance?season=${season.id}&act=personal`);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'דנה' })).toBeTruthy();
    expect(within(dialog).getByText('הביאה את הגנרטור')).toBeTruthy();
    expect(within(dialog).getByText(/מחיפה/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'הסרה · הביאה את הגנרטור' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'הוספת הסימון' })).toBeTruthy();
  });

  it('opens the drawer that adds a personal mark with the roster to pick from', async () => {
    const season = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 });
    await addMember(db, await person(db, 'דנה'), season.id);
    await createEvent(db, season.id, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);

    await renderPage({ season: season.id, act: 'personal' });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'סימון אישי' })).toBeTruthy();
    expect(within(dialog).getByRole('option', { name: 'דנה' })).toBeTruthy();
    expect(unnamedControls(dialog)).toEqual([]);
    expect(dialog.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('sends a season with days but nobody on its roster to אנשים', async () => {
    const season = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 });
    await createEvent(db, season.id, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    await renderPage({ season: season.id });
    expect(screen.getByRole('link', { name: 'מעבר לאנשים' }).getAttribute('href')).toBe('/members');
  });

  it('names every control and says nothing in English (E4, R9)', async () => {
    const season = await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1200 });
    const dana = await person(db, 'דנה');
    await addMember(db, dana, season.id);
    const work = await createEvent(db, season.id, { kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null }, LEAD);
    await setMark(db, work, dana, true, LEAD);

    await renderPage({ season: season.id, event: work });
    const main = screen.getByRole('main');
    expect(unnamedControls(main)).toEqual([]);
    // The drawer names who saved last; an address is data, not copy.
    expect((main.textContent ?? '').replaceAll(LEAD, '')).not.toMatch(/[A-Za-z]/);
  });
});
