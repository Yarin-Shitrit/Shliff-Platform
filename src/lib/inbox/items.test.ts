import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorklistRow, CollisionGroup } from '@/lib/data/worklist';
import type { SheetRow } from '@/lib/import/sheets';
import type { BlockStateRow } from '@/lib/import/register';

const {
  worklist, collisionGroups, sheetsNeedingSeason, flaggedArithmetic,
  blockStates, unnamedObligations, listUnlinkedNames, suggestPeopleForName,
  copyDiff, traceRow, partyRowCounts,
} = vi.hoisted(() => ({
  worklist: vi.fn(), collisionGroups: vi.fn(), sheetsNeedingSeason: vi.fn(),
  flaggedArithmetic: vi.fn(), blockStates: vi.fn(), unnamedObligations: vi.fn(),
  listUnlinkedNames: vi.fn(), suggestPeopleForName: vi.fn(),
  copyDiff: vi.fn(), traceRow: vi.fn(), partyRowCounts: vi.fn(),
}));

vi.mock('@/lib/data/worklist', () => ({
  worklist, collisionGroups, sheetsNeedingSeason, flaggedArithmetic,
}));
vi.mock('@/lib/import/register', () => ({ blockStates }));
vi.mock('@/lib/money/obligations', () => ({ unnamedObligations }));
vi.mock('@/lib/members/identity', () => ({ listUnlinkedNames }));
vi.mock('@/lib/members/suggest', () => ({ suggestPeopleForName }));
vi.mock('@/lib/data/evidence', () => ({ copyDiff }));
vi.mock('@/lib/money/trace', () => ({ traceRow }));
vi.mock('./party-rows', () => ({ partyRowCounts }));

import {
  inboxItems, loadInboxItems, openDecisionCount, blocksPromotion, tabOf, groupOf,
} from './items';

const NOW = new Date('2026-09-17T09:00:00Z');
const NONE = new Map<string, Date>();
const LEAD = 'lead@shliff.test';
const db = {} as never;

/** The page's call: refusals included. */
const FULL = { snoozed: NONE, now: NOW, recordedBy: LEAD, includeRefusals: true };

function row(over: Partial<WorklistRow> = {}): WorklistRow {
  return {
    blockId: 'b1', sheetId: 's1', sheetName: 'סיכום כללי',
    filename: 'קופת קאמפ 2026.xlsx', archetype: 'ledger',
    top: 5, bottom: 20, seasonId: 'season-26', seasonName: 'ברן 26',
    state: 'promoted', rowCount: 14, wouldWrite: 14, refusals: [],
    deleted: 0, retained: [], ...over,
  } as WorklistRow;
}

function sheet(over: Partial<SheetRow> = {}): SheetRow {
  return {
    id: 's1', name: 'סיכום כללי', uploadId: 'u1',
    filename: 'קופת קאמפ 2026.xlsx', seasonId: null, seasonName: null,
    authoritative: null, ...over,
  };
}

function block(over: Partial<BlockStateRow> = {}): BlockStateRow {
  return {
    blockId: 'b1', sheetId: 's1', sheetName: 'סיכום כללי', uploadId: 'u1',
    archetype: 'ledger', confidence: 1, top: 5, left: 1, bottom: 20, right: 6,
    range: 'A5:F20', rowCount: 16, headerRow: 5,
    columnMap: [{ column: 1, field: 'date', confidence: 1 }],
    mappingSource: 'admin', budgetCategory: null,
    confirmedBy: LEAD, confirmedAt: new Date('2026-09-01T00:00:00Z'),
    promotedRows: 14, state: 'promoted', ...over,
  } as BlockStateRow;
}

const FLAG = {
  seasonName: 'ברן 26',
  line: {
    id: 'bl1', label: 'סאונד רחבה', quantityText: '3', quantityNumAgorot: 300,
    unitCostAgorot: 400000, totalAgorot: 1500000, rationale: null,
    category: 'camp', arithmeticOff: true, sourceBlockId: null, sourceRow: null,
  },
};

const NAME = {
  aliasId: 'a1', alias: 'נועה ל.', normalized: 'נועה ל.', source: 'import',
  ignoredBy: null, ignoredAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  worklist.mockResolvedValue([]);
  collisionGroups.mockResolvedValue([]);
  sheetsNeedingSeason.mockResolvedValue([]);
  flaggedArithmetic.mockResolvedValue([]);
  blockStates.mockResolvedValue([]);
  unnamedObligations.mockResolvedValue([]);
  listUnlinkedNames.mockResolvedValue([]);
  suggestPeopleForName.mockResolvedValue([]);
  copyDiff.mockResolvedValue({ ok: true, rows: [], differing: 0 });
  traceRow.mockResolvedValue(null);
  partyRowCounts.mockResolvedValue(new Map());
});

describe('inboxItems — an unlinked name', () => {
  it('names the top suggestion and its confidence word in the rail line', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    suggestPeopleForName.mockResolvedValue([
      { personId: 'p1', displayName: 'נועה לוי', alias: 'נועה לוי', reasons: [], confidence: 'חזקה' },
    ]);

    const [item] = await inboxItems(db, FULL);

    expect(item.id).toBe('name:a1');
    expect(item.kind).toBe('unlinked-name');
    expect(item.title).toBe('״נועה ל.״');
    expect(item.detail).toContain('הצעה: נועה לוי');
    expect(item.blocking).toBe(true);
    expect(tabOf(item)).toBe('decide');
    expect(groupOf(item)).toBe('names');
  });

  it('gives digits 1..5 to the buttons and none to anything past the fifth', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    suggestPeopleForName.mockResolvedValue([
      { personId: 'p1', displayName: 'נועה לוי', alias: 'נועה לוי', reasons: [], confidence: 'חזקה' },
      { personId: 'p2', displayName: 'נועה ליבוביץ', alias: 'נועה ליבוביץ', reasons: [], confidence: 'חלשה' },
    ]);

    const [item] = await inboxItems(db, FULL);
    expect(item.actions.map((a) => [a.kind, a.digit])).toEqual([
      ['link-name', 1], ['link-name', 2], ['new-person', 3],
      ['ignore-name', 4], ['snooze', 5],
      ['search-person', null], ['split-name', null], ['skip', null],
    ]);
    expect(item.actions.find((a) => a.kind === 'link-name')!.arg).toBe('p1');
    expect(item.actions.find((a) => a.kind === 'link-name')!.undoable).toBe(true);
    expect(item.actions.find((a) => a.kind === 'new-person')!.undoable).toBe(false);
  });

  it('is not blocking while a deferral is in force, and says until when', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    const until = new Date('2026-09-24T09:00:00Z');
    const [item] = await inboxItems(db, {
      ...FULL, snoozed: new Map([['name:a1', until]]),
    });

    expect(item.snoozedUntil).toEqual(until);
    expect(item.blocking).toBe(false);
    expect(tabOf(item)).toBe('notice');
    expect(item.detail).toContain('נדחה על ידך עד');
  });

  // The brief hard-coded `rowCount: 0` on every name while documenting the
  // field as "promoted money rows still carrying this raw string". A number
  // that is always zero is a claim, not a blank, and this screen exists to be
  // believed — so it is counted, from the one column that holds a raw party.
  it('counts the promoted rows still carrying the raw name', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    partyRowCounts.mockResolvedValue(new Map([['נועה ל.', 3]]));

    const [item] = await inboxItems(db, FULL);
    expect(item.kind === 'unlinked-name' && item.rowCount).toBe(3);
    expect(partyRowCounts).toHaveBeenCalledWith(db, ['נועה ל.']);
  });
});

describe('inboxItems — sheets', () => {
  it('blocks promotion for a seasonless sheet carrying a confirmed budget table', async () => {
    sheetsNeedingSeason.mockResolvedValue([sheet({ id: 's1', name: 'תקציב 26' })]);
    blockStates.mockResolvedValue([
      block({
        blockId: 'b1', sheetId: 's1', sheetName: 'תקציב 26',
        archetype: 'budget_lines', state: 'confirmed', promotedRows: 0,
      }),
    ]);

    const [item] = await inboxItems(db, FULL);
    expect(item.kind).toBe('sheet-season');
    expect(item.blocking).toBe(true);
    expect(blocksPromotion(item)).toBe(true);
  });

  it('is a decision but not a promotion blocker when its rows promote season-less', async () => {
    sheetsNeedingSeason.mockResolvedValue([sheet({ id: 's1', name: 'מסיבת פורים' })]);
    blockStates.mockResolvedValue([
      block({
        blockId: 'b1', sheetId: 's1', sheetName: 'מסיבת פורים',
        archetype: 'ledger', state: 'promoted', promotedRows: 12,
      }),
    ]);

    const [item] = await inboxItems(db, FULL);
    expect(item.blocking).toBe(true);
    expect(blocksPromotion(item)).toBe(false);
    expect(item.detail).toContain('12');
  });

  // The season-requiring set is read off the promoter's own export rather than
  // from a dry run. Without this the predicate is a second copy of a rule the
  // promoter already states, and it drifts the first time an archetype gains
  // or loses a promoter.
  it('does not call the dry run to decide whether a season is required', async () => {
    sheetsNeedingSeason.mockResolvedValue([sheet({ id: 's1', name: 'תקציב 26' })]);
    blockStates.mockResolvedValue([
      block({ sheetId: 's1', archetype: 'ticket_rounds', state: 'confirmed', promotedRows: 0 }),
    ]);

    const [item] = await inboxItems(db, { ...FULL, includeRefusals: false });
    expect(worklist).not.toHaveBeenCalled();
    expect(blocksPromotion(item)).toBe(true);
  });

  it('does not require a season for a table nobody has confirmed yet', async () => {
    sheetsNeedingSeason.mockResolvedValue([sheet({ id: 's1', name: 'תקציב 26' })]);
    blockStates.mockResolvedValue([
      block({
        sheetId: 's1', archetype: 'budget_lines', state: 'needs-review',
        confirmedAt: null, confirmedBy: null, promotedRows: 0,
      }),
    ]);

    const items = await inboxItems(db, FULL);
    const seasonItem = items.find((i) => i.kind === 'sheet-season')!;
    expect(blocksPromotion(seasonItem)).toBe(false);
  });

  it('carries the copy-to-copy diff on a collision, and blocks promotion', async () => {
    collisionGroups.mockResolvedValue([{
      name: 'תקציב 26', state: 'undecided',
      sheets: [
        sheet({ id: 's1', filename: 'קופת קאמפ 2026.xlsx', seasonId: 'season-26', seasonName: 'ברן 26' }),
        sheet({ id: 's2', filename: 'קופת קאמפ 25.xlsx', seasonId: 'season-26', seasonName: 'ברן 26' }),
      ],
    } as CollisionGroup]);
    copyDiff.mockResolvedValue({ ok: true, rows: [], differing: 14 });

    const [item] = await inboxItems(db, FULL);
    expect(item.id).toBe('collision:תקציב 26:season-26');
    expect(item.title).toBe('שני עותקים של ״תקציב 26״');
    expect(item.detail).toContain('14');
    expect(blocksPromotion(item)).toBe(true);
    expect(copyDiff).toHaveBeenCalledWith(db, ['s1', 's2']);
    expect(item.actions.map((a) => [a.kind, a.digit])).toEqual([
      ['set-authority', 1], ['set-authority', 2], ['snooze', 3], ['skip', null],
    ]);
  });

  it('uses the stored Hebrew refusal for an ambiguous group, word for word', async () => {
    collisionGroups.mockResolvedValue([{
      name: 'תקציב 26', state: 'ambiguous',
      sheets: [sheet({ id: 's1' }), sheet({ id: 's2' })],
    } as CollisionGroup]);

    const [item] = await inboxItems(db, FULL);
    expect(item.detail).toBe('יותר מעותק אחד של הגיליון הזה סומן כנכון');
  });
});

describe('inboxItems — blocks, debts, refusals and flags', () => {
  it('makes an unconfirmed block a decision that blocks promotion, named in A1', async () => {
    blockStates.mockResolvedValue([
      block({
        blockId: 'b9', state: 'needs-review', archetype: 'ticket_rounds',
        confirmedAt: null, confirmedBy: null, promotedRows: 0,
        range: 'A5:F20', rowCount: 41,
      }),
    ]);
    const [item] = await inboxItems(db, FULL);

    expect(item.id).toBe('block:b9');
    expect(item.kind).toBe('block-undecided');
    expect(item.blocking).toBe(true);
    expect(blocksPromotion(item)).toBe(true);
    expect(item.detail).toContain('סיכום כללי!A5:F20');
  });

  it('calls a confirmed block with no column map unmapped, not unconfirmed', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b7', state: 'confirmed', columnMap: [], promotedRows: 0 }),
    ]);
    const [item] = await inboxItems(db, FULL);
    expect(item.kind === 'block-undecided' && item.reason).toBe('unmapped-column');
  });

  // A block on a contested or superseded sheet is already carried by that
  // sheet's collision item. Offering "confirm this table" beside it asks a
  // lead to decide something that cannot take effect until the other decision
  // is made, which is Ruling 4's duplicate emission in a different costume.
  it('leaves a block on a contested sheet to the collision item', async () => {
    collisionGroups.mockResolvedValue([{
      name: 'תקציב 26', state: 'undecided',
      sheets: [sheet({ id: 's1' }), sheet({ id: 's2' })],
    } as CollisionGroup]);
    blockStates.mockResolvedValue([
      block({ blockId: 'b3', sheetId: 's1', state: 'blocked', confirmedAt: null, confirmedBy: null }),
    ]);

    const items = await inboxItems(db, FULL);
    expect(items.map((i) => i.kind)).toEqual(['sheet-collision']);
  });

  // The block-state enum is not closed: a `retired` state is coming for the
  // sheets the camp lead chose to close rather than backfill. A skip-list
  // would greet it by asking a lead to confirm a table on a sheet they
  // deliberately retired — the unresolvable rail items returning by another
  // door. This pins the allow-list direction, not the specific future name.
  it('manufactures no decision from a block state it does not recognise', async () => {
    blockStates.mockResolvedValue([
      block({
        blockId: 'b4', state: 'retired' as BlockStateRow['state'],
        confirmedAt: null, confirmedBy: null, promotedRows: 0,
      }),
    ]);
    expect(await inboxItems(db, FULL)).toEqual([]);
  });

  it('gives an unnamed debt no snooze and no ignore', async () => {
    unnamedObligations.mockResolvedValue([{
      id: 'o1', direction: 'owed_by_camp', partyPersonId: null, partyName: null,
      displayParty: null, description: 'החזר לעומר', amountAgorot: 54000,
      settledAgorot: 0, outstandingAgorot: 54000, settled: false, unnamed: true,
      openedOn: null, seasonId: null, sourceBlockId: 'b1', sourceRow: 14, settlements: [],
    }]);

    const [item] = await inboxItems(db, FULL);
    expect(item.id).toBe('debt:o1');
    expect(item.blocking).toBe(true);
    expect(blocksPromotion(item)).toBe(false);
    expect(item.actions.map((a) => a.kind)).toEqual(['name-debt', 'open-source']);
    expect(item.detail).toBe('אי אפשר לסגור עד שיירשם למי');
  });

  it('carries a refused row as information, with the promoter’s own Hebrew', async () => {
    worklist.mockResolvedValue([
      row({
        state: 'promoted', rowCount: 13,
        refusals: [{
          sheetRow: 18, reason: 'total-row',
          message: 'שורת סה״כ היא סכום מחושב, לא תנועה',
          cells: ['סה״כ', '', '44,647'],
        }],
      }),
    ]);

    const items = await inboxItems(db, FULL);
    const item = items.find((i) => i.kind === 'refused-row')!;
    expect(item.id).toBe('refusal:b1:18:total-row');
    expect(item.blocking).toBe(false);
    expect(tabOf(item)).toBe('notice');
    expect(item.detail).toBe('שורת סה״כ היא סכום מחושב, לא תנועה');
    expect(item.actions.map((a) => a.kind)).toEqual(['open-source']);
    expect(groupOf(item)).toBe('refusals');
  });

  it('never emits a refusal that another item kind already carries', async () => {
    worklist.mockResolvedValue([
      row({
        state: 'refused', rowCount: 0,
        refusals: [
          { sheetRow: 5, reason: 'no-season', message: 'לגיליון לא נקבעה עונה, ותקציב חייב עונה', cells: [] },
          { sheetRow: 6, reason: 'sheet-undecided', message: 'x', cells: [] },
          { sheetRow: 7, reason: 'blank-row', message: 'שורה ריקה', cells: [] },
          { sheetRow: 8, reason: 'no-amount', message: 'אין סכום בשורה', cells: [] },
        ],
      }),
    ]);

    const items = await inboxItems(db, FULL);
    expect(items.filter((i) => i.kind === 'refused-row').map((i) => i.id))
      .toEqual(['refusal:b1:8:no-amount']);
  });

  it('carries an arithmetic flag as information that names the sum that fails', async () => {
    flaggedArithmetic.mockResolvedValue([FLAG]);

    const [item] = await inboxItems(db, FULL);
    expect(item.id).toBe('arith:bl1');
    expect(item.blocking).toBe(false);
    expect(item.title).toBe('סאונד רחבה');
    expect(item.detail).toContain('ברן 26');
    expect(groupOf(item)).toBe('refusals');
  });
});

describe('the dry run is opt-in', () => {
  // A32: worklist dry-runs every confirmed block. The shell's badge and the
  // home preview call loadInboxItems on every request, and a dry run per page
  // load is the hazard this project was warned about arriving by a different
  // door. Refused rows are the only kind that needs it, and none of them is
  // ever blocking, so the badge cannot differ.
  it('does not run the promoter when refusals were not asked for', async () => {
    blockStates.mockResolvedValue([block()]);
    await inboxItems(db, { ...FULL, includeRefusals: false });
    expect(worklist).not.toHaveBeenCalled();
  });

  it('runs it exactly once when they were', async () => {
    await inboxItems(db, FULL);
    expect(worklist).toHaveBeenCalledWith(db, LEAD);
    expect(worklist).toHaveBeenCalledTimes(1);
  });

  it('counts the same open decisions either way, which is what makes it safe', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    worklist.mockResolvedValue([
      row({
        refusals: [{
          sheetRow: 18, reason: 'total-row',
          message: 'שורת סה״כ היא סכום מחושב, לא תנועה', cells: [],
        }],
      }),
    ]);

    const withRefusals = await inboxItems(db, FULL);
    const without = await inboxItems(db, { ...FULL, includeRefusals: false });

    expect(withRefusals.length).toBeGreaterThan(without.length);
    expect(openDecisionCount(withRefusals)).toBe(openDecisionCount(without));
  });

  it('loadInboxItems takes I2’s two arguments and runs no dry run', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    const items = await loadInboxItems(db, 'season-26');
    expect(worklist).not.toHaveBeenCalled();
    expect(items.map((i) => i.id)).toEqual(['name:a1']);
    expect(suggestPeopleForName).toHaveBeenCalledWith(db, 'נועה ל.', { seasonId: 'season-26' });
  });
});

describe('openDecisionCount', () => {
  it('counts blocking items and nothing else', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    flaggedArithmetic.mockResolvedValue([FLAG]);

    const items = await inboxItems(db, FULL);
    expect(items).toHaveLength(2);
    expect(openDecisionCount(items)).toBe(1);
  });

  it('is zero when everything left is information, so the badge can be hidden', async () => {
    flaggedArithmetic.mockResolvedValue([FLAG]);
    expect(openDecisionCount(await inboxItems(db, FULL))).toBe(0);
  });
});

describe('inboxItems — order', () => {
  it('orders decisions before information, and blockers first within them', async () => {
    listUnlinkedNames.mockResolvedValue([NAME]);
    collisionGroups.mockResolvedValue([{
      name: 'תקציב 26', state: 'undecided',
      sheets: [sheet({ id: 's1' }), sheet({ id: 's2' })],
    } as CollisionGroup]);
    flaggedArithmetic.mockResolvedValue([FLAG]);

    const items = await inboxItems(db, FULL);
    expect(items.map((i) => i.kind)).toEqual(['sheet-collision', 'unlinked-name', 'arithmetic-flag']);
  });
});
