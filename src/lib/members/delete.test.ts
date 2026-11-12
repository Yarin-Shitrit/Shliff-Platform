import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import {
  persons, personAliases, seasons, memberships, dues, payments, tasks, taskAssignments,
} from '@/db/schema/camp';
import { accounts, obligations } from '@/db/schema/money';
import { acquisitionItems, workItems } from '@/db/schema/logistics';
import { recordUnlinkedName, listUnlinkedNames, resolveName } from '@/lib/members/identity';
import { createPerson, linkAlias, mergePersons } from '@/lib/members/link';
import { deletePerson, previewDelete } from '@/lib/members/delete';

const LEAD = 'lead@shliff.camp';

async function season(db: TestDb, name = 'ברן 26', year = 2026): Promise<string> {
  const [row] = await db.insert(seasons).values({ name, year, flatRate: '1200.00' }).returning();
  return row.id;
}

describe('deleting a person', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('removes a hand-made record with its spelling, its memberships and its unpaid due', async () => {
    const seasonId = await season(db);
    const id = await createPerson(db, 'בדיקה', LEAD);
    await db.insert(memberships).values({ personId: id, seasonId });
    await db.insert(dues).values({ personId: id, seasonId, amount: '1200.00' });

    const result = await deletePerson(db, id);
    expect(result).toEqual({
      ok: true, removed: { aliases: 1, requeued: 0, memberships: 1, dues: 1 },
    });

    expect(await db.select().from(persons).where(eq(persons.id, id))).toEqual([]);
    expect(await db.select().from(personAliases)).toEqual([]);
    expect(await db.select().from(memberships)).toEqual([]);
    expect(await db.select().from(dues)).toEqual([]);
    expect((await resolveName(db, 'בדיקה')).candidates).toEqual([]);
  });

  /*
   * A workbook spelling is evidence of what the files say, and the next
   * import would only queue it again. So it is not deleted with the record:
   * it goes back to the queue, cleared of the confirmation that pointed here.
   */
  it('returns a workbook spelling to the queue instead of deleting it', async () => {
    const id = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, id, LEAD);

    const result = await deletePerson(db, id);
    expect(result).toEqual({
      ok: true, removed: { aliases: 1, requeued: 1, memberships: 0, dues: 0 },
    });

    const queue = await listUnlinkedNames(db);
    expect(queue.map((row) => row.alias)).toEqual(['אופק כהן']);
    const [alias] = await db.select().from(personAliases).where(eq(personAliases.id, aliasId));
    expect(alias.personId).toBeNull();
    expect(alias.confirmedBy).toBeNull();
    expect(alias.confirmedAt).toBeNull();
  });

  it('previews exactly what would go, split by where each spelling came from', async () => {
    const s25 = await season(db, 'ברן 25', 2025);
    const s26 = await season(db);
    const id = await createPerson(db, 'רוני', LEAD);
    const aliasId = await recordUnlinkedName(db, 'רוני אדלר', 'import');
    await linkAlias(db, aliasId, id, LEAD);
    await db.insert(memberships).values([{ personId: id, seasonId: s26 }, { personId: id, seasonId: s25 }]);
    await db.insert(dues).values({ personId: id, seasonId: s26, amount: '1200.00' });

    expect(await previewDelete(db, id)).toEqual({
      personId: id,
      displayName: 'רוני',
      manualAliases: ['רוני'],
      importAliases: ['רוני אדלר'],
      seasons: ['ברן 25', 'ברן 26'],
      duesCount: 1,
      blockers: [],
    });
  });

  it('previews nothing for an id that names nobody, or is not an id at all', async () => {
    expect(await previewDelete(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await previewDelete(db, 'not-an-id')).toBeNull();
    expect(await deletePerson(db, 'not-an-id')).toEqual({ ok: false, reason: 'not-found' });
  });

  describe('refuses, and names why, when', () => {
    async function expectBlocked(id: string, conflict: string, count: number, href: string | null) {
      const preview = await previewDelete(db, id);
      expect(preview?.blockers).toEqual([{ conflict, count, href }]);

      const result = await deletePerson(db, id);
      expect(result).toEqual({ ok: false, reason: 'blocked', blockers: [{ conflict, count, href }] });
      expect(await db.select().from(persons).where(eq(persons.id, id))).toHaveLength(1);
    }

    it('a payment was recorded against one of their dues', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      const [due] = await db.insert(dues).values({ personId: id, seasonId, amount: '1200.00' }).returning();
      await db.insert(payments).values([
        { dueId: due.id, amount: '500.00', channel: 'ביט', paidOn: new Date('2026-05-01'), recordedBy: LEAD },
        { dueId: due.id, amount: '700.00', channel: 'מזומן', paidOn: new Date('2026-06-01'), recordedBy: LEAD },
      ]);
      await expectBlocked(id, 'תשלומים', 2, `/members/${id}?tab=payments`);
      // The payments survive the refusal, to the row.
      expect(await db.select().from(payments)).toHaveLength(2);
    });

    it('they are placed on a task', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      const [task] = await db.insert(tasks).values({ seasonId, kind: 'shift', title: 'משמרת בר' }).returning();
      await db.insert(taskAssignments).values({ taskId: task.id, personId: id, assignedBy: LEAD });
      await expectBlocked(id, 'שיבוץ למשימה', 1, `/members/${id}?tab=tasks`);
    });

    it('a debt names them', async () => {
      const id = await createPerson(db, 'יוסף', LEAD);
      await db.insert(obligations).values({
        direction: 'camp_owes', partyPersonId: id, description: 'מקרר', amount: '15240.00',
      });
      await expectBlocked(id, 'חובות', 1, '/money/debts');
    });

    it('they hold a קופה', async () => {
      const id = await createPerson(db, 'יוסף', LEAD);
      await db.insert(accounts).values({ name: 'ביט של יוסף', kind: 'personal', holderPersonId: id });
      await expectBlocked(id, 'קופה', 1, '/money');
    });

    it('they absorbed somebody in a merge, with nowhere to send the lead', async () => {
      const survivor = await createPerson(db, 'אופק כהן', LEAD);
      const absorbed = await createPerson(db, 'אופק', LEAD);
      expect((await mergePersons(db, absorbed, survivor, LEAD)).ok).toBe(true);
      await expectBlocked(survivor, 'מיזוג קודם', 1, null);
    });

    it('they were merged into somebody else, pointing at where they now live', async () => {
      const survivor = await createPerson(db, 'אופק כהן', LEAD);
      const absorbed = await createPerson(db, 'אופק', LEAD);
      expect((await mergePersons(db, absorbed, survivor, LEAD)).ok).toBe(true);
      await expectBlocked(absorbed, 'רשומה ממוזגת', 1, `/members/${survivor}`);
    });

    it('they are responsible for, or lending, something being acquired', async () => {
      const id = await createPerson(db, 'רוני', LEAD);
      await db.insert(acquisitionItems).values([
        { name: 'גנרטור', assigneePersonId: id },
        { name: 'מקרר', source: 'borrow_member', lenderPersonId: id },
      ]);
      await expectBlocked(id, 'פריטי רכש', 2, '/logistics/acquisitions');
    });

    it('they are responsible for a line on the work plan', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      await db.insert(workItems).values({ seasonId, title: 'הקמת הסלון', assigneePersonId: id });
      await expectBlocked(id, 'לוח עבודה', 1, '/logistics/plan');
    });

    it('lists every blocker at once, in reading order', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      const [due] = await db.insert(dues).values({ personId: id, seasonId, amount: '1200.00' }).returning();
      await db.insert(payments).values({
        dueId: due.id, amount: '500.00', channel: 'ביט', paidOn: new Date('2026-05-01'), recordedBy: LEAD,
      });
      await db.insert(accounts).values({ name: 'ביט של רוני', kind: 'personal', holderPersonId: id });

      const preview = await previewDelete(db, id);
      expect(preview?.blockers.map((blocker) => blocker.conflict)).toEqual(['תשלומים', 'קופה']);
    });
  });
});
