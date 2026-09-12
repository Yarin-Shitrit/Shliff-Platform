import type { AnyDb } from '@/lib/db-types';
import { createSeason, getSeasonByName, addMember } from '@/lib/members/roster';
import { resolveName, recordUnlinkedName } from '@/lib/members/identity';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordOffset, settlementFor } from '@/lib/fees/payments';
import { createEvent, listEvents } from '@/lib/work/events';
import { createTask, listTasks, setTaskBudgetLine } from '@/lib/work/tasks';
import { assignPerson, setAssignmentStatus } from '@/lib/work/coverage';
import type { AccountKind } from '@/db/schema/money';
import { createAccount, listAccounts } from '@/lib/money/accounts';
import { recordEntry, listMovements } from '@/lib/money/ledger';
import { createBudgetLine, listBudgetLines } from '@/lib/money/budget';
import {
  createFundingTarget, listFundingTargets, createTicketRound, listTicketRounds,
} from '@/lib/money/funding';
import { createObligation, settleObligation, listObligations } from '@/lib/money/obligations';
import { isBlank } from '@/lib/text/normalize';

export interface CampSeedResult {
  seasons: number;
  events: number;
  people: number;
  tasks: number;
  accounts: number;
  movements: number;
  budgetLines: number;
  fundingTargets: number;
  ticketRounds: number;
  obligations: number;
}

/** Named in `תקציב קאמפ ברן 25` as `חריגים`, with their amounts. */
const BURN_25_EXCEPTIONS: Array<[string, number]> = [
  ['עזריאל', 1000],
  ['עדי', 1000],
  ['דניאל פינטו', 555],
  ['דנה שרון', 1400],
  ['עמירם דהן', 0],
];

/** Named in the ברן 25 reimbursement column, and in the רחבה `אחראי` column. */
const BURN_25_NAMED = [
  'אורי', 'לטם', 'אופק', 'תומר גולן', 'טלי', 'שימי', 'איתן', 'יובי',
  'עמי', 'נטלי', 'ראנצ׳ו', 'אלפר', 'רן', 'דניאל ענבר',
];

/** Marked `שולם` under `דמי קאמפ` in the ברן 26 sheet. Their dues were settled
 *  by the 6,000 offset line in the `קיזוזים` table under `חוב יוסף`. */
const BURN_26_OFFSET_MEMBERS = ['יוסף', 'קארינה', 'יונתן', 'ירין', 'עילאי'];

/** The `אחראי` column of `תקציב רחבה ברן 25`. `מייצג` is deliberately left
 *  unassigned: its owner cell reads `ראנצ׳ו ונטלי`, two names in one string.
 *  Each also gets a `budget_lines` row of the same amount, category
 *  `dancefloor` — `budgetAmount` stays on the task too (see `createTask`'s
 *  input): it is deprecated in place, not removed, because the task form
 *  still writes it and Wave 1 ships no picker to replace that. */
const BURN_25_DELIVERABLES: Array<{ title: string; budget: number; owner?: string }> = [
  { title: 'מייצג', budget: 41300 },
  { title: 'חשמל', budget: 12950, owner: 'אופק' },
  { title: 'הגברה + תאורה', budget: 30810, owner: 'עמי' },
  { title: 'הובלה', budget: 4000, owner: 'אופק' },
];

const BURN_25_EVENTS = ['House of trance 270925', 'Halloween Underground 311025'];
const BURN_26_EVENTS = ['מסיבת פקאנים', 'SuperNature 18.7', 'SuperNature 3.10'];

/**
 * The ברן 25 `מיקום` block, with its stated balances as opening balances.
 *
 * They are openings rather than derived totals because the sheet's ledger rows
 * carry no account at all — it never says which קופה any movement touched. So
 * the honest reading is: these three figures are what the camp counted, and
 * every seeded movement below is unattributed until someone says otherwise.
 *
 * `עו״ש אופק` is a member's personal current account holding camp money.
 * Their dates differ in the sheet (1,584 at 2025-10-10, the other two at
 * 2025-05-20); `openingOn` records each as given rather than flattening them.
 */
const ACCOUNTS: Array<{
  name: string; kind: AccountKind; holder?: string; opening: number; openingOn: string;
}> = [
  { name: 'קופת מזומן', kind: 'cash', opening: 1584, openingOn: '2025-10-10' },
  { name: 'עו״ש אופק', kind: 'personal', holder: 'אופק', opening: 14079.55, openingOn: '2025-05-20' },
  { name: 'וייבז קלוז פרינדס', kind: 'event_float', opening: 28520, openingOn: '2025-05-20' },
];

/** `סיכום כללי` of `קופת קאמפ 25'`. The 44,647 `מעבר לקובץ חדש` row is NOT
 *  here: under a continuous ledger it is the previous book's closing balance,
 *  and importing it as income would double-count everything the three
 *  opening balances above already carry forward. */
const LEDGER_25: Array<[string, 'in' | 'out', number, string]> = [
  ['2025-06-10', 'out', 200, 'תרומה אבישי פרץ'],
  ['2025-08-01', 'out', 8850, 'מכולה אוג 25-26'],
  ['2025-08-01', 'out', 20660, 'מקדמה במה ברן 25'],
  ['2025-09-27', 'in', 34646.55, 'רווח מסיבה נמל'],
  ['2025-10-16', 'out', 20660, 'חצי שני למייצג נטלי'],
  ['2025-10-16', 'out', 400, 'מברגה לקאמפ'],
  ['2025-10-30', 'in', 15660, 'מסיבת האלווין 30/10'],
];

/** `סיכום כללי` of `קופת קאמפ 2026`. */
const LEDGER_26: Array<[string, 'in' | 'out', number, string]> = [
  ['2026-06-01', 'out', 14000, 'חוב לירון סלע על ברן 25'],
  ['2026-06-01', 'out', 7350, 'עובדי הקמה יוניברן'],
  ['2026-07-01', 'in', 5000, 'קיזוז מול תקציב גיפטינג יוני'],
  ['2026-07-01', 'out', 3000, 'מקדמה מכולות ליולי עד נובמבר'],
  ['2026-07-18', 'in', 57000, 'רווח מסיבת פקאנים'],
  ['2026-07-22', 'out', 8820, '3 כרטיסי אומנים ברן'],
  ['2026-07-22', 'out', 4000, 'ציוד מטבח חדש'],
  ['2026-07-22', 'out', 2000, 'הובלות'],
  ['2026-08-01', 'out', 1000, 'מקלחת'],
  ['2026-08-01', 'out', 231, 'ציוד מכולה'],
  ['2026-08-01', 'out', 1200, 'פינויים נסורת - להחזיר לאורי'],
  ['2026-08-01', 'out', 3670, 'מכולה עד דצמבר'],
];

/** Only a plain integer or decimal counts as a real quantity — `12,000kw`,
 *  `מכולה` and `10% תקציב` stay text-only, the same rule the page's own
 *  `quantityText`/`quantityNum` split already tests for a single row. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
function budgetQuantityNum(quantityText: string): number | undefined {
  return PLAIN_NUMBER.test(quantityText) ? Number(quantityText) : undefined;
}

/** `תקציב קאמפ ברן 26`, summing to 64,375.30. Category `camp`: these are the
 *  season's general running costs, not the dancefloor deliverables above. */
const BUDGET_26: Array<[string, string, number | null, number, string]> = [
  ['שירותים נסורת', '5', 125, 1625, 'תקציב ברן 25׳ בפועל'],
  ['פינוי שירותים', '18', 125, 2250, 'תקציב ברן 25׳ בפועל'],
  ['ציוד היגיינה', '1', 100, 100, 'תוספת של 70 ש״ח'],
  ['מיכל מים לבנים + מתאם ברז', '2', 1534, 3068, 'תקציב ברן 25׳ צפי לעליית מחיר'],
  ['מיכל מים אפורים', '1', 472, 472, 'תקציב ברן 25 - צריך לקנות'],
  ['מילוי מי שתייה', '5', 590, 2950, 'תוספת מיכל למקלחות'],
  ['פינוי מים אפורים', '4', 708, 2832, 'תוספת מיכל פינויים'],
  ['מקלחות', '2', 750, 1500, 'תוספת 900 שקלים לטובת תאים'],
  ['ציוד משלים למקלחת', '1', 500, 500, 'תוספת 400 שקלים לטובת נוחות'],
  ['חשמל לקאמפ', '12,000kw', 7500, 7500, 'תוספת של עוד 3KWH'],
  ['הובלה', 'מכולה', 12000, 9000, 'תוספת של 2000 שקלים'],
  ['באלות', '20', 15, 300, 'ירידה של 150 שקלים'],
  ['אוכל', 'תפריט שלם לשבוע', 8000, 8000, 'תוספת של 1,000 שקלים'],
  ['ציוד מטבח - כירת גז + מיחם', '1', 850, 930, 'עוד כירת גז'],
  ['מילוי גז', '1', 200, 200, 'מילוי בלון 12 ק״ג'],
  ['מקרר + מקפיא', 'מקרר תעשייתי', null, 0, 'מקרר חדש תעשייתי'],
  ['קרח', '38', 30, 1140, 'תקציב ברן 25׳'],
  ['צילייה מחנה', '600', 14, 9156, 'ירידה של 100 מ״ר'],
  ['גידור מחנה', '200', 14, 2800, 'ירידה של 50 מ״ר'],
  ['הובלה צילייה', '1', 500, 500, 'עלות שקועה'],
  ['100 ק"ג עצים + תוספת אחסנה', '1', 500, 500, 'ירידה של 1000 ש״ח'],
  ['גנרטור', '1', 2200, 2200, 'קונים עוד אחד'],
  ['30 מ׳ לייקרה + 50 מ׳ בד זול', '1', 1000, 1000, 'תוספת של 430 ש״ח'],
  ['תקציב הפתעות דק׳ 90', '10% תקציב', 5852.3, 5852.3, ''],
];

/** `תקציב גיוס לשנה` from `תקציב קאמפ ברן 26`, summing to 135,375.30. Only the
 *  dues line counts against the camp budget — the rest fund the dancefloor,
 *  the art car and last year's debt. */
const FUNDING_26: Array<[string, number, boolean]> = [
  ['חוב', 15000, false],
  ['תיקון ותחזוק מייצג', 5000, false],
  ['חשמל רחבה', 16000, false],
  ['הגברה', 35000, false],
  ['הובלה', 6000, false],
  ['תאורה לייזרים', 20000, false],
  ['מכולות', 16000, false],
  ['הורדת מחיר דמי קאמפ', 22375.3, true],
];

/** The ticket projection beside it: 60,000 already sold, then two rounds. */
const TICKETS_26: Array<[string, number | null, number | null, number]> = [
  ['כרטיסים עד כה', null, null, 60000],
  ['סבב ג׳', 165, 200, 33000],
  ['סבב ד׳', 195, 400, 78000],
];

/** The `חוב יוסף` block: the debt's own total, and its four `קיזוזים`. */
const YOSEF_DEBT = 15240;
const YOSEF_OFFSETS: Array<[number, string]> = [
  [4410, '3 כרטיס + רכב'],
  [2780, '3 כרטיס לבד'],
  [1140, 'ביט מאורי'],
  [6000, 'יוסף קארינה יונתן ירין ועילאי'],
];

/**
 * The twelve ברן 25 reimbursement lines, totalling 5,954 — which is exactly
 * the `תקציב הפתעות דק׳ 90` budget line in the same sheet.
 *
 * Two have no name. They are seeded with no party on purpose: the camp cannot
 * say who to pay back, and a placeholder would be the system inventing an
 * owner for real money.
 */
const REIMBURSEMENTS_25: Array<[string | null, number, string]> = [
  ['אורי', 300, 'שווארמה הקמות'],
  ['לטם', 65, 'דלק לטם'],
  ['אופק', 400, 'מים שישיות חלוץ'],
  ['אופק', 709, 'מקס סטוק השלמות'],
  ['תומר גולן', 820, 'נגרר שני rentagrar'],
  ['טלי', 200, 'אוכל חלוץ'],
  ['שימי', 335, 'השלמות מקלחת סלון'],
  [null, 500, 'מקפיא באיחסון נוסף'],
  [null, 400, 'דולב זבל במחסן'],
  ['איתן', 40, 'מפצל'],
  ['יובי', 580, 'גרילנדות ומנורות'],
  ['אופק', 1605, 'החזרי נסיעה עגלה'],
];

/** Creates a person only if no linked alias already resolves to one. */
async function ensurePerson(
  db: AnyDb, name: string, email: string, counter: { people: number },
): Promise<string> {
  const existing = await resolveName(db, name);
  if (existing.personId) return existing.personId;
  counter.people += 1;
  return createPerson(db, name, email);
}

/**
 * Seeds the roster, dues, work and money the workbooks actually record.
 *
 * Deliberately partial. Several things are NOT seeded, each for the same
 * reason: the system does not invent what the source does not say.
 *  - ברן 23 and ברן 24 have no recorded flat rate, so they are not created.
 *  - The 38 anonymous `רגילים` are a count in a budget cell, not a roster;
 *    `plannedSize` carries the number instead.
 *  - `ראנצ׳ו ונטלי` is queued as an unlinked name rather than split into one
 *    or two people. A lead decides.
 *  - The `44,647 מעבר לקובץ חדש` row is not seeded as income — see `LEDGER_25`.
 *  - Two of the twelve reimbursements name no one — see `REIMBURSEMENTS_25`.
 *
 * Idempotent: safe to run against a database that already has some of this.
 */
export async function seedCampBaseline(
  db: AnyDb, email: string,
): Promise<CampSeedResult> {
  const result: CampSeedResult = {
    seasons: 0, events: 0, people: 0, tasks: 0,
    accounts: 0, movements: 0, budgetLines: 0, fundingTargets: 0, ticketRounds: 0,
    obligations: 0,
  };
  const counter = { people: 0 };

  let s25 = await getSeasonByName(db, 'ברן 25');
  if (!s25) {
    s25 = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    result.seasons += 1;
  }
  let s26 = await getSeasonByName(db, 'ברן 26');
  if (!s26) {
    s26 = await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    });
    result.seasons += 1;
  }

  const existingEvents = new Set([
    ...(await listEvents(db, s25.id)).map((e) => e.name),
    ...(await listEvents(db, s26.id)).map((e) => e.name),
  ]);
  for (const [season, names] of [[s25, BURN_25_EVENTS], [s26, BURN_26_EVENTS]] as const) {
    for (const name of names) {
      if (existingEvents.has(name)) continue;
      await createEvent(db, { seasonId: season.id, name, kind: 'fundraiser' });
      result.events += 1;
    }
  }

  // ברן 25 roster: everyone the sheets name. The 38 anonymous רגילים are not people.
  for (const name of [...BURN_25_NAMED, ...BURN_25_EXCEPTIONS.map(([n]) => n)]) {
    const personId = await ensurePerson(db, name, email, counter);
    await addMember(db, personId, s25.id);
  }
  await issueFlatDues(db, s25.id);

  const dues25 = await listDues(db, s25.id);
  for (const [name, amount] of BURN_25_EXCEPTIONS) {
    const row = dues25.find((d) => d.displayName === name);
    if (!row || row.kind === 'exception') continue;
    await setException(db, {
      personId: row.personId,
      seasonId: s25.id,
      amount,
      reason: 'חריג מתוך `תקציב קאמפ ברן 25` — הסכום נרשם, הסיבה לא תועדה במקור',
      decidedBy: email,
    });
  }

  // ברן 26: the five whose dues were settled by the 6,000 offset.
  for (const name of BURN_26_OFFSET_MEMBERS) {
    const personId = await ensurePerson(db, name, email, counter);
    await addMember(db, personId, s26.id);
  }
  await issueFlatDues(db, s26.id);

  const dues26 = await listDues(db, s26.id);
  const unsettled = dues26.filter((row) => BURN_26_OFFSET_MEMBERS.includes(row.displayName));
  const entries = [];
  for (const row of unsettled) {
    if ((await settlementFor(db, row.dueId)).paidAgorot > 0) continue;
    entries.push({ dueId: row.dueId, amount: 1200 });
  }
  if (entries.length > 0) {
    await recordOffset(db, {
      entries,
      note: 'קיזוז מול חוב יוסף — 6,000 (יוסף קארינה יונתן ירין ועילאי)',
      paidOn: new Date('2026-07-01T00:00:00Z'),
      recordedBy: email,
    });
  }

  // The four owned רחבה deliverables, each pointed at its own dancefloor
  // budget line so the season's planned total never double-counts a
  // deliverable's own `budgetAmount` (see `BURN_25_DELIVERABLES`'s comment).
  //
  // The budget line's existence check is its own, independent of the
  // task's — a database where `seedCampBaseline` already ran before budget
  // lines existed already has these four tasks with `budgetLineId` null.
  // Nesting the budget line under "the task doesn't exist yet" (as an
  // earlier version of this function did) would mean those four tasks could
  // never get a budget line, on any future re-run.
  const dancefloorLines = new Map(
    (await listBudgetLines(db, s25.id))
      .filter((line) => line.category === 'dancefloor')
      .map((line) => [line.label, line.id]),
  );
  const existingDeliverables = new Map(
    (await listTasks(db, s25.id)).map((t) => [t.title, t]),
  );
  for (const deliverable of BURN_25_DELIVERABLES) {
    let budgetLineId = dancefloorLines.get(deliverable.title);
    if (!budgetLineId) {
      budgetLineId = await createBudgetLine(db, {
        seasonId: s25.id,
        label: deliverable.title,
        total: deliverable.budget,
        category: 'dancefloor',
      });
      dancefloorLines.set(deliverable.title, budgetLineId);
      result.budgetLines += 1;
    }

    const existingTask = existingDeliverables.get(deliverable.title);
    if (existingTask) {
      // The task predates this budget line — link the two so a task created
      // before budget lines existed is not left permanently unlinked.
      if (!existingTask.budgetLineId) {
        await setTaskBudgetLine(db, existingTask.taskId, budgetLineId);
      }
      continue;
    }

    const taskId = await createTask(db, {
      seasonId: s25.id,
      kind: 'deliverable',
      title: deliverable.title,
      budgetAmount: deliverable.budget,
      budgetLineId,
    });
    result.tasks += 1;

    if (!deliverable.owner) continue;
    const owner = await resolveName(db, deliverable.owner);
    if (!owner.personId) continue;
    const assignmentId = await assignPerson(db, taskId, owner.personId, email);
    await setAssignmentStatus(db, assignmentId, 'accepted');
  }

  // `מייצג`'s owner cell reads `ראנצ׳ו ונטלי` — two names in one string.
  // The system records it and stops. A lead splits it.
  await recordUnlinkedName(db, 'ראנצ׳ו ונטלי', 'import');

  // The three ברן 25 קופות, as opening balances — see `ACCOUNTS`'s comment.
  const existingAccounts = new Set((await listAccounts(db)).map((a) => a.name));
  for (const account of ACCOUNTS) {
    if (existingAccounts.has(account.name)) continue;
    const holder = account.holder ? await resolveName(db, account.holder) : null;
    await createAccount(db, {
      name: account.name,
      kind: account.kind,
      holderPersonId: holder?.personId ?? undefined,
      openingBalance: account.opening,
      openingOn: new Date(`${account.openingOn}T00:00:00Z`),
    });
    result.accounts += 1;
  }

  // Every ברן 25 and ברן 26 ledger movement — unattributed, because neither
  // sheet's ledger rows name an account (see `ACCOUNTS`'s comment).
  for (const [season, rows] of [[s25, LEDGER_25], [s26, LEDGER_26]] as const) {
    const existingMoves = new Set(
      (await listMovements(db, { seasonId: season.id }))
        .filter((m) => m.source === 'ledger')
        .map((m) => m.description),
    );
    for (const [date, direction, amount, description] of rows) {
      if (existingMoves.has(description)) continue;
      await recordEntry(db, {
        occurredOn: new Date(`${date}T00:00:00Z`),
        direction,
        amount,
        description,
        seasonId: season.id,
        recordedBy: email,
      });
      result.movements += 1;
    }
  }

  // ברן 26's general running costs — the season's `budget_lines`, category
  // `camp`. The four dancefloor lines above are separate: two categories on
  // the same season, never summed into one figure by anything but the total.
  const existingBudget26 = new Set(
    (await listBudgetLines(db, s26.id)).map((line) => line.label),
  );
  for (const [label, quantityText, unitCost, total, rationale] of BUDGET_26) {
    if (existingBudget26.has(label)) continue;
    await createBudgetLine(db, {
      seasonId: s26.id,
      label,
      quantityText,
      quantityNum: budgetQuantityNum(quantityText),
      unitCost: unitCost ?? undefined,
      total,
      rationale: isBlank(rationale) ? undefined : rationale,
      category: 'camp',
    });
    result.budgetLines += 1;
  }

  // The whole ברן 26 fundraising plan — see `FUNDING_26`'s comment. Its own
  // existence guard, by label, independent of every other group's: nesting
  // this inside another group's check (as an earlier version of this
  // function did for the dancefloor budget lines) would mean a database
  // seeded before this commit could never get the seven lines it is missing.
  const existingFunding26 = new Set(
    (await listFundingTargets(db, s26.id)).map((t) => t.label),
  );
  for (const [label, amount, countsTowardCampBudget] of FUNDING_26) {
    if (existingFunding26.has(label)) continue;
    await createFundingTarget(db, { seasonId: s26.id, label, amount, countsTowardCampBudget });
    result.fundingTargets += 1;
  }

  // The ticket projection beside the fundraising plan — see `TICKETS_26`'s
  // comment. Its own existence guard, by label, standalone for the same
  // reason as `FUNDING_26`'s above.
  const existingTickets26 = new Set(
    (await listTicketRounds(db, s26.id)).map((t) => t.label),
  );
  for (const [label, quantity, price, total] of TICKETS_26) {
    if (existingTickets26.has(label)) continue;
    await createTicketRound(db, {
      seasonId: s26.id,
      label,
      quantity: quantity ?? undefined,
      price: price ?? undefined,
      total,
    });
    result.ticketRounds += 1;
  }

  // `חוב יוסף` and its four offsets. Settlements are only added the run that
  // creates the obligation — re-adding them against an obligation that
  // already carries them would exceed its amount and `settleObligation`
  // would (correctly) refuse, which is exactly the idempotency this
  // function promises never to violate.
  const campOwes = await listObligations(db, { direction: 'camp_owes' });
  const existingCampOwes = new Set(campOwes.map((o) => o.description));
  if (!existingCampOwes.has('חוב יוסף')) {
    const yosef = await resolveName(db, 'יוסף');
    const obligationId = await createObligation(db, {
      direction: 'camp_owes',
      partyPersonId: yosef.personId ?? undefined,
      partyName: yosef.personId ? undefined : 'יוסף',
      description: 'חוב יוסף',
      amount: YOSEF_DEBT,
      seasonId: s26.id,
      openedOn: new Date('2026-07-01T00:00:00Z'),
    });
    result.obligations += 1;
    for (const [amount, note] of YOSEF_OFFSETS) {
      await settleObligation(db, {
        obligationId, amount, kind: 'offset', note,
        settledOn: new Date('2026-07-01T00:00:00Z'), recordedBy: email,
      });
    }
  }

  // The twelve ברן 25 reimbursements. `openedOn` is not in the source at
  // all — the sheet names an amount and a reimbursee, never a date — so the
  // season's own year-start stands in as a deliberately synthetic date,
  // not a claim about when any of these actually happened.
  const reimbursementDate = new Date('2025-01-01T00:00:00Z');
  for (const [name, amount, description] of REIMBURSEMENTS_25) {
    if (existingCampOwes.has(description)) continue;
    const party = name ? await resolveName(db, name) : null;
    await createObligation(db, {
      direction: 'camp_owes',
      partyPersonId: party?.personId ?? undefined,
      partyName: party?.personId ? undefined : (name ?? undefined),
      description,
      amount,
      seasonId: s25.id,
      openedOn: reimbursementDate,
    });
    result.obligations += 1;
  }

  result.people = counter.people;
  return result;
}
