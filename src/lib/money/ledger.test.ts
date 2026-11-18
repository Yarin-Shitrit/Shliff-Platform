import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordPayment, recordOffset } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { uploads, sheets, blocks } from '@/db/schema/source';
import type { BlockArchetype } from '@/lib/classify/types';
import { createAccount } from './accounts';
import {
  recordEntry, recordTransfer, listMovements, ledgerTotals,
  updateEntry, deleteEntry, ENTRY_REFUSALS,
} from './ledger';
import { ledgerEntries } from '@/db/schema/money';
import { createBudgetLine } from './budget';
import { createObligation, settleObligation, listObligations } from './obligations';
import { createParty, recordPartyMovement } from './parties';
import { accountBalances } from './accounts';
import { listLedgerRows } from './ledger-view';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

const LEAD = 'lead@example.com';

// Copied from trace.test.ts's shape (`addSheet`/`addBlock`), not the brief's
// nonexistent `seedBlock` — this file has no such helper and none of trace's
// test-only fixtures are exported for reuse.
async function addSheet(db: TestDb, filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}/${name}`, storageKey: `k/${name}`,
    sizeBytes: 1, uploadedBy: LEAD, status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name, index: 0, rowCount: 20, colCount: 6,
  }).returning();
  return sheet.id;
}

async function addBlock(
  db: TestDb, onSheet: string, archetype: BlockArchetype, opts: { top?: number; left?: number } = {},
): Promise<string> {
  const top = opts.top ?? 1;
  const left = opts.left ?? 1;
  const [block] = await db.insert(blocks).values({
    sheetId: onSheet, top, left, bottom: top, right: left,
    archetype, confidence: '1.0000', headerRow: null, fingerprint: null,
    pipelineVersion: 1, rawGrid: [['x']],
    confirmedBy: LEAD, confirmedAt: new Date(),
  }).returning();
  return block.id;
}

describe('the ledger', () => {
  it('reproduces the ברן 25 bottom line from its eight movements', async () => {
    const rows: Array<[('in' | 'out'), number, string]> = [
      ['in', 44647, 'מעבר לקובץ חדש'],
      ['out', 200, 'תרומה אבישי פרץ'],
      ['out', 8850, 'מכולה אוג 25-26'],
      ['out', 20660, 'מקדמה במה ברן 25'],
      ['in', 34646.55, 'רווח מסיבה נמל'],
      ['out', 20660, 'חצי שני למייצג נטלי'],
      ['out', 400, 'מברגה לקאמפ'],
      ['in', 15660, 'מסיבת האלווין 30/10'],
    ];
    for (const [direction, amount, description] of rows) {
      await recordEntry(db, {
        occurredOn: new Date('2025-06-01T00:00:00Z'),
        direction, amount, description, recordedBy: LEAD,
      });
    }

    const totals = await ledgerTotals(db);
    expect(totals.count).toBe(8);
    expect(totals.outAgorot).toBe(5077000);
    expect(totals.inAgorot).toBe(9495355);
    expect(totals.netAgorot).toBe(4418355);
  });

  it('refuses a non-positive amount, because direction carries the sign', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'out', amount: -50,
      description: 'שלילי', recordedBy: LEAD,
    })).rejects.toThrow(/חיובי/);
  });

  it('refuses a zero amount, because a zero movement is not a movement', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'out', amount: 0,
      description: 'אפס', recordedBy: LEAD,
    })).rejects.toThrow(/חיובי/);
  });

  it('refuses a blank description', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'in', amount: 50,
      description: ' ‎ ', recordedBy: LEAD,
    })).rejects.toThrow(/תיאור/);
  });

  it('writes a transfer as two entries sharing one non-null group', async () => {
    const from = await createAccount(db, { name: 'וייבז', kind: 'event_float', openingBalance: 5000 });
    const to = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });

    await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 1200,
      occurredOn: new Date(), description: 'העברה לקופה', recordedBy: LEAD,
    });

    const moves = await listMovements(db);
    expect(moves).toHaveLength(2);
    expect(new Set(moves.map((m) => m.direction))).toEqual(new Set(['in', 'out']));
    // The actual requirement (§4 requirement 6): a transfer is identifiable
    // as one movement because both its entries carry the *same* group id.
    // `typeof ... === 'string'` rather than `.not.toBeNull()`: a field the
    // select statement forgets to project comes back `undefined`, and
    // `undefined` passes a bare not-null check just as easily as a real
    // UUID would — this would have let `transferGroupId` go on being
    // selected nowhere and still pass.
    expect(typeof moves[0].transferGroupId).toBe('string');
    expect(moves[1].transferGroupId).toBe(moves[0].transferGroupId);
  });

  it('does not share a transfer group between two separate transfers', async () => {
    const a = await createAccount(db, { name: 'וייבז', kind: 'event_float', openingBalance: 5000 });
    const b = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    const c = await createAccount(db, { name: 'עו״ש אופק', kind: 'personal' });

    await recordTransfer(db, {
      fromAccountId: a.id, toAccountId: b.id, amount: 1200,
      occurredOn: new Date('2026-01-01T00:00:00Z'), description: 'העברה ראשונה', recordedBy: LEAD,
    });
    await recordTransfer(db, {
      fromAccountId: b.id, toAccountId: c.id, amount: 300,
      occurredOn: new Date('2026-01-02T00:00:00Z'), description: 'העברה שנייה', recordedBy: LEAD,
    });

    const moves = await listMovements(db);
    expect(moves).toHaveLength(4);
    const firstGroup = moves[0].transferGroupId;
    const secondGroup = moves[2].transferGroupId;
    expect(typeof firstGroup).toBe('string');
    expect(typeof secondGroup).toBe('string');
    expect(secondGroup).not.toBe(firstGroup);
    expect(moves[1].transferGroupId).toBe(firstGroup);
    expect(moves[3].transferGroupId).toBe(secondGroup);
  });

  it('refuses a transfer to the same account', async () => {
    const a = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    await expect(recordTransfer(db, {
      fromAccountId: a.id, toAccountId: a.id, amount: 10,
      occurredOn: new Date(), description: 'עצמי', recordedBy: LEAD,
    })).rejects.toThrow(/אותו חשבון/);
  });

  it('reads a dues payment as a movement alongside ledger entries — the union, not a copy', async () => {
    // This is the test the brief's Step 5 warns might not exist: drop the
    // `payments` half of listMovements and nothing above would fail, because
    // every other test here only ever inserts ledger_entries rows. A real
    // due, paid, is the only way to exercise the union at all.
    const season = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const personId = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [row] = await listSeasonFees(db, season.id);

    await recordPayment(db, {
      dueId: row.dueId!, amount: 1500, channel: 'מזומן', paidOn: new Date('2025-07-01T00:00:00Z'),
      recordedBy: LEAD,
    });

    // A ledger entry in the same season, so the totals reflect both sources.
    await recordEntry(db, {
      occurredOn: new Date('2025-07-02T00:00:00Z'), direction: 'out', amount: 300,
      description: 'הוצאה', recordedBy: LEAD, seasonId: season.id,
    });

    const moves = await listMovements(db, { seasonId: season.id });
    expect(moves).toHaveLength(2);
    expect(moves.some((m) => m.source === 'dues')).toBe(true);
    expect(moves.some((m) => m.source === 'ledger')).toBe(true);

    const totals = await ledgerTotals(db, { seasonId: season.id });
    expect(totals.count).toBe(2);
    expect(totals.inAgorot).toBe(150000);
    expect(totals.outAgorot).toBe(30000);
    expect(totals.netAgorot).toBe(120000);
  });

  /**
   * A `קיזוז` settles a due against a debt the camp already owes the payer —
   * no cash changes hands. `unattributedAgorot` already excludes it for the
   * same reason (`accounts.ts`). Counting it here as ledger income would make
   * a season's "in" total exceed every shekel it actually received, by
   * exactly the amount of every offset dues ever get settled with.
   */
  it('excludes a קיזוז offset from ledger income — it moves no cash', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const personId = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [row] = await listSeasonFees(db, season.id);

    await recordOffset(db, {
      entries: [{ dueId: row.dueId!, amount: 1200 }],
      note: 'קיזוז מול חוב הקאמפ ליוסף',
      paidOn: new Date('2026-07-01T00:00:00Z'),
      recordedBy: LEAD,
    });

    await recordEntry(db, {
      occurredOn: new Date('2026-07-02T00:00:00Z'), direction: 'in', amount: 500,
      description: 'תרומה אמיתית', recordedBy: LEAD, seasonId: season.id,
    });

    const totals = await ledgerTotals(db, { seasonId: season.id });
    expect(totals.count).toBe(1);
    expect(totals.inAgorot).toBe(50000);
  });
});

describe('a movement knows where it came from', () => {
  it("carries a promoted entry's source block and row, and leaves a payment's null", async () => {
    // Its own inline season/person/account fixtures — this file's real
    // `beforeEach` is `db = await createTestDb();` alone, with no shared
    // `s26`/`cash`. The brief's snippet assumed fixtures that do not exist.
    const sheetId = await addSheet(db, '2026.xlsx', 'תנועות קופה');
    const blockId = await addBlock(db, sheetId, 'ledger', { top: 1, left: 1 });

    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1500 });
    const personId = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, personId, season.id);
    await issueFlatDues(db, season.id);
    const [row] = await listSeasonFees(db, season.id);
    await recordPayment(db, {
      dueId: row.dueId!, amount: 1500, channel: 'מזומן',
      paidOn: new Date('2026-07-01T00:00:00Z'), recordedBy: LEAD,
    });

    await recordEntry(db, {
      occurredOn: new Date('2026-09-12T00:00:00Z'), direction: 'in', amount: 185,
      description: 'מסיבת גיוס — אוקטובר', seasonId: season.id,
      recordedBy: LEAD, sourceBlockId: blockId, sourceRow: 41,
    });

    const moves = await listMovements(db, { seasonId: season.id });
    const promoted = moves.find((move) => move.source === 'ledger')!;
    expect(promoted.sourceBlockId).toBe(blockId);
    expect(promoted.sourceRow).toBe(41);

    const paid = moves.find((move) => move.source === 'dues')!;
    // `payments` carries no provenance columns, and a dues payment genuinely
    // is a lead typing into a form — null is the true answer, and the screen
    // renders it as `נרשם ידנית`.
    expect(paid.sourceBlockId).toBeNull();
    expect(paid.sourceRow).toBeNull();
  });
});

describe('correcting and removing a movement a lead typed', () => {
  const DAY = new Date('2026-11-02T00:00:00Z');

  async function typed(over: Partial<Parameters<typeof recordEntry>[1]> = {}): Promise<string> {
    return recordEntry(db, {
      occurredOn: DAY, direction: 'out', amount: 1345,
      description: 'החזר לאורי — חוב כללי', recordedBy: LEAD, ...over,
    });
  }

  async function stored(id: string) {
    const rows = await db.select().from(ledgerEntries);
    return rows.find((row) => row.id === id);
  }

  it('rewrites every field the form sends, and leaves who recorded it alone', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const account = await createAccount(db, { name: 'קופת מסיבות', kind: 'event_float' });
    const lineId = await createBudgetLine(db, {
      seasonId: season.id, label: 'קרח', total: 1140, category: 'camp',
    });
    const id = await typed();

    await updateEntry(db, id, {
      occurredOn: new Date('2026-11-05T00:00:00Z'), direction: 'in', amount: 1300.5,
      description: 'החזר לאורי מור — חוב כללי',
      accountId: account.id, seasonId: season.id, budgetLineId: lineId,
    });

    const row = (await stored(id))!;
    expect(row.occurredOn).toEqual(new Date('2026-11-05T00:00:00Z'));
    expect(row.direction).toBe('in');
    expect(row.amount).toBe('1300.50');
    expect(row.description).toBe('החזר לאורי מור — חוב כללי');
    expect(row.accountId).toBe(account.id);
    expect(row.seasonId).toBe(season.id);
    expect(row.budgetLineId).toBe(lineId);
    expect(row.recordedBy).toBe(LEAD);
  });

  it('reads an omitted account, season and budget line as none, not as unchanged', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const account = await createAccount(db, { name: 'קופת מסיבות', kind: 'event_float' });
    const id = await typed({ accountId: account.id, seasonId: season.id });

    await updateEntry(db, id, {
      occurredOn: DAY, direction: 'out', amount: 1345, description: 'החזר לאורי — חוב כללי',
    });

    const row = (await stored(id))!;
    expect(row.accountId).toBeNull();
    expect(row.seasonId).toBeNull();
    expect(row.budgetLineId).toBeNull();
  });

  /** The oracle is the balance the account card shows, not the row itself. */
  it('moves the account balance by exactly the correction, and by the whole amount on removal', async () => {
    const account = await createAccount(db, {
      name: 'קופת מסיבות', kind: 'event_float', openingBalance: 19042,
      openingOn: new Date('2026-09-27T00:00:00Z'),
    });
    const id = await typed({ accountId: account.id });
    const balance = async () =>
      (await accountBalances(db)).find((one) => one.accountId === account.id)!.balanceAgorot;
    expect(await balance()).toBe(1904200 - 134500);

    await updateEntry(db, id, {
      occurredOn: DAY, direction: 'out', amount: 1000,
      description: 'החזר לאורי — חוב כללי', accountId: account.id,
    });
    expect(await balance()).toBe(1904200 - 100000);

    await deleteEntry(db, id);
    expect(await balance()).toBe(1904200);
    expect(await stored(id)).toBeUndefined();
  });

  it('keeps the two refusals a new movement has', async () => {
    const id = await typed();
    const base = { occurredOn: DAY, direction: 'out' as const, description: 'החזר' };
    await expect(updateEntry(db, id, { ...base, amount: 0 }))
      .rejects.toThrow('סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן');
    await expect(updateEntry(db, id, { ...base, amount: 10, description: '\u200f' }))
      .rejects.toThrow('לתנועה חייב להיות תיאור');
    await expect(updateEntry(db, id, { ...base, amount: 10, occurredOn: new Date('') }))
      .rejects.toThrow(ENTRY_REFUSALS.noDate);
    expect((await stored(id))!.amount).toBe('1345.00');
  });

  it('refuses a movement that is no longer there', async () => {
    const gone = '00000000-0000-4000-8000-000000000000';
    await expect(deleteEntry(db, gone)).rejects.toThrow(ENTRY_REFUSALS.missing);
    await expect(updateEntry(db, gone, {
      occurredOn: DAY, direction: 'out', amount: 1, description: 'x',
    })).rejects.toThrow(ENTRY_REFUSALS.missing);
  });

  /** `promote` upserts on the source key: an edit would be overwritten and a
   *  delete undone by the next import. */
  it('refuses a row read from a sheet, both ways, and leaves it as it was', async () => {
    const sheetId = await addSheet(db, '2026.xlsx', 'סיכום כללי');
    const blockId = await addBlock(db, sheetId, 'ledger');
    const id = await typed({ sourceBlockId: blockId, sourceRow: 14 });

    await expect(deleteEntry(db, id)).rejects.toThrow(ENTRY_REFUSALS.fromSheet);
    await expect(updateEntry(db, id, {
      occurredOn: DAY, direction: 'out', amount: 1, description: 'אחר',
    })).rejects.toThrow(ENTRY_REFUSALS.fromSheet);
    expect((await stored(id))!.description).toBe('החזר לאורי — חוב כללי');
  });

  it('refuses one leg of a transfer, both ways', async () => {
    const from = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    const to = await createAccount(db, { name: 'קופת מסיבות', kind: 'event_float' });
    const [out] = await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 500, occurredOn: DAY,
      description: 'העברה', recordedBy: LEAD,
    });
    await expect(deleteEntry(db, out)).rejects.toThrow(ENTRY_REFUSALS.transferDelete);
    await expect(updateEntry(db, out, {
      occurredOn: DAY, direction: 'out', amount: 400, description: 'העברה',
    })).rejects.toThrow(ENTRY_REFUSALS.transferEdit);
    expect((await listMovements(db)).length).toBe(2);
  });

  it('refuses a party line, which its own page keeps', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const partyId = await createParty(db, {
      seasonId: season.id, name: 'מסיבת פקאנים', heldOn: new Date('2026-07-18T00:00:00Z'),
    });
    const id = await recordPartyMovement(db, {
      eventId: partyId, part: 'bar', amount: 900, occurredOn: DAY, recordedBy: LEAD,
    });
    await expect(deleteEntry(db, id)).rejects.toThrow(ENTRY_REFUSALS.party);
    await expect(updateEntry(db, id, {
      occurredOn: DAY, direction: 'in', amount: 800, description: 'בר',
    })).rejects.toThrow(ENTRY_REFUSALS.party);
  });

  describe('a movement that closes a debt', () => {
    async function closing() {
      const personId = await createPerson(db, 'יוסף כהן', LEAD);
      const debtId = await createObligation(db, {
        direction: 'camp_owes', partyPersonId: personId, description: 'חוב יוסף',
        amount: 910, openedOn: null,
      });
      const id = await typed({ amount: 910, description: 'סגירת חוב — יוסף כהן' });
      await settleObligation(db, {
        obligationId: debtId, amount: 910, kind: 'cash', ledgerEntryId: id,
        settledOn: DAY, recordedBy: LEAD,
      });
      return { id, debtId };
    }

    it('cannot be removed, and the debt stays closed', async () => {
      const { id, debtId } = await closing();
      await expect(deleteEntry(db, id)).rejects.toThrow(ENTRY_REFUSALS.settlesDelete);
      expect(await stored(id)).toBeDefined();
      const debt = (await listObligations(db)).find((one) => one.id === debtId)!;
      expect(debt.outstandingAgorot).toBe(0);
    });

    it('keeps its amount and its direction', async () => {
      const { id } = await closing();
      const same = { occurredOn: DAY, description: 'סגירת חוב — יוסף כהן' };
      await expect(updateEntry(db, id, { ...same, direction: 'out', amount: 900 }))
        .rejects.toThrow(ENTRY_REFUSALS.settlesEdit);
      await expect(updateEntry(db, id, { ...same, direction: 'in', amount: 910 }))
        .rejects.toThrow(ENTRY_REFUSALS.settlesEdit);
      expect((await stored(id))!.amount).toBe('910.00');
    });

    it('may still have its date, description and account corrected', async () => {
      const { id } = await closing();
      const account = await createAccount(db, { name: 'קופת מסיבות', kind: 'event_float' });
      await updateEntry(db, id, {
        occurredOn: new Date('2026-11-03T00:00:00Z'), direction: 'out', amount: 910,
        description: 'סגירת חוב — יוסף', accountId: account.id,
      });
      const row = (await stored(id))!;
      expect(row.description).toBe('סגירת חוב — יוסף');
      expect(row.accountId).toBe(account.id);
    });
  });

  it('refuses an account or a budget line that does not exist', async () => {
    const id = await typed();
    const nowhere = '00000000-0000-4000-8000-000000000000';
    const base = {
      occurredOn: DAY, direction: 'out' as const, amount: 1345, description: 'החזר',
    };
    await expect(updateEntry(db, id, { ...base, accountId: nowhere }))
      .rejects.toThrow(ENTRY_REFUSALS.noAccount);
    await expect(updateEntry(db, id, { ...base, budgetLineId: nowhere }))
      .rejects.toThrow(ENTRY_REFUSALS.noBudgetLine);
  });

  it('refuses a budget line of another year, or of a year the movement does not name', async () => {
    const last = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const now = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const lastLine = await createBudgetLine(db, {
      seasonId: last.id, label: 'קרח', total: 1140, category: 'camp',
    });
    const id = await typed({ seasonId: now.id });
    const base = {
      occurredOn: DAY, direction: 'out' as const, amount: 1345, description: 'החזר',
    };
    await expect(updateEntry(db, id, { ...base, seasonId: now.id, budgetLineId: lastLine }))
      .rejects.toThrow(ENTRY_REFUSALS.budgetSeason);
    await expect(updateEntry(db, id, { ...base, budgetLineId: lastLine }))
      .rejects.toThrow(ENTRY_REFUSALS.budgetSeason);
    expect((await stored(id))!.budgetLineId).toBeNull();
  });

  /** The row's controls and the library read one rule. This pins the flag the
   *  screen shows to what the library then allows. */
  it('marks as editable exactly the rows it would let through', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const from = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    const to = await createAccount(db, { name: 'קופת מסיבות', kind: 'event_float' });
    const sheetId = await addSheet(db, '2026.xlsx', 'סיכום כללי');
    const blockId = await addBlock(db, sheetId, 'ledger');
    const partyId = await createParty(db, {
      seasonId: season.id, name: 'מסיבת פקאנים', heldOn: new Date('2026-07-18T00:00:00Z'),
    });

    const hand = await typed({ description: 'ביד' });
    await typed({ description: 'מגיליון', sourceBlockId: blockId, sourceRow: 3 });
    await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 500, occurredOn: DAY,
      description: 'העברה', recordedBy: LEAD,
    });
    await recordPartyMovement(db, {
      eventId: partyId, part: 'bar', amount: 900, occurredOn: DAY, recordedBy: LEAD,
    });

    const rows = await listLedgerRows(db);
    expect(rows.length).toBe(5);
    expect(rows.filter((row) => row.editable).map((row) => row.id)).toEqual([hand]);
    for (const row of rows.filter((one) => !one.editable)) {
      await expect(deleteEntry(db, row.id)).rejects.toThrow();
    }
    expect((await listLedgerRows(db)).length).toBe(5);
  });
});
