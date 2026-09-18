/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PersonListRow, PersonDues } from '@/lib/members/people-list';

const { responsibilitiesOf, personChangeLog } = vi.hoisted(() => ({
  responsibilitiesOf: vi.fn(),
  personChangeLog: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/work/coverage', () => ({ responsibilitiesOf }));
vi.mock('@/lib/members/change-log', () => ({ personChangeLog }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import { PeekDrawer } from './peek-drawer';

function dues(overrides: Partial<PersonDues> = {}): PersonDues {
  return {
    dueId: 'd1', amountAgorot: 120000, paidAgorot: 0, outstandingAgorot: 120000,
    kind: 'flat', exceptionReason: null, state: 'unpaid', ...overrides,
  };
}

function row(overrides: Partial<PersonListRow> = {}): PersonListRow {
  return {
    personId: 'p1',
    displayName: 'רוני אדלר',
    aliases: [],
    role: 'member',
    seasons: [{ seasonId: 's26', name: 'ברן 26', year: 2026, role: 'member' }],
    dues: null,
    outstandingAgorot: 0,
    taskCount: 0,
    lastActivityAt: new Date('2026-09-01T10:00:00Z'),
    onScopeSeason: true,
    newThisSeason: false,
    lapsed: false,
    ...overrides,
  };
}

async function renderDrawer(overrides: Partial<PersonListRow> = {}, closeHref = '/members?season=s26') {
  return render(await PeekDrawer({
    row: row(overrides),
    seasonId: 's26',
    seasonName: 'ברן 26',
    closeHref,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  responsibilitiesOf.mockResolvedValue([]);
  personChangeLog.mockResolvedValue([]);
});

describe('PeekDrawer — what it shows', () => {
  it('names the person and the state of their dues', async () => {
    await renderDrawer({ dues: dues({ paidAgorot: 50000, outstandingAgorot: 70000, state: 'partial' }), outstandingAgorot: 70000 });
    expect(screen.getByRole('heading', { name: 'רוני אדלר' })).toBeTruthy();
    expect(screen.getByText('שולם חלקית')).toBeTruthy();
    expect(screen.getByText('שולם 500 ₪ מתוך 1,200 ₪')).toBeTruthy();
  });

  it('lists every other spelling after גם:', async () => {
    await renderDrawer({ aliases: ['Roni A.', 'רוני'] });
    expect(screen.getByText('גם: Roni A. · רוני')).toBeTruthy();
  });

  it('says גם: nothing at all when a person has one spelling', async () => {
    await renderDrawer({ aliases: [] });
    expect(screen.queryByText(/גם:/)).toBeNull();
  });

  it('writes a zero balance as — rather than as 0 ₪', async () => {
    await renderDrawer({ outstandingAgorot: 0 });
    expect(screen.queryByText('0 ₪')).toBeNull();
    expect(screen.getByText('אין חוב לקאמפ')).toBeTruthy();
  });

  /*
   * Someone on no season has no dues state to show, and a pill reading
   * `אין חיוב` would imply the camp decided not to bill them. It did not
   * decide anything — they are simply not on the list.
   */
  it('says a person is not on the season rather than showing them an empty due', async () => {
    await renderDrawer({ onScopeSeason: false, dues: null, seasons: [] });
    expect(screen.getByText('לא ברשימת ברן 26')).toBeTruthy();
    expect(screen.queryByText('אין חיוב')).toBeNull();
  });

  it('names the first two tasks it is holding, and says how many more there are', async () => {
    responsibilitiesOf.mockResolvedValue([
      { taskId: 't1', title: 'הקמת הצל', seasonName: 'ברן 26', status: 'accepted' },
      { taskId: 't2', title: 'משמרת בר', seasonName: 'ברן 26', status: 'accepted' },
      { taskId: 't3', title: 'פירוק', seasonName: 'ברן 26', status: 'accepted' },
    ]);
    await renderDrawer({ taskCount: 3 });
    expect(screen.getByText('הקמת הצל · משמרת בר')).toBeTruthy();
  });

  it('shows the three newest changes and no more', async () => {
    personChangeLog.mockResolvedValue([
      { kind: 'payment_recorded', at: new Date('2026-09-12'), by: 'lead@shliff.camp', subject: 'העברה', amountAgorot: 120000 },
      { kind: 'joined_season', at: new Date('2026-08-01'), by: null, subject: 'ברן 26', amountAgorot: null },
      { kind: 'alias_linked', at: new Date('2026-07-01'), by: 'lead@shliff.camp', subject: 'רוני', amountAgorot: null },
      { kind: 'alias_merged', at: new Date('2026-06-01'), by: 'lead@shliff.camp', subject: 'Roni A.', amountAgorot: null },
    ]);
    await renderDrawer();
    expect(screen.getByText(/נרשם תשלום/)).toBeTruthy();
    expect(screen.queryByText(/Roni A\./)).toBeNull();
  });
});

describe('PeekDrawer — what it refuses to be', () => {
  /*
   * R6's peek is a preview, not a second smaller record page. The moment it
   * can write, it starts to drift from the real one and a lead has two places
   * to look. This is the test that keeps it honest.
   */
  it('writes nothing at all: no form, no submit', async () => {
    const { container } = await renderDrawer({ dues: dues() });
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('offers exactly three ways out, all of them links', async () => {
    await renderDrawer();
    expect(screen.getByRole('link', { name: 'פתיחת הרשומה המלאה' }).getAttribute('href'))
      .toBe('/members/p1');
    expect(screen.getByRole('link', { name: 'רישום תשלום' }).getAttribute('href'))
      .toBe('/fees?season=s26&person=p1');
    expect(screen.getByRole('link', { name: 'שיבוץ למשימה' }).getAttribute('href'))
      .toBe('/tasks?season=s26&person=p1');
  });

  it('closes back to the list it was opened from, filters and all', async () => {
    await renderDrawer({}, '/members?season=s26&view=unpaid&q=%D7%9C%D7%95%D7%99');
    expect(screen.getByRole('link', { name: 'סגירה' }).getAttribute('href'))
      .toBe('/members?season=s26&view=unpaid&q=%D7%9C%D7%95%D7%99');
  });
});
