import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import {
  persons, personAliases, seasons, memberships, dues, payments, tasks, taskAssignments,
} from '@/db/schema/camp';
import { accounts, obligations, obligationSettlements } from '@/db/schema/money';
import { acquisitionItems, workItems } from '@/db/schema/logistics';
import { recordUnlinkedName, listUnlinkedNames, resolveName } from '@/lib/members/identity';
import { createPerson, linkAlias, mergePersons } from '@/lib/members/link';
import { deletePerson, previewDelete } from '@/lib/members/delete';

const LEAD = 'lead@shliff.camp';

async function season(
  db: TestDb, name = 'ברן 26', year = 2026, startsOn: Date | null = null,
): Promise<string> {
  const [row] = await db.insert(seasons).values({ name, year, flatRate: '1200.00', startsOn }).returning();
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

  describe('refuses, names why, and says what to do, when', () => {
    /**
     * Each refusal is checked three ways: the noun, the count and the way
     * in (`href`, `items`), and that the delete itself refuses with the same
     * list. The instruction (`action`) is prose and is checked for the
     * control it names, not quoted whole.
     */
    async function expectBlocked(
      id: string, conflict: string, count: number, href: string | null,
      items: Array<{ label: string; href: string | null }>, mentions: string,
    ) {
      const preview = await previewDelete(db, id);
      expect(preview?.blockers.map((b) => ({ conflict: b.conflict, count: b.count, href: b.href, items: b.items })))
        .toEqual([{ conflict, count, href, items }]);
      expect(preview?.blockers[0].action).toContain(mentions);

      const result = await deletePerson(db, id);
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === 'blocked') {
        expect(result.blockers.map((b) => b.conflict)).toEqual([conflict]);
      } else {
        throw new Error(`expected a blocked refusal, got ${JSON.stringify(result)}`);
      }
      expect(await db.select().from(persons).where(eq(persons.id, id))).toHaveLength(1);
    }

    it('a payment was recorded against one of their dues, linking each to the payment drawer of its season', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      await db.insert(memberships).values({ personId: id, seasonId });
      const [due] = await db.insert(dues).values({ personId: id, seasonId, amount: '1200.00' }).returning();
      await db.insert(payments).values([
        { dueId: due.id, amount: '500.00', channel: 'ביט', paidOn: new Date('2026-05-01T09:00:00Z'), recordedBy: LEAD },
        { dueId: due.id, amount: '700.50', channel: 'מזומן', paidOn: new Date('2026-06-01T09:00:00Z'), recordedBy: LEAD },
      ]);
      const drawer = `/fees?season=${seasonId}&peek=${id}&act=pay`;
      await expectBlocked(id, 'תשלומים', 2, drawer, [
        { label: 'ברן 26 · 500 ₪ · ביט · 01/05/26', href: drawer },
        { label: 'ברן 26 · 700.50 ₪ · מזומן · 01/06/26', href: drawer },
      ], 'הסרה');
      // The payments survive the refusal, to the row.
      expect(await db.select().from(payments)).toHaveLength(2);
    });

    it('a payment in a season they are no longer listed in has no drawer to open, and the step says to list them first', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      const [due] = await db.insert(dues).values({ personId: id, seasonId, amount: '1200.00' }).returning();
      await db.insert(payments).values({
        dueId: due.id, amount: '500.00', channel: 'ביט', paidOn: new Date('2026-05-01T09:00:00Z'), recordedBy: LEAD,
      });
      await expectBlocked(id, 'תשלומים', 1, null, [
        { label: 'ברן 26 · 500 ₪ · ביט · 01/05/26 · לא ברשימת ברן 26', href: null },
      ], 'הוספה לשנה');
    });

    it('they are placed on a task — the board for a task, the shift drawer for a scheduled shift', async () => {
      const seasonId = await season(db, 'ברן 26', 2026, new Date('2026-05-01T00:00:00Z'));
      const id = await createPerson(db, 'רוני', LEAD);
      const [shift] = await db.insert(tasks).values({
        seasonId, kind: 'shift', title: 'משמרת בר',
        startsAt: new Date('2026-05-01T18:00:00Z'), endsAt: new Date('2026-05-01T22:00:00Z'),
      }).returning();
      const [build] = await db.insert(tasks).values({ seasonId, kind: 'build', title: 'הקמת הצל', status: 'done' }).returning();
      await db.insert(taskAssignments).values([
        { taskId: shift.id, personId: id, assignedBy: LEAD },
        { taskId: build.id, personId: id, assignedBy: LEAD, status: 'dropped' },
      ]);
      await expectBlocked(id, 'שיבוץ למשימה', 2, `/tasks?season=${seasonId}`, [
        { label: 'הקמת הצל · ברן 26 · שיבוץ שבוטל · משימה שבוצעה', href: `/tasks?season=${seasonId}` },
        { label: 'משמרת בר · ברן 26', href: `/logistics/shifts?season=${seasonId}&peek=${shift.id}` },
      ], 'הסרת השיבוץ');
    });

    it('sends a shift to the board while its season has no gate date, since the schedule has nothing to open', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      const [shift] = await db.insert(tasks).values({
        seasonId, kind: 'shift', title: 'משמרת בר',
        startsAt: new Date('2026-05-01T18:00:00Z'), endsAt: new Date('2026-05-01T22:00:00Z'),
      }).returning();
      await db.insert(taskAssignments).values({ taskId: shift.id, personId: id, assignedBy: LEAD });
      await expectBlocked(id, 'שיבוץ למשימה', 1, `/tasks?season=${seasonId}`, [
        { label: 'משמרת בר · ברן 26', href: `/tasks?season=${seasonId}` },
      ], 'הסרת השיבוץ');
    });

    it('a debt names them, linking each to its drawer and a settled one to the settled view', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'יוסף', LEAD);
      const [open] = await db.insert(obligations).values({
        direction: 'camp_owes', partyPersonId: id, description: 'מקרר', amount: '15240.00',
        seasonId, openedOn: new Date('2026-01-01T00:00:00Z'),
      }).returning();
      const [closed] = await db.insert(obligations).values({
        direction: 'owed_to_camp', partyPersonId: id, description: 'מקדמה', amount: '100.00',
        openedOn: new Date('2026-02-01T00:00:00Z'),
      }).returning();
      await db.insert(obligationSettlements).values({
        obligationId: closed.id, amount: '100.00', kind: 'cash', settledOn: new Date(), recordedBy: LEAD,
      });
      await expectBlocked(id, 'חובות', 2, `/money/debts?season=${seasonId}&peek=${open.id}`, [
        { label: 'מקרר · 15,240 ₪', href: `/money/debts?season=${seasonId}&peek=${open.id}` },
        { label: 'מקדמה · 100 ₪ · נסגר', href: `/money/debts?peek=${closed.id}&view=settled` },
      ], 'ניתוק מהאדם');
    });

    it('they hold a קופה, linking to its holder drawer', async () => {
      const id = await createPerson(db, 'יוסף', LEAD);
      const [account] = await db.insert(accounts).values({ name: 'ביט של יוסף', kind: 'personal', holderPersonId: id }).returning();
      await expectBlocked(id, 'קופה', 1, `/money?act=holder&account=${account.id}`, [
        { label: 'ביט של יוסף', href: `/money?act=holder&account=${account.id}` },
      ], 'מי מחזיק/ה');
    });

    it('they absorbed somebody in a merge, linking to that record with the unmerge open', async () => {
      const survivor = await createPerson(db, 'אופק כהן', LEAD);
      const absorbed = await createPerson(db, 'אופק', LEAD);
      expect((await mergePersons(db, absorbed, survivor, LEAD)).ok).toBe(true);
      await expectBlocked(survivor, 'מיזוג קודם', 1, `/members/${absorbed}?unmerge=1`, [
        { label: 'אופק', href: `/members/${absorbed}?unmerge=1` },
      ], 'ביטול המיזוג');
    });

    it('they were merged into somebody else: the unmerge is here, the survivor is a link', async () => {
      const survivor = await createPerson(db, 'אופק כהן', LEAD);
      const absorbed = await createPerson(db, 'אופק', LEAD);
      expect((await mergePersons(db, absorbed, survivor, LEAD)).ok).toBe(true);
      await expectBlocked(absorbed, 'רשומה ממוזגת', 1, `/members/${absorbed}?unmerge=1`, [
        { label: 'מוזגה לתוך אופק כהן', href: `/members/${survivor}` },
      ], 'ביטול המיזוג');
    });

    it('they are responsible for, or lending, something being acquired, linking each to its drawer with its season', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      const [generator] = await db.insert(acquisitionItems).values({ name: 'גנרטור', assigneePersonId: id, seasonId }).returning();
      const [fridge] = await db.insert(acquisitionItems).values({ name: 'מקרר', source: 'borrow_member', lenderPersonId: id }).returning();
      await expectBlocked(id, 'פריטי רכש', 2, `/logistics/acquisitions?season=${seasonId}&peek=${generator.id}`, [
        { label: 'גנרטור · אחראי/ת', href: `/logistics/acquisitions?season=${seasonId}&peek=${generator.id}` },
        { label: 'מקרר · משאיל/ה', href: `/logistics/acquisitions?peek=${fridge.id}` },
      ], 'מי אחראי להשיג');
    });

    it('they are responsible for a line on the work plan; a line that follows a purchase links to the purchase', async () => {
      const seasonId = await season(db);
      const id = await createPerson(db, 'רוני', LEAD);
      const [line] = await db.insert(workItems).values({ seasonId, title: 'הקמת הסלון', assigneePersonId: id }).returning();
      const [purchase] = await db.insert(acquisitionItems).values({ name: 'כבל', assigneePersonId: id, seasonId }).returning();
      await db.insert(workItems).values({ seasonId, title: 'לקנות כבל', assigneePersonId: id, acquisitionItemId: purchase.id });
      const preview = await previewDelete(db, id);
      expect(preview?.blockers.map((b) => b.conflict)).toEqual(['פריטי רכש', 'לוח עבודה']);
      expect(preview?.blockers[1]).toMatchObject({
        count: 2,
        href: `/logistics/plan?season=${seasonId}&peek=${line.id}`,
        items: [
          { label: 'הקמת הסלון', href: `/logistics/plan?season=${seasonId}&peek=${line.id}` },
          { label: 'לקנות כבל · עוקב אחרי פריט ברכש', href: `/logistics/acquisitions?season=${seasonId}&peek=${purchase.id}` },
        ],
      });
      expect(preview?.blockers[1].action).toContain('עדיין לא נקבע');
      expect(preview?.blockers[1].action).toContain('ברשימת הרכש');
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
