/**
 * The cutover: promote the confirmed blocks of one season — or of every season
 * — and remove the seeded rows the promotion replaces, in ONE transaction.
 *
 * Until now the camp's money was written twice over — once by hand into
 * `src/lib/seed/camp-seed.ts`, and now by the promoter out of the confirmed
 * workbook blocks. The seed has given up what the promoter owns; the rows it
 * already wrote into a live database are still standing, and this script is
 * what takes them out.
 *
 * ## Runbook, with the three things that actually bite
 *
 * `create database … template shliff` FAILS while anything holds a connection
 * to `shliff` — "source database is being accessed by other users" — and a dev
 * server holds one all day. Dump and restore instead; it needs no exclusive
 * lock and no write to live:
 *
 *   docker exec shliff-pg psql -U shliff -d postgres \
 *     -c "drop database if exists shliff_cutover;" -c "create database shliff_cutover;"
 *   docker exec shliff-pg bash -lc \
 *     "pg_dump -U shliff -d shliff --no-owner --no-acl | \
 *      psql -U shliff -d shliff_cutover -q -v ON_ERROR_STOP=1"
 *
 * Migrations 0005 (`sheets.season_id` / `authoritative`) and 0006
 * (`obligations.opened_on` nullable) are NOT applied to live. 0002-0004 were
 * applied there by `drizzle-kit push`, so the journal does not know them and
 * `migrate` would try to re-run them; record those three by file sha256 in the
 * clone's journal first, then:
 *
 *   DATABASE_URL=postgres://shliff:<pw>@localhost:5433/shliff_cutover \
 *     ./node_modules/.bin/drizzle-kit migrate
 *
 * Live has ZERO confirmed blocks. This script does not confirm anything —
 * that is a lead's decision in the import UI — so on live today it would
 * promote nothing, find no replacements and refuse. Before it can do anything
 * a lead must label the eleven labellable sheets, set the four authority
 * flags, re-pick `fa78b9be` as `budget_lines`, and confirm the blocks. On a
 * scratch clone `dry-run-promote.ts` does all of that:
 *
 *   DATABASE_URL=… npx tsx scripts/dry-run-promote.ts       # labels and confirms
 *   DATABASE_URL=… npx tsx scripts/cutover.ts --season "ברן 26"
 *   DATABASE_URL=… npx tsx scripts/cutover.ts --season "ברן 26" \
 *     --commit --include-truncations
 *
 * Seven rules this script exists to obey, each of them learned the hard way:
 *
 *  1. ONE transaction. The obvious order — promote, check, then delete —
 *     leaves a window in which the database holds both copies of everything:
 *     about 64,000 ₪ of double-counted ברן 26 budget plus nineteen
 *     double-counted ledger movements. There is no unique constraint across
 *     `(season_id, label)` or `(occurred_on, description)`, and the seeded
 *     rows have a null `source_block_id` so the promoter's own
 *     `(source_block_id, source_row)` key never sees them. Any balance read
 *     inside that window is simply wrong. So the promotion and the deletion
 *     are one transaction, and a failed check rolls the whole thing back.
 *
 *  2. Delete by enumerated id, never by predicate. Every id below was read off
 *     the live database and checked by a reviewer, row by row, against the
 *     workbook it came from. A `where category = 'camp' and season = …`
 *     evaluated at run time has had no such review, and the two diverge the
 *     moment anything else writes a row. If the database and the list below
 *     disagree — a listed id has gone, or a row's label or amount has moved —
 *     this script stops rather than deleting what it finds.
 *
 *  3. Gate each delete on ITS OWN replacement. Not on a count: the count
 *     under `66ad3b61` is 26, not 23, because the block also produces the
 *     lycra line and two rows of a neighbouring sub-table. A delete happens
 *     only when the row that replaces it has been located by
 *     `(source_block_id, source_row)` and agrees on season, label and amount
 *     to the agora.
 *
 *  4. Check the POPULATION, not only the ids. A list of 41 ids catches a row
 *     that has gone; it cannot see a row that has been ADDED since the evidence
 *     was reviewed, and that row would be left standing with no replacement and
 *     nobody told. So the seeded counts must be exactly 19 / 28 / 3 / 13 or the
 *     run stops before it promotes anything.
 *
 *  5. SCOPE it. The seasons are not equally ready: ברן 26 reproduces its
 *     workbook to the agora, while ברן 25's budget lands at 158,507 against a
 *     workbook that says 59,587, because the dancefloor block comes back
 *     categorised `camp`. `--season` narrows the promotion and the deletion set
 *     together, so a lead can take the half that is right without the half that
 *     is not. It cannot be re-run over a season it has already cut over: the
 *     enumerated rows for that season are gone, so every replacement check
 *     fails and the transaction rolls back. A second run is a refusal, not a
 *     repair — see "Left for the camp lead" item 5 for the by-hand recovery.
 *
 *  6. Make the lead ANSWER the truncation question before committing. Leaving
 *     the two truncated rows is not a neutral default — their replacements are
 *     already written at the same amounts, so 5,000 ₪ and 1,000 ₪ end up
 *     counted twice and the ברן 26 identity stops closing. `--commit` refuses
 *     without `--include-truncations` or `--keep-truncations`.
 *
 *  7. The scratch guard is an allowlist. This script deletes real financial
 *     records, so it refuses to open anything but `shliff_cutover`. The guard
 *     resolves the database name the way postgres.js resolves it — including
 *     reading the LAST of a repeated `?database=` key, which is what
 *     postgres.js does and what `URLSearchParams.get` does not.
 *
 * What it deliberately does NOT do:
 *
 *  - It never touches `funding_targets`, `accounts`, `account_balances`,
 *    `obligation_settlements`, `dues`, `payments` or `tasks`.
 *  - It never deletes an `obligations` row. All thirteen stand un-replaced:
 *    `חוב יוסף` is a headerless block with no column map, and the twelve
 *    ברן 25 reimbursements live in columns H–J of a `budget_lines` block whose
 *    map stops at column 4. Deleting `חוב יוסף` would additionally cascade
 *    away the four settlements that model the 6,000 offset.
 *  - It never deletes the three seeded `ticket_rounds`. They are a sub-table
 *    of a `budget_lines` block; no block produces them.
 *  - It never deletes the four ברן 25 `dancefloor` budget lines. The promoter
 *    re-creates them at the right amounts but categorised `camp`, with new
 *    ids, and four `tasks.budget_line_id` values point at the old ids with no
 *    foreign key to protect them. That is a decision for the camp lead, and
 *    `reportDecisions` prints it rather than taking it.
 *
 * Follows `scripts/dry-run-promote.ts` for how the database handle is
 * obtained: `@/db` builds its client at import time from `DATABASE_URL`, so it
 * is imported dynamically, after the guard has run.
 */
import {
  and, eq, inArray, isNotNull, isNull, sql,
} from 'drizzle-orm';
import { blocks, sheets } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';
import { promoteBlock, type BulkResult } from '@/lib/import/promote/promote';
import type { PromotionResult } from '@/lib/import/promote/types';
import { seasonMoneySummary } from '@/lib/money/summary';
import { budgetTotalAgorot } from '@/lib/money/budget';
import { ticketTotalAgorot, fundingTotalAgorot } from '@/lib/money/funding';
import { normalizeHebrew } from '@/lib/text/normalize';
import { formatILS, toAgorot } from '@/lib/money';
import type { AnyDb } from '@/lib/db-types';
import { assertScratchDatabase, CUTOVER_DATABASE } from './scratch-guard';
import { placeInScope, type ScopePlacement } from './cutover-scope';

// ---------------------------------------------------------------------------
// The evidence, transcribed
// ---------------------------------------------------------------------------

/** `סיכום כללי` of `קופת קאמפ 25’` — ledger, seven ברן 25 movements. */
const BLOCK_LEDGER_25 = 'ac5a9d6e-8b52-40a9-bfea-a22771a2e4c6';
/** `סיכום כללי` of `קופת קאמפ 2026` — ledger, twelve ברן 26 movements. */
const BLOCK_LEDGER_26 = '6f1a7fc4-03ac-4ec3-abe4-0b5a863e133f';
/** `תקציב קאמפ ברן 26` in `קופת קאמפ 2026`, the authoritative copy. */
const BLOCK_BUDGET_26 = '66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92';
/**
 * `SuperNature 3.10` F1:I12 — four promoted ticket rounds. A fifth, the `אסף`
 * profit-split row at r11, was junk this script deleted; the promoter refuses it
 * now, so it is neither written nor enumerated here. Kept as a named constant
 * because the JUNK note below and the report both name the block.
 */
export const BLOCK_TICKETS_SN = '84d315a5-6c69-4c5a-97e3-72108fc32f01';

type ReplaceableTable = 'ledger_entries' | 'budget_lines';

/**
 * A seeded row and the promoted row that replaces it.
 *
 * `label` and `amount` are the SEEDED row's, and both sides are checked
 * against them: the seeded row must still hold them (or the list is stale),
 * and the promoted row must reproduce them (or it is not a replacement). The
 * amount is the `numeric(12,2)` text Postgres stores, compared as agorot.
 */
interface Replacement {
  table: ReplaceableTable;
  /** The seeded row, `source_block_id IS NULL`. */
  id: string;
  label: string;
  amount: string;
  /** The block that re-creates it, and the sheet row it comes from. */
  blockId: string;
  sourceRow: number;
  /**
   * The label the PROMOTED row carries, when it differs from the seeded one.
   *
   * Only the two truncations set this, and they have to: the seed shortened
   * the workbook's wording, so demanding label equality on both sides would
   * refuse them for the very reason they are listed separately. The amount and
   * the season are still checked on both sides, so a differing label never
   * loosens the money check — it only records that the difference was seen and
   * written down before this row could be deleted.
   */
  workbookLabel?: string;
}

/**
 * The 41 rows the evidence proved safe: same season, same label, same amount
 * to the agora. Eighteen `ledger_entries` and twenty-three `budget_lines`.
 */
const REPLACED: Replacement[] = [
  // ledger_entries — סיכום כללי, קופת קאמפ 25’ (ברן 25), 7 rows
  { table: 'ledger_entries', id: 'c182d162-6e94-4451-a0e3-7ce10f363ad4', label: 'תרומה אבישי פרץ', amount: '200.00', blockId: BLOCK_LEDGER_25, sourceRow: 3 },
  { table: 'ledger_entries', id: '8cd11601-97cd-4cc7-a8f3-07b4bdb52701', label: 'מכולה אוג 25-26', amount: '8850.00', blockId: BLOCK_LEDGER_25, sourceRow: 4 },
  { table: 'ledger_entries', id: 'd5b2fe0b-eef2-4aff-8b38-01400a3b0c79', label: 'מקדמה במה ברן 25', amount: '20660.00', blockId: BLOCK_LEDGER_25, sourceRow: 5 },
  { table: 'ledger_entries', id: '5b8fcdfb-3b79-435a-b335-f73afa9c9015', label: 'רווח מסיבה נמל', amount: '34646.55', blockId: BLOCK_LEDGER_25, sourceRow: 6 },
  { table: 'ledger_entries', id: 'a06c506b-e8e1-4f0a-8a52-ee1d1d7d353d', label: 'חצי שני למייצג נטלי', amount: '20660.00', blockId: BLOCK_LEDGER_25, sourceRow: 7 },
  { table: 'ledger_entries', id: '4516c89d-17b1-4f52-9104-9594b0313510', label: 'מברגה לקאמפ', amount: '400.00', blockId: BLOCK_LEDGER_25, sourceRow: 8 },
  { table: 'ledger_entries', id: 'dca069ef-8f96-4976-97e8-a90f82b47b47', label: 'מסיבת האלווין 30/10', amount: '15660.00', blockId: BLOCK_LEDGER_25, sourceRow: 9 },

  // ledger_entries — סיכום כללי, קופת קאמפ 2026 (ברן 26), 11 rows
  { table: 'ledger_entries', id: '5e6f8b16-7106-4198-888a-85836848c254', label: 'חוב לירון סלע על ברן 25', amount: '14000.00', blockId: BLOCK_LEDGER_26, sourceRow: 2 },
  { table: 'ledger_entries', id: '75bf60e3-cb82-4bb8-9747-de9dc0f19a5d', label: 'עובדי הקמה יוניברן', amount: '7350.00', blockId: BLOCK_LEDGER_26, sourceRow: 3 },
  { table: 'ledger_entries', id: '9bb918be-3046-40b2-a8cc-b3ae149df304', label: 'מקדמה מכולות ליולי עד נובמבר', amount: '3000.00', blockId: BLOCK_LEDGER_26, sourceRow: 5 },
  { table: 'ledger_entries', id: '48f5ad3b-2789-42c8-8f56-bc23f5b653bf', label: 'רווח מסיבת פקאנים', amount: '57000.00', blockId: BLOCK_LEDGER_26, sourceRow: 6 },
  { table: 'ledger_entries', id: 'c7a9382d-48a6-462f-8814-db88bd4efc54', label: '3 כרטיסי אומנים ברן', amount: '8820.00', blockId: BLOCK_LEDGER_26, sourceRow: 7 },
  { table: 'ledger_entries', id: 'dde50b70-9b56-4222-8515-1c6aa00868ea', label: 'ציוד מטבח חדש', amount: '4000.00', blockId: BLOCK_LEDGER_26, sourceRow: 8 },
  { table: 'ledger_entries', id: 'ea7cee37-01c1-4602-9ae3-375bc8d9dec6', label: 'הובלות', amount: '2000.00', blockId: BLOCK_LEDGER_26, sourceRow: 9 },
  { table: 'ledger_entries', id: 'a2b52cd8-a8a1-4b6c-98b3-26271a181719', label: 'מקלחת', amount: '1000.00', blockId: BLOCK_LEDGER_26, sourceRow: 10 },
  { table: 'ledger_entries', id: 'a2538fa9-3fe1-4305-959f-c88b8c28a823', label: 'ציוד מכולה', amount: '231.00', blockId: BLOCK_LEDGER_26, sourceRow: 11 },
  { table: 'ledger_entries', id: '119514bb-7751-407c-8e82-a74d033e45a5', label: 'פינויים נסורת - להחזיר לאורי', amount: '1200.00', blockId: BLOCK_LEDGER_26, sourceRow: 12 },
  { table: 'ledger_entries', id: '7d4fef73-4ed0-40dc-8bc3-d1c681e5c662', label: 'מכולה עד דצמבר', amount: '3670.00', blockId: BLOCK_LEDGER_26, sourceRow: 13 },

  // budget_lines — תקציב קאמפ ברן 26 (ברן 26), 23 rows
  { table: 'budget_lines', id: '54688d50-0dd3-4414-b2da-3167018e6b4d', label: 'שירותים נסורת', amount: '1625.00', blockId: BLOCK_BUDGET_26, sourceRow: 3 },
  { table: 'budget_lines', id: '09a6852f-c0e5-476c-8497-7fc107c458fd', label: 'פינוי שירותים', amount: '2250.00', blockId: BLOCK_BUDGET_26, sourceRow: 4 },
  { table: 'budget_lines', id: 'b3760806-794c-409a-a349-8d4bd3325fed', label: 'ציוד היגיינה', amount: '100.00', blockId: BLOCK_BUDGET_26, sourceRow: 5 },
  { table: 'budget_lines', id: '811f57b5-f8fb-4797-a4cf-b84761421e7e', label: 'מיכל מים לבנים + מתאם ברז', amount: '3068.00', blockId: BLOCK_BUDGET_26, sourceRow: 6 },
  { table: 'budget_lines', id: '25485cd4-ff67-4467-b9b7-8629762dbc39', label: 'מיכל מים אפורים', amount: '472.00', blockId: BLOCK_BUDGET_26, sourceRow: 7 },
  { table: 'budget_lines', id: '5ed03ed9-946d-414d-9802-3bdebf1029a2', label: 'מילוי מי שתייה', amount: '2950.00', blockId: BLOCK_BUDGET_26, sourceRow: 8 },
  { table: 'budget_lines', id: '3ae4ad25-780e-49d9-8a6c-24aed2de388d', label: 'פינוי מים אפורים', amount: '2832.00', blockId: BLOCK_BUDGET_26, sourceRow: 9 },
  { table: 'budget_lines', id: '4c277c0c-b4bd-4c18-9941-9aefeb62268b', label: 'מקלחות', amount: '1500.00', blockId: BLOCK_BUDGET_26, sourceRow: 10 },
  { table: 'budget_lines', id: 'ee5f3000-5d62-458a-8470-eb6240bff6f6', label: 'ציוד משלים למקלחת', amount: '500.00', blockId: BLOCK_BUDGET_26, sourceRow: 11 },
  { table: 'budget_lines', id: '8876f4ee-b01b-463a-878d-0e22f5ba0643', label: 'חשמל לקאמפ', amount: '7500.00', blockId: BLOCK_BUDGET_26, sourceRow: 12 },
  { table: 'budget_lines', id: '1667b8d5-858d-45f6-b7de-2927ac638e9b', label: 'הובלה', amount: '9000.00', blockId: BLOCK_BUDGET_26, sourceRow: 13 },
  { table: 'budget_lines', id: 'fcf7da38-6107-450e-b73c-7065f1fdf2b7', label: 'באלות', amount: '300.00', blockId: BLOCK_BUDGET_26, sourceRow: 14 },
  { table: 'budget_lines', id: 'b80c0207-6f83-4122-a962-29aef09e833c', label: 'אוכל', amount: '8000.00', blockId: BLOCK_BUDGET_26, sourceRow: 15 },
  { table: 'budget_lines', id: '898daf27-ff58-4163-9ce8-b393a5995ea9', label: 'ציוד מטבח - כירת גז + מיחם', amount: '930.00', blockId: BLOCK_BUDGET_26, sourceRow: 16 },
  { table: 'budget_lines', id: 'b1b76b55-923b-4e47-a79b-50716df747cc', label: 'מילוי גז', amount: '200.00', blockId: BLOCK_BUDGET_26, sourceRow: 17 },
  { table: 'budget_lines', id: 'e7ecd995-935a-4288-b15f-142c4516e2af', label: 'מקרר + מקפיא', amount: '0.00', blockId: BLOCK_BUDGET_26, sourceRow: 18 },
  { table: 'budget_lines', id: 'c2df3f64-5541-4f80-9fcf-f8b680bd82bc', label: 'קרח', amount: '1140.00', blockId: BLOCK_BUDGET_26, sourceRow: 19 },
  { table: 'budget_lines', id: 'f2b09343-cc19-4fe1-941c-27050d3118a2', label: 'צילייה מחנה', amount: '9156.00', blockId: BLOCK_BUDGET_26, sourceRow: 20 },
  { table: 'budget_lines', id: '0908ecd3-5e2a-4c55-98b9-a467d5745a6d', label: 'גידור מחנה', amount: '2800.00', blockId: BLOCK_BUDGET_26, sourceRow: 21 },
  { table: 'budget_lines', id: 'f16ed0e7-fef6-42d7-8a9f-bbe17317f1be', label: 'הובלה צילייה', amount: '500.00', blockId: BLOCK_BUDGET_26, sourceRow: 22 },
  { table: 'budget_lines', id: 'fdc0ac33-597a-4c7e-916f-645ee7c0f06c', label: '100 ק"ג עצים + תוספת אחסנה', amount: '500.00', blockId: BLOCK_BUDGET_26, sourceRow: 24 },
  { table: 'budget_lines', id: '98feeb0a-52e5-4364-978e-9e4df54e43e3', label: 'גנרטור', amount: '2200.00', blockId: BLOCK_BUDGET_26, sourceRow: 25 },
  { table: 'budget_lines', id: 'a7d86aa1-a943-4dfc-974c-01fb763b3468', label: 'תקציב הפתעות דק׳ 90', amount: '5852.30', blockId: BLOCK_BUDGET_26, sourceRow: 28 },
];

/**
 * Rows the promotion WRITES that are not facts at all.
 *
 * `confirmBlock` takes an archetype and a column map and nothing else: block
 * bounds are not editable anywhere and the promoter has no per-row veto, so a
 * lead cannot refuse these at confirm time. They have to come out afterwards,
 * in the same transaction that wrote them — otherwise the camp's budget page
 * shows the season's dues total and its fundraising target as though they were
 * two more things to buy.
 *
 * Identified by `(source_block_id, source_row)`, which is the promoter's own
 * unique key, and gated on the label so that a re-confirmed block whose rows
 * have shifted stops this script instead of deleting a real line.
 */
interface JunkRow {
  table: 'budget_lines' | 'ticket_rounds';
  blockId: string;
  sourceRow: number;
  label: string;
  /**
   * The amount the evidence recorded, as the column stores it.
   *
   * Gated exactly like a replacement's, and for the same reason: a block whose
   * rows shifted could put a real budget line under the label this list
   * expects, and the label alone would not notice. The amount is the second
   * lock.
   */
  amount: string;
  why: string;
}

const JUNK: JunkRow[] = [
  {
    table: 'budget_lines', blockId: BLOCK_BUDGET_26, sourceRow: 31, label: 'תקציב מחנה',
    amount: '42000.00',
    why: 'the season’s dues × head-count (42,000), from a neighbouring sub-table — not a line to spend',
  },
  {
    table: 'budget_lines', blockId: BLOCK_BUDGET_26, sourceRow: 32, label: 'יעד גיוס',
    amount: '22375.30',
    why: 'the fundraising target (22,375.30), same sub-table — it is a funding_target, not a budget line',
  },
  // `(BLOCK_TICKETS_SN, 11)` — the `אסף` profit-split row, total 0.6666666667
  // → 0.67 with a quantity silently rounded to 0 — WAS the third entry here,
  // and has been REMOVED because the promoter no longer writes it:
  // `ticketRow` refuses a non-integer quantity as of
  // `fix(promote): a fractional ticket count is refused, not rounded to zero`,
  // and the 2026-09-18 evidence re-run reports it under `out-of-range`.
  //
  // Removing it was not optional. `verifyJunk` refuses when the enumerated row
  // is not found EXACTLY once, so leaving it listed would make every cutover
  // run fail its verification and roll the whole promotion back — a row that is
  // never written can never be verified or deleted. Nothing else changed: the
  // `ledger_entries` and `budget_lines` enumerations are byte-identical to the
  // previous evidence run, and JUNK is not part of the seeded-population check.
];

/**
 * Two seeded rows whose replacement holds the SAME amount under the workbook's
 * longer wording. The seed truncated the label; the workbook did not.
 *
 * Deleting them is correct if the camp is content for the label to lengthen,
 * and wrong if anybody is reading the shorter one. That is not an
 * implementer's call, so they are behind `--include-truncations` and are
 * printed either way. Left in place they are duplicates: the same 5,000 and
 * the same 1,000 counted twice.
 */
const TRUNCATIONS: Array<Replacement & { workbookLabel: string }> = [
  {
    table: 'ledger_entries', id: 'cb5c56de-bf1e-4c6b-a0d3-761f3c7d07ca',
    label: 'קיזוז מול תקציב גיפטינג יוני', amount: '5000.00',
    blockId: BLOCK_LEDGER_26, sourceRow: 4,
    workbookLabel: 'קיזוז מול תקציב גיפטינג יוניברן',
  },
  {
    table: 'budget_lines', id: '35bddd9c-9f2a-4196-9362-8e8fc0bf2015',
    label: '30 מ׳ לייקרה + 50 מ׳ בד זול', amount: '1000.00',
    blockId: BLOCK_BUDGET_26, sourceRow: 26,
    workbookLabel: '30 מ׳ לייקרה+ 50 מ׳ בד זול גידור מחנה ונגרר רחבה',
  },
];

/**
 * The four ברן 25 `dancefloor` budget lines. NOT deleted here, and listed so
 * the report can say exactly what is being handed back rather than leaving it
 * to be rediscovered.
 */
const DANCEFLOOR_KEPT: Array<{ id: string; label: string; amount: string; note: string }> = [
  { id: '59a66ac1-cf51-4035-9a8f-5f442d90daa0', label: 'מייצג', amount: '41300.00', note: 'fa78b9be r3' },
  { id: '15aecf85-467f-428c-af0b-36c743057cf5', label: 'חשמל', amount: '12950.00', note: 'fa78b9be r4' },
  { id: '8aed0b22-a1c9-4626-ac73-e3d76292ef47', label: 'הגברה + תאורה', amount: '30810.00', note: 'fa78b9be r5' },
  { id: '2f8b932f-08d6-47cb-80d2-aca95d2b581f', label: 'הובלה', amount: '4000.00', note: 'fa78b9be r6 and 254bef9f r13 — one fact or two?' },
];

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const out: string[] = [];
function say(line = ''): void {
  out.push(line);
}

/** `numeric(12,2)` text compared as the money it is, never as a string: `0.00`
 *  and `0` are the same amount and different strings. `toAgorot` is the
 *  project's only converter and does exactly this — a second copy of
 *  `Math.round(n * 100)` in the file that decides what gets deleted is the
 *  last place worth having one. */
function sameMoney(a: string, b: string): boolean {
  return toAgorot(a) === toAgorot(b);
}

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
class CutoverRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CutoverRefusal';
  }
}

// ---------------------------------------------------------------------------
// Row access
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  label: string;
  amount: string;
  seasonId: string | null;
  sourceBlockId: string | null;
  sourceRow: number | null;
}

/**
 * Every row of one of the four target tables, keyed by id.
 *
 * Read whole rather than queried per id: 63 seeded rows and 93 promoted ones
 * fit in memory many times over, and holding them all means the verification
 * below compares against one consistent snapshot taken inside the transaction
 * instead of 90 separate round trips that could each see something different.
 */
async function readTable(db: AnyDb, table: ReplaceableTable | 'ticket_rounds'): Promise<Row[]> {
  if (table === 'ledger_entries') {
    const rows = await db.select({
      id: ledgerEntries.id,
      label: ledgerEntries.description,
      amount: ledgerEntries.amount,
      seasonId: ledgerEntries.seasonId,
      sourceBlockId: ledgerEntries.sourceBlockId,
      sourceRow: ledgerEntries.sourceRow,
    }).from(ledgerEntries);
    return rows;
  }
  if (table === 'budget_lines') {
    return db.select({
      id: budgetLines.id,
      label: budgetLines.label,
      amount: budgetLines.total,
      seasonId: budgetLines.seasonId,
      sourceBlockId: budgetLines.sourceBlockId,
      sourceRow: budgetLines.sourceRow,
    }).from(budgetLines);
  }
  return db.select({
    id: ticketRounds.id,
    label: ticketRounds.label,
    amount: ticketRounds.total,
    seasonId: ticketRounds.seasonId,
    sourceBlockId: ticketRounds.sourceBlockId,
    sourceRow: ticketRounds.sourceRow,
  }).from(ticketRounds);
}

async function deleteByIds(
  db: AnyDb, table: ReplaceableTable | 'ticket_rounds', ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  if (table === 'ledger_entries') {
    return (await db.delete(ledgerEntries)
      .where(inArray(ledgerEntries.id, ids)).returning()).length;
  }
  if (table === 'budget_lines') {
    return (await db.delete(budgetLines)
      .where(inArray(budgetLines.id, ids)).returning()).length;
  }
  return (await db.delete(ticketRounds)
    .where(inArray(ticketRounds.id, ids)).returning()).length;
}

interface TableCounts {
  ledgerSeeded: number; ledgerPromoted: number;
  budgetSeeded: number; budgetPromoted: number;
  ticketSeeded: number; ticketPromoted: number;
  obligationSeeded: number; obligationPromoted: number;
}

/**
 * Counts written out per table rather than through one generic helper: a
 * helper parameterised on the column cannot be typed across four different
 * `tableName` literals without a cast, and a cast in the one function whose
 * numbers the report is judged on is not worth the eight saved lines.
 */
async function countRows(db: AnyDb): Promise<TableCounts> {
  const n = (rows: Array<{ n: string }>): number => Number(rows[0].n);
  const count = sql<string>`count(*)`;
  return {
    ledgerSeeded: n(await db.select({ n: count }).from(ledgerEntries)
      .where(isNull(ledgerEntries.sourceBlockId))),
    ledgerPromoted: n(await db.select({ n: count }).from(ledgerEntries)
      .where(sql`${ledgerEntries.sourceBlockId} is not null`)),
    budgetSeeded: n(await db.select({ n: count }).from(budgetLines)
      .where(isNull(budgetLines.sourceBlockId))),
    budgetPromoted: n(await db.select({ n: count }).from(budgetLines)
      .where(sql`${budgetLines.sourceBlockId} is not null`)),
    ticketSeeded: n(await db.select({ n: count }).from(ticketRounds)
      .where(isNull(ticketRounds.sourceBlockId))),
    ticketPromoted: n(await db.select({ n: count }).from(ticketRounds)
      .where(sql`${ticketRounds.sourceBlockId} is not null`)),
    obligationSeeded: n(await db.select({ n: count }).from(obligations)
      .where(isNull(obligations.sourceBlockId))),
    obligationPromoted: n(await db.select({ n: count }).from(obligations)
      .where(sql`${obligations.sourceBlockId} is not null`)),
  };
}

/**
 * The seeded population the evidence was taken against, exactly.
 *
 * R31 has two halves and the id list only covers one of them. A listed id that
 * has GONE is caught when its row cannot be found; a seeded row that has been
 * ADDED since the evidence was written is invisible to a list of 41 ids — the
 * run would delete the 41 it knows and leave the new one standing, unreviewed,
 * with no replacement and nobody told. So the population is checked first, and
 * a population this evidence cannot account for stops the run.
 */
const EVIDENCE_SEEDED = {
  ledger_entries: 19, budget_lines: 28, ticket_rounds: 3, obligations: 13,
} as const;

type SeededTable = keyof typeof EVIDENCE_SEEDED;

/**
 * Compares the seeded population against the evidence, allowing for rows a
 * PREVIOUS run of this script already deleted.
 *
 * A flat "must equal 19 / 28 / 3 / 13" would be wrong the moment `--season` is
 * used as intended: cut ברן 26 over today and the ledger holds 7 seeded rows,
 * so a flat check would refuse to ever cut ברן 25 over tomorrow. The
 * expectation is therefore the evidence's count MINUS the enumerated ids that
 * are no longer there — every one of which this script, and only this script,
 * is meant to have removed. Anything left over is a row the evidence never saw.
 */
function populationProblems(
  counts: TableCounts, seededIds: Map<SeededTable, Set<string>>,
): string[] {
  const seen: Record<SeededTable, number> = {
    ledger_entries: counts.ledgerSeeded,
    budget_lines: counts.budgetSeeded,
    ticket_rounds: counts.ticketSeeded,
    obligations: counts.obligationSeeded,
  };
  const enumerated = [...REPLACED, ...TRUNCATIONS];

  return (Object.keys(EVIDENCE_SEEDED) as SeededTable[]).flatMap((table) => {
    const present = seededIds.get(table) ?? new Set<string>();
    const alreadyGone = enumerated
      .filter((row) => row.table === table && !present.has(row.id))
      .length;
    const expected = EVIDENCE_SEEDED[table] - alreadyGone;
    if (seen[table] === expected) return [];
    return [`${table}: ${seen[table]} seeded rows, but the evidence accounts for `
      + `${expected} (${EVIDENCE_SEEDED[table]} reviewed, ${alreadyGone} of them `
      + 'already deleted by an earlier run)'];
  });
}

function sayCounts(title: string, counts: TableCounts): void {
  say(`${title}:`);
  say(`  ledger_entries  seeded=${counts.ledgerSeeded} promoted=${counts.ledgerPromoted}`);
  say(`  budget_lines    seeded=${counts.budgetSeeded} promoted=${counts.budgetPromoted}`);
  say(`  ticket_rounds   seeded=${counts.ticketSeeded} promoted=${counts.ticketPromoted}`);
  say(`  obligations     seeded=${counts.obligationSeeded} promoted=${counts.obligationPromoted}`);
}

// ---------------------------------------------------------------------------
// Verification — every reason this script is allowed to delete a row
// ---------------------------------------------------------------------------

interface Verified {
  table: ReplaceableTable | 'ticket_rounds';
  id: string;
  what: string;
}

/**
 * Finds the promoted row that replaces `target`, or explains why there is not
 * one. Four things must hold, and all four are checked against rows read back
 * from inside the transaction, after the promotion has written them:
 *
 *  1. the seeded row is still there, with `source_block_id IS NULL`;
 *  2. it still holds the label and amount the evidence recorded — if it does
 *     not, the list is stale and this script must not act on it;
 *  3. exactly one promoted row carries `(blockId, sourceRow)`;
 *  4. that row agrees on season, label and amount to the agora.
 */
function verifyReplacement(
  target: Replacement, rows: Row[],
): { ok: true; row: Verified } | { ok: false; why: string } {
  const seeded = rows.find((row) => row.id === target.id);
  if (!seeded) {
    return { ok: false, why: `seeded row ${target.id} (${target.label}) is not in the database` };
  }
  if (seeded.sourceBlockId !== null) {
    return {
      ok: false,
      why: `seeded row ${target.id} (${target.label}) already carries `
        + `source_block_id=${seeded.sourceBlockId} — it is not a seeded row any more`,
    };
  }
  if (!sameLabel(seeded.label, target.label)) {
    return {
      ok: false,
      why: `seeded row ${target.id} reads "${seeded.label}", the evidence recorded `
        + `"${target.label}"`,
    };
  }
  if (!sameMoney(seeded.amount, target.amount)) {
    return {
      ok: false,
      why: `seeded row ${target.id} (${target.label}) holds ${seeded.amount}, the `
        + `evidence recorded ${target.amount}`,
    };
  }

  const candidates = rows.filter(
    (row) => row.sourceBlockId === target.blockId && row.sourceRow === target.sourceRow,
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      why: `no promoted row at (${target.blockId.slice(0, 8)}, r${target.sourceRow}) to `
        + `replace ${target.label} — was the block confirmed?`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      why: `${candidates.length} promoted rows at (${target.blockId.slice(0, 8)}, `
        + `r${target.sourceRow}); the source key is supposed to be unique`,
    };
  }

  const [replacement] = candidates;
  if (replacement.seasonId !== seeded.seasonId) {
    return {
      ok: false,
      why: `the replacement for ${target.label} belongs to a different season `
        + `(${replacement.seasonId ?? 'none'} vs ${seeded.seasonId ?? 'none'})`,
    };
  }
  const expectedLabel = target.workbookLabel ?? target.label;
  if (!sameLabel(replacement.label, expectedLabel)) {
    return {
      ok: false,
      why: `the replacement for ${target.label} reads "${replacement.label}", not `
        + `"${expectedLabel}"`,
    };
  }
  if (!sameMoney(replacement.amount, target.amount)) {
    return {
      ok: false,
      why: `the replacement for ${target.label} holds ${replacement.amount}, not `
        + `${target.amount} — a row with a different number is not a replacement`,
    };
  }

  return {
    ok: true,
    row: {
      table: target.table,
      id: target.id,
      what: `${target.label} ${target.amount} <- ${target.blockId.slice(0, 8)} `
        + `r${target.sourceRow}`,
    },
  };
}

/** The junk row itself is what gets deleted, so it is located by the
 *  promoter's own key and checked against the label AND the amount the
 *  evidence recorded — both sides, exactly as a replacement is. */
function verifyJunk(
  junk: JunkRow, rows: Row[],
): { ok: true; row: Verified; amount: string } | { ok: false; why: string } {
  const candidates = rows.filter(
    (row) => row.sourceBlockId === junk.blockId && row.sourceRow === junk.sourceRow,
  );
  if (candidates.length !== 1) {
    return {
      ok: false,
      why: `${candidates.length} rows at (${junk.blockId.slice(0, 8)}, r${junk.sourceRow}); `
        + `expected exactly the junk row "${junk.label}"`,
    };
  }
  const [row] = candidates;
  if (!sameLabel(row.label, junk.label)) {
    return {
      ok: false,
      why: `(${junk.blockId.slice(0, 8)}, r${junk.sourceRow}) reads "${row.label}", not `
        + `"${junk.label}" — the block's rows have moved, so this is not the junk row`,
    };
  }
  if (!sameMoney(row.amount, junk.amount)) {
    return {
      ok: false,
      why: `(${junk.blockId.slice(0, 8)}, r${junk.sourceRow}) "${junk.label}" holds `
        + `${row.amount}, the evidence recorded ${junk.amount} — a row this script `
        + 'has not seen before is not junk it may delete',
    };
  }
  return {
    ok: true,
    amount: row.amount,
    row: { table: junk.table, id: row.id, what: `${junk.label} ${row.amount} — ${junk.why}` },
  };
}

// ---------------------------------------------------------------------------
// Scope — one season at a time, because the seasons are not equally ready
// ---------------------------------------------------------------------------

/**
 * Which season this run is allowed to touch. `null` means all of them.
 *
 * ברן 26 reproduces its workbook to the agora once promoted; ברן 25 does not,
 * because the dancefloor block comes back categorised `camp` and its budget
 * lands at 158,507 against a workbook that says 59,587. Running the whole
 * corpus in one transaction makes those one decision, and a lead who wants the
 * good half has no way to take it without the bad half. So the scope is a
 * parameter: it narrows the promotion AND the deletion set together, and
 * anything enumerated for another season is left exactly where it is.
 */
interface Scope {
  seasonId: string | null;
  seasonName: string | null;
}

interface BlockSeason {
  seasonId: string | null;
  seasonName: string | null;
  sheetName: string;
}

/** The season each evidence block's sheet carries. The block's season, not the
 *  row's, decides scope: it is the same thing that decides whether the block is
 *  promoted at all, so the two halves cannot disagree. */
async function blockSeasons(db: AnyDb): Promise<Map<string, BlockSeason>> {
  const rows = await db.select({
    id: blocks.id,
    seasonId: sheets.seasonId,
    seasonName: seasons.name,
    sheetName: sheets.name,
  })
    .from(blocks)
    .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
    .leftJoin(seasons, eq(seasons.id, sheets.seasonId));
  return new Map(rows.map((row) => [row.id, {
    seasonId: row.seasonId, seasonName: row.seasonName, sheetName: row.sheetName,
  }]));
}

/**
 * Promotes every confirmed block whose sheet is in scope.
 *
 * With `scope.seasonId === null` the selection is character for character the
 * one `promoteAll` makes — confirmed blocks, ordered by `sheets.name` then
 * `blocks.top` — and the per-block savepoint behaviour is the same, because
 * this calls the same `promoteBlock`. It is written out here rather than
 * passing a filter into `promoteAll` because `promoteAll` is the register's
 * shared entry point and four lanes are editing this repo; a season parameter
 * on it is a change to everyone's API for one script's benefit.
 */
async function promoteScoped(
  db: AnyDb, opts: { dryRun: boolean; recordedBy: string }, scope: Scope,
): Promise<BulkResult> {
  const confirmed = await db.select({ id: blocks.id })
    .from(blocks)
    .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
    .where(scope.seasonId === null
      ? isNotNull(blocks.confirmedAt)
      : and(isNotNull(blocks.confirmedAt), eq(sheets.seasonId, scope.seasonId)))
    .orderBy(sheets.name, blocks.top);

  const results: PromotionResult[] = [];
  const failures: { blockId: string; message: string }[] = [];
  for (const { id } of confirmed) {
    try {
      // Sequential on purpose, as in `promoteAll`: each block must finish, or
      // roll back to its own savepoint, before the next one starts.
      results.push(await promoteBlock(db, id, opts));
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
}

// ---------------------------------------------------------------------------
// The money figures, so the report can be compared against the workbooks
// ---------------------------------------------------------------------------

async function sayMoney(db: AnyDb, title: string): Promise<void> {
  say(`### ${title}`);
  say();
  const seasonRows = await db.select({ id: seasons.id, name: seasons.name })
    .from(seasons).orderBy(seasons.name);
  for (const season of seasonRows) {
    const summary = await seasonMoneySummary(db, season.id);
    const camp = await budgetTotalAgorot(db, season.id, 'camp');
    const dancefloor = await budgetTotalAgorot(db, season.id, 'dancefloor');
    const all = await budgetTotalAgorot(db, season.id);
    say(`- ${season.name}`);
    say(`    ledger: in=${formatILS(summary.ledger.inAgorot)} `
      + `out=${formatILS(summary.ledger.outAgorot)} `
      + `net=${formatILS(summary.ledger.netAgorot)} count=${summary.ledger.count}`);
    say(`    budget: camp=${formatILS(camp)} dancefloor=${formatILS(dancefloor)} `
      + `all=${formatILS(all)}`);
    say(`    identity: budget=${formatILS(summary.identity.budgetTotalAgorot)} `
      + `perHead=${summary.identity.perPersonFullAgorot === null
        ? 'n/a' : formatILS(summary.identity.perPersonFullAgorot)} `
      + `flat=${formatILS(summary.identity.flatRateAgorot)} `
      + `funding/head=${summary.identity.perPersonFundingAgorot === null
        ? 'n/a' : formatILS(summary.identity.perPersonFundingAgorot)} `
      + `closes=${summary.identity.closes}`);
    // Tickets and funding are printed because tickets is the figure that
    // doubles: the three seeded rounds (171,000, from an unmapped sub-table of
    // `תקציב קאמפ ברן 26`) stay, and `SuperNature 3.10` adds four more
    // (139,125). They are two projections of two different things and
    // `ticketTotalAgorot` sums them without a word. Leaving the one number
    // this cutover visibly breaks out of the report would be the report
    // choosing what not to look at.
    const [tickets, funding] = await Promise.all([
      ticketTotalAgorot(db, season.id), fundingTotalAgorot(db, season.id),
    ]);
    say(`    tickets: ${formatILS(tickets)}   funding plan: ${formatILS(funding)}`);
    say(`    accounts: ${formatILS(summary.totalBalanceAgorot)} `
      + `(${summary.accounts.length}) — camp-wide, not season-scoped`);
    say(`    campOwes: ${formatILS(summary.campOwesAgorot)} `
      + `(${summary.campOwes.length} rows)`);
  }
  say();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** `--flag value` or `--flag=value`, so a Hebrew season name can be quoted
 *  either way. Returns undefined when the flag is absent. */
function flagValue(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const at = process.argv.indexOf(name);
  if (at === -1) return undefined;
  const next = process.argv[at + 1];
  if (next === undefined || next.startsWith('--')) {
    throw new Error(`${name} needs a value, e.g. ${name} "ברן 26"`);
  }
  return next;
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const includeTruncations = process.argv.includes('--include-truncations');
  const keepTruncations = process.argv.includes('--keep-truncations');
  const actor = flagValue('--actor') ?? 'cutover@shliff.camp';
  const seasonArg = flagValue('--season');

  /**
   * The truncation question has to be ANSWERED before anything is kept.
   *
   * Leaving the two truncated rows in place is not a neutral default: their
   * replacements are already written at the same amounts, so the 5,000 and the
   * 1,000 are counted twice and the ברן 26 identity stops closing. Committing
   * that silently makes the wrong answer the one nobody chose. Both answers
   * are one flag; only having no answer is refused.
   */
  if (commit && includeTruncations === keepTruncations) {
    throw new CutoverRefusal(
      includeTruncations
        ? 'pass either --include-truncations or --keep-truncations, not both.'
        : 'refusing to commit without an answer on the two truncated labels. '
        + 'Leaving them is not free: their replacements are already written at '
        + 'the same amounts, so 5,000 ₪ and 1,000 ₪ end up counted twice and the '
        + 'ברן 26 dues/fundraising identity stops closing. Pass '
        + '--include-truncations to delete them (the labels lengthen to the '
        + "workbook's wording), or --keep-truncations to accept the double count "
        + 'deliberately. A dry run needs neither.',
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const dbName = assertScratchDatabase(url, CUTOVER_DATABASE);

  // Imported here, not at the top: `@/db` connects at import time.
  const { db } = await import('@/db');

  const seasonRows = await db.select({ id: seasons.id, name: seasons.name })
    .from(seasons).orderBy(seasons.name);
  const scope: Scope = { seasonId: null, seasonName: null };
  if (seasonArg !== undefined) {
    const match = seasonRows.find((row) => row.name === seasonArg);
    if (!match) {
      throw new CutoverRefusal(
        `no season named "${seasonArg}". This database has: `
        + `${seasonRows.map((row) => row.name).join(', ') || '(none)'}.`,
      );
    }
    scope.seasonId = match.id;
    scope.seasonName = match.name;
  }

  say(`# Cutover — database "${dbName}"`);
  say(`generated ${new Date().toISOString()}`);
  say(commit
    ? 'MODE: --commit. The transaction below is kept.'
    : 'MODE: dry run. Everything below really happens, inside one transaction, '
      + 'and the transaction is then rolled back. Pass --commit to keep it.');
  say(`actor: ${actor}`);
  say(`truncated-label rows: ${includeTruncations ? 'DELETED (--include-truncations)'
    : (keepTruncations ? 'kept (--keep-truncations)' : 'kept (dry run — undecided)')}`);
  say();

  say('## Scope');
  say();
  if (scope.seasonId === null) {
    say('acting on: EVERY season, and every confirmed block.');
    say('  No --season was given. ברן 25 and ברן 26 are not equally ready — see');
    say('  "Left for the camp lead" — so consider --season "ברן 26" first.');
  } else {
    say(`acting on: ${scope.seasonName} only.`);
  }
  for (const season of seasonRows) {
    if (season.id === scope.seasonId || scope.seasonId === null) continue;
    say(`not acting on: ${season.name} — its blocks are not promoted and its `
      + 'enumerated rows are left exactly where they are.');
  }

  // The list above can only name seasons that exist, and sheets with no season
  // belong to none of them — so without this line the eight unlabelled
  // `קופת קאמפ 23'-24'` sheets would be absent from the scope report entirely,
  // which reads as "not there" rather than "deliberately nowhere". Nothing is
  // at risk either way: an unlabelled sheet is never in scope (a scoped run
  // matches on season id, and theirs is null), and under an unscoped run its
  // blocks promote but refuse every row `no-season`. They are counted rather
  // than listed because the point is that they are a known quantity.
  const [unlabelled] = await db.select({ n: sql<string>`count(*)` })
    .from(sheets).where(isNull(sheets.seasonId));
  if (Number(unlabelled.n) > 0) {
    say(`not acting on: ${unlabelled.n} sheets with no season at all — ברן 23 and `
      + 'ברן 24 do not exist as seasons, so their sheets could not be labelled. They '
      + 'are in no season\'s scope, they have no enumerated rows, and under an '
      + 'unscoped run every row of theirs refuses `no-season`.');
  }
  say();

  const confirmedBlocks = await db.select({ n: sql<string>`count(*)` })
    .from(blocks).where(sql`${blocks.confirmedAt} is not null`);
  say(`confirmed blocks: ${confirmedBlocks[0].n} of `
    + `${(await db.select({ n: sql<string>`count(*)` }).from(blocks))[0].n}`);
  say(`sheets: ${(await db.select({ n: sql<string>`count(*)` }).from(sheets))[0].n}`);
  say();

  let rolledBack = false;
  try {
    await (db as unknown as {
      transaction: <T>(fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
    }).transaction(async (tx) => {
      const before = await countRows(tx);
      sayCounts('## Before', before);
      say();

      // -- 0. The population the evidence was taken against ------------------
      // Read before the promotion, so "seeded" means what it meant when the
      // evidence was reviewed rather than whatever the promoter just wrote.
      const seededIds = new Map<SeededTable, Set<string>>();
      for (const table of ['ledger_entries', 'budget_lines', 'ticket_rounds'] as const) {
        seededIds.set(table, new Set(
          (await readTable(tx, table))
            .filter((row) => row.sourceBlockId === null)
            .map((row) => row.id),
        ));
      }
      const grown = populationProblems(before, seededIds);
      if (grown.length > 0) {
        for (const problem of grown) say(`  !! ${problem}`);
        say();
        throw new CutoverRefusal(
          'the seeded population is not one this evidence can account for: '
          + `${grown.join('; ')}. A seeded row the evidence never saw has no `
          + 'enumerated id and no reviewed replacement, so it would be left standing '
          + 'with nobody told. Re-derive the evidence before running this.',
        );
      }

      await sayMoney(tx, 'Money before');

      // -- 1. Promote, in scope ---------------------------------------------
      const bulk = await promoteScoped(tx, { dryRun: false, recordedBy: actor }, scope);
      say('## Promotion');
      say();
      say(`scope: ${scope.seasonName ?? 'every season'}`);
      say(`blocks promoted: ${bulk.results.length}`);
      say(`rows written: ${bulk.writtenCount}`);
      say(`rows refused: ${bulk.refusedCount}`);
      say(`rows swept:   ${bulk.deletedCount} deleted, ${bulk.retainedCount} retained`);
      say(`failures:     ${bulk.failedCount}`);
      for (const failure of bulk.failures) {
        say(`  !! ${failure.blockId}: ${failure.message}`);
      }
      say();
      if (bulk.failedCount > 0) {
        throw new CutoverRefusal(
          `${bulk.failedCount} blocks failed to promote. Nothing is deleted while a `
          + 'block that should have produced replacements did not run.',
        );
      }

      // -- 2. Verify every delete against its own replacement ---------------
      const snapshot = new Map<ReplaceableTable | 'ticket_rounds', Row[]>([
        ['ledger_entries', await readTable(tx, 'ledger_entries')],
        ['budget_lines', await readTable(tx, 'budget_lines')],
        ['ticket_rounds', await readTable(tx, 'ticket_rounds')],
      ]);

      const verified: Verified[] = [];
      const problems: string[] = [];

      // The block's season decides scope, because it is the same thing that
      // decided whether the block was promoted a moment ago. A target whose
      // block is out of scope has no replacement in this transaction — by
      // design — so it is skipped rather than verified and failed. A target
      // whose block this database does not have at all is neither, and is
      // raised as a problem: see `placeInScope`.
      const byBlock = await blockSeasons(tx);
      const known = new Set(byBlock.keys());
      const place = (blockId: string): ScopePlacement => placeInScope(
        blockId, known, (id) => byBlock.get(id)?.seasonId ?? null, scope.seasonId,
      );

      const chosen = includeTruncations ? [...REPLACED, ...TRUNCATIONS] : REPLACED;
      const targets = chosen.filter((target) => place(target.blockId) === 'in');
      const skipped = chosen.filter((target) => place(target.blockId) === 'out');
      const skippedJunk = JUNK.filter((junk) => place(junk.blockId) === 'out');
      const junkTargets = JUNK.filter((junk) => place(junk.blockId) === 'in');
      const unknown = [...chosen, ...JUNK].filter(
        (target) => place(target.blockId) === 'unknown',
      );

      if (unknown.length > 0) {
        say('## Blocks this database has never heard of');
        say();
        for (const target of unknown) {
          const why = `block ${target.blockId} is not in this database, so the row `
            + `"${target.label}" has no replacement and no season — the evidence was `
            + 'taken against a different database, or the sheets were re-imported';
          problems.push(why);
          say(`  !!  ${target.table}  ${why}`);
        }
        say();
      }

      if (skipped.length > 0 || skippedJunk.length > 0) {
        say('## Out of scope — enumerated, and deliberately left alone');
        say();
        for (const target of [...skipped, ...skippedJunk]) {
          const block = byBlock.get(target.blockId);
          say(`  --  ${target.table}  ${target.label}  `
            + `(${target.blockId.slice(0, 8)} r${target.sourceRow}, `
            + `${block?.seasonName ?? 'no season'})`);
        }
        say();
      }

      say('## Replacements verified, one row at a time');
      say();
      for (const target of targets) {
        const outcome = verifyReplacement(target, snapshot.get(target.table) ?? []);
        if (!outcome.ok) {
          problems.push(outcome.why);
          say(`  !!  ${target.table}  ${outcome.why}`);
          continue;
        }
        // Belt and braces on the scope. `verifyReplacement` already proved the
        // seeded row and its replacement share a season; this says out loud
        // that the season is the one asked for, so a block whose sheet label
        // moved cannot smuggle another season's row into a scoped run.
        const seeded = (snapshot.get(target.table) ?? []).find((row) => row.id === target.id);
        if (scope.seasonId !== null && seeded?.seasonId !== scope.seasonId) {
          problems.push(`${target.label} (${target.id}) belongs to a season other than `
            + `${scope.seasonName}, but its block is labelled ${scope.seasonName}`);
          say(`  !!  ${target.table}  ${target.label} — season mismatch against the scope`);
          continue;
        }
        verified.push(outcome.row);
        say(`  ok  ${target.table}  ${outcome.row.what}`);
      }
      say();

      say('## Junk the promotion wrote, identified and removed');
      say();
      for (const junk of junkTargets) {
        const outcome = verifyJunk(junk, snapshot.get(junk.table) ?? []);
        if (outcome.ok) {
          verified.push(outcome.row);
          say(`  ok  ${junk.table}  ${outcome.row.what}`);
        } else {
          problems.push(outcome.why);
          say(`  !!  ${junk.table}  ${outcome.why}`);
        }
      }
      if (junkTargets.length === 0) say('  (none in scope)');
      say();

      if (problems.length > 0) {
        throw new CutoverRefusal(
          `${problems.length} of ${targets.length + junkTargets.length + unknown.length} `
          + 'rows this run had to account for could not be verified. The evidence and '
          + 'the database disagree, so nothing is deleted and the promotion is rolled '
          + 'back with it.',
        );
      }

      // -- 3. Delete, by id, in the same transaction ------------------------
      say('## Deletion');
      say();
      let deleted = 0;
      for (const table of ['ledger_entries', 'budget_lines', 'ticket_rounds'] as const) {
        const ids = verified.filter((row) => row.table === table).map((row) => row.id);
        const gone = await deleteByIds(tx, table, ids);
        deleted += gone;
        say(`  ${table}: ${gone} of ${ids.length} deleted`);
        if (gone !== ids.length) {
          throw new CutoverRefusal(
            `expected to delete ${ids.length} rows from ${table}, deleted ${gone}`,
          );
        }
      }
      say();
      say(`total deleted: ${deleted}`);
      say();

      const after = await countRows(tx);
      sayCounts('## After', after);
      say();
      await sayMoney(tx, 'Money after');

      if (!commit) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    rolledBack = true;
  }

  say('## Outcome');
  say();
  say(rolledBack
    ? 'rolled back — this was a dry run, and the database is exactly as it was.'
    : 'committed.');
  say();

  reportDecisions();

  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${out.join('\n')}\n`, (err) => (err ? reject(err) : resolve()));
  });
  process.exit(0);
}

/**
 * The questions this script refuses to answer on the camp's behalf.
 *
 * Printed on every run, committed or not, because a decision that is only
 * visible when something goes wrong is a decision nobody makes.
 */
function reportDecisions(): void {
  say('## Left for the camp lead');
  say();
  say('1. The four ברן 25 dancefloor budget lines are NOT deleted.');
  for (const line of DANCEFLOOR_KEPT) {
    say(`     ${line.id}  ${line.label}  ${line.amount}  (${line.note})`);
  }
  say('   The promoter re-creates all four at the right amount, but `budgetRow`');
  say('   hard-codes `category: \'camp\'`, so they come back as camp spend with new');
  say('   ids. Four `tasks.budget_line_id` values point at the ids above and there');
  say('   is no foreign key, so deleting them would orphan those references in');
  say('   silence AND move 89,060 ₪ of dancefloor spend into the camp identity —');
  say('   which divides by the camp\'s 43 heads. Until either `budgetRow` grows a');
  say('   category lever at confirm time or the four tasks are deliberately');
  say('   re-pointed, the seeded rows stay and the season carries both copies:');
  say('   dancefloor 89,060 ₪ seeded, plus the same four as camp from the block.');
  say();
  say('2. `הובלה` ברן 25 at 4,000 is produced by TWO blocks — `fa78b9be` r6 (the');
  say('   dancefloor deliverable) and `254bef9f` r13 (the camp budget\'s own');
  say('   transport line). A lead has to say whether that is one fact or two.');
  say();
  say('3. The two truncated labels. The fact is re-created at the same amount under');
  say('   the workbook\'s longer wording; only the label lengthens:');
  for (const row of TRUNCATIONS) {
    say(`     ${row.table}  ${row.id}`);
    say(`       seeded:   ${row.label}  ${row.amount}`);
    say(`       workbook: ${row.workbookLabel}  (${row.blockId.slice(0, 8)} r${row.sourceRow})`);
  }
  say('   Run with --include-truncations once the camp is content for the labels to');
  say('   lengthen. Until then both are counted twice: 5,000 ₪ and 1,000 ₪.');
  say();
  say('4. Nothing in `obligations` is deleted — all thirteen stand un-replaced —');
  say('   and neither are the three seeded `ticket_rounds`. Both sit in side-by-side');
  say('   sub-tables that `detectBlocks` never carved out, so no column map reaches');
  say('   them. They are real data with no workbook route in.');
  say();
  say('5. THE JUNK DELETION IS NOT DURABLE, and nothing in the schema makes it so.');
  say('   The promoter upserts on `(source_block_id, source_row)`. Once');
  say('   `(66ad3b61, r31)` and `(66ad3b61, r32)` are deleted, that conflict target');
  say('   no longer exists — so the NEXT promotion of block 66ad3b61 does not update');
  say('   them, it re-INSERTS them: 42,000 + 22,375.30 of non-budget back onto');
  say('   ברן 26, which is 64,375.30 on a budget of 64,375.30. It exactly doubles.');
  say('   Measured on a clone: budget 64,375.30 -> 128,750.60 after one re-promotion.');
  say('   The W5 sweep cannot help — it only removes rows the block no longer');
  say('   produces, and the block still produces these.');
  say();
  say('   THIS SCRIPT CANNOT UNDO IT. It cannot be re-run over a season it has');
  say('   already cut over: the enumerated seeded rows for that season are gone, so');
  say('   every `verifyReplacement` fails with "seeded row ... is not in the');
  say('   database" and the whole transaction rolls back — including the deletion');
  say('   of the junk it was run to remove. A second run is a refusal, not a repair.');
  say();
  say('   The repair is by hand, against the database, after the re-promotion:');
  say();
  say('     delete from budget_lines');
  say('      where source_block_id = \'66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92\'');
  say('        and source_row in (31, 32);');
  say();
  say('   Check before and after that those are the two rows and nothing else:');
  say();
  say('     select source_row, label, total from budget_lines');
  say('      where source_block_id = \'66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92\'');
  say('        and source_row in (31, 32);');
  say('     -- expect exactly: 31 תקציב מחנה 42000.00, 32 יעד גיוס 22375.30');
  say();
  say('   `(84d315a5, r11)` — the אסף profit-split row — used to be on this list and');
  say('   is NOT any more. `ticketRow` refuses a non-integer quantity now, so it is');
  say('   never written and there is nothing to delete. Re-promoting 84d315a5 is safe.');
  say();
  say('   So: re-promoting 66ad3b61 after a cutover is an action that requires those');
  say('   deletes afterwards. Until a lead can veto a row at confirm time, or block');
  say('   bounds become editable, there is no better remedy than knowing this before');
  say('   pressing the button.');
  say();
  say('6. ברן 26\'s ticket projection DOUBLES, to 310,125.');
  say('   171,000 seeded — כרטיסים עד כה 60,000, סבב ג׳ 33,000, סבב ד׳ 78,000, from');
  say('   the unmapped sub-table of `תקציב קאמפ ברן 26` — plus 139,125 promoted from');
  say('   `SuperNature 3.10` (מוקדמות 7,000, ראשון 18,000, שני 38,500, אחרון 75,625).');
  say('   They are two projections of two different things and `ticketTotalAgorot`');
  say('   sums them with nothing to tell them apart. Neither replaces the other, so');
  say('   this script deletes neither; a lead has to say what the season\'s ticket');
  say('   figure is meant to be.');
  say();
  say('7. One promoted row is a false positive this script does NOT delete:');
  say('     budget_lines  (fa78b9be r20)  צפי להחזרי מע״מ  5,550');
  say('   It is the head of a VAT-reclaim sub-table, not a budget line, and it');
  say('   inflates ברן 25\'s camp budget by 5,550 ₪. The cutover evidence names it');
  say('   in its false-positive table but does not list it among the rows to delete');
  say('   after promoting, and this script deletes only what the evidence');
  say('   enumerated — re-deriving the set at run time is exactly what R31 forbids.');
  say('   Add it to JUNK once a reviewer has checked the row the same way the');
  say('   other three were checked.');
  say();
}

main().catch((error) => {
  // The report buffer is flushed on EVERY exit, not only a refusal. A crash
  // rolls the transaction back just as cleanly, but the lead still needs the
  // before-counts, the money snapshot and the per-row verification to know how
  // far the run got — and on a crash they need it more, not less. Printing it
  // before the error keeps the stack trace as the last thing on screen.
  process.stdout.write(`${out.join('\n')}\n\n`);
  if (error instanceof CutoverRefusal) {
    console.error(`REFUSED: ${error.message}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
