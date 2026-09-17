/**
 * Dry-run promotion evidence, taken against a clone of the live database.
 *
 * The cutover's one real failure mode is deleting a seeded fact that no
 * workbook block re-creates, and no test can see it: tests run on a fresh
 * `createTestDb()` where the seed and the promoter never coexist. This script
 * puts them in the same database and writes down the difference.
 *
 * It labels sheets and confirms blocks, so it is NOT read-only — which is why
 * it refuses outright to run against the live `shliff` database (see
 * `assertScratchDatabase`). Point it at a clone:
 *
 *   docker exec shliff-pg psql -U shliff -d postgres \
 *     -c "create database shliff_evidence template shliff;"
 *   DATABASE_URL=postgres://shliff:<pw>@localhost:5433/shliff_evidence \
 *     npx tsx scripts/dry-run-promote.ts
 *
 * Every promotion itself runs with `dryRun: true`, so even in the clone no
 * domain row is written, deleted or retained — only reported.
 *
 * Follows scripts/seed-camp.ts for how the database handle is obtained, with
 * one difference: `@/db` builds its client at import time from
 * `DATABASE_URL`, so it is imported dynamically, *after* the guard has run.
 * A static import would connect to whatever the environment names before
 * this file got a chance to refuse it.
 */
import { asc, eq, isNull } from 'drizzle-orm';
import { blocks, blockMappings, sheets, uploads } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';
import { setSheetSeason, setSheetAuthority, sheetEligibility } from '@/lib/import/sheets';
import { applyConfirmation } from '@/lib/import/confirm';
import { promoteBlock } from '@/lib/import/promote/promote';
import { blockRows } from '@/lib/import/promote/rows';
import { ledgerRow } from '@/lib/import/promote/ledger';
import { budgetRow } from '@/lib/import/promote/budget';
import { ticketRow } from '@/lib/import/promote/tickets';
import { obligationRow } from '@/lib/import/promote/obligations';
import type { PromotionResult, PromotedRow } from '@/lib/import/promote/types';
import type { BlockArchetype } from '@/lib/classify/types';
import type { AnyDb } from '@/lib/db-types';
import { normalizeHebrew } from '@/lib/text/normalize';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/** The live database. Nothing in this file may ever touch it. */
const LIVE_DATABASE = 'shliff';

function databaseNameOf(url: string): string {
  // `postgres://user:pw@host:port/name?opts` — `URL` parses the non-http
  // scheme fine and `pathname` is `/name`.
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

/**
 * A hard stop, not a comment. This script writes season labels, authority
 * flags and confirmations; on the live database those are exactly the rows
 * Task 12 promised would stay untouched, and a mistyped `DATABASE_URL` is the
 * only way they ever could be.
 */
function assertScratchDatabase(url: string): string {
  const name = databaseNameOf(url);
  if (name === LIVE_DATABASE) {
    throw new Error(
      `refusing to run against the live database "${LIVE_DATABASE}". `
      + 'Clone it first (create database shliff_evidence template shliff) and '
      + 'point DATABASE_URL at the clone.',
    );
  }
  return name;
}

// ---------------------------------------------------------------------------
// The judgement a lead would make, written down
// ---------------------------------------------------------------------------

type Workbook = 'y2324' | 'y25' | 'y2026';

/**
 * Which workbook a sheet came from, by filename.
 *
 * Matched on the year token rather than the whole filename on purpose: the
 * three filenames differ in their apostrophes (`25’` is U+2019, `23'-24'` is
 * ASCII), and a literal copied into source is one invisible character away
 * from silently matching nothing. `2026` is tested first because `23'-24'`
 * and `25’` contain neither `2026` nor each other's token.
 */
function workbookOf(filename: string): Workbook {
  if (filename.includes('2026')) return 'y2026';
  if (filename.includes('23')) return 'y2324';
  if (filename.includes('25')) return 'y25';
  throw new Error(`unrecognised workbook filename: ${filename}`);
}

function sheetKey(workbook: Workbook, name: string): string {
  return `${workbook}::${name}`;
}

/**
 * The season each of the nineteen sheets belongs to, decided by hand from the
 * sheet's own contents — never from its name, which W10 forbids inferring
 * from, and which would in any case be wrong: `תקציב קאמפ ברן 25` appears in
 * the 2026 workbook.
 *
 * The evidence behind each ambiguous one:
 *  - `סיכום כללי` in the 2026 workbook carries dates 2026-06 … 2026-08; the
 *    copy in the 25’ workbook carries 2025-05 … 2025-10. Same name, different
 *    years, so they are not two copies of one sheet and neither supersedes
 *    the other.
 *  - `House of trance 270925` nets 34,646.55, the exact ledger row dated
 *    2025-09-27; `Halloween Underground 311025` nets 15,660, the row dated
 *    2025-10-30. Both are ברן 25 events.
 *  - The two `SuperNature` sheets are ברן 26 events (the season's ledger
 *    books `רווח מסיבת פקאנים` alongside them).
 *
 * The eight sheets of `קופת קאמפ 23'-24'` are deliberately NOT here. Their
 * seasons are ברן 23 and ברן 24, and neither exists: the seed refuses to
 * create a season whose flat rate no workbook records. An unlabelled sheet is
 * evidence in itself, so they are left unset and reported rather than
 * assigned to a season that would be a guess.
 */
const SEASON_BY_SHEET: Record<string, string> = {
  [sheetKey('y2026', 'סיכום כללי')]: 'ברן 26',
  [sheetKey('y2026', 'תקציב קאמפ ברן 26')]: 'ברן 26',
  [sheetKey('y2026', 'תקציב קאמפ ברן 25')]: 'ברן 25',
  [sheetKey('y2026', 'SuperNature 18.7')]: 'ברן 26',
  [sheetKey('y2026', 'SuperNature 3.10')]: 'ברן 26',
  [sheetKey('y25', 'סיכום כללי')]: 'ברן 25',
  [sheetKey('y25', 'תקציב קאמפ ברן 26')]: 'ברן 26',
  [sheetKey('y25', 'House of trance 270925')]: 'ברן 25',
  [sheetKey('y25', 'Halloween Underground 311025')]: 'ברן 25',
  [sheetKey('y25', 'תקציב רחבה ברן 25')]: 'ברן 25',
  [sheetKey('y25', 'תקציב קאמפ ברן 25')]: 'ברן 25',
};

/**
 * Which copy of a repeated sheet is the real one.
 *
 *  - `תקציב קאמפ ברן 26`: the 2026 workbook's copy. Its figures are the ones
 *    the camp acted on (מילוי מי שתייה 5 × 590, מקרר 0, הובלה 9,000); the
 *    25’ workbook's copy is an earlier revision (4 × 590, מקרר 1,000).
 *  - `תקציב קאמפ ברן 25`: the 25’ workbook's copy. It is complete — it totals
 *    59,587 including the 5,954 `תקציב הפתעות` line the 2026 copy leaves
 *    blank (53,633) — and it carries the exceptions and reimbursement columns
 *    the other copy does not have at all.
 *
 * `סיכום כללי` is absent on purpose: once the two copies hold different
 * seasons they no longer contest each other, and marking one authoritative
 * would assert a choice nobody has to make.
 */
const AUTHORITY_BY_SHEET: Record<string, boolean> = {
  [sheetKey('y2026', 'תקציב קאמפ ברן 26')]: true,
  [sheetKey('y25', 'תקציב קאמפ ברן 26')]: false,
  [sheetKey('y25', 'תקציב קאמפ ברן 25')]: true,
  [sheetKey('y2026', 'תקציב קאמפ ברן 25')]: false,
};

/**
 * Blocks the classifier got wrong, re-picked the way a lead would at confirm
 * time. Keyed by workbook, sheet name and the block's top-left cell, because
 * a sheet can hold several blocks.
 *
 * `תקציב רחבה ברן 25` A1:D26 is the dancefloor's budget — `תיאור | סכום |
 * אחראי` over מייצג 41,300, חשמל 12,950, הגברה + תאורה 30,810, הובלה 4,000,
 * which are precisely the four `dancefloor` budget lines the seed wrote. The
 * classifier called it `event_lines`, which has no promoter at all.
 *
 * Re-picking goes through `applyConfirmation`, which recomputes the column
 * map for the new archetype from the block's own stored grid and header row.
 */
const REPICKS: Record<string, BlockArchetype> = {
  [`${sheetKey('y25', 'תקציב רחבה ברן 25')}@r1c1`]: 'budget_lines',
};

function blockKey(workbook: Workbook, sheetName: string, top: number, left: number): string {
  return `${sheetKey(workbook, sheetName)}@r${top}c${left}`;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const out: string[] = [];
function say(line = ''): void {
  out.push(line);
}

function cellsOf(raw: string[]): string {
  return raw.map((cell) => (cell === '' ? '·' : cell)).join(' | ');
}

/**
 * The key two rows are "the same fact" by: the camp's own wording, under the
 * same season.
 *
 * The season belongs in the key. `הובלה` is a ברן 26 camp line of 9,000 and
 * also a ברן 25 dancefloor line of 4,000; matching on the label alone would
 * tell the next task that one re-creates the other, and it would delete a
 * real row on the strength of it.
 */
function factKey(season: string | null, text: string): string {
  return `${season ?? 'no-season'}|${normalizeHebrew(text).toLowerCase()}`;
}

/** `numeric(12,2)` text vs a JS number, compared as the money they are. */
function sameMoney(seeded: string, promoted: number | null): boolean {
  if (promoted === null) return false;
  return Math.round(Number(seeded) * 100) === Math.round(promoted * 100);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface SheetInfo {
  id: string;
  name: string;
  index: number;
  filename: string;
  workbook: Workbook;
}

interface BlockInfo {
  id: string;
  sheet: SheetInfo;
  top: number;
  left: number;
  bottom: number;
  right: number;
  archetype: BlockArchetype;
  headerRow: number | null;
  rawGrid: string[][];
  seasonName: string | null;
}

/**
 * One row the dry run says it would write, with the amount and season that
 * would go into the column — which `PromotedRow` does not carry, since the
 * register only ever shows a Hebrew one-liner.
 *
 * The amounts are obtained by calling the very same pure row functions
 * `promoteBlock` calls, over the same `blockRows`, so they are the values a
 * commit would insert and not a second parse of the sheet.
 */
interface WrittenFact {
  block: BlockInfo;
  table: TargetTable;
  sheetRow: number;
  label: string;
  amount: number | null;
  detail: string;
  notes: string[];
  raw: string[];
}

type TargetTable = PromotedRow['table'];

const TARGET_TABLES: readonly TargetTable[] = [
  'ledger_entries', 'budget_lines', 'ticket_rounds', 'obligations',
];

interface SeededRow {
  id: string;
  fact: string;
  amount: string;
  season: string | null;
  extra: string;
}

async function seededRows(db: AnyDb, table: TargetTable): Promise<SeededRow[]> {
  if (table === 'ledger_entries') {
    const rows = await db.select({
      id: ledgerEntries.id,
      fact: ledgerEntries.description,
      amount: ledgerEntries.amount,
      season: seasons.name,
      direction: ledgerEntries.direction,
      occurredOn: ledgerEntries.occurredOn,
    })
      .from(ledgerEntries)
      .leftJoin(seasons, eq(seasons.id, ledgerEntries.seasonId))
      .where(isNull(ledgerEntries.sourceBlockId))
      .orderBy(asc(ledgerEntries.occurredOn));
    return rows.map((row) => ({
      id: row.id,
      fact: row.fact,
      amount: row.amount,
      season: row.season,
      extra: `${row.direction} ${row.occurredOn.toISOString().slice(0, 10)}`,
    }));
  }
  if (table === 'budget_lines') {
    const rows = await db.select({
      id: budgetLines.id,
      fact: budgetLines.label,
      amount: budgetLines.total,
      season: seasons.name,
      category: budgetLines.category,
    })
      .from(budgetLines)
      .leftJoin(seasons, eq(seasons.id, budgetLines.seasonId))
      .where(isNull(budgetLines.sourceBlockId))
      .orderBy(asc(budgetLines.label));
    return rows.map((row) => ({
      id: row.id, fact: row.fact, amount: row.amount, season: row.season, extra: row.category,
    }));
  }
  if (table === 'ticket_rounds') {
    const rows = await db.select({
      id: ticketRounds.id,
      fact: ticketRounds.label,
      amount: ticketRounds.total,
      season: seasons.name,
      quantity: ticketRounds.quantity,
      price: ticketRounds.price,
    })
      .from(ticketRounds)
      .leftJoin(seasons, eq(seasons.id, ticketRounds.seasonId))
      .where(isNull(ticketRounds.sourceBlockId))
      .orderBy(asc(ticketRounds.label));
    return rows.map((row) => ({
      id: row.id,
      fact: row.fact,
      amount: row.amount,
      season: row.season,
      extra: `${row.quantity ?? '—'} × ${row.price ?? '—'}`,
    }));
  }
  const rows = await db.select({
    id: obligations.id,
    fact: obligations.description,
    amount: obligations.amount,
    season: seasons.name,
    direction: obligations.direction,
    partyName: obligations.partyName,
    partyPersonId: obligations.partyPersonId,
  })
    .from(obligations)
    .leftJoin(seasons, eq(seasons.id, obligations.seasonId))
    .where(isNull(obligations.sourceBlockId))
    .orderBy(asc(obligations.description));
  return rows.map((row) => ({
    id: row.id,
    fact: row.fact,
    amount: row.amount,
    season: row.season,
    extra: `${row.direction}, party=${row.partyPersonId ? 'linked' : (row.partyName ?? 'none')}`,
  }));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const dbName = assertScratchDatabase(url);

  // Imported here, not at the top: `@/db` connects at import time.
  const { db } = await import('@/db');

  say(`# Dry-run promotion evidence — database "${dbName}"`);
  say(`generated ${new Date().toISOString()}`);
  say();

  // -- Inventory -----------------------------------------------------------
  const sheetRows = await db.select({
    id: sheets.id,
    name: sheets.name,
    index: sheets.index,
    filename: uploads.filename,
  })
    .from(sheets)
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId));

  const sheetInfos: SheetInfo[] = sheetRows
    .map((row) => ({ ...row, workbook: workbookOf(row.filename) }))
    .sort((a, b) => a.filename.localeCompare(b.filename) || a.index - b.index);

  const seasonRows = await db.select({ id: seasons.id, name: seasons.name }).from(seasons);
  const seasonIdByName = new Map(seasonRows.map((row) => [row.name, row.id]));

  // -- Label the sheets (clone only) ---------------------------------------
  say('## 1. Sheet labelling');
  say();
  const unlabelled: SheetInfo[] = [];
  for (const sheet of sheetInfos) {
    const key = sheetKey(sheet.workbook, sheet.name);
    const seasonName = SEASON_BY_SHEET[key];
    if (seasonName === undefined) {
      unlabelled.push(sheet);
      await setSheetSeason(db, sheet.id, null);
      continue;
    }
    const seasonId = seasonIdByName.get(seasonName);
    if (!seasonId) throw new Error(`season "${seasonName}" does not exist (sheet ${key})`);
    await setSheetSeason(db, sheet.id, seasonId);
  }
  for (const sheet of sheetInfos) {
    const key = sheetKey(sheet.workbook, sheet.name);
    if (!Object.hasOwn(AUTHORITY_BY_SHEET, key)) continue;
    await setSheetAuthority(db, sheet.id, AUTHORITY_BY_SHEET[key]);
  }

  const eligibility = await sheetEligibility(db);
  const labelled = await db.select({
    id: sheets.id,
    name: sheets.name,
    filename: uploads.filename,
    seasonName: seasons.name,
    authoritative: sheets.authoritative,
  })
    .from(sheets)
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .leftJoin(seasons, eq(seasons.id, sheets.seasonId));
  const labelledById = new Map(labelled.map((row) => [row.id, row]));

  for (const sheet of sheetInfos) {
    const row = labelledById.get(sheet.id);
    const state = eligibility.get(sheet.id)?.state ?? '(missing)';
    say(`- ${sheet.filename} / ${sheet.name}`
      + ` — season=${row?.seasonName ?? 'UNSET'}`
      + ` authoritative=${row?.authoritative ?? 'null'}`
      + ` eligibility=${state}`);
  }
  say();
  say(`Unlabelled sheets: ${unlabelled.length} `
    + `(${unlabelled.map((s) => s.name).join(', ') || 'none'})`);
  say();

  // -- Confirm every block (clone only) ------------------------------------
  const blockRowsDb = await db.select().from(blocks);
  const sheetById = new Map(sheetInfos.map((s) => [s.id, s]));
  const blockInfos: BlockInfo[] = blockRowsDb
    .map((row) => {
      const sheet = sheetById.get(row.sheetId);
      if (!sheet) throw new Error(`block ${row.id} has no sheet`);
      return {
        id: row.id,
        sheet,
        top: row.top,
        left: row.left,
        bottom: row.bottom,
        right: row.right,
        archetype: row.archetype,
        headerRow: row.headerRow,
        rawGrid: row.rawGrid,
        seasonName: labelledById.get(row.sheetId)?.seasonName ?? null,
      };
    })
    .sort((a, b) => a.sheet.filename.localeCompare(b.sheet.filename)
      || a.sheet.index - b.sheet.index
      || a.top - b.top
      || a.left - b.left);

  say('## 2. Blocks, archetypes and column maps (after confirmation)');
  say();
  for (const block of blockInfos) {
    const key = blockKey(block.sheet.workbook, block.sheet.name, block.top, block.left);
    const repick = REPICKS[key];
    const [mapping] = await db.select().from(blockMappings)
      .where(eq(blockMappings.blockId, block.id));
    await applyConfirmation(
      db, 'evidence', block.id, repick ?? block.archetype, mapping?.columnMap ?? [],
    );
  }

  // Re-read: `applyConfirmation` recomputes the map for a re-picked archetype.
  const confirmed = await db.select().from(blocks);
  const confirmedById = new Map(confirmed.map((row) => [row.id, row]));
  const mapped = await db.select().from(blockMappings);
  const mapById = new Map(mapped.map((row) => [row.blockId, row]));

  for (const block of blockInfos) {
    const key = blockKey(block.sheet.workbook, block.sheet.name, block.top, block.left);
    const now = confirmedById.get(block.id);
    const mapping = mapById.get(block.id);
    const repicked = REPICKS[key] ? ` (RE-PICKED from ${block.archetype})` : '';
    const columns = (mapping?.columnMap ?? [])
      .map((entry) => `${entry.field}=c${entry.column}`)
      .join(' ') || '(none)';
    say(`- ${block.id}`);
    say(`  ${block.sheet.filename} / ${block.sheet.name}`
      + ` rows ${block.top}-${block.bottom} cols ${block.left}-${block.right}`);
    say(`  archetype=${now?.archetype}${repicked}`
      + ` headerRow=${block.headerRow ?? 'null'}`
      + ` mapSource=${mapping?.source}`);
    say(`  columns: ${columns}`);
  }
  say();

  // -- Promote, dry run ----------------------------------------------------
  say('## 3. Promotion results, per block (dryRun: true)');
  say();
  const results: Array<{ block: BlockInfo; result: PromotionResult }> = [];
  for (const block of blockInfos) {
    const result = await promoteBlock(db, block.id, { dryRun: true, recordedBy: 'evidence' });
    results.push({ block, result });
    say(`- ${block.sheet.filename} / ${block.sheet.name}`
      + ` r${block.top}c${block.left} [${result.archetype}]`
      + ` → written=${result.written.length} refused=${result.refused.length}`
      + ` deleted=${result.deleted} retained=${result.retained.length}`);
  }
  say();

  // The amount and the shape of every written row, recovered by calling the
  // same pure row functions `promoteBlock` calls, over the same `blockRows`.
  const rawByRow = new Map<string, string[]>();
  const factsByRow = new Map<string, { amount: number | null; detail: string }>();
  for (const block of blockInfos) {
    const mapping = mapById.get(block.id);
    if (!mapping) continue;
    const seasonId = seasonIdByName.get(block.seasonName ?? '') ?? null;
    const ctx = { seasonId, recordedBy: 'evidence', blockId: block.id };
    for (const row of blockRows(
      { top: block.top, left: block.left, headerRow: block.headerRow, rawGrid: block.rawGrid },
      mapping.columnMap,
    )) {
      const key = `${block.id}:${row.sheetRow}`;
      const archetype = confirmedById.get(block.id)?.archetype;
      if (archetype === 'ledger') {
        const outcome = ledgerRow(row, ctx);
        if (outcome.ok) {
          factsByRow.set(key, {
            amount: outcome.input.amount,
            detail: `${outcome.input.direction} ${outcome.input.occurredOn.toISOString().slice(0, 10)}`,
          });
        }
      } else if (archetype === 'budget_lines') {
        const outcome = budgetRow(row, ctx);
        if (outcome.ok) {
          factsByRow.set(key, {
            amount: outcome.input.total, detail: `category=${outcome.input.category}`,
          });
        }
      } else if (archetype === 'ticket_rounds') {
        const outcome = ticketRow(row, ctx);
        if (outcome.ok) {
          factsByRow.set(key, {
            amount: outcome.input.total,
            detail: `${outcome.input.quantity ?? '—'} × ${outcome.input.price ?? '—'}`,
          });
        }
      } else if (archetype === 'obligations') {
        const outcome = obligationRow(row, ctx);
        if (outcome.ok) {
          factsByRow.set(key, {
            amount: outcome.input.amount,
            detail: `${outcome.input.direction}, openedOn=`
              + `${outcome.input.openedOn?.toISOString().slice(0, 10) ?? 'null'}`,
          });
        }
      }
      factsByRow.set(key, factsByRow.get(key) ?? { amount: null, detail: '' });
      rawByRow.set(key, row.raw);
    }
  }

  const facts: WrittenFact[] = [];
  for (const { block, result } of results) {
    for (const row of result.written) {
      const key = `${block.id}:${row.sheetRow}`;
      const derived = factsByRow.get(key);
      facts.push({
        block,
        table: row.table,
        sheetRow: row.sheetRow,
        label: row.summary,
        amount: derived?.amount ?? null,
        detail: derived?.detail ?? '',
        notes: row.notes,
        raw: rawByRow.get(key) ?? [],
      });
    }
  }

  // -- Per-table difference ------------------------------------------------
  say('## 4. Per-table difference against the seeded rows');
  say();
  say('Matching is on (season, label) — never label alone; see `factKey`.');
  say();
  for (const table of TARGET_TABLES) {
    const written = facts.filter((fact) => fact.table === table);
    const seeded = await seededRows(db, table);

    const writtenByKey = new Map<string, WrittenFact[]>();
    for (const fact of written) {
      const key = factKey(fact.block.seasonName, fact.label);
      writtenByKey.set(key, [...(writtenByKey.get(key) ?? []), fact]);
    }
    const seededKeys = new Set(seeded.map((row) => factKey(row.season, row.fact)));

    say(`### ${table}`);
    say();
    say(`would write: ${written.length} rows`);
    for (const fact of written) {
      say(`  [${fact.block.sheet.filename} / ${fact.block.sheet.name}] r${fact.sheetRow}`
        + `  ${fact.label}  amount=${fact.amount ?? '?'}`
        + `  season=${fact.block.seasonName ?? 'none'}  ${fact.detail}`);
      say(`      cells: ${cellsOf(fact.raw)}`);
      for (const note of fact.notes) say(`      note: ${note}`);
    }
    say();
    say(`seeded rows present with source_block_id IS NULL: ${seeded.length}`);
    for (const row of seeded) {
      say(`  ${row.id}  ${row.fact}  ${row.amount}`
        + `  season=${row.season ?? 'none'}  ${row.extra}`);
    }
    say();

    const recreated = seeded.filter((row) => writtenByKey.has(factKey(row.season, row.fact)));
    const orphaned = seeded.filter((row) => !writtenByKey.has(factKey(row.season, row.fact)));
    const novel = written.filter(
      (fact) => !seededKeys.has(factKey(fact.block.seasonName, fact.label)),
    );

    say(`seeded rows the promoter WOULD re-create (same season + label): ${recreated.length}`);
    for (const row of seeded) {
      const matches = writtenByKey.get(factKey(row.season, row.fact));
      if (!matches) continue;
      for (const fact of matches) {
        const verdict = sameMoney(row.amount, fact.amount)
          ? 'same amount'
          : `AMOUNT DIFFERS: seeded ${row.amount} vs promoted ${fact.amount ?? '?'}`;
        say(`  ${row.id}  ${row.fact}  (${row.extra})`);
        say(`      <- ${fact.block.sheet.name} r${fact.sheetRow} (${fact.detail}) — ${verdict}`);
      }
    }
    say();
    say(`seeded rows NO block re-creates: ${orphaned.length}`);
    for (const row of orphaned) {
      say(`  ${row.id}  ${row.fact}  ${row.amount}`
        + `  season=${row.season ?? 'none'}  ${row.extra}`);
    }
    say();
    say(`rows the promoter would write that match no seeded row: ${novel.length}`);
    for (const fact of novel) {
      say(`  [${fact.block.sheet.name}] r${fact.sheetRow}  ${fact.label}`
        + `  amount=${fact.amount ?? '?'}  season=${fact.block.seasonName ?? 'none'}`);
    }
    say();
  }

  // -- Refusals ------------------------------------------------------------
  say('## 5. Refusals, grouped by reason');
  say();
  const byReason = new Map<string, Array<{ block: BlockInfo; sheetRow: number;
    message: string; cells: string[]; }>>();
  for (const { block, result } of results) {
    for (const refusal of result.refused) {
      const list = byReason.get(refusal.reason) ?? [];
      list.push({
        block, sheetRow: refusal.sheetRow, message: refusal.message, cells: refusal.cells,
      });
      byReason.set(refusal.reason, list);
    }
  }
  const reasons = [...byReason.keys()].sort();
  say(`total refusals: ${[...byReason.values()].reduce((n, list) => n + list.length, 0)}`);
  say();
  for (const reason of reasons) {
    const list = byReason.get(reason) ?? [];
    say(`### ${reason} — ${list.length}`);
    for (const item of list) {
      say(`  [${item.block.sheet.filename} / ${item.block.sheet.name}]`
        + ` r${item.sheetRow}  ${item.message}`);
      if (item.cells.length > 0) say(`      cells: ${cellsOf(item.cells)}`);
    }
    say();
  }

  // -- Retained ------------------------------------------------------------
  say('## 6. Retained rows (W5: stale, but something depends on them)');
  say();
  let retainedCount = 0;
  for (const { block, result } of results) {
    for (const row of result.retained) {
      retainedCount += 1;
      say(`- [${block.sheet.name} r${block.top}c${block.left}] ${row.table}`
        + ` id=${row.id} sourceRow=${row.sheetRow ?? 'null'} — ${row.reason}`);
    }
  }
  if (retainedCount === 0) say('none');
  say();
  const deleted = results.reduce((n, { result }) => n + result.deleted, 0);
  say(`rows a committed run would delete: ${deleted}`);
  say();

  // `process.exit` abandons a pending stdout write, and this report is far
  // larger than one pipe buffer — an earlier run lost everything past 72 KiB
  // that way. Wait for the write to land, then exit (the postgres client
  // holds the event loop open, so returning is not enough).
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${out.join('\n')}\n`, (error) => (
      error ? reject(error) : resolve()
    ));
  });
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
