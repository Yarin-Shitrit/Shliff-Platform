/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { Dossier, DossierDue } from '@/lib/members/dossier';

const {
  requireAdmin, personDossier, listSeasons, listPeopleForSeason,
  aliasSourcesFor, personChangeLog, listObligations, accountBalances,
  listPayments, notFound,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  personDossier: vi.fn(),
  listSeasons: vi.fn(),
  listPeopleForSeason: vi.fn(),
  aliasSourcesFor: vi.fn(),
  personChangeLog: vi.fn(),
  listObligations: vi.fn(),
  accountBalances: vi.fn(),
  listPayments: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/dossier', () => ({ personDossier }));
vi.mock('@/lib/members/roster', () => ({ listSeasons, addMember: vi.fn() }));
vi.mock('@/lib/members/people-list', () => ({ listPeopleForSeason }));
vi.mock('@/lib/members/alias-sources', () => ({ aliasSourcesFor }));
vi.mock('@/lib/members/change-log', () => ({ personChangeLog }));
vi.mock('@/lib/money/obligations', () => ({ listObligations }));
vi.mock('@/lib/money/accounts', () => ({ accountBalances }));
vi.mock('@/lib/fees/payments', () => ({ listPayments }));
vi.mock('next/navigation', () => ({
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: () => {} }),
  usePathname: () => '/members',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../actions', () => ({
  addMemberAction: vi.fn(), createPersonAction: vi.fn(), unlinkAliasAction: vi.fn(),
  /* A38: the page binds the wrapper, not the raw action, and reads the param
     name from the same module the action writes it with. */
  unlinkAliasAndReturn: vi.fn(),
  renamePersonAndReturn: vi.fn(),
  UNLINK_ERROR_PARAM: 'unlinkError',
}));

import PersonPage from './page';
import styles from './person.module.css';

const SEASON = { id: 's26', name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35, startsOn: null };

function dossier(overrides: Partial<Dossier> = {}): Dossier {
  return {
    personId: 'p1',
    displayName: 'רוני אדלר',
    notes: null,
    mergedIntoId: null,
    aliases: [{ aliasId: 'al1', alias: 'רוני אדלר', source: 'manual', confirmedBy: 'lead@shliff.camp' }],
    seasons: [{ seasonId: 's26', seasonName: 'ברן 26', role: 'member' }],
    dues: [],
    responsibilities: [],
    ...overrides,
  };
}

function due(overrides: Partial<DossierDue> = {}): DossierDue {
  return {
    dueId: 'd1', seasonName: 'ברן 26', amountAgorot: 120000, kind: 'flat',
    exceptionReason: null, decidedBy: null, paidAgorot: 0,
    outstandingAgorot: 120000, settled: false, ...overrides,
  };
}

async function renderPage(search: Record<string, string> = {}) {
  return render(await PersonPage({
    params: Promise.resolve({ id: 'p1' }),
    searchParams: Promise.resolve(search),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  personDossier.mockResolvedValue(dossier());
  listSeasons.mockResolvedValue([SEASON]);
  listPeopleForSeason.mockResolvedValue([]);
  aliasSourcesFor.mockResolvedValue([]);
  personChangeLog.mockResolvedValue([]);
  listObligations.mockResolvedValue([]);
  accountBalances.mockResolvedValue([]);
  listPayments.mockResolvedValue([]);
});

describe('/members/[id] — the gate', () => {
  it('refuses before it reads anything at all', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(personDossier).not.toHaveBeenCalled();
  });

  it('404s an id that names nobody', async () => {
    personDossier.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('/members/[id] — the header', () => {
  it('names the person and their role', async () => {
    const { container } = await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'רוני אדלר' })).toBeTruthy();
    /* Scoped to the header: the side panel carries the role too, which is the
       point of the panel being present on every tab. */
    const head = container.querySelector('header')!;
    expect(within(head as HTMLElement).getByText('חבר/ה')).toBeTruthy();
  });

  /*
   * The mock draws `050-1234567 · roni@example.com` under the name. `persons`
   * has displayName, notes, merged_into_id and created_at — no phone, no
   * email — and this plan adds no column. The sub-line is the other spellings
   * instead: a real fact about this person, in the place the mock wanted one.
   * An empty field for a column that does not exist is worse than its absence.
   */
  it('carries no phone and no email, because the schema has neither', async () => {
    personDossier.mockResolvedValue(dossier({
      aliases: [
        { aliasId: 'al1', alias: 'רוני אדלר', source: 'manual', confirmedBy: 'lead@shliff.camp' },
        { aliasId: 'al2', alias: 'Roni A.', source: 'import', confirmedBy: 'lead@shliff.camp' },
      ],
    }));
    const { container } = await renderPage();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/@example\.com/);
    expect(screen.getByText('גם: Roni A.')).toBeTruthy();
  });

  it('starts a merge through A3 URL rather than a select over everyone', async () => {
    listPeopleForSeason.mockResolvedValue([
      { personId: 'p1', displayName: 'רוני אדלר', aliases: [], role: null, seasons: [], dues: null, outstandingAgorot: 0, taskCount: 0, lastActivityAt: new Date(), onScopeSeason: false, newThisSeason: false, lapsed: false },
      { personId: 'p2', displayName: 'אופק כהן', aliases: [], role: null, seasons: [], dues: null, outstandingAgorot: 0, taskCount: 0, lastActivityAt: new Date(), onScopeSeason: false, newThisSeason: false, lapsed: false },
    ]);
    await renderPage();
    /* The kit's Popover renders its panel only while open, so the candidates
       are not in the DOM until the trigger is pressed. */
    fireEvent.click(screen.getByRole('button', { name: 'מיזוג לתוך אדם אחר' }));
    const target = screen.getByRole('link', { name: 'אופק כהן' });
    expect(target.getAttribute('href')).toContain('act=merge');
    expect(target.getAttribute('href')).toContain('peek=p1');
    expect(target.getAttribute('href')).toContain('with=p2');
    // Never itself.
    expect(screen.queryByRole('link', { name: 'רוני אדלר' })).toBeNull();
  });
});

describe('/members/[id] — the tiles', () => {
  it('always shows the three that describe every person', async () => {
    personDossier.mockResolvedValue(dossier({ dues: [due()] }));
    await renderPage();
    expect(screen.getByText('דמי קאמפ · ברן 26')).toBeTruthy();
    expect(screen.getByText('יתרה לתשלום')).toBeTruthy();
    expect(screen.getByText('משימות בברן 26')).toBeTruthy();
  });

  /*
   * A zero there would imply a relationship that does not exist: the camp does
   * not owe this person nothing, it owes them nothing *because there is no
   * debt*, and a `0 ₪` tile invites a lead to go looking for one.
   */
  it('withholds the debt and קופה tiles when there is no such relationship', async () => {
    const { container } = await renderPage();
    const tiles = container.querySelector(`.${styles.tiles}`)! as HTMLElement;
    expect(within(tiles).queryByText(/הקאמפ חייב/)).toBeNull();
    expect(within(tiles).queryByText('מחזיק/ה קופה')).toBeNull();
    // Three tiles, not five.
    expect(within(tiles).getByText('דמי קאמפ · ברן 26')).toBeTruthy();
  });

  it('shows what the camp owes when it owes something', async () => {
    listObligations.mockResolvedValue([
      { id: 'o1', direction: 'camp_owes', partyPersonId: 'p1', partyName: null, displayParty: 'רוני אדלר', description: 'מקדמת גנרטור', amountAgorot: 80000, settledAgorot: 30000, outstandingAgorot: 50000, settled: false, unnamed: false, seasonId: 's26', sourceBlockId: null, sourceRow: null },
      { id: 'o2', direction: 'camp_owes', partyPersonId: 'p9', partyName: null, displayParty: 'מישהו אחר', description: 'אחר', amountAgorot: 1000, settledAgorot: 0, outstandingAgorot: 1000, settled: false, unnamed: false, seasonId: 's26', sourceBlockId: null, sourceRow: null },
    ]);
    await renderPage();
    expect(screen.getByText('הקאמפ חייב ל־רוני אדלר')).toBeTruthy();
    expect(screen.getByText('500 ₪')).toBeTruthy();
  });

  /* R11's spirit applied to money: a private account holding camp cash is a
     fact a lead must be told, not a detail. */
  it('warns when the קופה a person holds is a private account', async () => {
    accountBalances.mockResolvedValue([
      { accountId: 'ac1', name: 'ביט של רוני', kind: 'personal', holderPersonId: 'p1', holderName: 'רוני אדלר', balanceAgorot: 240000 },
    ]);
    const { container } = await renderPage();
    const tiles = container.querySelector(`.${styles.tiles}`)! as HTMLElement;
    expect(within(tiles).getByText('מחזיק/ה קופה')).toBeTruthy();
    expect(within(tiles).getByText('חשבון פרטי עם כסף של הקאמפ')).toBeTruthy();
  });
});

describe('/members/[id] — the header hand-offs', () => {
  it('leads back to the list on the same season', async () => {
    await renderPage({ season: 's26' });
    const crumbs = screen.getByRole('navigation', { name: 'מיקום' });
    expect(within(crumbs).getByRole('link', { name: 'אנשים' }).getAttribute('href'))
      .toBe('/members?season=s26');
  });

  /* /fees opens its payment drawer from `?peek=<personId>&act=pay`; /tasks has
     no per-person drawer and lands on the board. */
  it('hands off to the fees drawer and the task board on the scope season', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: /רישום תשלום/ }).getAttribute('href'))
      .toBe('/fees?season=s26&peek=p1&act=pay');
    expect(screen.getByRole('link', { name: /שיבוץ למשימה/ }).getAttribute('href'))
      .toBe('/tasks?season=s26');
  });

  it('withholds רישום תשלום for a person who is not on the scope season', async () => {
    personDossier.mockResolvedValue(dossier({ seasons: [] }));
    await renderPage();
    expect(screen.queryByRole('link', { name: /רישום תשלום/ })).toBeNull();
  });
});

describe('/members/[id] — the overview', () => {
  it('draws one row per season with that season\'s due beside the membership', async () => {
    personDossier.mockResolvedValue(dossier({ dues: [due({ paidAgorot: 50000, outstandingAgorot: 70000 })] }));
    await renderPage();
    const table = screen.getByRole('table', { name: 'השנים בקאמפ' });
    expect(within(table).getByText('נוכחית')).toBeTruthy();
    expect(within(table).getByText('חבר/ה')).toBeTruthy();
    expect(within(table).getByText('שולם חלקית')).toBeTruthy();
    expect(within(table).getByText('1,200 ₪')).toBeTruthy();
    expect(within(table).getByText('500 ₪')).toBeTruthy();
    expect(within(table).getByText('700 ₪')).toBeTruthy();
  });

  it('says in words when a season has no due, rather than leaving the cell blank', async () => {
    await renderPage();
    const table = screen.getByRole('table', { name: 'השנים בקאמפ' });
    expect(within(table).getByText('לא הונפק חיוב')).toBeTruthy();
  });
});

describe('/members/[id] — the payments tab', () => {
  const PAYMENT = {
    id: 'pay1', amountAgorot: 50000, channel: 'ביט', paidOn: new Date('2026-07-01'),
    note: 'חלק ראשון', recordedBy: 'lead@shliff.camp', accountId: null,
  };

  it('lists the payments themselves, not the dues again', async () => {
    personDossier.mockResolvedValue(dossier({ dues: [due()] }));
    listPayments.mockResolvedValue([PAYMENT]);
    await renderPage({ tab: 'payments' });
    const table = screen.getByRole('table', { name: 'תשלומים שנרשמו' });
    expect(within(table).getByText('ביט')).toBeTruthy();
    expect(within(table).getByText('500 ₪')).toBeTruthy();
    expect(within(table).getByText('חלק ראשון')).toBeTruthy();
    expect(within(table).getByText('01/07/26')).toBeTruthy();
    expect(listPayments).toHaveBeenCalledWith(expect.anything(), 'd1');
  });

  it('counts the payments on the tab', async () => {
    personDossier.mockResolvedValue(dossier({ dues: [due()] }));
    listPayments.mockResolvedValue([PAYMENT, { ...PAYMENT, id: 'pay2' }]);
    await renderPage();
    const tab = screen.getAllByRole('tab').find((t) => t.textContent?.includes('תשלומים'))!;
    expect(tab.textContent).toContain('2');
  });

  it('says so when nothing was ever paid', async () => {
    personDossier.mockResolvedValue(dossier({ dues: [due()] }));
    await renderPage({ tab: 'payments' });
    expect(screen.getByText('כאן יופיעו תשלומים. עדיין לא נוספו.')).toBeTruthy();
  });
});

describe('/members/[id] — the tabs', () => {
  it('is six links and never a button, so a tab can be sent to someone', async () => {
    await renderPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    for (const tab of tabs) expect(tab.tagName).toBe('A');
  });

  it('falls back to the overview for a tab nobody has heard of', async () => {
    await renderPage({ tab: 'nonsense' });
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('סקירה');
  });

  it('opens the spellings tab when the URL names it', async () => {
    await renderPage({ tab: 'aliases' });
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected[0].textContent).toContain('כינויים');
  });
});

describe('/members/[id] — the side panel', () => {
  it('shows every spelling with where it came from', async () => {
    aliasSourcesFor.mockResolvedValue([
      { aliasId: 'al1', alias: 'רוני אדלר', source: 'manual', mergedFromPersonId: null, confirmedBy: 'lead@shliff.camp', confirmedAt: new Date('2026-07-01'), cell: null },
      { aliasId: 'al2', alias: 'Roni A.', source: 'import', mergedFromPersonId: null, confirmedBy: 'lead@shliff.camp', confirmedAt: new Date('2026-07-02'), cell: { blockId: 'b1', sheetId: 'sh1', sheetName: 'סיכום כללי', filename: 'x.xlsx', sheetRow: 14, reference: 'סיכום כללי!A14' } },
      { aliasId: 'al3', alias: 'רוני', source: 'import', mergedFromPersonId: null, confirmedBy: null, confirmedAt: null, cell: null },
    ]);
    await renderPage();
    const panel = screen.getByRole('complementary', { name: 'פרטי הרשומה' });
    expect(within(panel).getByText('נרשם ידנית')).toBeTruthy();
    expect(within(panel).getByText('סיכום כללי!A14')).toBeTruthy();
    // An import spelling nothing corroborates says so, and invents no cell.
    expect(within(panel).getByText('מקובץ')).toBeTruthy();
  });

  it('marks a spelling that arrived in a merge', async () => {
    aliasSourcesFor.mockResolvedValue([
      { aliasId: 'al1', alias: 'רוני', source: 'import', mergedFromPersonId: 'p9', confirmedBy: 'lead@shliff.camp', confirmedAt: new Date('2026-07-01'), cell: null },
    ]);
    await renderPage();
    expect(screen.getByText('הכינוי הזה הגיע ממיזוג.')).toBeTruthy();
  });

  /*
   * `dues` records who decided an exception and never when, so that entry has
   * no date. Grouping it under its own heading is the honest alternative to
   * putting it at an assumed position in a chronology.
   */
  it('groups the undated entries last, under their own heading', async () => {
    personChangeLog.mockResolvedValue([
      { kind: 'payment_recorded', at: new Date('2026-09-12'), by: 'lead@shliff.camp', subject: 'העברה', amountAgorot: 120000 },
      { kind: 'joined_season', at: new Date('2026-08-01'), by: null, subject: 'ברן 26', amountAgorot: null },
      { kind: 'exception_decided', at: null, by: 'lead@shliff.camp', subject: 'הובילה את ההקמה', amountAgorot: 0 },
    ]);
    await renderPage();
    const panel = screen.getByRole('complementary', { name: 'פרטי הרשומה' });
    expect(within(panel).getByText('ללא תאריך')).toBeTruthy();
    expect(within(panel).getByText(/הובילה את ההקמה/)).toBeTruthy();
  });

  /* `memberships` records when somebody joined and never who added them. An
     invented actor would be worse than an absent one. */
  it('names no actor for an entry that records none', async () => {
    personChangeLog.mockResolvedValue([
      { kind: 'joined_season', at: new Date('2026-08-01'), by: null, subject: 'ברן 26', amountAgorot: null },
    ]);
    await renderPage();
    const panel = screen.getByRole('complementary', { name: 'פרטי הרשומה' });
    expect(within(panel).getByText(/הצטרפות לברן 26/)).toBeTruthy();
    expect(within(panel).queryByText(/אושר ע״י/)).toBeNull();
  });
});

/*
 * Plan 06, Task 10, ruling 5. The whole point of this dialog is that it is
 * *server*-rendered: R7's two-client-component budget on this screen is spent
 * on `people-table.tsx` and `merge-confirm.tsx`, so the confirmation is driven
 * by `?unlink=<aliasId>` and cancels through a link, never a closure.
 */
describe('/members/[id] — unlinking a spelling', () => {
  const TWO = [
    { aliasId: 'al1', alias: 'רוני אדלר', source: 'manual' as const, mergedFromPersonId: null, confirmedBy: 'lead@shliff.camp', confirmedAt: new Date('2026-07-01'), cell: null },
    { aliasId: 'al2', alias: 'Roni A.', source: 'import' as const, mergedFromPersonId: null, confirmedBy: null, confirmedAt: null, cell: null },
  ];

  it('carries a link per spelling that puts the decision in the URL', async () => {
    aliasSourcesFor.mockResolvedValue(TWO);
    await renderPage({ tab: 'aliases', season: 's26' });
    const panel = screen.getByRole('complementary', { name: 'פרטי הרשומה' });
    const controls = within(panel).getAllByRole('link', { name: 'ביטול הקישור' });
    expect(controls).toHaveLength(2);
    expect(controls[1].getAttribute('href')).toBe('/members/p1?season=s26&tab=aliases&unlink=al2');
  });

  it('raises the confirmation from the server when the URL names a spelling', async () => {
    aliasSourcesFor.mockResolvedValue(TWO);
    await renderPage({ tab: 'aliases', unlink: 'al2' });
    const dialog = screen.getByRole('alertdialog', { name: 'ביטול קישור הכינוי' });
    expect(within(dialog).getByText(/יחזור לרשימת השמות שממתינים לשיוך/)).toBeTruthy();
    expect(within(dialog).getByText('Roni A.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'ביטול הקישור' })).toBeTruthy();
  });

  /* The load-bearing assertion: cancel is a link, which is the only reason
     this dialog can exist on a Server Component at all. */
  it('cancels by navigating back to the tab, with no closure anywhere', async () => {
    aliasSourcesFor.mockResolvedValue(TWO);
    await renderPage({ tab: 'aliases', unlink: 'al2' });
    const dialog = screen.getByRole('alertdialog', { name: 'ביטול קישור הכינוי' });
    expect(within(dialog).getByRole('link', { name: 'ביטול' }).getAttribute('href'))
      .toBe('/members/p1?tab=aliases');
  });

  it('says so when the spelling arrived in a merge', async () => {
    aliasSourcesFor.mockResolvedValue([
      TWO[0],
      { ...TWO[1], mergedFromPersonId: 'p9' },
    ]);
    await renderPage({ tab: 'aliases', unlink: 'al2' });
    const dialog = screen.getByRole('alertdialog', { name: 'ביטול קישור הכינוי' });
    expect(within(dialog).getByText(/הגיע ממיזוג/)).toBeTruthy();
  });

  it('raises nothing for an id that is not one of this person\'s spellings', async () => {
    aliasSourcesFor.mockResolvedValue(TWO);
    await renderPage({ tab: 'aliases', unlink: 'not-theirs' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  /*
   * `createPerson` writes the display name as the first alias and `resolveName`
   * matches on aliases alone, so a person with none is invisible to every
   * future import. `unlinkAliasAction` refuses it; the screen says why instead
   * of offering a control that can only fail.
   */
  it('offers no control for a person\'s only spelling, and says why', async () => {
    aliasSourcesFor.mockResolvedValue([TWO[0]]);
    await renderPage({ tab: 'aliases' });
    const panel = screen.getByRole('complementary', { name: 'פרטי הרשומה' });
    expect(within(panel).queryByRole('link', { name: 'ביטול הקישור' })).toBeNull();
    expect(within(panel).getByText(/אי אפשר יהיה לזהות את האדם בקבצים/)).toBeTruthy();
  });

  it('raises no dialog for that only spelling even when the URL asks for one', async () => {
    aliasSourcesFor.mockResolvedValue([TWO[0]]);
    await renderPage({ tab: 'aliases', unlink: 'al1' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

/**
 * A38's other half: the refusal handed back through the URL has to be read.
 * A redirect carrying a message nobody renders is the same silence as before,
 * moved one file along.
 */
describe('/members/[id] — a refused unlink says so', () => {
  it('renders the refusal the action handed back in the URL', async () => {
    await renderPage({
      tab: 'aliases',
      unlinkError: 'לא ניתן לבטל את הכינוי האחרון של אדם — בלעדיו אי אפשר יהיה לזהות אותו בקבצים.',
    });
    expect(screen.getByRole('alert').textContent)
      .toBe('לא ניתן לבטל את הכינוי האחרון של אדם — בלעדיו אי אפשר יהיה לזהות אותו בקבצים.');
  });

  it('says nothing when nothing was refused', async () => {
    await renderPage({ tab: 'aliases' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * The rename form is URL-driven, like the unlink dialog: the screen's
 * client-component budget (R7) is spent, and a Server Component with a bound
 * Server Action needs none. So the control is a link, the form appears on
 * `?rename=1`, and both ways out go to the same page without the param.
 */
describe('/members/[id] — renaming', () => {
  it('offers a link to the rename form that keeps the season and the tab', async () => {
    await renderPage({ season: 's26', tab: 'aliases' });
    const link = screen.getByRole('link', { name: 'שינוי שם' });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('/members/p1?')).toBe(true);
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('rename')).toBe('1');
    expect(query.get('season')).toBe('s26');
    expect(query.get('tab')).toBe('aliases');
    expect(screen.queryByRole('textbox', { name: /שם חדש/ })).toBeNull();
  });

  it('opens a form prefilled with the current name, posting the bound action', async () => {
    const { container } = await renderPage({ rename: '1', tab: 'aliases' });
    const input = screen.getByRole('textbox', { name: /שם חדש/ }) as HTMLInputElement;
    expect(input.value).toBe('רוני אדלר');
    expect(input.name).toBe('displayName');
    expect(input.required).toBe(true);
    expect(screen.getByRole('button', { name: 'שמירת השם' })).toBeTruthy();
    expect(container.querySelector('form')).toBeTruthy();
    // The heading stays: the form edits the name, it does not replace it.
    expect(screen.getByRole('heading', { level: 1, name: 'רוני אדלר' })).toBeTruthy();
    // The control that opened the form is gone while it is open.
    expect(screen.queryByRole('link', { name: 'שינוי שם' })).toBeNull();
  });

  it('cancels back to the same page without the param', async () => {
    await renderPage({ rename: '1', tab: 'aliases' });
    expect(screen.getByRole('link', { name: 'ביטול' }).getAttribute('href'))
      .toBe('/members/p1?tab=aliases');
  });

  it('renders the refusal the action handed back in the URL', async () => {
    await renderPage({ renameError: 'כבר קיים אדם בשם עמירם דהן — לא ניתן לתת לשניים את אותו השם.' });
    expect(screen.getByRole('alert').textContent)
      .toBe('כבר קיים אדם בשם עמירם דהן — לא ניתן לתת לשניים את אותו השם.');
  });
});
