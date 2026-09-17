import { asc } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { blocks } from '@/db/schema/source';
import type { BlockArchetype } from '@/lib/classify/types';
import { promoteBlock } from '@/lib/import/promote/promote';
import type { Refusal, RefusalReason, RetainedRow } from '@/lib/import/promote/types';
import { listSheets, sheetEligibility } from '@/lib/import/sheets';
import type { SheetRow, SheetState } from '@/lib/import/sheets';
import { listSeasons } from '@/lib/members/roster';
import { listBudgetLines } from '@/lib/money/budget';
import type { BudgetLineRow } from '@/lib/money/budget';

/**
 * What the register shows for one block: has it been promoted, or, if not,
 * why not.
 *
 * ### Decision table
 *
 * `worklist` (below) dry-runs every *confirmed* block through
 * `promoteBlock` (Ruling R6: unconfirmed blocks are never dry-run, because
 * `promoteBlock` itself would just report the `unconfirmed` whole-block
 * refusal back — the state is already known from the block's own row).
 *
 * | block record                        | dry-run result                                          | state         |
 * |--------------------------------------|----------------------------------------------------------|---------------|
 * | `confirmedAt` is null                 | *(never run)*                                             | `unconfirmed` |
 * | confirmed                             | `written: []`, one refusal, reason `no-promoter`          | `no-promoter` |
 * | confirmed                             | `written: []`, one refusal, reason `sheet-superseded`     | `superseded`  |
 * | confirmed                             | `written: []`, one refusal, reason `sheet-undecided`, `sheet-ambiguous` or `unmapped-column` | `refused` |
 * | confirmed                             | anything else (rows written, or only per-row refusals)    | `promoted`    |
 *
 * The five whole-block reasons above are exactly the ones `promoteBlock`
 * produces via its internal `reject()` path — always alone in `refused`,
 * always with `written: []`. Every other reason (`carry-forward`,
 * `total-row`, `blank-row`, `no-amount`, `negative-amount`, `out-of-range`,
 * …) is a per-row refusal that a block can carry while other rows of the
 * same block still promote, so it never overrides `promoted`.
 */
export type BlockState =
  | 'unconfirmed' | 'promoted' | 'refused' | 'superseded' | 'no-promoter';

export interface WorklistRow {
  blockId: string;
  sheetId: string;
  sheetName: string;
  filename: string;
  archetype: BlockArchetype;
  top: number;
  bottom: number;
  seasonId: string | null;
  seasonName: string | null;
  state: BlockState;
  rowCount: number;
  refusals: Refusal[];
  /**
   * Rows a commit would remove because this block no longer produces them
   * (W5's sweep, computed via the dry run). Zero for a block that was never
   * dry-run (`unconfirmed`).
   */
  deleted: number;
  /**
   * The block's retained rows in full, not a count: `deleted` alone would
   * tell a lead a row is gone, when in fact it survives because a
   * settlement, a transfer's other leg, or a task still depends on it. A
   * count would raise the question without answering it, and this is the
   * one place a lead sees any of it — so the full `RetainedRow[]` (table,
   * id, sheet row, reason) is carried through rather than collapsed.
   */
  retained: RetainedRow[];
}

export interface CoverageCell {
  seasonName: string;
  archetype: BlockArchetype;
  /** Sum of `rowCount` over this cell's `promoted` blocks. */
  promoted: number;
  /**
   * Every block assigned to this season and archetype, regardless of state —
   * confirmed or not, promoted, refused, superseded. Deliberate, not
   * incidental: the register's whole job is "what has not settled yet", so a
   * cell holding three still-unconfirmed tables and zero promoted rows must
   * read as three blocks with nothing promoted, not as an empty cell that
   * implies there is nothing to do.
   */
  blocks: number;
}

export interface CollisionGroup {
  name: string;
  sheets: SheetRow[];
  state: SheetState;
}

/** The whole-block refusal reasons `promoteBlock` can return — see the
 *  decision table on `BlockState` above. */
const WHOLE_BLOCK_REASONS: ReadonlySet<RefusalReason> = new Set<RefusalReason>([
  'no-promoter', 'sheet-undecided', 'sheet-ambiguous', 'sheet-superseded', 'unmapped-column',
]);

function stateOfConfirmed(written: number, refused: Refusal[]): BlockState {
  const wholeBlock = written === 0 && refused.length === 1 && WHOLE_BLOCK_REASONS.has(refused[0].reason);
  if (!wholeBlock) return 'promoted';
  const [only] = refused;
  if (only.reason === 'no-promoter') return 'no-promoter';
  if (only.reason === 'sheet-superseded') return 'superseded';
  return 'refused';
}

/**
 * Every block, promoted or not — the register's main list. Iterates every
 * block (not only confirmed ones, per R6) and dry-runs the confirmed ones
 * through `promoteBlock`, so the state and row count shown are exactly what
 * a commit would do, never a stored, staler answer (W8).
 *
 * A dry run performs no writes, but it does run inside `promoteBlock`'s own
 * transaction per block; nothing here opens a transaction of its own or
 * writes directly.
 */
export async function worklist(db: AnyDb, recordedBy: string): Promise<WorklistRow[]> {
  const [allBlocks, sheetRows] = await Promise.all([
    db.select().from(blocks).orderBy(asc(blocks.sheetId), asc(blocks.top)),
    listSheets(db),
  ]);
  const sheetById = new Map(sheetRows.map((sheet) => [sheet.id, sheet]));

  const rows: WorklistRow[] = [];
  for (const block of allBlocks) {
    const sheet = sheetById.get(block.sheetId);
    if (!sheet) throw new Error(`unknown sheet ${block.sheetId}`);

    const base = {
      blockId: block.id,
      sheetId: block.sheetId,
      sheetName: sheet.name,
      filename: sheet.filename,
      archetype: block.archetype,
      top: block.top,
      bottom: block.bottom,
      seasonId: sheet.seasonId,
      seasonName: sheet.seasonName,
    };

    if (!block.confirmedAt) {
      rows.push({
        ...base, state: 'unconfirmed', rowCount: 0, refusals: [], deleted: 0, retained: [],
      });
      continue;
    }

    const dry = await promoteBlock(db, block.id, { dryRun: true, recordedBy });
    rows.push({
      ...base,
      state: stateOfConfirmed(dry.written.length, dry.refused),
      rowCount: dry.written.length,
      refusals: dry.refused,
      deleted: dry.deleted,
      retained: dry.retained,
    });
  }

  return rows;
}

/**
 * Per season and archetype: how many rows are actually promoted against how
 * many blocks exist. A cell is emitted for every (season, archetype) pair
 * that has at least one block — including one whose `promoted` is zero —
 * so a lead sees a gap rather than a missing row in the table (`coverage`
 * takes already-computed `WorklistRow[]`, so it never touches the database
 * itself). Blocks whose sheet has no season are excluded: they cannot be
 * placed in this per-season matrix and are `sheetsNeedingSeason`'s to
 * surface instead.
 */
export function coverage(rows: WorklistRow[]): CoverageCell[] {
  const cells = new Map<string, CoverageCell>();

  for (const row of rows) {
    if (row.seasonName === null) continue;
    const key = `${row.seasonName}\u0000${row.archetype}`;
    const cell = cells.get(key) ?? {
      seasonName: row.seasonName, archetype: row.archetype, promoted: 0, blocks: 0,
    };
    cell.blocks += 1;
    if (row.state === 'promoted') cell.promoted += row.rowCount;
    cells.set(key, cell);
  }

  return [...cells.values()];
}

/**
 * Sheets sharing a name that contest one another (`sheetEligibility`'s
 * `contestedWith`), grouped into connected components — a name can collide
 * across more than two sheets, and `contestedWith` edges are symmetric by
 * construction (`conflicts()` in sheets.ts), so a plain BFS finds the whole
 * group from any member.
 *
 * A sheet with no contest at all (an ordinary `eligible` sheet, or a sheet
 * sharing a name with nothing else) never appears here — this is a list of
 * contests, not a list of every sheet.
 *
 * `sheetEligibility` computes every member of a resolved group's state from
 * the same chosen set, so within one group the states are uniform except
 * for the eligible/superseded split on a resolved winner and its losers:
 * either every member is `undecided`, every member is `ambiguous`, or
 * exactly one is `eligible` and the rest are `superseded`. The group-level
 * `state` picks, in that order, whichever of `undecided` / `ambiguous` /
 * `superseded` is present — `superseded` in the resolved case, so the
 * group's own state names the thing a lead can still act on (the loser),
 * not the winner that needs nothing further.
 */
export async function collisionGroups(db: AnyDb): Promise<CollisionGroup[]> {
  const sheetRows = await listSheets(db);
  const byId = new Map(sheetRows.map((sheet) => [sheet.id, sheet]));
  const eligibility = await sheetEligibility(db);

  const visited = new Set<string>();
  const groups: CollisionGroup[] = [];

  for (const sheet of sheetRows) {
    if (visited.has(sheet.id)) continue;
    visited.add(sheet.id);
    const info = eligibility.get(sheet.id);
    if (!info || info.contestedWith.length === 0) continue;

    const component = new Set<string>();
    const queue = [sheet.id];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || component.has(id)) continue;
      component.add(id);
      visited.add(id);
      for (const next of eligibility.get(id)?.contestedWith ?? []) {
        if (!component.has(next)) queue.push(next);
      }
    }

    const members = [...component]
      .map((id) => byId.get(id))
      .filter((s): s is SheetRow => s !== undefined)
      .sort((a, b) => a.filename.localeCompare(b.filename));
    const states = members.map((member) => eligibility.get(member.id)!.state);
    const state: SheetState = states.includes('undecided')
      ? 'undecided'
      : states.includes('ambiguous')
        ? 'ambiguous'
        : states.includes('superseded')
          ? 'superseded'
          : 'eligible';

    groups.push({ name: sheet.name, sheets: members, state });
  }

  return groups;
}

/** Sheets nobody has labelled with a season yet — every collision and every
 *  promotion downstream of them is stuck until a lead does. */
export async function sheetsNeedingSeason(db: AnyDb): Promise<SheetRow[]> {
  const sheetRows = await listSheets(db);
  return sheetRows.filter((sheet) => sheet.seasonId === null);
}

/**
 * Every budget line whose stored arithmetic does not add up, across every
 * season. Reads `listBudgetLines`'s existing `arithmeticOff` field rather
 * than recomputing it — `isArithmeticOff` is meant to have exactly one
 * caller-visible definition (see arithmetic.ts), and a second computation
 * here would let the register and the budget table quietly disagree.
 */
export async function flaggedArithmetic(
  db: AnyDb,
): Promise<Array<{ seasonName: string; line: BudgetLineRow }>> {
  const seasonRows = await listSeasons(db);
  const flagged: Array<{ seasonName: string; line: BudgetLineRow }> = [];

  for (const season of seasonRows) {
    const lines = await listBudgetLines(db, season.id);
    for (const line of lines) {
      if (line.arithmeticOff) flagged.push({ seasonName: season.name, line });
    }
  }

  return flagged;
}
