import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createEvent } from '@/lib/work/events';
import { ledgerEntries, obligations, obligationSettlements } from '@/db/schema/money';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { createAccount } from './accounts';
import { recordEntry, listMovements } from './ledger';
import {
  createParty, updateParty, recordPartyMovement, deletePartyMovement,
  listParties, partyDetail,
} from './parties';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

const LEAD = 'lead@example.com';
const DAY = new Date('2026-07-18');

async function season(name = 'ברן 26', year = 2026): Promise<string> {
  const row = await createSeason(db, { name, year, flatRate: 1200, plannedSize: 35 });
  return row.id;
}

describe('createParty', () => {
  it('makes a fundraiser event with its date and partner', async () => {
    const s = await season();
    const id = await createParty(db, {
      seasonId: s, name: 'SuperNature', heldOn: DAY, partnerName: ' וייבז ',
    });
    const detail = await partyDetail(db, id);
    expect(detail?.name).toBe('SuperNature');
    expect(detail?.heldOn).toEqual(DAY);
    expect(detail?.partnerName).toBe('וייבז');
  });

  it('stores a blank partner as none — the camp made it alone', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY, partnerName: '  ' });
    expect((await partyDetail(db, id))?.partnerName).toBeNull();
  });

  it('refuses a party with no name or no date', async () => {
    const s = await season();
    await expect(createParty(db, { seasonId: s, name: ' ', heldOn: DAY }))
      .rejects.toThrow('למסיבה חייב להיות שם');
    await expect(createParty(db, { seasonId: s, name: 'x', heldOn: new Date('nope') }))
      .rejects.toThrow('למסיבה חייב להיות תאריך');
  });
});

describe('recordPartyMovement', () => {
  it('records tickets and bar as money in, and a cost as money out, in the party\'s season', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await recordPartyMovement(db, { eventId: id, part: 'tickets', amount: 5000, occurredOn: DAY, recordedBy: LEAD });
    await recordPartyMovement(db, { eventId: id, part: 'bar', amount: 2000, occurredOn: DAY, recordedBy: LEAD });
    await recordPartyMovement(db, {
      eventId: id, part: 'cost', amount: 3000, occurredOn: DAY, description: 'סאונד', recordedBy: LEAD,
    });

    const moves = await listMovements(db, { eventId: id });
    expect(moves.map((m) => [m.direction, m.amountAgorot, m.seasonId])).toEqual([
      ['in', 500000, s], ['in', 200000, s], ['out', 300000, s],
    ]);
  });

  it('names a ticket or bar row after the party when no description is given', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await recordPartyMovement(db, { eventId: id, part: 'bar', amount: 10, occurredOn: DAY, recordedBy: LEAD });
    expect((await partyDetail(db, id))?.movements[0].description).toBe('בר — פקאנים');
  });

  it('refuses a cost with no description', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await expect(recordPartyMovement(db, {
      eventId: id, part: 'cost', amount: 10, occurredOn: DAY, description: ' ', recordedBy: LEAD,
    })).rejects.toThrow('להוצאה חייב להיות תיאור');
  });

  it('refuses a direction that contradicts the part, rather than flipping it', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await expect(recordPartyMovement(db, {
      eventId: id, part: 'tickets', direction: 'out', amount: 10, occurredOn: DAY, recordedBy: LEAD,
    })).rejects.toThrow('כרטיסים הם תמיד כסף שנכנס');
    await expect(recordPartyMovement(db, {
      eventId: id, part: 'cost', direction: 'in', amount: 10, occurredOn: DAY, description: 'x', recordedBy: LEAD,
    })).rejects.toThrow('הוצאה היא תמיד כסף שיצא');
  });

  it('refuses a movement with no date, before it reaches the database', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await expect(recordPartyMovement(db, {
      eventId: id, part: 'bar', amount: 10, occurredOn: new Date(''), recordedBy: LEAD,
    })).rejects.toThrow('לתנועה חייב להיות תאריך');
  });

  it('refuses a partner movement on a party the camp made alone', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await expect(recordPartyMovement(db, {
      eventId: id, part: 'partner', direction: 'out', amount: 10, occurredOn: DAY, recordedBy: LEAD,
    })).rejects.toThrow('למסיבה הזו לא רשום קאמפ שותף');
  });

  it('requires a partner movement to say which way the money went', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'SN', heldOn: DAY, partnerName: 'וייבז' });
    await expect(recordPartyMovement(db, {
      eventId: id, part: 'partner', amount: 10, occurredOn: DAY, recordedBy: LEAD,
    })).rejects.toThrow('צריך לבחור');
  });

  it('refuses the burn, which is an event but not a party', async () => {
    const s = await season();
    const burn = await createEvent(db, { seasonId: s, name: 'ברן', kind: 'burn' });
    await expect(recordPartyMovement(db, {
      eventId: burn.id, part: 'tickets', amount: 10, occurredOn: DAY, recordedBy: LEAD,
    })).rejects.toThrow('אין מסיבה כזו');
  });

  it('keeps the account it was given, and none when none was given', async () => {
    const s = await season();
    const cash = await createAccount(db, { name: 'קופה', kind: 'cash' });
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await recordPartyMovement(db, {
      eventId: id, part: 'bar', amount: 10, occurredOn: DAY, accountId: cash.id, recordedBy: LEAD,
    });
    await recordPartyMovement(db, { eventId: id, part: 'bar', amount: 10, occurredOn: DAY, recordedBy: LEAD });
    expect((await partyDetail(db, id))?.movements.map((m) => m.accountName)).toEqual(['קופה', null]);
  });
});

describe('party totals', () => {
  it('splits a shared party into tickets, bar, costs and what passed to the partner', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'SN', heldOn: DAY, partnerName: 'וייבז' });
    const base = { eventId: id, occurredOn: DAY, recordedBy: LEAD };
    await recordPartyMovement(db, { ...base, part: 'tickets', amount: 10000 });
    await recordPartyMovement(db, { ...base, part: 'bar', amount: 4000.5 });
    await recordPartyMovement(db, { ...base, part: 'cost', amount: 6000, description: 'DJ' });
    await recordPartyMovement(db, { ...base, part: 'partner', direction: 'out', amount: 4000 });
    await recordPartyMovement(db, { ...base, part: 'partner', direction: 'in', amount: 500 });

    const detail = (await partyDetail(db, id))!;
    expect(detail).toMatchObject({
      ticketsAgorot: 1000000,
      barAgorot: 400050,
      costAgorot: 600000,
      partnerOutAgorot: 400000,
      partnerInAgorot: 50000,
      unsortedInAgorot: 0,
      unsortedOutAgorot: 0,
      netAgorot: 1000000 + 400050 - 600000 - 400000 + 50000,
      count: 5,
    });
  });

  /**
   * A row carrying the event but no part is what an import or an older write
   * leaves. It is still the party's money, so it moves the net — but it is
   * never folded into tickets or costs on the strength of its direction.
   */
  it('counts an unsorted row in the net and nowhere else', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'פקאנים', heldOn: DAY });
    await recordEntry(db, {
      occurredOn: DAY, direction: 'in', amount: 300, description: 'משהו', eventId: id, recordedBy: LEAD,
    });
    const detail = (await partyDetail(db, id))!;
    expect(detail.ticketsAgorot).toBe(0);
    expect(detail.unsortedInAgorot).toBe(30000);
    expect(detail.netAgorot).toBe(30000);
    expect(detail.movements[0].part).toBeNull();
  });

  it('lists every party across years, newest year first, without the burn', async () => {
    const s25 = await season('ברן 25', 2025);
    const s26 = await season('ברן 26', 2026);
    await createParty(db, { seasonId: s25, name: 'House of trance', heldOn: new Date('2025-09-27') });
    const early = await createParty(db, { seasonId: s26, name: 'פקאנים', heldOn: new Date('2026-03-01') });
    const late = await createParty(db, { seasonId: s26, name: 'SN', heldOn: new Date('2026-07-18') });
    await createEvent(db, { seasonId: s26, name: 'ברן', kind: 'burn' });
    // A seeded party with no date yet.
    await createEvent(db, { seasonId: s26, name: 'בלי תאריך', kind: 'fundraiser' });
    await recordPartyMovement(db, { eventId: early, part: 'tickets', amount: 100, occurredOn: DAY, recordedBy: LEAD });

    const list = await listParties(db);
    expect(list.map((p) => p.name)).toEqual(['SN', 'פקאנים', 'בלי תאריך', 'House of trance']);
    expect(list.find((p) => p.id === early)?.netAgorot).toBe(10000);
    expect(list.find((p) => p.id === late)?.count).toBe(0);
    expect(list.map((p) => p.seasonName)).toEqual(['ברן 26', 'ברן 26', 'ברן 26', 'ברן 25']);
  });

  it('returns nothing for an id that is not a party', async () => {
    const s = await season();
    const burn = await createEvent(db, { seasonId: s, name: 'ברן', kind: 'burn' });
    expect(await partyDetail(db, burn.id)).toBeUndefined();
  });
});

describe('updateParty', () => {
  it('renames, re-dates and sets the partner', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'x', heldOn: DAY });
    await updateParty(db, id, { name: 'SuperNature', heldOn: new Date('2026-10-03'), partnerName: 'וייבז' });
    expect(await partyDetail(db, id)).toMatchObject({
      name: 'SuperNature', heldOn: new Date('2026-10-03'), partnerName: 'וייבז',
    });
  });

  it('refuses to drop a partner that money already passed to', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'SN', heldOn: DAY, partnerName: 'וייבז' });
    await recordPartyMovement(db, {
      eventId: id, part: 'partner', direction: 'out', amount: 10, occurredOn: DAY, recordedBy: LEAD,
    });
    await expect(updateParty(db, id, { name: 'SN', heldOn: DAY }))
      .rejects.toThrow('יש התחשבנות רשומה עם הקאמפ השותף');
  });
});

describe('deletePartyMovement', () => {
  it('removes a movement a lead typed', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'x', heldOn: DAY });
    const entry = await recordPartyMovement(db, {
      eventId: id, part: 'bar', amount: 10, occurredOn: DAY, recordedBy: LEAD,
    });
    await deletePartyMovement(db, id, entry);
    expect((await partyDetail(db, id))?.movements).toEqual([]);
  });

  it('refuses a movement of another party', async () => {
    const s = await season();
    const one = await createParty(db, { seasonId: s, name: 'a', heldOn: DAY });
    const two = await createParty(db, { seasonId: s, name: 'b', heldOn: DAY });
    const entry = await recordPartyMovement(db, {
      eventId: one, part: 'bar', amount: 10, occurredOn: DAY, recordedBy: LEAD,
    });
    await expect(deletePartyMovement(db, two, entry)).rejects.toThrow('לא שייכת למסיבה הזו');
  });

  it('refuses a row read off a workbook', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'x', heldOn: DAY });
    const [up] = await db.insert(uploads).values({
      filename: 'f.xlsx', sha256: 'h', storageKey: 'k', sizeBytes: 1, uploadedBy: LEAD, status: 'committed',
    }).returning();
    const [sheet] = await db.insert(sheets).values({
      uploadId: up.id, name: 's', index: 0, rowCount: 1, colCount: 1,
    }).returning();
    const [block] = await db.insert(blocks).values({
      sheetId: sheet.id, top: 1, left: 1, bottom: 1, right: 1, archetype: 'ledger',
      confidence: '1.0000', headerRow: null, fingerprint: null, pipelineVersion: 1, rawGrid: [['x']],
    }).returning();
    const entry = await recordEntry(db, {
      occurredOn: DAY, direction: 'in', amount: 10, description: 'x', eventId: id,
      recordedBy: LEAD, sourceBlockId: block.id, sourceRow: 2,
    });
    await expect(deletePartyMovement(db, id, entry)).rejects.toThrow('נקראה מגיליון');
  });

  it('refuses a movement that settles a debt', async () => {
    const s = await season();
    const id = await createParty(db, { seasonId: s, name: 'x', heldOn: DAY });
    const entry = await recordPartyMovement(db, {
      eventId: id, part: 'cost', amount: 10, occurredOn: DAY, description: 'x', recordedBy: LEAD,
    });
    const [debt] = await db.insert(obligations).values({
      direction: 'camp_owes', description: 'x', amount: '10.00', partyName: 'מישהו',
    }).returning();
    await db.insert(obligationSettlements).values({
      obligationId: debt.id, amount: '10.00', kind: 'cash', ledgerEntryId: entry,
      settledOn: DAY, recordedBy: LEAD,
    });
    await expect(deletePartyMovement(db, id, entry)).rejects.toThrow('סוגרת חוב');
    const still = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, entry));
    expect(still).toHaveLength(1);
  });
});
