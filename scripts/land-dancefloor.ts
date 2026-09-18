/**
 * Landing the dancefloor's budget table: confirm `תקציב רחבה ברן 25` as the
 * dancefloor's budget, promote it, move the four `tasks.budget_line_id`
 * references onto the promoted rows, and delete the four seeded rows they used
 * to point at — all in ONE transaction, on a clone, never on live.
 *
 * Block `fa78b9be` is the one block the cutover deliberately left unconfirmed.
 * Its rows reproduce the four seeded `dancefloor` budget lines (89,060 total),
 * and until Task 15 gave `applyConfirmation` a budget category there was no way
 * to promote them as anything but `camp` — so promoting would have left ברן 25
 * holding two copies of the dancefloor at two different categories, with four
 * tasks pointing at the copy about to be deleted and no foreign key to notice.
 *
 * ## The shape, and why each part of it exists
 *
 * `scripts/cutover.ts` is the discipline this mirrors, and the three rules that
 * matter most are its rules 1, 2 and 3:
 *
 *  1. ONE transaction. Promote, re-point, delete and verify together, or not at
 *     all. The obvious order — promote, look, then delete — leaves a window in
 *     which ברן 25 holds the dancefloor twice, 178,120 instead of 89,060, and
 *     any balance read inside that window is simply wrong.
 *  2. Delete by enumerated id. The four seeded ids below were read off live and
 *     are checked, row by row, against the label and the amount this script
 *     expects before anything is deleted. A `where category = 'dancefloor'`
 *     evaluated at run time has had no such review.
 *  3. Gate each delete on ITS OWN replacement, and let ambiguity stop the run.
 *     A seeded row is deleted only when EXACTLY ONE row promoted from this
 *     block agrees with it on season, on the label under `normalizeHebrew`, and
 *     on the amount to the agora. Zero matches or two matches refuse the whole
 *     run: two rows that could each be the replacement mean nobody has decided
 *     which one the tasks should follow.
 *
 * Two rules are this script's own, because `tasks.budget_line_id` has no
 * foreign key (migration 0003 — verified again here, see `assertNoDangling`):
 *
 *  4. A task reference is moved BEFORE its row is deleted, in the same
 *     transaction, and afterwards no `tasks.budget_line_id` may point at a row
 *     that no longer exists. Nothing in the database enforces that, so this
 *     check is the only thing standing between the lead and a task silently
 *     pointing at nothing.
 *  5. Both totals are asserted at the end, inside the transaction: ברן 25's
 *     `dancefloor` budget must still be 89,060.00 counted ONCE, and its `camp`
 *     budget must be unchanged at 59,587.00. Either one moving rolls everything
 *     back — a moved total is the signature of a double count or of a row
 *     landing in the wrong budget.
 *
 * ## What it does NOT do
 *
 * It never renames a database — making a verified clone live is the
 * controller's step. It never writes to `shliff`: the guard is an allowlist and
 * this script narrows it to `shliff_dancefloor` alone, exactly as `cutover.ts`
 * narrows it to `shliff_cutover`. It touches no table but `blocks`,
 * `block_mappings`, `layout_signatures` (all three through
 * `applyConfirmation`), `budget_lines` and `tasks.budget_line_id`.
 *
 * ## Runbook
 *
 *   docker exec shliff-pg pg_dump -U shliff -d shliff --no-owner --no-acl > backup.sql
 *   docker exec shliff-pg psql -U shliff -d postgres \
 *     -c "drop database if exists shliff_dancefloor;" \
 *     -c "create database shliff_dancefloor;"
 *   docker exec -i shliff-pg psql -U shliff -d shliff_dancefloor \
 *     -q -v ON_ERROR_STOP=1 < backup.sql
 *   DATABASE_URL=postgres://shliff:<pw>@localhost:5433/shliff_dancefloor \
 *     npx tsx scripts/land-dancefloor.ts            # dry run, prints the plan
 *   DATABASE_URL=… npx tsx scripts/land-dancefloor.ts --commit
 *
 * `pg_dump | psql` rather than `create database … template shliff`: the
 * template path fails with "source database is being accessed by other users"
 * whenever a dev server holds a connection to live, and `pg_dump` on live is
 * read-only. Live's migration journal already records all eight migrations by
 * file sha256, so a clone taken this way needs no `drizzle-kit migrate`.
 *
 * Follows `dry-run-promote.ts` for how the handle is obtained: `@/db` builds
 * its client at import time, so it is imported dynamically, after the guard.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { blocks, blockMappings, sheets } from '@/db/schema/source';
import { seasons, tasks } from '@/db/schema/camp';
import { budgetLines } from '@/db/schema/money';
import { applyConfirmation } from '@/lib/import/confirm';
import { promoteBlock } from '@/lib/import/promote/promote';
import { normalizeHebrew } from '@/lib/text/normalize';
import { formatILS, toAgorot } from '@/lib/money';
import type { AnyDb } from '@/lib/db-types';
import { assertScratchDatabase, DANCEFLOOR_DATABASE } from './scratch-guard';

// ---------------------------------------------------------------------------
// The facts this script was written against, transcribed
// ---------------------------------------------------------------------------

/** `תקציב רחבה ברן 25` A1:D26 in `קופת קאמפ 25’` — the dancefloor's budget.
 *  Re-picked from `event_lines` to `budget_lines` during the cutover's
 *  evidence run and left unconfirmed there on purpose. */
const BLOCK_ID = 'fa78b9be-8b93-49ce-8bd0-c2ec11fe0672';

/** The season the whole operation is scoped to. Named, not id'd: the id is
 *  read from the clone so a re-seeded database cannot be acted on by accident
 *  with a stale uuid. */
const SEASON_NAME = 'ברן 25';

/**
 * The seeded `dancefloor` lines, as they stand on live: four rows,
 * `source_block_id IS NULL`, 89,060.00 together, each one referenced by
 * exactly one `tasks` row.
 *
 * Enumerated rather than queried (cutover rule 2) so that a fifth seeded
 * dancefloor row appearing after this was written stops the run instead of
 * being silently swept along with the four a reviewer checked.
 */
interface SeededLine {
  id: string;
  label: string;
  amount: string;
  /** The block row a reviewer expects to replace it — printed for comparison,
   *  never used to find the replacement. The mapping below is derived from the
   *  promoted rows themselves, so a block whose rows have moved produces a
   *  visibly different mapping rather than a quietly wrong one. */
  expectedRow: number;
}

const SEEDED: readonly SeededLine[] = [
  { id: '59a66ac1-cf51-4035-9a8f-5f442d90daa0', label: 'מייצג', amount: '41300.00', expectedRow: 3 },
  { id: '15aecf85-467f-428c-af0b-36c743057cf5', label: 'חשמל', amount: '12950.00', expectedRow: 4 },
  { id: '8aed0b22-a1c9-4626-ac73-e3d76292ef47', label: 'הגברה + תאורה', amount: '30810.00', expectedRow: 5 },
  { id: '2f8b932f-08d6-47cb-80d2-aca95d2b581f', label: 'הובלה', amount: '4000.00', expectedRow: 6 },
];

/** ברן 25's dancefloor budget, counted once. Unchanged by this operation or it
 *  rolls back. */
const EXPECTED_DANCEFLOOR = '89060.00';

/** ברן 25's camp budget. This operation must not touch it: every row this
 *  block produces belongs to the dancefloor, so a camp total that moves means a
 *  row landed in the wrong budget. */
const EXPECTED_CAMP = '59587.00';

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const out: string[] = [];
function say(line = ''): void {
  out.push(line);
}

/** `numeric(12,2)` text compared as the money it is: `0.00` and `0` are the
 *  same amount and different strings. `toAgorot` is the project's only
 *  converter and a second copy of `Math.round(n * 100)` in the file that
 *  decides what gets deleted is the last place worth having one. */
function sameMoney(a: string, b: string): boolean {
  return toAgorot(a) === toAgorot(b);
}

/** The cutover's own label comparison: the seed truncated three labels
 *  relative to the workbook, so label equality is `normalizeHebrew` equality
 *  or nothing. */
function sameLabel(a: string, b: string): boolean {
  return normalizeHebrew(a) === normalizeHebrew(b);
}

/** Thrown to roll a verified transaction back. Not an error: the dry run's
 *  whole point is that it does all the work and then keeps none of it. */
class DryRunRollback extends Error {
  constructor() {
    super('dry run — rolling back');
    this.name = 'DryRunRollback';
  }
}

/** A check that failed. Distinct from `DryRunRollback` so the outer handler
 *  can tell "nothing was wrong, we chose not to keep it" from "stop". */
class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface BudgetRow {
  id: string;
  label: string;
  total: string;
  category: string;
  seasonId: string;
  sourceBlockId: string | null;
  sourceRow: number | null;
}

async function readBudgetLines(db: AnyDb): Promise<BudgetRow[]> {
  return db.select({
    id: budgetLines.id,
    label: budgetLines.label,
    total: budgetLines.total,
    category: budgetLines.category,
    seasonId: budgetLines.seasonId,
    sourceBlockId: budgetLines.sourceBlockId,
    sourceRow: budgetLines.sourceRow,
  }).from(budgetLines);
}

/** One season's budget in one category, summed in the database rather than in
 *  JavaScript: the assertion is about what a money screen would read. */
async function categoryTotal(
  db: AnyDb, seasonId: string, category: 'camp' | 'dancefloor',
): Promise<{ agorot: number; rows: number }> {
  const [row] = await db.select({
    total: sql<string>`coalesce(sum(${budgetLines.total}), 0)`,
    n: sql<string>`count(*)`,
  })
    .from(budgetLines)
    .where(and(eq(budgetLines.seasonId, seasonId), eq(budgetLines.category, category)));
  return { agorot: toAgorot(row.total), rows: Number(row.n) };
}

interface TaskRef {
  id: string;
  title: string;
  budgetLineId: string | null;
}

async function readTaskRefs(db: AnyDb): Promise<TaskRef[]> {
  return db.select({ id: tasks.id, title: tasks.title, budgetLineId: tasks.budgetLineId })
    .from(tasks)
    .where(sql`${tasks.budgetLineId} is not null`);
}

/**
 * The check no foreign key performs: every `tasks.budget_line_id` still names
 * a `budget_lines` row that exists.
 *
 * A left join rather than a NOT IN: `budget_line_id` is nullable and `NOT IN`
 * over a set containing a null is never true, so the predicate that reads most
 * naturally is the one that silently finds nothing.
 */
async function assertNoDangling(db: AnyDb, when: string): Promise<void> {
  const dangling = await db.select({ id: tasks.id, title: tasks.title, ref: tasks.budgetLineId })
    .from(tasks)
    .leftJoin(budgetLines, eq(budgetLines.id, tasks.budgetLineId))
    .where(and(sql`${tasks.budgetLineId} is not null`, isNull(budgetLines.id)));

  if (dangling.length === 0) {
    say(`  ok  ${when}: no tasks.budget_line_id points at a row that does not exist`);
    return;
  }
  for (const row of dangling) {
    say(`  !!  task ${row.id} ("${row.title}") points at ${row.ref}, which is not a budget line`);
  }
  throw new Refusal(
    `${dangling.length} tasks.budget_line_id references dangle ${when}. There is no `
    + 'foreign key here, so nothing but this check stands between the lead and a task '
    + 'silently pointing at nothing. Rolling back.',
  );
}

// ---------------------------------------------------------------------------
// The mapping — one seeded row, exactly one replacement
// ---------------------------------------------------------------------------

interface Mapped {
  seeded: SeededLine;
  promoted: BudgetRow;
}

/**
 * Pairs each seeded row with the single row promoted from this block that
 * replaces it, or explains why there is not one.
 *
 * Candidates are drawn from THIS BLOCK only. `הובלה` ברן 25 4,000 also exists
 * as a promoted `camp` line from `254bef9f` r13 — the camp budget's own
 * transport line — and whether that is the same fact as the dancefloor's
 * deliverable is an open question for the lead. Widening the candidate set to
 * every block would turn that open question into a two-way ambiguity that
 * stopped this run for a reason unrelated to the dancefloor.
 *
 * Both directions are checked. One-to-one is not "every seeded row found a
 * replacement": two seeded rows could find the same promoted row, and then
 * deleting both would leave one fact where there were two and two tasks
 * pointing at one line.
 */
function mapReplacements(
  seeded: readonly SeededLine[], promoted: BudgetRow[],
): { mapped: Mapped[]; problems: string[] } {
  const mapped: Mapped[] = [];
  const problems: string[] = [];

  for (const line of seeded) {
    const candidates = promoted.filter((row) => sameLabel(row.label, line.label)
      && sameMoney(row.total, line.amount));

    if (candidates.length === 0) {
      problems.push(`no promoted row from this block matches ${line.label} ${line.amount} `
        + '(same season, same label, same amount) — nothing replaces it, so it cannot be deleted');
      continue;
    }
    if (candidates.length > 1) {
      problems.push(`${candidates.length} promoted rows match ${line.label} ${line.amount} `
        + `(rows ${candidates.map((row) => `r${row.sourceRow}`).join(', ')}) — which one the `
        + 'tasks should follow is a decision, not something this script may pick');
      continue;
    }
    mapped.push({ seeded: line, promoted: candidates[0] });
  }

  const used = new Map<string, string[]>();
  for (const pair of mapped) {
    used.set(pair.promoted.id, [...(used.get(pair.promoted.id) ?? []), pair.seeded.label]);
  }
  for (const [id, labels] of used) {
    if (labels.length > 1) {
      problems.push(`promoted row ${id} is the replacement for ${labels.length} seeded rows `
        + `(${labels.join(', ')}) — the mapping is not one-to-one`);
    }
  }

  return { mapped, problems };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commit = argv.includes('--commit');
  const actor = argv.find((arg) => arg.startsWith('--actor='))?.slice('--actor='.length)
    ?? 'land-dancefloor';

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Narrowed to one name, as `cutover.ts` is: this script deletes financial
  // rows and rewrites references no foreign key protects, so the other scratch
  // clones are as wrong for it as live is.
  const dbName = assertScratchDatabase(url, DANCEFLOOR_DATABASE);

  // Imported here, not at the top: `@/db` connects at import time.
  const { db } = await import('@/db');

  say(`# Landing the dancefloor table — database "${dbName}"`);
  say(`generated ${new Date().toISOString()}`);
  say(commit
    ? 'MODE: --commit. The transaction below is kept.'
    : 'MODE: dry run. Everything below really happens, inside one transaction, and the '
      + 'transaction is then rolled back. Pass --commit to keep it.');
  say(`actor: ${actor}`);
  say();

  const [season] = await db.select({ id: seasons.id, name: seasons.name })
    .from(seasons).where(eq(seasons.name, SEASON_NAME));
  if (!season) {
    throw new Refusal(`no season named "${SEASON_NAME}" in this database`);
  }

  let rolledBack = false;
  try {
    await (db as unknown as {
      transaction: <T>(fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
    }).transaction(async (tx) => {
      // -- 0. The block, its sheet and its stored mapping -------------------
      say('## The block');
      say();
      const [block] = await tx.select().from(blocks).where(eq(blocks.id, BLOCK_ID));
      if (!block) {
        throw new Refusal(`block ${BLOCK_ID} is not in this database — the clone was taken `
          + 'from a database this script was not written against');
      }
      const [sheet] = await tx.select({
        id: sheets.id, name: sheets.name, seasonId: sheets.seasonId,
        authoritative: sheets.authoritative,
      }).from(sheets).where(eq(sheets.id, block.sheetId));
      const [mappingBefore] = await tx.select().from(blockMappings)
        .where(eq(blockMappings.blockId, BLOCK_ID));

      say(`id:          ${BLOCK_ID}`);
      say(`sheet:       ${sheet?.name ?? '(missing)'} `
        + `(season=${sheet?.seasonId === season.id ? SEASON_NAME : (sheet?.seasonId ?? 'UNSET')}, `
        + `authoritative=${sheet?.authoritative ?? 'null'})`);
      say(`bounds:      rows ${block.top}-${block.bottom} cols ${block.left}-${block.right}, `
        + `header row ${block.headerRow ?? 'none'}`);
      say(`archetype:   ${block.archetype}`);
      say(`confirmed:   ${block.confirmedAt ? block.confirmedAt.toISOString() : 'NO'}`
        + `${block.confirmedBy ? ` by ${block.confirmedBy}` : ''}`);
      say(`column map:  ${(mappingBefore?.columnMap ?? [])
        .map((entry) => `${entry.field}=c${entry.column}`).join(' ') || '(none)'}`);
      say(`category:    ${mappingBefore?.budgetCategory ?? 'null'} (before this run)`);
      say();
      if (sheet?.seasonId !== season.id) {
        throw new Refusal(`the block's sheet is not labelled ${SEASON_NAME}, so its rows would `
          + 'carry a different season than the seeded rows they are meant to replace');
      }

      // -- 1. The population, before anything is written --------------------
      //
      // Read before the promotion, so "seeded" means what it meant when these
      // four rows were reviewed rather than whatever the promoter just wrote.
      // A fifth seeded dancefloor row has no reviewed replacement and no
      // enumerated id: it would be left standing with nobody told.
      say('## The seeded population');
      say();
      const before = await readBudgetLines(tx);
      const seededDancefloor = before.filter((row) => row.category === 'dancefloor'
        && row.sourceBlockId === null);
      const enumeratedIds = new Set(SEEDED.map((line) => line.id));

      for (const row of seededDancefloor) {
        const known = enumeratedIds.has(row.id) ? 'enumerated' : '!! NOT ENUMERATED';
        say(`  ${row.id}  ${row.label}  ${row.total}  ${known}`);
      }
      say();
      if (seededDancefloor.length !== SEEDED.length) {
        throw new Refusal(`${seededDancefloor.length} seeded dancefloor budget lines, but `
          + `${SEEDED.length} were reviewed. A row this script never saw has no replacement `
          + 'to be gated on, so nothing is promoted and nothing is deleted.');
      }
      for (const line of SEEDED) {
        const row = seededDancefloor.find((candidate) => candidate.id === line.id);
        if (!row) {
          throw new Refusal(`seeded row ${line.id} (${line.label}) is not in this database as an `
            + 'unpromoted dancefloor line — has this script already run?');
        }
        if (!sameLabel(row.label, line.label)) {
          throw new Refusal(`seeded row ${line.id} reads "${row.label}", this script expects `
            + `"${line.label}" — the list is stale and must not be acted on`);
        }
        if (!sameMoney(row.total, line.amount)) {
          throw new Refusal(`seeded row ${line.id} (${line.label}) holds ${row.total}, this `
            + `script expects ${line.amount} — the list is stale`);
        }
        if (row.seasonId !== season.id) {
          throw new Refusal(`seeded row ${line.id} (${line.label}) is not in ${SEASON_NAME}`);
        }
      }

      const refsBefore = await readTaskRefs(tx);
      const refsToSeeded = refsBefore.filter((task) => task.budgetLineId !== null
        && enumeratedIds.has(task.budgetLineId));
      say('tasks pointing at the seeded rows:');
      for (const task of refsBefore) {
        const seededLine = SEEDED.find((line) => line.id === task.budgetLineId);
        say(`  ${task.id}  "${task.title}"  -> ${task.budgetLineId}`
          + `${seededLine ? ` (${seededLine.label})` : '  !! not one of the four'}`);
      }
      say();
      await assertNoDangling(tx, 'before');
      say();

      // -- 2. Both totals, before -------------------------------------------
      const dancefloorBefore = await categoryTotal(tx, season.id, 'dancefloor');
      const campBefore = await categoryTotal(tx, season.id, 'camp');
      say('## Totals before');
      say();
      say(`${SEASON_NAME} dancefloor: ${formatILS(dancefloorBefore.agorot)} `
        + `over ${dancefloorBefore.rows} rows`);
      say(`${SEASON_NAME} camp:       ${formatILS(campBefore.agorot)} `
        + `over ${campBefore.rows} rows`);
      say();
      if (dancefloorBefore.agorot !== toAgorot(EXPECTED_DANCEFLOOR)) {
        throw new Refusal(`${SEASON_NAME}'s dancefloor budget is `
          + `${formatILS(dancefloorBefore.agorot)}, not ${EXPECTED_DANCEFLOOR}, before this run `
          + 'even starts. This script was written against a different database state.');
      }
      if (campBefore.agorot !== toAgorot(EXPECTED_CAMP)) {
        throw new Refusal(`${SEASON_NAME}'s camp budget is ${formatILS(campBefore.agorot)}, not `
          + `${EXPECTED_CAMP}, before this run even starts.`);
      }

      // -- 3. Confirm the block as the dancefloor's budget ------------------
      //
      // Through `applyConfirmation` (R46), which is the lever that exists for
      // exactly this: it stores the lead's category decision on the block
      // MAPPING, and `budgetRow` reads it from there. Writing `category`
      // onto the promoted rows by hand would be undone by the next
      // re-promotion, because `category` travels in the promoter's
      // `fromSheet` set and a fresh confirm wins.
      //
      // The stored column map is passed through rather than `[]`: the block's
      // archetype is ALREADY `budget_lines` (it was re-picked during the
      // cutover's evidence run and left unconfirmed), and `applyConfirmation`
      // only recomputes the map when the archetype CHANGES. An unchanged
      // archetype keeps the caller's map verbatim, so passing an empty one
      // would erase `item=c1 total=c2` and every row would refuse `no-amount`.
      // This is what the confirm screen does too: it submits the map on show.
      say('## Confirmation');
      say();
      await applyConfirmation(
        tx, actor, BLOCK_ID, 'budget_lines', mappingBefore?.columnMap ?? [], 'dancefloor',
      );
      const [mappingAfter] = await tx.select().from(blockMappings)
        .where(eq(blockMappings.blockId, BLOCK_ID));
      const [blockAfter] = await tx.select().from(blocks).where(eq(blocks.id, BLOCK_ID));
      say(`archetype:   ${blockAfter.archetype}`);
      say(`confirmed:   ${blockAfter.confirmedAt?.toISOString() ?? 'NO'} by `
        + `${blockAfter.confirmedBy ?? '(nobody)'}`);
      say(`column map:  ${(mappingAfter?.columnMap ?? [])
        .map((entry) => `${entry.field}=c${entry.column}`).join(' ') || '(none)'}`);
      say(`category:    ${mappingAfter?.budgetCategory ?? 'null'}`);
      say();
      if (mappingAfter?.budgetCategory !== 'dancefloor') {
        throw new Refusal('the block mapping does not carry budgetCategory=dancefloor after '
          + 'confirmation, so every promoted row would be categorised camp');
      }
      if (!(mappingAfter.columnMap ?? []).some((entry) => entry.field === 'total')) {
        throw new Refusal('the confirmed column map has no `total` column, so every row would '
          + 'refuse `no-amount`. The stored map was not passed through.');
      }

      // -- 4. Promote -------------------------------------------------------
      //
      // Inside the outer transaction: `promoteBlock` opens its own, which
      // nests as a savepoint on this driver, so its writes commit or roll back
      // with everything else here.
      const result = await promoteBlock(tx, BLOCK_ID, { dryRun: false, recordedBy: actor });

      say('## What the block produces — every row, in full');
      say();
      say(`written: ${result.written.length}   refused: ${result.refused.length}   `
        + `swept: ${result.deleted} deleted, ${result.retained.length} retained`);
      say();
      const afterPromotion = await readBudgetLines(tx);
      const promoted = afterPromotion.filter((row) => row.sourceBlockId === BLOCK_ID);
      const promotedByRow = new Map(promoted.map((row) => [row.sourceRow, row]));

      for (const row of [...result.written].sort((a, b) => a.sheetRow - b.sheetRow)) {
        const stored = promotedByRow.get(row.sheetRow);
        say(`  r${String(row.sheetRow).padStart(2)}  ${stored?.total.padStart(10) ?? '?'}  `
          + `${stored?.category ?? '?'}  ${row.summary}  ${stored?.id ?? '(no id)'}`);
        for (const note of row.notes) say(`        note: ${note}`);
      }
      say();
      say('refused:');
      for (const refusal of [...result.refused].sort((a, b) => a.sheetRow - b.sheetRow)) {
        say(`  r${String(refusal.sheetRow).padStart(2)}  ${refusal.reason.padEnd(15)} `
          + `${refusal.message}`);
      }
      say();
      const wrongCategory = promoted.filter((row) => row.category !== 'dancefloor');
      if (wrongCategory.length > 0) {
        throw new Refusal(`${wrongCategory.length} promoted rows are not categorised `
          + 'dancefloor, so the confirmation did not reach the promoter');
      }
      const wrongProvenance = promoted.filter((row) => row.sourceRow === null);
      if (wrongProvenance.length > 0) {
        throw new Refusal(`${wrongProvenance.length} promoted rows carry no source_row, so they `
          + 'cannot be traced back to the workbook row they came from');
      }

      // -- 5. The mapping, printed before it is acted on ---------------------
      say('## The mapping — one seeded row, exactly one replacement');
      say();
      const { mapped, problems } = mapReplacements(
        SEEDED, promoted.filter((row) => row.seasonId === season.id),
      );
      for (const pair of mapped) {
        const expected = pair.promoted.sourceRow === pair.seeded.expectedRow
          ? '' : `  !! expected r${pair.seeded.expectedRow}`;
        say(`  ok  ${pair.seeded.label} ${pair.seeded.amount}  ${pair.seeded.id}`);
        say(`      -> r${pair.promoted.sourceRow} ${pair.promoted.total} `
          + `${pair.promoted.category}  ${pair.promoted.id}${expected}`);
      }
      for (const problem of problems) say(`  !!  ${problem}`);
      say();

      // Rows this block promotes that replace nothing. Not a refusal in
      // itself — six of them are the dancefloor's own expenses, which the seed
      // never held — but they are what moves the dancefloor total, so they are
      // named here in full rather than left to be inferred from the arithmetic.
      const replacements = new Set(mapped.map((pair) => pair.promoted.id));
      const newRows = promoted.filter((row) => !replacements.has(row.id));
      say(`rows this block promotes that replace no seeded row: ${newRows.length}`);
      for (const row of [...newRows].sort((a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0))) {
        say(`  r${String(row.sourceRow).padStart(2)}  ${row.total.padStart(10)}  ${row.label}`);
      }
      const newAgorot = newRows.reduce((sum, row) => sum + toAgorot(row.total), 0);
      say(`  their total: ${formatILS(newAgorot)}`);
      say();

      if (problems.length > 0) {
        throw new Refusal(`${problems.length} of the ${SEEDED.length} seeded rows could not be `
          + 'mapped to exactly one replacement. Ambiguity stops the run: a row whose '
          + 'replacement nobody has chosen must not be deleted, and a task must not be '
          + 'pointed at a row picked by a coin toss.');
      }
      if (mapped.length !== SEEDED.length) {
        throw new Refusal(`mapped ${mapped.length} of ${SEEDED.length} seeded rows`);
      }

      // -- 6. Move the task references, before their rows are deleted --------
      say('## Moving the task references');
      say();
      let moved = 0;
      for (const pair of mapped) {
        // `.returning()` with no projection: `AnyDb` is a union of two drivers
        // and only its zero-argument overload resolves across both, which is
        // why `cutover.ts`'s `deleteByIds` does the same.
        const updated = await tx.update(tasks)
          .set({ budgetLineId: pair.promoted.id })
          .where(eq(tasks.budgetLineId, pair.seeded.id))
          .returning();
        moved += updated.length;
        for (const task of updated) {
          say(`  ok  task ${task.id} ("${task.title}")  ${pair.seeded.id} -> `
            + `${pair.promoted.id}  (${pair.seeded.label})`);
        }
        if (updated.length === 0) {
          say(`  --  no task pointed at ${pair.seeded.label} (${pair.seeded.id})`);
        }
      }
      say();
      say(`references moved: ${moved} of ${refsToSeeded.length} that pointed at a seeded row`);
      if (moved !== refsToSeeded.length) {
        throw new Refusal(`${refsToSeeded.length} tasks pointed at the seeded rows but ${moved} `
          + 'were moved. A reference left behind would dangle the moment its row is deleted.');
      }
      say();

      // -- 7. Delete the seeded rows, by enumerated id ----------------------
      say('## Deletion');
      say();
      const ids = SEEDED.map((line) => line.id);
      const deleted = await tx.delete(budgetLines)
        .where(inArray(budgetLines.id, ids))
        .returning();
      for (const row of deleted) say(`  deleted  ${row.id}  ${row.label}  ${row.total}`);
      say();
      if (deleted.length !== ids.length) {
        throw new Refusal(`expected to delete ${ids.length} seeded rows, deleted `
          + `${deleted.length}`);
      }

      // -- 8. The check no foreign key performs -----------------------------
      say('## Task references after');
      say();
      const refsAfter = await readTaskRefs(tx);
      const expectedRef = new Map(mapped.map((pair) => [pair.seeded.id, pair.promoted.id]));
      const promotedIds = new Set(promoted.map((row) => row.id));
      for (const task of refsAfter) {
        const ok = task.budgetLineId !== null && promotedIds.has(task.budgetLineId);
        say(`  ${ok ? 'ok' : '!!'}  ${task.id}  "${task.title}"  -> ${task.budgetLineId}`);
      }
      say();
      await assertNoDangling(tx, 'after');
      const stillSeeded = refsAfter.filter((task) => task.budgetLineId !== null
        && enumeratedIds.has(task.budgetLineId));
      if (stillSeeded.length > 0) {
        throw new Refusal(`${stillSeeded.length} tasks still point at a deleted seeded row`);
      }
      if (refsAfter.length !== refsBefore.length) {
        throw new Refusal(`${refsBefore.length} tasks carried a budget line before and `
          + `${refsAfter.length} do after — a reference was lost, not moved`);
      }
      if ([...expectedRef.values()].some((id) => !refsAfter
        .some((task) => task.budgetLineId === id))) {
        throw new Refusal('a promoted replacement has no task pointing at it, though its '
          + 'seeded row did');
      }
      say();

      // -- 9. Both totals, after --------------------------------------------
      const dancefloorAfter = await categoryTotal(tx, season.id, 'dancefloor');
      const campAfter = await categoryTotal(tx, season.id, 'camp');
      say('## Totals after');
      say();
      say(`${SEASON_NAME} dancefloor: ${formatILS(dancefloorAfter.agorot)} `
        + `over ${dancefloorAfter.rows} rows (was ${formatILS(dancefloorBefore.agorot)} `
        + `over ${dancefloorBefore.rows})`);
      say(`${SEASON_NAME} camp:       ${formatILS(campAfter.agorot)} `
        + `over ${campAfter.rows} rows (was ${formatILS(campBefore.agorot)} `
        + `over ${campBefore.rows})`);
      say();
      say('the dancefloor total, decomposed:');
      const replacedAgorot = mapped.reduce((sum, pair) => sum + toAgorot(pair.promoted.total), 0);
      say(`  the four replacements:        ${formatILS(replacedAgorot)}`);
      say(`  rows replacing nothing:       ${formatILS(newAgorot)}`);
      say(`  together:                     ${formatILS(replacedAgorot + newAgorot)}`);
      say();

      if (campAfter.agorot !== toAgorot(EXPECTED_CAMP)) {
        throw new Refusal(`${SEASON_NAME}'s camp budget moved from ${EXPECTED_CAMP} to `
          + `${formatILS(campAfter.agorot)}. Every row this block produces belongs to the `
          + 'dancefloor, so a camp total that moves means a row landed in the wrong budget. '
          + 'Rolling back.');
      }
      if (dancefloorAfter.agorot !== toAgorot(EXPECTED_DANCEFLOOR)) {
        throw new Refusal(`${SEASON_NAME}'s dancefloor budget moved from `
          + `${EXPECTED_DANCEFLOOR} to ${formatILS(dancefloorAfter.agorot)}. The four seeded `
          + `rows are replaced exactly (${formatILS(replacedAgorot)}, counted once, not `
          + `${formatILS(replacedAgorot * 2)}), but this block also promotes ${newRows.length} `
          + `rows that replace nothing, worth ${formatILS(newAgorot)} — see the list above. `
          + 'R49 says the dancefloor total must be unchanged, so this run refuses: whether '
          + 'those rows belong in the dancefloor budget is the lead\'s decision, not this '
          + 'script\'s. Rolling back.');
      }

      if (!commit) throw new DryRunRollback();
    });
  } catch (error) {
    if (error instanceof DryRunRollback) {
      rolledBack = true;
    } else {
      say('## Outcome');
      say();
      say('REFUSED — nothing was kept. The transaction is rolled back in full: no promotion, '
        + 'no re-pointed task, no deletion.');
      say();
      say(error instanceof Error ? error.message : String(error));
      say();
      process.stdout.write(`${out.join('\n')}\n`);
      process.exit(1);
    }
  }

  say('## Outcome');
  say();
  say(rolledBack
    ? 'rolled back — this was a dry run, and the database is exactly as it was.'
    : 'committed.');
  say();

  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${out.join('\n')}\n`, (err) => (err ? reject(err) : resolve()));
  });
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stdout.write(`${out.join('\n')}\n`);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
