/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';

/**
 * The page is rendered against a real PGlite database, through the same
 * proxy `shell/actions.test.ts` uses: each test builds its own instance
 * after the module has captured `db`. What is checked here is the page's own
 * glue — which season's date it shows, and the link it builds to the drawer
 * that changes it — so nothing below the page is stubbed but navigation.
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
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(),
}));

import TasksPage from './page';

async function renderPage(params: Record<string, string> = {}) {
  render(await TasksPage({ searchParams: Promise.resolve(params) }));
}

describe('/tasks — the gate line links to what changes it', () => {
  beforeEach(async () => {
    dbRef.current = await createTestDb();
  });

  it("makes the countdown a link to the season's gate-date drawer", async () => {
    const season = await createSeason(dbRef.current!, {
      name: 'ברן 30', year: 2030, flatRate: 1200, startsOn: new Date('2030-06-04'),
    });

    await renderPage({ season: season.id, view: 'gaps' });

    const link = screen.getByRole('link', { name: /השער נפתח/ });
    expect(link.getAttribute('href'))
      .toBe(`/tasks?season=${season.id}&view=gaps&act=season-date`);
  });

  it('names the season it shows even when the URL names none', async () => {
    await createSeason(dbRef.current!, { name: 'ברן 29', year: 2029, flatRate: 1200 });
    const newest = await createSeason(dbRef.current!, {
      name: 'ברן 30', year: 2030, flatRate: 1200, startsOn: new Date('2030-06-04'),
    });

    await renderPage();

    expect(screen.getByRole('link', { name: /השער נפתח/ }).getAttribute('href'))
      .toBe(`/tasks?season=${newest.id}&act=season-date`);
  });

  it('invites setting the date when none is recorded, linking to the same drawer', async () => {
    const season = await createSeason(dbRef.current!, { name: 'ברן 30', year: 2030, flatRate: 1200 });

    await renderPage({ season: season.id });

    const link = screen.getByRole('link', { name: 'תאריך הפתיחה לא נרשם · קביעה' });
    expect(link.getAttribute('href')).toBe(`/tasks?season=${season.id}&act=season-date`);
  });
});
