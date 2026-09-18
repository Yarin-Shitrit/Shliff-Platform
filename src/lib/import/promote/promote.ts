import {
  and, asc, count, eq, inArray, isNotNull, isNull, notInArray, or,
} from 'drizzle-orm';
import type { Db } from '@/db';
import type { AnyDb } from '@/lib/db-types';
import { blocks, blockMappings, sheets } from '@/db/schema/source';
import { tasks } from '@/db/schema/camp';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations, obligationSettlements,
} from '@/db/schema/money';
import { resolveName, recordUnlinkedName } from '@/lib/members/identity';
import { sheetEligibility } from '@/lib/import/sheets';
import { toAgorot, fromAgorot } from '@/lib/money';
import type { BlockArchetype } from '@/lib/classify/types';
import type { BlockRow } from './rows';
import { blockRows, refuse } from './rows';
import { ledgerRow } from './ledger';
import { budgetRow } from './budget';
import { ticketRow } from './tickets';
import { obligationRow } from './obligations';
import type {
  PromotionResult, PromotedRow, Refusal, RetainedRow, PromoteContext,
} from './types';

type TargetTable = PromotedRow['table'];

/** Which table each promotable archetype writes to (W6). */
const TARGETS = {
  ledger: 'ledger_entries',
  budget_lines: 'budget_lines',
  ticket_rounds: 'ticket_rounds',
  obligations: 'obligations',
} as const satisfies Record<string, TargetTable>;

type PromotableArchetype = keyof typeof TARGETS;

const TABLES = {
  ledger_entries: ledgerEntries,
  budget_lines: budgetLines,
  ticket_rounds: ticketRounds,
  obligations,
} as const;

/**
 * The order the W5 sweep decides tables in. A budget line is referenced by
 * ledger rows, so the ledger is decided first: a budget line whose only
 * reference is a ledger row this same sweep removes is not held back by it.
 */
const SWEEP_ORDER: readonly TargetTable[] = [
  'ticket_rounds', 'obligations', 'ledger_entries', 'budget_lines',
];

/** Plain Hebrew for a camp lead: no build phases, no internal terms. */
const MESSAGES = {
  unconfirmed: 'הבלוק עדיין לא אושר',
  noPromoter: 'המערכת עדיין לא יודעת להכניס טבלה מסוג זה — היא נשמרת לעיון בלבד',
  accountBalances: 'יתרות חשבונות נקבעות ידנית ולא נקלטות מגיליון',
  unmapped: 'לטבלה אין שיוך עמודות',
  sheet: {
    undecided: 'הגיליון הזה קיים ביותר מקובץ אחד, ועדיין לא נבחר איזה עותק נכון',
    ambiguous: 'יותר מעותק אחד של הגיליון הזה סומן כנכון',
    superseded: 'נבחר עותק אחר של הגיליון הזה',
  },
} as const;

function hasPromoter(a: BlockArchetype): a is PromotableArchetype {
  return Object.hasOwn(TARGETS, a);
}

function wholeBlock(
  block: { top: number }, reason: Refusal['reason'], message: string,
): Refusal {
  return { sheetRow: block.top, reason, message, cells: [] };
}

// ---------------------------------------------------------------------------
// Range guard
// ---------------------------------------------------------------------------

/** `numeric(12,2)` holds ten integer digits and two decimal ones. */
const NUMERIC_12_2_MAX_AGOROT = 999_999_999_999;
const PG_INTEGER_MIN = -2_147_483_648;
const PG_INTEGER_MAX = 2_147_483_647;

interface RangeCheck {
  /** Hebrew column name, as a lead would call it. */
  column: string;
  value: number | undefined;
  kind: 'money' | 'integer';
}

function fits({ value, kind }: RangeCheck): boolean {
  if (value === undefined) return true;
  if (!Number.isFinite(value)) return false;
  if (kind === 'integer') {
    return Number.isInteger(value) && value >= PG_INTEGER_MIN && value <= PG_INTEGER_MAX;
  }
  // Compared in agorot, the same rounding the write applies, so a value that
  // rounds up past the limit is refused rather than overflowing on write.
  return Math.abs(toAgorot(value)) <= NUMERIC_12_2_MAX_AGOROT;
}

/**
 * A value the column cannot hold is a database error on commit and nothing
 * at all on a dry run — so the register would promise a row the commit then
 * fails on. Checked here, once for every archetype and before the dry-run
 * branch, so both modes refuse the same rows.
 */
function outOfRange(row: BlockRow, checks: RangeCheck[]): Refusal | null {
  const bad = checks.find((check) => !fits(check));
  if (!bad) return null;
  const limit = bad.kind === 'money'
    ? 'סכום עד 9,999,999,999.99, חיובי או שלילי'
    : 'מספר שלם עד 2,147,483,647, חיובי או שלילי';
  return refuse(row, 'out-of-range',
    `הערך ${bad.value} בעמודת ${bad.column} חורג ממה שהמערכת יכולה לשמור (${limit})`);
}

// ---------------------------------------------------------------------------
// W5 sweep
// ---------------------------------------------------------------------------

interface OwnedRow {
  id: string;
  sourceRow: number | null;
}

/** Rows of `table` this block wrote and does not produce now. */
async function staleRows(
  db: AnyDb, table: TargetTable, blockId: string, produced: number[],
): Promise<OwnedRow[]> {
  const t = TABLES[table];
  // A null source_row is never one this run produced; `NOT IN` alone would
  // skip it, because NULL NOT IN (...) is not true.
  const notProduced = produced.length === 0
    ? undefined
    : or(isNull(t.sourceRow), notInArray(t.sourceRow, produced));
  return db.select({ id: t.id, sourceRow: t.sourceRow })
    .from(t)
    .where(and(eq(t.sourceBlockId, blockId), notProduced))
    .orderBy(asc(t.sourceRow));
}

function addReason(into: Map<string, string[]>, id: string | null, reason: string): void {
  if (id === null) return;
  into.set(id, [...(into.get(id) ?? []), reason]);
}

/**
 * Everything that depends on a stale row, by row id. Every reference to the
 * four target tables is checked here, including the one no foreign key
 * declares:
 *
 * - `obligation_settlements.obligation_id` → obligations (cascade)
 * - `obligation_settlements.ledger_entry_id` → ledger_entries (set null)
 * - `ledger_entries.transfer_group_id`, shared with another ledger row
 * - `ledger_entries.budget_line_id` → budget_lines (set null)
 * - `tasks.budget_line_id` → budget_lines (no foreign key; migration 0003)
 *
 * Nothing references `ticket_rounds`.
 *
 * `leavingLedger` is the ledger rows this sweep removes: a reference from a
 * row that is itself going away holds nothing back.
 */
async function dependents(
  db: AnyDb, table: TargetTable, ids: string[], leavingLedger: Set<string>,
): Promise<Map<string, string[]>> {
  const held = new Map<string, string[]>();

  if (table === 'obligations') {
    const settled = await db
      .select({ id: obligationSettlements.obligationId, n: count() })
      .from(obligationSettlements)
      .where(inArray(obligationSettlements.obligationId, ids))
      .groupBy(obligationSettlements.obligationId);
    for (const { id, n } of settled) {
      addReason(held, id, `על החוב הזה נרשמו סילוקים (${n}), ומחיקתו הייתה מוחקת אותם`);
    }
  }

  if (table === 'ledger_entries') {
    const settling = await db
      .select({ id: obligationSettlements.ledgerEntryId, n: count() })
      .from(obligationSettlements)
      .where(inArray(obligationSettlements.ledgerEntryId, ids))
      .groupBy(obligationSettlements.ledgerEntryId);
    for (const { id, n } of settling) {
      addReason(held, id, `התנועה הזו רשומה כסילוק של חוב (${n}), ומחיקתה הייתה מנתקת אותו`);
    }

    // Known asymmetry with the `budget_lines` check below, recorded rather
    // than fixed: the peer query has no `leavingLedger` exclusion, so two legs
    // of one transfer that are BOTH owned by this block retain each other
    // permanently — each is the other's surviving peer, and neither can ever
    // leave. Reaching that state takes a lead hand-setting `transferGroupId`
    // on two rows of a single block; nothing in the promoter or the workbooks
    // creates it, and no such pair exists in the camp's data. The fix is the
    // same shape as `booked` below (exclude ids this sweep is removing), and
    // it belongs with a test that can construct the pair.
    const grouped = await db
      .select({ id: ledgerEntries.id, group: ledgerEntries.transferGroupId })
      .from(ledgerEntries)
      .where(and(inArray(ledgerEntries.id, ids), isNotNull(ledgerEntries.transferGroupId)));
    const groups = [...new Set(grouped.map((row) => row.group as string))];
    if (groups.length > 0) {
      const legs = await db
        .select({ id: ledgerEntries.id, group: ledgerEntries.transferGroupId })
        .from(ledgerEntries)
        .where(inArray(ledgerEntries.transferGroupId, groups));
      for (const row of grouped) {
        if (legs.some((leg) => leg.group === row.group && leg.id !== row.id)) {
          addReason(held, row.id,
            'התנועה הזו היא צד אחד של העברה בין קופות, ומחיקתה הייתה משאירה את הצד השני לבדו');
        }
      }
    }
  }

  if (table === 'budget_lines') {
    const leaving = [...leavingLedger];
    const booked = await db
      .select({ id: ledgerEntries.budgetLineId, n: count() })
      .from(ledgerEntries)
      .where(and(
        inArray(ledgerEntries.budgetLineId, ids),
        leaving.length > 0 ? notInArray(ledgerEntries.id, leaving) : undefined,
      ))
      .groupBy(ledgerEntries.budgetLineId);
    for (const { id, n } of booked) {
      addReason(held, id, `תנועות כספיות (${n}) רשומות על הסעיף הזה, ומחיקתו הייתה מנתקת אותן`);
    }

    const assigned = await db
      .select({ id: tasks.budgetLineId, n: count() })
      .from(tasks)
      .where(inArray(tasks.budgetLineId, ids))
      .groupBy(tasks.budgetLineId);
    for (const { id, n } of assigned) {
      addReason(held, id, `משימות (${n}) משויכות לסעיף הזה, ומחיקתו הייתה מנתקת אותן`);
    }
  }

  return held;
}

/**
 * W5: a block owns its rows, in every target table — not only the one its
 * current archetype writes to, since a block re-confirmed as something else
 * still owns what it wrote before. In `current` it keeps the rows produced
 * this run; everywhere else it keeps none. A stale row something depends on
 * is retained and reported rather than deleted (or cascaded).
 *
 * Decided in full before anything is removed, so a dry run reports exactly
 * what a commit removes and retains.
 */
async function sweep(
  db: AnyDb, blockId: string, current: TargetTable | null, produced: number[],
  dryRun: boolean,
): Promise<{ deleted: number; retained: RetainedRow[] }> {
  const retained: RetainedRow[] = [];
  const doomed: [TargetTable, string[]][] = [];
  const leavingLedger = new Set<string>();

  for (const table of SWEEP_ORDER) {
    const stale = await staleRows(db, table, blockId, table === current ? produced : []);
    if (stale.length === 0) continue;

    const held = await dependents(db, table, stale.map((row) => row.id), leavingLedger);
    const leaving: string[] = [];
    for (const row of stale) {
      const reasons = held.get(row.id);
      if (reasons) {
        retained.push({ table, id: row.id, sheetRow: row.sourceRow, reason: reasons.join('; ') });
      } else {
        leaving.push(row.id);
      }
    }
    if (table === 'ledger_entries') leaving.forEach((id) => leavingLedger.add(id));
    doomed.push([table, leaving]);
  }

  let deleted = 0;
  for (const [table, ids] of doomed) {
    if (ids.length === 0) continue;
    if (dryRun) {
      deleted += ids.length;
      continue;
    }
    const t = TABLES[table];
    const gone = await db.delete(t).where(inArray(t.id, ids)).returning();
    deleted += gone.length;
  }

  return { deleted, retained };
}

// ---------------------------------------------------------------------------
// Promoted-row lookup
// ---------------------------------------------------------------------------

/**
 * Which of `blockIds` already own at least one row in any of the four target
 * tables, by non-null `source_block_id` — and how many.
 *
 * Lifted here from `src/lib/data/worklist.ts`, which used it first to make
 * the register's `promoted` state mean rows that actually exist rather than
 * rows a dry run would write. `promoteAllAction`'s skip gate needs exactly
 * the same fact — whether a block has already produced rows, not whether a
 * commit would write some — so `worklist.ts` now imports this rather than
 * keeping a second copy: two implementations of "does this block already
 * have rows" is the risk that gate exists to remove.
 *
 * Four queries for the whole set, not one per block: each is a single
 * grouped `count(*) … where source_block_id in (…)`, over `TABLES`. A block
 * appears in the result only if it has rows, so a count-reading caller uses
 * `?? 0` and a yes/no-reading caller uses `.has(blockId)`.
 */
export async function promotedRowCounts(
  db: AnyDb, blockIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (blockIds.length === 0) return totals;

  const groups = await Promise.all(
    Object.values(TABLES).map((t) => db
      .select({ blockId: t.sourceBlockId, n: count() })
      .from(t)
      .where(inArray(t.sourceBlockId, blockIds))
      .groupBy(t.sourceBlockId)),
  );

  for (const rows of groups) {
    for (const row of rows) {
      if (row.blockId === null) continue;
      totals.set(row.blockId, (totals.get(row.blockId) ?? 0) + Number(row.n));
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// promoteBlock
// ---------------------------------------------------------------------------

/**
 * Runs `fn` in a real transaction on either driver — the same cast
 * `runImport` uses, for the same reason: `Db` and `TestDb` each type
 * `.transaction()` against their own driver, so a callback typed against the
 * union satisfies neither for TypeScript. The cast is compile-time only.
 */
async function runInTransaction<T>(
  db: AnyDb, fn: (tx: AnyDb) => Promise<T>,
): Promise<T> {
  return (db as Db).transaction((tx) => fn(tx as unknown as AnyDb));
}

export interface BulkResult {
  results: PromotionResult[];
  writtenCount: number;
  refusedCount: number;
  /** Rows removed across every promoted block, in any target table. On a
   *  dry run, the rows a commit WOULD remove — summed across blocks, but
   *  nothing is actually removed. */
  deletedCount: number;
  /** Rows kept across every promoted block because something references
   *  them. Filled on a dry run too, for the same reason `deletedCount` is:
   *  a dry run reports what a commit would do, not what it did. */
  retainedCount: number;
  /** Blocks whose promotion threw a genuine database error rather than
   *  returning a business refusal — the two are not the same thing: a
   *  refusal is a normal outcome and lives in `results[].refused`; a
   *  failure here means the database itself rejected the write and the
   *  register cannot explain it to a lead in Hebrew. A failed block wrote
   *  nothing — its savepoint rolled back to before its own writes — while
   *  every block around it in the same run still committed normally. */
  failures: { blockId: string; message: string }[];
  /** `failures.length`, for a caller that only wants the count. */
  failedCount: number;
}

/**
 * Promotes every confirmed block, in a stable order (`sheets.name`, then
 * `blocks.top`) so two runs produce comparable output. Refusals are kept in
 * `results`: the register is a list of what could not be settled, so a
 * refused block is the point, not noise.
 *
 * The whole run is ONE outer transaction. Each `promoteBlock` call nests
 * inside it as a savepoint — both drivers support this (drizzle's PGlite
 * session opens `savepoint spN`; postgres-js delegates to
 * `client.savepoint`) — so a block whose write throws a genuine database
 * error rolls back only that block's savepoint; the loop catches the error,
 * records it in `failures`, and moves on to the next block. The outer
 * transaction then commits normally, so a bulk run always returns a
 * complete `BulkResult` and always persists whatever succeeded — a lead can
 * tell "18 of 20 promoted, block 19 failed, block 20 was fine" from the
 * result, rather than the caller seeing nothing at all because one block
 * out of many hit a bug. `promoteBlock` itself is unchanged for callers
 * that promote a single block directly: it still opens its own top-level
 * transaction and still throws on a genuine database error.
 */
export async function promoteAll(
  db: AnyDb, opts: { dryRun: boolean; recordedBy: string },
): Promise<BulkResult> {
  return runInTransaction(db, async (tx) => {
    const confirmed = await tx.select({ id: blocks.id })
      .from(blocks)
      .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
      .where(isNotNull(blocks.confirmedAt))
      .orderBy(sheets.name, blocks.top);

    const results: PromotionResult[] = [];
    const failures: { blockId: string; message: string }[] = [];
    for (const { id } of confirmed) {
      try {
        // Deliberately sequential: each block must finish (and, on
        // failure, roll back to its own savepoint) before the next one
        // starts. Running them concurrently would interleave writes and
        // sweeps against the same shared transaction.
        results.push(await promoteBlock(tx, id, opts));
      } catch (error) {
        failures.push({
          blockId: id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      results,
      writtenCount: results.reduce((n, r) => n + r.written.length, 0),
      refusedCount: results.reduce((n, r) => n + r.refused.length, 0),
      deletedCount: results.reduce((n, r) => n + r.deleted, 0),
      retainedCount: results.reduce((n, r) => n + r.retained.length, 0),
      failures,
      failedCount: failures.length,
    };
  });
}

/**
 * Turns one confirmed block into domain rows, or says why not.
 *
 * All of it — the writes, the name queue, the W5 sweep — runs in one
 * transaction: a row that fails in the database leaves the block exactly as
 * it was, not half re-promoted with its stale rows still standing.
 */
export async function promoteBlock(
  db: AnyDb, blockId: string, opts: { dryRun: boolean; recordedBy: string },
): Promise<PromotionResult> {
  return runInTransaction(db, (tx) => promoteWithin(tx, blockId, opts));
}

async function promoteWithin(
  db: AnyDb, blockId: string, opts: { dryRun: boolean; recordedBy: string },
): Promise<PromotionResult> {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) throw new Error(`unknown block ${blockId}`);

  const base = { blockId, archetype: block.archetype, dryRun: opts.dryRun };

  // A block refused as a whole produces nothing, so it keeps nothing: rows
  // it wrote while it was eligible go too. Otherwise moving authority to the
  // other copy of a sheet leaves both copies' rows standing (W13, W14).
  const reject = async (refusal: Refusal): Promise<PromotionResult> => {
    const { deleted, retained } = await sweep(db, blockId, null, [], opts.dryRun);
    return {
      ...base, written: [], refused: [refusal], deleted, retained,
    };
  };

  if (!block.confirmedAt) {
    return reject(wholeBlock(block, 'unconfirmed', MESSAGES.unconfirmed));
  }
  if (!hasPromoter(block.archetype)) {
    return reject(wholeBlock(block, 'no-promoter',
      block.archetype === 'account_balances' ? MESSAGES.accountBalances : MESSAGES.noPromoter));
  }

  const eligibility = (await sheetEligibility(db)).get(block.sheetId);
  // Every sheet belongs to an upload and the eligibility query joins on it,
  // so a missing entry is a broken database, not a state to promote through.
  if (!eligibility) throw new Error(`unknown sheet ${block.sheetId}`);
  if (eligibility.state !== 'eligible') {
    return reject(wholeBlock(block, `sheet-${eligibility.state}`,
      MESSAGES.sheet[eligibility.state]));
  }

  const [sheet] = await db.select().from(sheets).where(eq(sheets.id, block.sheetId));
  const [mapping] = await db.select().from(blockMappings)
    .where(eq(blockMappings.blockId, blockId));
  if (!mapping) {
    return reject(wholeBlock(block, 'unmapped-column', MESSAGES.unmapped));
  }

  const ctx: PromoteContext = {
    seasonId: sheet?.seasonId ?? null,
    recordedBy: opts.recordedBy,
    blockId,
    // Only meaningful to budgetRow; every other branch ignores it.
    budgetCategory: mapping.budgetCategory,
  };

  const written: PromotedRow[] = [];
  const refused: Refusal[] = [];
  const producedRows: number[] = [];

  // Each branch inserts the full row, but on conflict refreshes only what
  // the workbook row says (`fromSheet`). The rest is set once and is then a
  // lead's to change — an account, an event — and a re-run must not quietly
  // undo it. `budget_lines.category` is the one exception: it is not a
  // per-row decision made after promotion, it is the block mapping's own
  // stored decision (Task 15), so `fromSheet` carries it for that branch and
  // a fresh confirm wins on every re-promotion.
  for (const row of blockRows(block, mapping.columnMap)) {
    if (block.archetype === 'ledger') {
      const outcome = ledgerRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      const input = outcome.input;
      const tooBig = outOfRange(row, [
        { column: 'סכום', value: input.amount, kind: 'money' },
      ]);
      if (tooBig) {
        refused.push(tooBig);
        continue;
      }
      producedRows.push(row.sheetRow);
      let id: string | null = null;
      if (!opts.dryRun) {
        const fromSheet = {
          occurredOn: input.occurredOn,
          direction: input.direction,
          amount: fromAgorot(toAgorot(input.amount)),
          description: input.description,
          seasonId: input.seasonId ?? null,
        };
        const [saved] = await db.insert(ledgerEntries).values({
          ...fromSheet,
          accountId: input.accountId ?? null,
          eventId: input.eventId ?? null,
          budgetLineId: input.budgetLineId ?? null,
          transferGroupId: input.transferGroupId ?? null,
          recordedBy: input.recordedBy,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        })
          .onConflictDoUpdate({
            target: [ledgerEntries.sourceBlockId, ledgerEntries.sourceRow],
            set: fromSheet,
          })
          .returning();
        id = saved.id;
      }
      written.push({
        table: 'ledger_entries', sheetRow: row.sheetRow, id,
        summary: input.description, notes: outcome.notes,
      });
    } else if (block.archetype === 'budget_lines') {
      const outcome = budgetRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      const input = outcome.input;
      const tooBig = outOfRange(row, [
        { column: 'כמות', value: input.quantityNum, kind: 'money' },
        { column: 'מחיר ליחידה', value: input.unitCost, kind: 'money' },
        { column: 'עלות כוללת', value: input.total, kind: 'money' },
      ]);
      if (tooBig) {
        refused.push(tooBig);
        continue;
      }
      producedRows.push(row.sheetRow);
      let id: string | null = null;
      if (!opts.dryRun) {
        const fromSheet = {
          seasonId: input.seasonId,
          label: input.label,
          quantityText: input.quantityText ?? null,
          quantityNum: input.quantityNum === undefined
            ? null : fromAgorot(toAgorot(input.quantityNum)),
          unitCost: input.unitCost === undefined
            ? null : fromAgorot(toAgorot(input.unitCost)),
          total: fromAgorot(toAgorot(input.total)),
          rationale: input.rationale ?? null,
          // Unlike the rest of `promote.ts`'s "set once, then a lead's to
          // change" convention (W9): `category` is not a per-row decision a
          // lead makes on the promoted row, it is the block mapping's stored
          // decision (Task 15). A fresh confirm — even an implicitly
          // defaulted one — is a lead's current statement about the whole
          // block and must win on re-promotion, including over a value set
          // directly on the row some other way.
          category: input.category,
        };
        const [saved] = await db.insert(budgetLines).values({
          ...fromSheet,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        })
          .onConflictDoUpdate({
            target: [budgetLines.sourceBlockId, budgetLines.sourceRow],
            set: fromSheet,
          })
          .returning();
        id = saved.id;
      }
      written.push({
        table: 'budget_lines', sheetRow: row.sheetRow, id,
        summary: input.label, notes: outcome.notes,
      });
    } else if (block.archetype === 'ticket_rounds') {
      const outcome = ticketRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      const input = outcome.input;
      const tooBig = outOfRange(row, [
        { column: 'כמות', value: input.quantity, kind: 'integer' },
        { column: 'מחיר', value: input.price, kind: 'money' },
        { column: 'סה״כ', value: input.total, kind: 'money' },
      ]);
      if (tooBig) {
        refused.push(tooBig);
        continue;
      }
      producedRows.push(row.sheetRow);
      let id: string | null = null;
      if (!opts.dryRun) {
        const fromSheet = {
          seasonId: input.seasonId,
          label: input.label,
          quantity: input.quantity ?? null,
          price: input.price === undefined ? null : fromAgorot(toAgorot(input.price)),
          total: fromAgorot(toAgorot(input.total)),
        };
        const [saved] = await db.insert(ticketRounds).values({
          ...fromSheet,
          eventId: input.eventId ?? null,
          sold: input.sold ?? false,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        })
          .onConflictDoUpdate({
            target: [ticketRounds.sourceBlockId, ticketRounds.sourceRow],
            set: fromSheet,
          })
          .returning();
        id = saved.id;
      }
      written.push({
        table: 'ticket_rounds', sheetRow: row.sheetRow, id,
        summary: input.label, notes: outcome.notes,
      });
    } else {
      const outcome = obligationRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      const input = outcome.input;
      // Before the party is resolved: a refused row queues no name.
      const tooBig = outOfRange(row, [
        { column: 'סכום', value: input.amount, kind: 'money' },
      ]);
      if (tooBig) {
        refused.push(tooBig);
        continue;
      }
      producedRows.push(row.sheetRow);

      let partyPersonId: string | undefined;
      let partyName: string | undefined;
      const notes = [...outcome.notes];
      if (outcome.partyRaw !== null) {
        const resolution = await resolveName(db, outcome.partyRaw);
        if (resolution.personId) {
          partyPersonId = resolution.personId;
        } else {
          partyName = outcome.partyRaw;
          notes.push(`השם ${outcome.partyRaw} לא זוהה — נשמר כטקסט וממתין לקישור`);
          if (!opts.dryRun) await recordUnlinkedName(db, outcome.partyRaw, 'import');
        }
      }

      let id: string | null = null;
      if (!opts.dryRun) {
        const fromSheet = {
          direction: input.direction,
          partyPersonId: partyPersonId ?? input.partyPersonId ?? null,
          partyName: partyName ?? input.partyName ?? null,
          description: input.description,
          amount: fromAgorot(toAgorot(input.amount)),
          seasonId: input.seasonId ?? null,
          openedOn: input.openedOn,
        };
        const [saved] = await db.insert(obligations).values({
          ...fromSheet,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        })
          .onConflictDoUpdate({
            target: [obligations.sourceBlockId, obligations.sourceRow],
            set: fromSheet,
          })
          .returning();
        id = saved.id;
      }
      written.push({
        table: 'obligations', sheetRow: row.sheetRow, id,
        summary: input.description, notes,
      });
    }
  }

  const { deleted, retained } = await sweep(
    db, blockId, TARGETS[block.archetype], producedRows, opts.dryRun,
  );

  return {
    ...base, written, refused, deleted, retained,
  };
}
