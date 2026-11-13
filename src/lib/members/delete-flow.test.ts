import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases } from '@/db/schema/camp';
import { workItems } from '@/db/schema/logistics';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson, mergePersons, unmergePerson, unmergePreview } from '@/lib/members/link';
import { issueFlatDues, listDues } from '@/lib/fees/dues';
import { recordPayment, deletePayment, listPayments } from '@/lib/fees/payments';
import { createTask } from '@/lib/work/tasks';
import { assignPerson, removeAssignment, coverageFor } from '@/lib/work/coverage';
import { createObligation, detachObligationParty, listObligations } from '@/lib/money/obligations';
import { createAccount, setAccountHolder, accountBalances } from '@/lib/money/accounts';
import { createAcquisition, updateAcquisition, acquisitionById, type AcquisitionInput } from '@/lib/logistics/acquisitions';
import { createItem, updateItem } from '@/lib/logistics/plan';
import { deletePerson, previewDelete } from '@/lib/members/delete';

const LEAD = 'lead@shliff.camp';

/**
 * The whole flow, end to end, through the same library calls each screen's
 * control makes: a person who is named everywhere the schema allows, each
 * refusal closed the way the delete drawer says to close it, and the
 * deletion going through once the list is empty.
 *
 * The oracle for "the drawer's instructions are followable" is this file:
 * every step here is the write behind the control the `action` sentence
 * names (`deletePaymentAction` → `deletePayment`, the holder drawer →
 * `setAccountHolder`, and so on). A blocker whose instruction named a
 * control that does not exist would have no line here to close it with.
 */
describe('closing everything, then deleting', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  async function purchase(over: Partial<AcquisitionInput> = {}): Promise<AcquisitionInput> {
    return {
      seasonId: null, name: 'גנרטור', category: 'general', quantityNeeded: 1, source: 'buy_new',
      estimatedCost: null, actualCost: null, assigneePersonId: null, lenderPersonId: null,
      budgetLineId: null, ...over,
    };
  }

  it('walks every blocker down to zero in the order the drawer lists them', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const roni = await createPerson(db, 'רוני אדלר', LEAD);
    const maya = await createPerson(db, 'מאיה פרץ', LEAD);
    const duplicate = await createPerson(db, 'רוני א.', LEAD);
    await addMember(db, roni, season.id);
    await addMember(db, maya, season.id);

    // 1. A payment against a due.
    await issueFlatDues(db, season.id);
    const due = (await listDues(db, season.id)).find((row) => row.personId === roni)!;
    const paymentId = await recordPayment(db, {
      dueId: due.dueId, amount: 500, channel: 'ביט', paidOn: new Date('2026-05-01T09:00:00Z'), recordedBy: LEAD,
    });
    // 2. A shift and a build task.
    const shift = await createTask(db, {
      seasonId: season.id, kind: 'shift', title: 'משמרת בר',
      startsAt: new Date('2026-05-02T18:00:00Z'), endsAt: new Date('2026-05-02T22:00:00Z'),
    });
    const build = await createTask(db, { seasonId: season.id, kind: 'build', title: 'הקמת הצל' });
    const onShift = await assignPerson(db, shift, roni, LEAD);
    const onBuild = await assignPerson(db, build, roni, LEAD);
    // 3. A debt in each direction.
    const owed = await createObligation(db, {
      direction: 'camp_owes', partyPersonId: roni, description: 'מקרר', amount: 15240, seasonId: season.id,
      openedOn: new Date('2026-01-01T00:00:00Z'),
    });
    const owes = await createObligation(db, {
      direction: 'owed_to_camp', partyPersonId: roni, description: 'מקדמה', amount: 100, openedOn: null,
    });
    // 4. A personal account.
    const account = await createAccount(db, { name: 'ביט של רוני', kind: 'personal', holderPersonId: roni });
    // 5. A duplicate record merged into this one.
    expect((await mergePersons(db, duplicate, roni, LEAD)).ok).toBe(true);
    // 6. A purchase they are responsible for (which also makes a line on the
    //    work plan that follows it) and a thing they lend.
    const generator = await createAcquisition(db, await purchase({ seasonId: season.id, assigneePersonId: roni }), LEAD);
    const fridge = await createAcquisition(db, await purchase({
      name: 'מקרר', source: 'borrow_member', lenderPersonId: roni,
    }), LEAD);
    // 7. A line on the work plan of their own.
    const line = await createItem(db, season.id, {
      title: 'הקמת הסלון', notes: null, topicId: null, parentId: null,
      startsOn: null, endsOn: null, assigneePersonId: roni,
    }, LEAD);

    const before = await previewDelete(db, roni);
    expect(before?.blockers.map((b) => [b.conflict, b.count])).toEqual([
      ['תשלומים', 1], ['שיבוץ למשימה', 2], ['חובות', 2], ['קופה', 1], ['מיזוג קודם', 1],
      ['פריטי רכש', 2], ['לוח עבודה', 2],
    ]);
    // Every row has a way in, and every way in names the row's season when it has one.
    for (const blocker of before!.blockers) {
      expect(blocker.items).toHaveLength(blocker.count);
      for (const item of blocker.items) expect(item.href).not.toBeNull();
    }
    expect(await deletePerson(db, roni)).toMatchObject({ ok: false, reason: 'blocked' });

    async function remaining(): Promise<string[]> {
      return (await previewDelete(db, roni))!.blockers.map((b) => `${b.conflict} · ${b.count}`);
    }

    // The payment drawer's הסרה → מחיקת התשלום.
    await deletePayment(db, paymentId);
    expect(await listPayments(db, due.dueId)).toEqual([]);
    expect(await remaining()).toEqual([
      'שיבוץ למשימה · 2', 'חובות · 2', 'קופה · 1', 'מיזוג קודם · 1', 'פריטי רכש · 2', 'לוח עבודה · 2',
    ]);

    // The board's הסרה → הסרת השיבוץ, and the shift drawer's הסרת … מהמשמרת.
    await removeAssignment(db, onShift);
    expect(await remaining()).toContain('שיבוץ למשימה · 1');
    await removeAssignment(db, onBuild);
    expect((await coverageFor(db, season.id)).flatMap((row) => row.assignees)).toEqual([]);
    expect(await remaining()).toEqual(['חובות · 2', 'קופה · 1', 'מיזוג קודם · 1', 'פריטי רכש · 2', 'לוח עבודה · 2']);

    // The debt drawer's ניתוק מהאדם: the debt stays, under the same name.
    expect(await detachObligationParty(db, owed)).toEqual({ partyName: 'רוני אדלר' });
    expect(await detachObligationParty(db, owes)).toEqual({ partyName: 'רוני אדלר' });
    const debts = await listObligations(db);
    expect(debts.map((row) => [row.displayParty, row.partyPersonId, row.amountAgorot])).toEqual([
      ['רוני אדלר', null, 1524000], ['רוני אדלר', null, 10000],
    ]);
    expect(await remaining()).toEqual(['קופה · 1', 'מיזוג קודם · 1', 'פריטי רכש · 2', 'לוח עבודה · 2']);

    // The holder drawer's שמירה, with מאיה chosen.
    await setAccountHolder(db, account.id, maya);
    expect((await accountBalances(db))[0]).toMatchObject({ holderPersonId: maya, holderName: 'מאיה פרץ' });
    expect(await remaining()).toEqual(['מיזוג קודם · 1', 'פריטי רכש · 2', 'לוח עבודה · 2']);

    // The absorbed record's ביטול המיזוג.
    expect((await unmergePreview(db, duplicate))?.returning).toEqual(['רוני א.']);
    await unmergePerson(db, duplicate);
    const [restored] = await db.select().from(persons).where(eq(persons.id, duplicate));
    expect(restored.mergedIntoId).toBeNull();
    expect((await db.select().from(personAliases).where(eq(personAliases.personId, duplicate))).map((row) => row.alias))
      .toEqual(['רוני א.']);
    expect(await remaining()).toEqual(['פריטי רכש · 2', 'לוח עבודה · 2']);

    // The acquisition drawer's שמירה: אין אחראי עדיין on one, a different
    // way of getting the other. The line the first purchase made on the
    // plan follows it, so the plan blocker drops with it.
    await updateAcquisition(db, generator, await purchase({ seasonId: season.id, assigneePersonId: null }), LEAD);
    await updateAcquisition(db, fridge, await purchase({ name: 'מקרר', source: 'second_hand' }), LEAD);
    expect((await acquisitionById(db, generator))?.assignee).toBeNull();
    expect((await acquisitionById(db, fridge))?.lender).toBeNull();
    const [followed] = await db.select().from(workItems).where(eq(workItems.acquisitionItemId, generator));
    expect(followed.assigneePersonId).toBeNull();
    expect(await remaining()).toEqual(['לוח עבודה · 1']);

    // The plan drawer's שמירה with עדיין לא נקבע.
    await updateItem(db, line, {
      title: 'הקמת הסלון', notes: null, topicId: null, parentId: null,
      startsOn: null, endsOn: null, assigneePersonId: null,
    }, LEAD);
    expect(await remaining()).toEqual([]);

    // And now the dialog, not the drawer: what goes is the record itself.
    expect(await previewDelete(db, roni)).toMatchObject({
      manualAliases: ['רוני אדלר'], importAliases: [], seasons: ['ברן 26'], duesCount: 1, blockers: [],
    });
    expect(await deletePerson(db, roni)).toEqual({
      ok: true, removed: { aliases: 1, requeued: 0, memberships: 1, dues: 1 },
    });
    expect(await db.select().from(persons).where(eq(persons.id, roni))).toEqual([]);
    // Nothing that was closed by hand went with the record.
    expect((await listObligations(db)).map((row) => row.displayParty)).toEqual(['רוני אדלר', 'רוני אדלר']);
    expect((await accountBalances(db))[0].holderName).toBe('מאיה פרץ');
    expect((await acquisitionById(db, generator))?.name).toBe('גנרטור');
    expect(await db.select().from(persons).where(eq(persons.id, duplicate))).toHaveLength(1);
  });

  it('a merged-away record: unmerge it here, then delete it', async () => {
    const survivor = await createPerson(db, 'רוני אדלר', LEAD);
    const absorbed = await createPerson(db, 'רוני א.', LEAD);
    expect((await mergePersons(db, absorbed, survivor, LEAD)).ok).toBe(true);

    const preview = await previewDelete(db, absorbed);
    expect(preview?.blockers.map((b) => [b.conflict, b.href])).toEqual([
      ['רשומה ממוזגת', `/members/${absorbed}?unmerge=1`],
    ]);
    expect(preview?.blockers[0].items).toEqual([{ label: 'מוזגה לתוך רוני אדלר', href: `/members/${survivor}` }]);

    await unmergePerson(db, absorbed);
    expect((await previewDelete(db, absorbed))?.blockers).toEqual([]);
    expect(await deletePerson(db, absorbed)).toEqual({
      ok: true, removed: { aliases: 1, requeued: 0, memberships: 0, dues: 0 },
    });
    // The survivor is untouched, and no longer blocked by the merge either.
    expect((await previewDelete(db, survivor))?.blockers).toEqual([]);
  });
});
