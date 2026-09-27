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
import { createBudgetLine, listBudgetLines } from '@/lib/money/budget';
import {
  createFundingTarget, listFundingTargets, createTicketRound, listTicketRounds,
} from '@/lib/money/funding';
import { createObligation, settleObligation, listObligations } from '@/lib/money/obligations';

/**
 * What one run created.
 *
 * There is no `movements` counter any more. The seed no longer writes a single
 * `ledger_entries` row — the promoter owns them, from the two `סיכום כללי`
 * blocks — and a counter that can only ever report 0 would read as "nothing
 * was due" rather than "this is not the seed's job".
 */
export interface CampSeedResult {
  seasons: number;
  events: number;
  people: number;
  tasks: number;
  accounts: number;
  /** Only the four ברן 25 `dancefloor` lines; see the loop that writes them. */
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
 * The ברן 25 `מיקום` block, with its stated balances as counted balances.
 *
 * They are counts rather than derived totals because the sheet's ledger rows
 * carry no account at all — it never says which קופה any movement touched. So
 * the honest reading is: these three figures are what the camp counted, and
 * every promoted movement is unattributed until someone says otherwise.
 *
 * `openingOn` is the day the count stands for, and it is NOT the date the
 * sheet prints beside each account (1,584 at 2025-10-10, the other two at
 * 2025-05-20). The three sum to 44,183.55, which is the sheet's closing line
 * after its last movement on 2025-10-30 — a figure that includes
 * `חצי שני למייצג נטלי` (2025-10-16) and `מסיבת האלווין` (2025-10-30) cannot
 * have been counted in May. Dating the count 2025-05-20 would let those
 * movements, once attributed, be taken off a balance they were already taken
 * off. `COUNTED_ON` is the last movement day of the ברן 25 book, so every
 * ברן 25 movement is history to the count and every ברן 26 one moves it.
 *
 * `עו״ש אופק` is a member's personal current account holding camp money.
 */
const COUNTED_ON = '2025-10-30';
const ACCOUNTS: Array<{
  name: string; kind: AccountKind; holder?: string; opening: number; openingOn: string;
}> = [
  { name: 'קופת מזומן', kind: 'cash', opening: 1584, openingOn: COUNTED_ON },
  { name: 'עו״ש אופק', kind: 'personal', holder: 'אופק', opening: 14079.55, openingOn: COUNTED_ON },
  { name: 'וייבז קלוז פרינדס', kind: 'event_float', opening: 28520, openingOn: COUNTED_ON },
];

/**
 * The nineteen ledger movements this seed used to transcribe are GONE, and
 * with them the `LEDGER_25` and `LEDGER_26` tables that held them.
 *
 * They are produced by the promoter now, from two confirmed `ledger` blocks:
 *
 *  - `ac5a9d6e-8b52-40a9-bfea-a22771a2e4c6` — `סיכום כללי` of `קופת קאמפ 25’`,
 *    which writes the seven ברן 25 movements.
 *  - `6f1a7fc4-03ac-4ec3-abe4-0b5a863e133f` — `סיכום כללי` of
 *    `קופת קאמפ 2026`, which writes the twelve ברן 26 ones.
 *
 * The cutover evidence checked all nineteen against the live database, row by
 * row, on season + label + amount to the agora: eighteen come back identical,
 * and the nineteenth (`קיזוז מול תקציב גיפטינג יוני`) comes back at the same
 * 5,000 on the same date under the workbook's longer label
 * `קיזוז מול תקציב גיפטינג יוניברן` — a truncation this seed introduced, not
 * a fact the workbook lacks.
 *
 * One judgement made here does NOT survive into the promoter, and it is worth
 * knowing: the 44,647 `מעבר לקובץ חדש` row was deliberately never seeded,
 * because under a continuous ledger it is the previous book's closing balance
 * and importing it as income would double-count what the three opening
 * balances below already carry. The promoter reaches the same answer by its
 * own route — it refuses that row `carry-forward` — so the judgement is
 * preserved, but by the promoter's rule rather than by this file's silence.
 */

/**
 * `תקציב קאמפ ברן 26`'s twenty-four `camp` budget lines are gone too, along
 * with the `BUDGET_26` table and the `budgetQuantityNum` helper that read its
 * quantity column.
 *
 * Block `66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92` (`תקציב קאמפ ברן 26` in
 * `קופת קאמפ 2026`, the authoritative copy) produces them. Twenty-three come
 * back identical — including `מקרר + מקפיא` at 0.00 and `תקציב הפתעות דק׳ 90`
 * at 5,852.30 — and the twenty-fourth, `30 מ׳ לייקרה + 50 מ׳ בד זול`, comes
 * back at the same 1,000 under the workbook's longer label.
 *
 * The four ברן 25 `dancefloor` lines above are NOT here and are still written
 * by this seed. The same block-promoted route re-creates them at the right
 * amounts but categorised `camp`, because `budgetRow` hard-codes the category;
 * four `tasks.budget_line_id` values point at the seeded ids with no foreign
 * key to protect them. Until a lead decides that question the seed keeps them.
 */

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
 * Seeds the roster, dues, work and money the workbooks record AND no confirmed
 * block produces.
 *
 * That second clause is new. This function used to transcribe the workbooks by
 * hand; the promoter derives the same facts from confirmed blocks now, so
 * everything a block owns has been taken out — nineteen ledger movements and
 * twenty-four ברן 26 camp budget lines, each removal carrying a comment naming
 * the block that replaced it. What is left is the category no block contains:
 *
 *  - seasons, people, dues and the five ברן 25 exceptions;
 *  - events and the four ברן 25 deliverable tasks;
 *  - the four `dancefloor` budget lines those tasks point at (the promoter
 *    re-creates them as `camp`, which would move the dancefloor's spend into
 *    the camp identity and orphan four `tasks.budget_line_id` values);
 *  - the three `מיקום` accounts and their opening balances, which are an
 *    adjudication — `account_balances` has no promoter by design;
 *  - the eight `funding_targets`, for which `BLOCK_ARCHETYPES` has no
 *    archetype at all;
 *  - the three ticket rounds and the thirteen obligations, all of which sit in
 *    side-by-side sub-tables that no block's column map reaches;
 *  - the four settlements that model the 6,000 offset as five members' dues.
 *
 * Deliberately partial for its own, older reasons too — the system does not
 * invent what the source does not say:
 *  - ברן 23 and ברן 24 have no recorded flat rate, so they are not created.
 *  - The 38 anonymous `רגילים` are a count in a budget cell, not a roster;
 *    `plannedSize` carries the number instead.
 *  - `ראנצ׳ו ונטלי` is queued as an unlinked name rather than split into one
 *    or two people. A lead decides.
 *  - Two of the twelve reimbursements name no one — see `REIMBURSEMENTS_25`.
 *
 * Idempotent: safe to run against a database that already has some of this.
 */
export async function seedCampBaseline(
  db: AnyDb, email: string,
): Promise<CampSeedResult> {
  const result: CampSeedResult = {
    seasons: 0, events: 0, people: 0, tasks: 0,
    accounts: 0, budgetLines: 0, fundingTargets: 0, ticketRounds: 0,
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

  // The ledger movements and the ברן 26 camp budget lines used to be written
  // here. They are the promoter's now — see the two block comments above
  // `FUNDING_26` for which block produces what, and what the cutover evidence
  // checked before this loop was removed.

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
