import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { formatDateShort } from '@/lib/dates';
import { createTestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { createAccount, accountBalances } from './accounts';
import { recordEntry, recordTransfer } from './ledger';
import { createBudgetLine } from './budget';
import { traceRow } from './trace';
import type { SourceCell } from './trace';
import {
  listLedgerRows, applyLedgerView, viewCounts, ledgerStrip, groupByMonth,
  runningBalanceAvailable, runningBalanceFor,
} from './ledger-view';
import type { LedgerRow } from './ledger-view';

const LEAD = 'lead@example.com';
let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

/**
 * The upload → sheet → block fixture, copied in shape from `trace.test.ts`
 * (whose own helpers are `addSheet`/`addBlock`). Local to this file on
 * purpose: `trace.test.ts` belongs to another lane and is not edited here.
 */
async function seedBlock(
  opts: { sheetName: string; left: number },
): Promise<{ blockId: string; sheetId: string }> {
  const [up] = await db.insert(uploads).values({
    filename: '2026.xlsx', sha256: `sha/${opts.sheetName}/${opts.left}`,
    storageKey: `k/${opts.sheetName}/${opts.left}`, sizeBytes: 1,
    uploadedBy: LEAD, status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name: opts.sheetName, index: 0, rowCount: 60, colCount: 8,
  }).returning();
  const [block] = await db.insert(blocks).values({
    sheetId: sheet.id, top: 1, left: opts.left, bottom: 40, right: opts.left,
    archetype: 'ledger', confidence: '1.0000', headerRow: null, fingerprint: null,
    pipelineVersion: 1, rawGrid: [['x']], confirmedBy: LEAD, confirmedAt: new Date(),
  }).returning();
  return { blockId: block.id, sheetId: sheet.id };
}

describe('the ledger view', () => {
  it('carries the budget line label a movement was spent against', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const lineId = await createBudgetLine(db, {
      seasonId: season.id, label: 'תשתיות', total: 18600, category: 'camp',
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-08-28T00:00:00Z'), direction: 'out', amount: 18600,
      description: 'השכרת גנרטור', seasonId: season.id, budgetLineId: lineId,
      recordedBy: LEAD,
    });
    const [row] = await listLedgerRows(db, { seasonId: season.id });
    expect(row.budgetLineLabel).toBe('תשתיות');
    expect(row.budgetLineId).toBe(lineId);
    expect(row.amountAgorot).toBe(1860000);
    expect(row.direction).toBe('out');
  });

  it('names the payer as the counterpart of a dues payment, and never a sign', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const personId = await createPerson(db, 'נועה לוי', LEAD);
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await recordPayment(db, {
      dueId: fee.dueId!, amount: 1200, channel: 'מזומן',
      paidOn: new Date('2026-09-10T00:00:00Z'), recordedBy: LEAD,
    });
    const [row] = await listLedgerRows(db, { seasonId: season.id });
    expect(row.origin).toBe('dues');
    expect(row.counterpartName).toBe('נועה לוי');
    expect(row.counterpartPersonId).toBe(personId);
    expect(row.amountAgorot).toBe(120000);
    expect(row.direction).toBe('in');
    expect(row.source).toBeNull();
  });

  it('names the other account as the counterpart of each leg of a transfer', async () => {
    const from = await createAccount(db, { name: 'החשבון של רוני', kind: 'personal' });
    const to = await createAccount(db, { name: 'קופת מסיבות', kind: 'cash' });
    await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 6200,
      occurredOn: new Date('2026-09-12T00:00:00Z'), description: 'העברה לקופת מסיבות',
      recordedBy: LEAD,
    });
    const rows = await listLedgerRows(db);
    expect(rows.every((row) => row.isTransfer)).toBe(true);
    const out = rows.find((row) => row.direction === 'out')!;
    const into = rows.find((row) => row.direction === 'in')!;
    expect(out.counterpartName).toBe('קופת מסיבות');
    expect(into.counterpartName).toBe('החשבון של רוני');
  });

  it('leaves the counterpart empty for a plain entry rather than reading a name out of the description', async () => {
    await recordEntry(db, {
      occurredOn: new Date('2026-09-14T00:00:00Z'), direction: 'out', amount: 3875,
      description: 'השכרת משאית — הובלות דרום', recordedBy: LEAD,
    });
    const [row] = await listLedgerRows(db);
    expect(row.counterpartName).toBeNull();
    expect(row.counterpartPersonId).toBeNull();
    expect(row.isTransfer).toBe(false);
  });

  it('inherits the offset exclusion from listMovements rather than restating it', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const personId = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await recordPayment(db, {
      dueId: fee.dueId!, amount: 1200, channel: 'קיזוז', note: 'מול חוב יוסף',
      paidOn: new Date('2026-09-01T00:00:00Z'), recordedBy: LEAD,
    });
    expect(await listLedgerRows(db, { seasonId: season.id })).toHaveLength(0);
  });

  it('agrees with traceRow on the same row, so a chip and a trace cannot drift', async () => {
    const { blockId } = await seedBlock({ sheetName: 'סיכום כללי', left: 1 });
    const entryId = await recordEntry(db, {
      occurredOn: new Date('2026-07-11T00:00:00Z'), direction: 'out', amount: 41300,
      description: 'רכש ציוד תשתית', recordedBy: LEAD,
      sourceBlockId: blockId, sourceRow: 14,
    });
    const traced = await traceRow(db, 'ledger_entries', entryId);
    const [row] = await listLedgerRows(db);
    expect(traced!.reference).toBe('סיכום כללי!A14');
    expect(row.source).toEqual(traced);
  });
});

/**
 * A resolved workbook cell, in full. `LedgerRow.source` is a `SourceCell` —
 * `trace.ts`'s own type — rather than the narrower `{ blockId, reference }`
 * pair, so the row can be handed to `chipSource` without a second shape and
 * without anything re-deriving the reference string.
 */
function cell(over: Partial<SourceCell> = {}): SourceCell {
  return {
    blockId: 'b1', sheetId: 'sh1', sheetName: 'סיכום כללי', filename: '2026.xlsx',
    sheetRow: 14, reference: 'סיכום כללי!A14', ...over,
  };
}

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'r1', origin: 'ledger', occurredOn: new Date('2026-09-15T00:00:00Z'),
    direction: 'in', amountAgorot: 1850000, description: 'הכנסות מסיבת גיוס',
    accountId: 'a1', accountName: 'קופת מסיבות', counterpartName: null,
    counterpartPersonId: null, isTransfer: false, budgetLineId: null,
    budgetLineLabel: null, seasonId: 's1', source: null, ...over,
  };
}

describe('the saved views', () => {
  const rows = [
    row({ id: '1', direction: 'in', amountAgorot: 1850000 }),
    // Rows 2 and 3 carry their own descriptions rather than the fixture's
    // default: the search assertion below expects `גיוס` to match rows 1 and
    // 5 alone, which is only a claim about searching if the other rows say
    // something else.
    row({ id: '2', direction: 'out', amountAgorot: 387500, description: 'השכרת משאית' }),
    row({ id: '3', direction: 'out', amountAgorot: 120000, description: 'מים וקרח',
          accountId: null, accountName: null }),
    row({ id: '4', origin: 'dues', direction: 'in', amountAgorot: 120000,
          counterpartName: 'נועה לוי', description: 'דמי קאמפ — נועה לוי' }),
    row({ id: '5', source: cell() }),
  ];

  it('counts every view from one array', () => {
    expect(viewCounts(rows)).toEqual({
      all: 5, in: 3, out: 2, 'no-account': 1, imported: 1, manual: 4,
    });
  });

  it('filters to movements with no account at all', () => {
    const only = applyLedgerView(rows, { view: 'no-account', sort: 'date-asc' });
    expect(only.map((r) => r.id)).toEqual(['3']);
  });

  it('searches the description and the counterpart together', () => {
    expect(applyLedgerView(rows, { view: 'all', text: 'נועה', sort: 'date-asc' })
      .map((r) => r.id)).toEqual(['4']);
    expect(applyLedgerView(rows, { view: 'all', text: 'גיוס', sort: 'date-asc' })
      .map((r) => r.id)).toEqual(['1', '5']);
  });

  it('filters to one budget line without touching the rest of the query', () => {
    const lined = [...rows, row({ id: '6', budgetLineId: 'bl1', budgetLineLabel: 'תשתיות' })];
    expect(applyLedgerView(lined, { view: 'all', budgetLineId: 'bl1', sort: 'date-asc' })
      .map((r) => r.id)).toEqual(['6']);
  });

  it('orders by date, both ways', () => {
    const dated = [
      row({ id: 'old', occurredOn: new Date('2026-07-02T00:00:00Z') }),
      row({ id: 'new', occurredOn: new Date('2026-09-15T00:00:00Z') }),
    ];
    expect(applyLedgerView(dated, { view: 'all', sort: 'date-asc' }).map((r) => r.id))
      .toEqual(['old', 'new']);
    expect(applyLedgerView(dated, { view: 'all', sort: 'date-desc' }).map((r) => r.id))
      .toEqual(['new', 'old']);
  });
});

describe('the summary strip', () => {
  it('recomputes with the filter, because it reduces the rows on screen', () => {
    const rows = [
      row({ id: '1', direction: 'in', amountAgorot: 6200000 }),
      row({ id: '2', direction: 'out', amountAgorot: 4527100 }),
    ];
    expect(ledgerStrip(rows)).toEqual({
      inAgorot: 6200000, outAgorot: 4527100, netAgorot: 1672900, count: 2,
    });
    const outOnly = applyLedgerView(rows, { view: 'out', sort: 'date-asc' });
    expect(ledgerStrip(outOnly)).toEqual({
      inAgorot: 0, outAgorot: 4527100, netAgorot: -4527100, count: 1,
    });
  });
});

describe('month group headers', () => {
  it('groups by the month of the movement and labels it in Hebrew', () => {
    const groups = groupByMonth([
      row({ id: '1', occurredOn: new Date('2026-09-15T00:00:00Z') }),
      row({ id: '2', occurredOn: new Date('2026-09-08T00:00:00Z') }),
      row({ id: '3', occurredOn: new Date('2026-08-28T00:00:00Z') }),
    ], 'date-desc');
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['ספטמבר 2026', 2], ['אוגוסט 2026', 1],
    ]);
  });

  it('puts the oldest month first on the ascending sort', () => {
    const groups = groupByMonth([
      row({ id: '3', occurredOn: new Date('2026-08-28T00:00:00Z') }),
      row({ id: '1', occurredOn: new Date('2026-09-15T00:00:00Z') }),
    ], 'date-asc');
    expect(groups.map((g) => g.label)).toEqual(['אוגוסט 2026', 'ספטמבר 2026']);
  });

  /**
   * The month header and the date cells under it must name the same month.
   * `formatDateShort` reads every date in `Asia/Jerusalem`, so a movement at
   * 22:00Z on 31 August is `01/09/26` on screen — and a header derived from
   * `getUTCMonth()` would file it under אוגוסט, above a row whose own date
   * says September. The grouping is taken from the same helper the cell uses.
   */
  it('groups by the camp\'s calendar, not by UTC', () => {
    const lateAugustInUtc = new Date('2026-08-31T22:00:00Z');
    expect(formatDateShort(lateAugustInUtc)).toBe('01/09/26');
    const groups = groupByMonth([row({ id: '1', occurredOn: lateAugustInUtc })], 'date-asc');
    expect(groups.map((g) => g.label)).toEqual(['ספטמבר 2026']);
  });
});

describe('the running balance', () => {
  it('is shown for one account in date order, and closes on that account\'s balance', async () => {
    const account = await createAccount(db, {
      name: 'קופה מזומן', kind: 'cash', openingBalance: 44647,
    });
    for (const [direction, amount, on] of [
      ['out', 200, '2025-06-02'], ['in', 34646.55, '2025-07-11'], ['out', 400, '2025-08-05'],
    ] as const) {
      await recordEntry(db, {
        occurredOn: new Date(`${on}T00:00:00Z`), direction, amount,
        description: 'תנועה', accountId: account.id, recordedBy: LEAD,
      });
    }
    const scope = { accountId: account.id };
    const query = { view: 'all', sort: 'date-asc' } as const;
    expect(runningBalanceAvailable(scope, query)).toEqual({ ok: true });

    const rows = applyLedgerView(await listLedgerRows(db, scope), query);
    const balance = await runningBalanceFor(db, rows, scope, query);
    expect(balance.shown).toBe(true);
    if (!balance.shown) throw new Error('unreachable');
    expect(balance.openingAgorot).toBe(4464700);
    expect(balance.balancesAgorot).toEqual([4444700, 7909355, 7869355]);

    const derived = (await accountBalances(db))
      .find((row) => row.accountId === account.id)!;
    expect(balance.balancesAgorot.at(-1)).toBe(derived.balanceAgorot);
  });

  /**
   * The anchor is in the middle. 44,183.55 is what the sheet says the camp
   * held after 30/10/2025; the walk reads backwards from it through the two
   * counted rows and forwards from it through the one that came later, and
   * the last value is still what the account card says.
   */
  it('reads backwards from a counted balance through the movements inside the count', async () => {
    const account = await createAccount(db, {
      name: 'עו״ש אופק', kind: 'personal', openingBalance: 14079.55,
      openingOn: new Date('2025-10-30T00:00:00Z'),
    });
    for (const [direction, amount, on] of [
      ['out', 20660, '2025-10-16'], ['in', 15660, '2025-10-30'], ['out', 14000, '2026-06-01'],
    ] as const) {
      await recordEntry(db, {
        occurredOn: new Date(`${on}T00:00:00Z`), direction, amount,
        description: 'תנועה', accountId: account.id, recordedBy: LEAD,
      });
    }
    const scope = { accountId: account.id };
    const query = { view: 'all', sort: 'date-asc' } as const;
    const rows = applyLedgerView(await listLedgerRows(db, scope), query);
    const balance = await runningBalanceFor(db, rows, scope, query);
    if (!balance.shown) throw new Error('unreachable');
    expect(balance.countedOn?.toISOString()).toBe('2025-10-30T00:00:00.000Z');
    expect(balance.insideCount).toBe(2);
    // after 16/10: the count less the 15,660 that arrived on 30/10.
    // after 30/10: the count itself. after 01/06/26: the count less 14,000.
    expect(balance.balancesAgorot).toEqual([1407955 - 1566000, 1407955, 1407955 - 1400000]);

    const derived = (await accountBalances(db)).find((row) => row.accountId === account.id)!;
    expect(balance.balancesAgorot.at(-1)).toBe(derived.balanceAgorot);
  });

  it('is hidden across several accounts, and says so', () => {
    const result = runningBalanceAvailable({}, { view: 'all', sort: 'date-asc' });
    expect(result).toEqual({
      ok: false,
      reason: 'יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.',
    });
  });

  it('is hidden when the season filter is on, because a season is a label and not a period', () => {
    const result = runningBalanceAvailable(
      { accountId: 'a1', seasonId: 's1' }, { view: 'all', sort: 'date-asc' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'הסינון הפעיל מסתיר חלק מהתנועות של החשבון, ולכן יתרה רצה תהיה שגויה.',
    });
  });

  it('is hidden on a direction view and on the newest-first sort', () => {
    expect(runningBalanceAvailable({ accountId: 'a1' }, { view: 'out', sort: 'date-asc' }).ok)
      .toBe(false);
    expect(runningBalanceAvailable({ accountId: 'a1' }, { view: 'all', sort: 'date-desc' }))
      .toEqual({
        ok: false,
        reason: 'יתרה רצה מוצגת רק לפי סדר תאריכים עולה.',
      });
  });

  it('is hidden by a text search and by a budget-line filter, which also remove rows', () => {
    expect(runningBalanceAvailable(
      { accountId: 'a1' }, { view: 'all', text: 'משאית', sort: 'date-asc' },
    ).ok).toBe(false);
    expect(runningBalanceAvailable(
      { accountId: 'a1' }, { view: 'all', budgetLineId: 'bl1', sort: 'date-asc' },
    ).ok).toBe(false);
    // A search param that is present but empty removes nothing, so it does
    // not disqualify the column — otherwise every visit from a search form
    // would lose it.
    expect(runningBalanceAvailable(
      { accountId: 'a1' }, { view: 'all', text: '  ', sort: 'date-asc' },
    )).toEqual({ ok: true });
  });

  it('returns the reason rather than a column when it cannot be true', async () => {
    const balance = await runningBalanceFor(db, [], {}, { view: 'all', sort: 'date-asc' });
    expect(balance).toEqual({
      shown: false,
      reason: 'יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.',
    });
  });
});
