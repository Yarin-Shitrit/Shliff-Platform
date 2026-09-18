# Phase 3 Wave 2 — Block Promotion and the Unresolved Register

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a confirmed workbook block into domain rows that carry their own provenance, and rebuild `/data` as the register of everything the system could not settle.

**Architecture:** Four pure per-archetype promoters (`ledger`, `budget_lines`, `ticket_rounds`, `obligations`) map mapped cells to a domain input or a `Refusal`. One `promoteBlock` dispatches, writes, and deletes rows the block no longer produces. Sheets carry a hand-set season and a hand-set authority flag, which together decide eligibility. `/data` renders a live dry run rather than stored results, so it can never disagree with what a commit would do.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19, TypeScript, Drizzle ORM, Postgres (PGlite in tests), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-block-promotion-and-data-view-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Never run `npm install`.** npm/cli#4828 drops the rolldown native binding and breaks every test. If you hit `Cannot find module @rolldown/binding-darwin-arm64`, repair with `npm install --no-save @rolldown/binding-darwin-arm64@1.2.8`.
- **Never trust a test exit code. Read the test COUNT.** The `rtk` shell hook intermittently swallows vitest output and a parse error runs ZERO tests while still exiting 0. Route test runs through `rtk proxy`. A missing count is a failed run.
- **`git commit -m "..."` performs command substitution on backticked spans in this zsh and silently deletes them.** Always commit with `git commit -F -` and a quoted heredoc (`<<'MSG'`).
- **Never run `drizzle-kit push` or `drizzle-kit migrate` against the live database** on `localhost:5432`. `drizzle-kit generate` only writes SQL and is safe. Tests use PGlite via `createTestDb()`.
- **Additive migrations only.** Schema files stay listed explicitly in `drizzle.config.ts`; `src/db/config.test.ts` enforces it. `src/db/schema/source.ts` is already listed.
- **Money is `numeric(12,2)` in Postgres and integer agorot in JS.** `src/lib/money.ts` (`toAgorot`, `fromAgorot`, `sumAgorot`, `formatILS`) is the only converter. Never do float arithmetic on money.
- **Blankness checks on user or workbook input use `isBlank` from `@/lib/text/normalize`, never `.trim()`.** `.trim()` leaves invisible directional marks standing.
- **`@/db` throws at import time without `DATABASE_URL`** and must never enter the module graph of a `'use server'` file or a test. Domain modules under `@/lib` take `db: AnyDb` (from `@/lib/db-types`) as their first parameter.
- **Admin-only.** Every page and server action calls `requireAdmin()` from `@/lib/auth/guard` and throws on `!admin.ok`. UI hiding is never the enforcement.
- **Hebrew RTL throughout.** CSS logical properties only — `margin-inline`, `padding-block`, `border-inline-start/end`, `text-align: start/end`. Never `left`/`right`. Wrap Latin, numeric and mixed-direction runs in `<bdi>`. All UI copy in Hebrew.
- **`@testing-library/user-event` is NOT installed.** Use `fireEvent`.
- **`vi.mock` factories referencing a plain top-level `const` throw a hoisting `ReferenceError`.** Use `vi.hoisted`.
- **`docs/reference-data/` holds real names and amounts, is read-only, and must never be modified.**
- **Empty states are invitations, not apologies.** Every empty state names the season or subject and offers a next step with a link.
- **After a task passes, mutation-test it:** break each new behaviour on purpose and confirm a test fails. A surviving mutation is the finding worth having. Report every mutation run and its outcome.

## File Structure

**Create**

| path | responsibility |
|---|---|
| `drizzle/0005_*.sql` | adds `sheets.season_id`, `sheets.authoritative` |
| `src/lib/import/sheets.ts` | sheet season + authority + collision/eligibility rules |
| `src/lib/import/promote/types.ts` | `RefusalReason`, `Refusal`, `PromotedRow`, `PromotionResult`, `PromoteContext` |
| `src/lib/import/promote/rows.ts` | `raw_grid` → mapped rows; shared total/carry-forward/blank detection |
| `src/lib/import/promote/ledger.ts` | one ledger row → `NewEntry` or `Refusal` |
| `src/lib/import/promote/budget.ts` | one budget row → `NewBudgetLine` or `Refusal` |
| `src/lib/import/promote/tickets.ts` | one ticket row → `NewTicketRound` or `Refusal` |
| `src/lib/import/promote/obligations.ts` | one obligation row → `NewObligation` or `Refusal` |
| `src/lib/import/promote/promote.ts` | `promoteBlock`, `promoteAll` — dispatch, write, delete orphans |
| `src/lib/data/worklist.ts` | the register's queries |
| `src/lib/money/trace.ts` | block → rows, row → source cell |
| `src/app/(admin)/data/actions.ts` | server actions for season, authority, bulk promote |
| `src/app/(admin)/data/page.test.tsx` | the page's first test file |
| `scripts/dry-run-promote.ts` | Task 12's evidence run against the live database |
| `scripts/cutover.ts` | Task 13's one-time cutover, written from Task 12's output |

Each `src/lib/**` file above gets a sibling `*.test.ts`.

**Modify**

| path | change |
|---|---|
| `src/db/schema/source.ts` | two columns on `sheets`, import `seasons` from `./camp` |
| `src/app/(admin)/data/page.tsx` | full rewrite: database only |
| `src/app/(admin)/data/data-explorer.tsx` | replaced by register components |
| `src/app/(admin)/data/data.module.css` | styles for the register |
| `src/lib/seed/camp-seed.ts` | stops writing facts the promoter now owns (Task 13) |

---

### Task 1: Sheet season and authority

**Files:**
- Modify: `src/db/schema/source.ts`
- Create: `drizzle/0005_*.sql` (generated)
- Create: `src/lib/import/sheets.ts`
- Test: `src/lib/import/sheets.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface SheetRow {
    id: string; name: string; uploadId: string; filename: string;
    seasonId: string | null; seasonName: string | null;
    authoritative: boolean | null;
  }
  export type SheetState = 'eligible' | 'undecided' | 'ambiguous' | 'superseded';
  export interface SheetEligibility { sheetId: string; state: SheetState; contestedWith: string[] }

  export async function setSheetSeason(db: AnyDb, sheetId: string, seasonId: string | null): Promise<void>;
  export async function setSheetAuthority(db: AnyDb, sheetId: string, authoritative: boolean | null): Promise<void>;
  export async function listSheets(db: AnyDb): Promise<SheetRow[]>;
  export async function sheetEligibility(db: AnyDb): Promise<Map<string, SheetEligibility>>;
  ```

**The rule, stated once.** Two sheets *conflict* when they share a `name`, are different rows, and (their `seasonId`s are equal **or** either is null). A sheet that conflicts with nothing is `eligible`. A sheet that conflicts with something is `eligible` only if it alone in its conflict set is `authoritative === true`; if none is, every member is `undecided`; if two or more are, every member is `ambiguous`; the non-authoritative members of a resolved set are `superseded`.

- [ ] **Step 1: Add the columns to the schema**

In `src/db/schema/source.ts`, add `boolean` to the existing `drizzle-orm/pg-core` import, add `import { seasons } from './camp';`, and extend the `sheets` table:

```ts
export const sheets = pgTable('sheets', {
  id: uuid('id').defaultRandom().primaryKey(),
  uploadId: uuid('upload_id').notNull()
    .references(() => uploads.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  index: integer('index').notNull(),
  rowCount: integer('row_count').notNull(),
  colCount: integer('col_count').notNull(),
  /** The season this sheet's blocks belong to, set by hand. Never inferred
   *  from the filename or the sheet name — see W10. */
  seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  /** True on the chosen copy when the same sheet name appears in more than
   *  one upload for the same season. Null means undecided. */
  authoritative: boolean('authoritative'),
});
```

- [ ] **Step 2: Generate the migration**

```bash
rtk proxy ./node_modules/.bin/drizzle-kit generate
```

Expected: a new `drizzle/0005_*.sql` containing two `ALTER TABLE "sheets" ADD COLUMN` statements and one `ADD CONSTRAINT` foreign key. Read the file and confirm it contains no `DROP`. `createTestDb()` picks it up automatically because it applies every `drizzle/*.sql` in sorted order.

- [ ] **Step 3: Write the failing tests**

Create `src/lib/import/sheets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { uploads, sheets } from '@/db/schema/source';
import {
  setSheetSeason, setSheetAuthority, listSheets, sheetEligibility,
} from './sheets';

let db: TestDb;
let s25: string;
let s26: string;

async function addSheet(filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}-${name}`, storageKey: `k/${filename}-${name}`,
    sizeBytes: 1, uploadedBy: 'lead@shliff.test', status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name, index: 0, rowCount: 10, colCount: 5,
  }).returning();
  return sheet.id;
}

beforeEach(async () => {
  db = await createTestDb();
  s25 = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43 })).id;
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('sheet labelling', () => {
  it('stores a season set by hand and reports the season name', async () => {
    const id = await addSheet('25.xlsx', 'תקציב קאמפ ברן 25');
    await setSheetSeason(db, id, s25);
    const [row] = await listSheets(db);
    expect(row.seasonId).toBe(s25);
    expect(row.seasonName).toBe('ברן 25');
  });

  it('clears a season back to null', async () => {
    const id = await addSheet('25.xlsx', 'תקציב קאמפ ברן 25');
    await setSheetSeason(db, id, s25);
    await setSheetSeason(db, id, null);
    const [row] = await listSheets(db);
    expect(row.seasonId).toBeNull();
  });
});

describe('eligibility', () => {
  it('an uncontested sheet is eligible with no authority set', async () => {
    const id = await addSheet('26.xlsx', 'תקציב רחבה ברן 25');
    await setSheetSeason(db, id, s25);
    const map = await sheetEligibility(db);
    expect(map.get(id)?.state).toBe('eligible');
  });

  it('the same sheet name in two seasons is NOT a collision — both stay eligible', async () => {
    const a = await addSheet('25.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'סיכום כללי');
    await setSheetSeason(db, a, s25);
    await setSheetSeason(db, b, s26);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('eligible');
    expect(map.get(b)?.state).toBe('eligible');
  });

  it('the same sheet name in one season with no choice made is undecided on both', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('undecided');
    expect(map.get(b)?.state).toBe('undecided');
    expect(map.get(a)?.contestedWith).toEqual([b]);
  });

  it('marking one copy authoritative makes it eligible and the other superseded', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    await setSheetAuthority(db, b, true);
    const map = await sheetEligibility(db);
    expect(map.get(b)?.state).toBe('eligible');
    expect(map.get(a)?.state).toBe('superseded');
  });

  it('two copies both marked authoritative are ambiguous, and neither wins', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);
    await setSheetAuthority(db, a, true);
    await setSheetAuthority(db, b, true);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('ambiguous');
    expect(map.get(b)?.state).toBe('ambiguous');
  });

  it('an unlabelled sheet contests a same-named labelled one, and labelling it clears both', async () => {
    const a = await addSheet('25.xlsx', 'סיכום כללי');
    const b = await addSheet('2026.xlsx', 'סיכום כללי');
    await setSheetSeason(db, a, s25);
    expect((await sheetEligibility(db)).get(a)?.state).toBe('undecided');
    await setSheetSeason(db, b, s26);
    const map = await sheetEligibility(db);
    expect(map.get(a)?.state).toBe('eligible');
    expect(map.get(b)?.state).toBe('eligible');
  });
});
```

- [ ] **Step 4: Run the tests and verify they fail**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/sheets.test.ts
```

Expected: FAIL — `Failed to resolve import "./sheets"`. Confirm the failure count is 8, not 0.

- [ ] **Step 5: Implement `src/lib/import/sheets.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { sheets, uploads } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';

export interface SheetRow {
  id: string;
  name: string;
  uploadId: string;
  filename: string;
  seasonId: string | null;
  seasonName: string | null;
  authoritative: boolean | null;
}

export type SheetState = 'eligible' | 'undecided' | 'ambiguous' | 'superseded';

export interface SheetEligibility {
  sheetId: string;
  state: SheetState;
  /** Ids of the sheets this one conflicts with. Empty when uncontested. */
  contestedWith: string[];
}

export async function setSheetSeason(
  db: AnyDb, sheetId: string, seasonId: string | null,
): Promise<void> {
  await db.update(sheets).set({ seasonId }).where(eq(sheets.id, sheetId));
}

export async function setSheetAuthority(
  db: AnyDb, sheetId: string, authoritative: boolean | null,
): Promise<void> {
  await db.update(sheets).set({ authoritative }).where(eq(sheets.id, sheetId));
}

export async function listSheets(db: AnyDb): Promise<SheetRow[]> {
  const rows = await db.select({
    id: sheets.id,
    name: sheets.name,
    uploadId: sheets.uploadId,
    filename: uploads.filename,
    seasonId: sheets.seasonId,
    seasonName: seasons.name,
    authoritative: sheets.authoritative,
  })
    .from(sheets)
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .leftJoin(seasons, eq(seasons.id, sheets.seasonId));
  return rows;
}

/**
 * Two sheets conflict when they share a name and either share a season or
 * either one's season is unset.
 *
 * The unset case is deliberate: until a lead says which season a sheet
 * belongs to, the system genuinely cannot tell a second revision of one
 * season's budget from a different year's. Refusing is correct, and it
 * resolves the moment the season is set.
 */
function conflicts(a: SheetRow, b: SheetRow): boolean {
  if (a.id === b.id || a.name !== b.name) return false;
  return a.seasonId === b.seasonId || a.seasonId === null || b.seasonId === null;
}

export async function sheetEligibility(db: AnyDb): Promise<Map<string, SheetEligibility>> {
  const all = await listSheets(db);
  const out = new Map<string, SheetEligibility>();

  for (const sheet of all) {
    const contested = all.filter((other) => conflicts(sheet, other));
    if (contested.length === 0) {
      out.set(sheet.id, { sheetId: sheet.id, state: 'eligible', contestedWith: [] });
      continue;
    }

    const group = [sheet, ...contested];
    const chosen = group.filter((s) => s.authoritative === true);
    const contestedWith = contested.map((s) => s.id);

    let state: SheetState;
    if (chosen.length === 0) state = 'undecided';
    else if (chosen.length > 1) state = 'ambiguous';
    else state = chosen[0].id === sheet.id ? 'eligible' : 'superseded';

    out.set(sheet.id, { sheetId: sheet.id, state, contestedWith });
  }

  return out;
}
```

- [ ] **Step 6: Run the tests and verify they pass**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/sheets.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Run the full suite, typecheck and lint**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
```

Expected: 460 + 8 = **468 passed**, tsc silent, lint exit 0. `src/db/config.test.ts` and `src/db/schema/*.test.ts` must still pass — if a schema guard test fails, the migration or the schema file is wrong, not the test.

- [ ] **Step 8: Mutation-test**

Run each of these, confirm the named test fails, then revert:
1. In `conflicts`, drop the `|| a.seasonId === null || b.seasonId === null` clause → "an unlabelled sheet contests a same-named labelled one" must fail.
2. In `conflicts`, drop the `a.name !== b.name` guard → "the same sheet name in two seasons is NOT a collision" must fail.
3. In `sheetEligibility`, change `chosen.length > 1` to `chosen.length > 2` → "two copies both marked authoritative are ambiguous" must fail.

Report each mutation and its outcome. A mutation that does **not** produce a failure is the finding — say so rather than moving on.

- [ ] **Step 9: Commit**

```bash
git add src/db/schema/source.ts drizzle/ src/lib/import/sheets.ts src/lib/import/sheets.test.ts
git commit -F - <<'MSG'
feat(import): a sheet carries a season and an authority, both set by hand

A block does not know its season, and inferring one from a filename or a
sheet name is the guess this wave refuses. The season is a label on the
sheet, set by a lead.

The same label then decides what counts as a duplicate. Two sheets
conflict when they share a name and either share a season or either is
unlabelled — so the two תקציב קאמפ ברן 26 copies are one season written
twice and need a choice, while the two סיכום כללי copies are different
years and both promote. Keying on the name alone would have deleted a
year of the camp's history.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 2: The refusal vocabulary and the row reader

**Files:**
- Create: `src/lib/import/promote/types.ts`
- Create: `src/lib/import/promote/rows.ts`
- Test: `src/lib/import/promote/rows.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type RefusalReason =
    | 'carry-forward' | 'total-row' | 'blank-row' | 'no-amount'
    | 'both-directions' | 'no-date' | 'no-description' | 'no-label'
    | 'no-season' | 'unconfirmed' | 'unmapped-column' | 'no-promoter'
    | 'sheet-undecided' | 'sheet-ambiguous' | 'sheet-superseded';

  export interface Refusal { sheetRow: number; reason: RefusalReason; message: string; cells: string[] }
  export interface PromotedRow {
    table: 'ledger_entries' | 'budget_lines' | 'ticket_rounds' | 'obligations';
    sheetRow: number; id: string | null; summary: string; notes: string[];
  }
  export interface PromotionResult {
    blockId: string; archetype: BlockArchetype; dryRun: boolean;
    written: PromotedRow[]; refused: Refusal[]; deleted: number;
  }
  export interface PromoteContext { seasonId: string | null; recordedBy: string; blockId: string }
  export interface BlockRow { sheetRow: number; cells: Record<string, string>; raw: string[] }

  export function blockRows(block: BlockShape, columnMap: ColumnMapping[]): BlockRow[];
  export function isTotalRow(raw: string[]): boolean;
  export function isCarryForward(raw: string[]): boolean;
  export function isBlankRow(raw: string[]): boolean;
  // Note: `refuse` lives in rows.ts alongside the classifiers, not in types.ts.
  // types.ts stays types-only, which is what lets every other module import it.
  export function refuse(row: BlockRow, reason: RefusalReason, message: string): Refusal;
  ```
  where `BlockShape` is `{ top: number; left: number; headerRow: number | null; rawGrid: string[][] }`.

**Why `sheetRow` is absolute.** `source_row` must survive re-detection of block bounds and must render as a real cell reference. `sheetRow = block.top + gridIndex`. The column index into a `rawGrid` row is `mapping.column - block.left`, because `ColumnMapping.column` is a 1-indexed **sheet** column.

- [ ] **Step 1: Write `src/lib/import/promote/types.ts`**

```ts
import type { BlockArchetype } from '@/lib/classify/types';

/** Every reason the promoter can decline to write a row. */
export type RefusalReason =
  | 'carry-forward'
  | 'total-row'
  | 'blank-row'
  | 'no-amount'
  | 'both-directions'
  | 'no-date'
  | 'no-description'
  | 'no-label'
  | 'no-season'
  /** The block has not been approved by a lead yet. Distinct from
   *  `unmapped-column`: the mapping may be perfect and merely unapproved. */
  | 'unconfirmed'
  | 'unmapped-column'
  | 'no-promoter'
  | 'sheet-undecided'
  | 'sheet-ambiguous'
  | 'sheet-superseded';

export interface Refusal {
  /** Absolute 1-indexed sheet row, or the block's own top row for a
   *  whole-block refusal. */
  sheetRow: number;
  reason: RefusalReason;
  /** Hebrew, shown to a lead in the register. */
  message: string;
  /** The row exactly as it appeared, so the register can show the evidence. */
  cells: string[];
}

export interface PromotedRow {
  table: 'ledger_entries' | 'budget_lines' | 'ticket_rounds' | 'obligations';
  sheetRow: number;
  /** Null on a dry run — nothing was written, so there is no id to give. */
  id: string | null;
  /** Hebrew one-liner for the register. */
  summary: string;
  /** Things true of this row that are not refusals: an unresolved party
   *  name kept as raw text, an arithmetic mismatch flagged and kept. */
  notes: string[];
}

export interface PromotionResult {
  blockId: string;
  archetype: BlockArchetype;
  dryRun: boolean;
  written: PromotedRow[];
  refused: Refusal[];
  /** Rows removed because this block no longer produces them (W5). */
  deleted: number;
}

export interface PromoteContext {
  /** Null is legal for ledger and obligations; budget and tickets refuse. */
  seasonId: string | null;
  recordedBy: string;
  blockId: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/import/promote/rows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { blockRows, isTotalRow, isCarryForward, isBlankRow } from './rows';

const BLOCK = {
  top: 5,
  left: 2,
  headerRow: 5,
  rawGrid: [
    ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
    ['20/05/2025', 'מקדמה מייצג', '4000', ''],
    ['', '', '', ''],
    ['סה"כ', '', '4000', ''],
  ],
};

const MAP = [
  { column: 2, field: 'date', confidence: 1 },
  { column: 3, field: 'description', confidence: 1 },
  { column: 4, field: 'outflow', confidence: 1 },
  { column: 5, field: 'inflow', confidence: 1 },
];

describe('blockRows', () => {
  it('numbers rows by absolute sheet row, not by index in the block', () => {
    const rows = blockRows(BLOCK, MAP);
    expect(rows[0].sheetRow).toBe(6);
    expect(rows.at(-1)?.sheetRow).toBe(8);
  });

  it('skips the header row', () => {
    const rows = blockRows(BLOCK, MAP);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sheetRow > 5)).toBe(true);
  });

  it('maps cells by sheet column, offset by the block left edge', () => {
    const [first] = blockRows(BLOCK, MAP);
    expect(first.cells.date).toBe('20/05/2025');
    expect(first.cells.description).toBe('מקדמה מייצג');
    expect(first.cells.outflow).toBe('4000');
    expect(first.cells.inflow).toBe('');
  });

  it('keeps the raw row alongside the mapped cells', () => {
    const [first] = blockRows(BLOCK, MAP);
    expect(first.raw).toEqual(['20/05/2025', 'מקדמה מייצג', '4000', '']);
  });

  it('treats every row as data when there is no header row', () => {
    const rows = blockRows({ ...BLOCK, headerRow: null }, MAP);
    expect(rows).toHaveLength(4);
    expect(rows[0].sheetRow).toBe(5);
  });
});

describe('row classifiers', () => {
  it('detects a סה"כ row regardless of quote style', () => {
    expect(isTotalRow(['סה"כ', '', '4000'])).toBe(true);
    expect(isTotalRow(['סה״כ', '', '4000'])).toBe(true);
    expect(isTotalRow(['מקדמה מייצג', '', '4000'])).toBe(false);
  });

  it('detects the carry-forward line', () => {
    expect(isCarryForward(['מעבר לקובץ חדש', '', '44647'])).toBe(true);
    expect(isCarryForward(['מסיבת פקאנים', '', '57000'])).toBe(false);
  });

  it('treats a row of only invisible marks as blank', () => {
    expect(isBlankRow(['', '  ', '‏'])).toBe(true);
    expect(isBlankRow(['', '', '0'])).toBe(false);
  });
});
```

- [ ] **Step 3: Run and verify it fails**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/rows.test.ts
```

Expected: FAIL — cannot resolve `./rows`. Confirm 8 failures, not 0.

- [ ] **Step 4: Implement `src/lib/import/promote/rows.ts`**

```ts
import type { ColumnMapping } from '@/lib/classify/map-columns';
import { normalizeHebrew, isBlank } from '@/lib/text/normalize';
import type { Refusal, RefusalReason } from './types';

export interface BlockShape {
  top: number;
  left: number;
  headerRow: number | null;
  rawGrid: string[][];
}

export interface BlockRow {
  /** Absolute 1-indexed sheet row. */
  sheetRow: number;
  /** Canonical field name -> cell text, per the block's column map. */
  cells: Record<string, string>;
  /** The row exactly as stored, for the register's evidence column. */
  raw: string[];
}

/**
 * Walks a block's stored grid into mapped rows.
 *
 * `ColumnMapping.column` is a 1-indexed *sheet* column, so the index into a
 * `rawGrid` row is `column - block.left`. `sheetRow` is absolute for the same
 * reason `source_row` is: a trace has to name a real cell, and it has to keep
 * naming the right one if the block's bounds are re-detected.
 */
export function blockRows(block: BlockShape, columnMap: ColumnMapping[]): BlockRow[] {
  const out: BlockRow[] = [];
  for (let i = 0; i < block.rawGrid.length; i += 1) {
    const sheetRow = block.top + i;
    if (block.headerRow !== null && sheetRow <= block.headerRow) continue;

    const raw = block.rawGrid[i] ?? [];
    const cells: Record<string, string> = {};
    for (const mapping of columnMap) {
      cells[mapping.field] = raw[mapping.column - block.left] ?? '';
    }
    out.push({ sheetRow, cells, raw });
  }
  return out;
}

/** A `סה״כ` row is a computed total, not a movement (W8). */
export function isTotalRow(raw: string[]): boolean {
  return raw.some((cell) => normalizeHebrew(cell).includes('סה"כ'));
}

/**
 * `מעבר לקובץ חדש 44,647` closes the previous book and opens this one.
 * Importing it as income counts the previous book's money a second time.
 */
export function isCarryForward(raw: string[]): boolean {
  return raw.some((cell) => normalizeHebrew(cell).includes('מעבר לקובץ חדש'));
}

export function isBlankRow(raw: string[]): boolean {
  return raw.every((cell) => isBlank(cell));
}

export function refuse(
  row: { sheetRow: number; raw: string[] }, reason: RefusalReason, message: string,
): Refusal {
  return { sheetRow: row.sheetRow, reason, message, cells: row.raw };
}
```

- [ ] **Step 5: Run and verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/rows.test.ts
```

Expected: PASS, 8 tests. If `isTotalRow` fails on `סה״כ` with the Hebrew gershayim, read `normalizeHebrew` in `src/lib/text/normalize.ts` and match what it actually produces — do not change `normalizeHebrew`.

- [ ] **Step 6: Mutation-test**

1. Change `sheetRow = block.top + i` to `= i + 1` → "numbers rows by absolute sheet row" must fail.
2. Change `raw[mapping.column - block.left]` to `raw[mapping.column]` → "maps cells by sheet column" must fail.
3. Change `sheetRow <= block.headerRow` to `sheetRow < block.headerRow` → "skips the header row" must fail.

- [ ] **Step 7: Full suite, typecheck, lint, then commit**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
git add src/lib/import/promote/
git commit -F - <<'MSG'
feat(promote): the refusal vocabulary, and a reader that names real cells

source_row is the absolute sheet row rather than the index within the
block, so a trace names a cell a lead can open and keeps naming the right
one if block bounds are ever re-detected. Column mappings are 1-indexed
sheet columns, so the grid index is column - block.left.

The three shared refusals live here because all four archetypes need
them: a סה״כ row is a computed total, מעבר לקובץ חדש is last year's book
and not this year's income, and a row of invisible directional marks is
blank.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 3: The ledger promoter

**Files:**
- Create: `src/lib/import/promote/ledger.ts`
- Test: `src/lib/import/promote/ledger.test.ts`

**Interfaces:**
- Consumes: `BlockRow`, `Refusal`, `PromoteContext`, `refuse`, `isTotalRow`, `isCarryForward`, `isBlankRow` from Task 2.
- Produces:
  ```ts
  export type LedgerOutcome =
    | { ok: true; input: NewEntry; notes: string[] }
    | { ok: false; refusal: Refusal };
  export function ledgerRow(row: BlockRow, ctx: PromoteContext): LedgerOutcome;
  ```

**Rules.** Blank, total and carry-forward rows refuse first. `outflow` maps to `direction: 'out'`, `inflow` to `'in'`. Both non-zero is `both-directions` — the workbook never means both, and choosing one would be a guess. Neither is `no-amount`. An unparseable date is `no-date`. A blank description is `no-description` (the column is `NOT NULL`, and inventing text is invention). `seasonId` may be null; `accountId`, `eventId` and `budgetLineId` are always absent (W9).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/import/promote/ledger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { ledgerRow } from './ledger';

const CTX: PromoteContext = {
  seasonId: 'season-26', recordedBy: 'lead@shliff.test', blockId: 'block-1',
};

function row(cells: Record<string, string>, sheetRow = 7): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('ledgerRow', () => {
  it('reads an outflow as direction out with a positive amount', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: 'מקדמה מייצג', outflow: '4,000', inflow: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.direction).toBe('out');
    expect(out.input.amount).toBe(4000);
    expect(out.input.description).toBe('מקדמה מייצג');
    expect(out.input.occurredOn).toEqual(new Date(Date.UTC(2025, 4, 20)));
    expect(out.input.seasonId).toBe('season-26');
    expect(out.input.sourceBlockId).toBe('block-1');
    expect(out.input.sourceRow).toBe(7);
  });

  it('reads an inflow as direction in', () => {
    const out = ledgerRow(row({
      date: '2025-10-30', description: 'מסיבת פקאנים', outflow: '', inflow: '57000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.direction).toBe('in');
    expect(out.input.amount).toBe(57000);
  });

  it('never attributes an account, an event or a budget line', () => {
    const out = ledgerRow(row({
      date: '2025-10-30', description: 'מסיבת פקאנים', outflow: '', inflow: '57000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.accountId).toBeUndefined();
    expect(out.input.eventId).toBeUndefined();
    expect(out.input.budgetLineId).toBeUndefined();
  });

  it('promotes with a null season when the sheet has none', () => {
    const out = ledgerRow(row({
      date: '2025-10-30', description: 'מסיבת פקאנים', outflow: '', inflow: '57000',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.seasonId).toBeUndefined();
  });

  it('refuses the carry-forward line', () => {
    const out = ledgerRow(row({
      date: '', description: 'מעבר לקובץ חדש', outflow: '', inflow: '44647',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('carry-forward');
  });

  it('refuses a סה"כ row', () => {
    const out = ledgerRow(row({
      date: '', description: 'סה"כ', outflow: '45271', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row carrying both an outflow and an inflow', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: 'לא ברור', outflow: '100', inflow: '200',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('both-directions');
  });

  it('refuses a row with no amount in either column', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: 'כותרת ביניים', outflow: '', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses an unparseable date rather than inventing one', () => {
    const out = ledgerRow(row({
      date: 'מאי', description: 'מקדמה מייצג', outflow: '4000', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-date');
  });

  it('refuses a description of only invisible marks', () => {
    const out = ledgerRow(row({
      date: '20/05/2025', description: '‏', outflow: '4000', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-description');
  });

  it('keeps the cells of a refused row as evidence', () => {
    const out = ledgerRow(row({
      date: '', description: 'סה"כ', outflow: '45271', inflow: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.cells).toContain('סה"כ');
    expect(out.refusal.sheetRow).toBe(7);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/ledger.test.ts
```

Expected: FAIL, 11 failures, cannot resolve `./ledger`.

- [ ] **Step 3: Implement `src/lib/import/promote/ledger.ts`**

```ts
import type { NewEntry } from '@/lib/money/ledger';
import { parseNumber } from '@/lib/coerce/number';
import { parseDate } from '@/lib/coerce/date';
import { isBlank } from '@/lib/text/normalize';
import type { BlockRow } from './rows';
import { isTotalRow, isCarryForward, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type LedgerOutcome =
  | { ok: true; input: NewEntry; notes: string[] }
  | { ok: false; refusal: Refusal };

/**
 * One workbook ledger row, as a movement or as a stated refusal.
 *
 * Pure: it never touches the database, so every refusal reason is testable
 * from a cell array alone. The write side lives in `promote.ts`.
 */
export function ledgerRow(row: BlockRow, ctx: PromoteContext): LedgerOutcome {
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isCarryForward(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'carry-forward',
        'מעבר לקובץ חדש הוא סגירת הספר הקודם, לא הכנסה של העונה הזו'),
    };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא תנועה'),
    };
  }

  const outflow = parseNumber(row.cells.outflow ?? '');
  const inflow = parseNumber(row.cells.inflow ?? '');
  const hasOut = outflow !== null && outflow !== 0;
  const hasIn = inflow !== null && inflow !== 0;

  if (hasOut && hasIn) {
    return {
      ok: false,
      refusal: refuse(row, 'both-directions',
        'בשורה יש גם הוצאה וגם הכנסה — לא ניתן להכריע לאיזה כיוון הכסף זז'),
    };
  }
  if (!hasOut && !hasIn) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין סכום בשורה') };
  }

  const parsed = parseDate(row.cells.date ?? '');
  if (!parsed.ok || parsed.date === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-date', `תאריך לא קריא: ${parsed.raw || '(ריק)'}`),
    };
  }

  const description = (row.cells.description ?? '').trim();
  if (isBlank(description)) {
    return { ok: false, refusal: refuse(row, 'no-description', 'אין תיאור לתנועה') };
  }

  // accountId, eventId and budgetLineId stay unset on purpose (W9): the
  // workbooks name no account for any movement, so attributing one would be
  // invention. Wave 1's unattributed figure already reports this honestly.
  const input: NewEntry = {
    occurredOn: parsed.date,
    direction: hasOut ? 'out' : 'in',
    amount: hasOut ? Math.abs(outflow as number) : Math.abs(inflow as number),
    description,
    recordedBy: ctx.recordedBy,
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(ctx.seasonId ? { seasonId: ctx.seasonId } : {}),
  };

  return { ok: true, input, notes: [] };
}
```

- [ ] **Step 4: Run and verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/ledger.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation-test**

1. Remove the `isCarryForward` branch → "refuses the carry-forward line" must fail.
2. Change `hasOut && hasIn` to `hasOut || hasIn` → "reads an outflow as direction out" must fail.
3. Change `direction: hasOut ? 'out' : 'in'` to always `'in'` → "reads an outflow as direction out" must fail.
4. Replace `isBlank(description)` with `!description` → "refuses a description of only invisible marks" must fail. **This is the `isBlank` rule the project has been burned by three times; if this mutation survives, the test is wrong.**

- [ ] **Step 6: Full suite, typecheck, lint, then commit**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
git add src/lib/import/promote/ledger.ts src/lib/import/promote/ledger.test.ts
git commit -F - <<'MSG'
feat(promote): a workbook ledger row, as a movement or a stated refusal

Direction comes from which of the two columns holds the amount, which is
how the sheets themselves record it and removes a class of sign error.
A row holding both refuses rather than picking one.

Nothing is attributed. The workbooks name no account for any movement, so
accountId, eventId and budgetLineId stay unset and Wave 1's direction-split
unattributed figure reports that honestly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 4: The budget promoter

**Files:**
- Create: `src/lib/import/promote/budget.ts`
- Test: `src/lib/import/promote/budget.test.ts`

**Interfaces:**
- Consumes: Task 2's exports; `parseQuantity` from `@/lib/coerce/quantity`.
- Produces:
  ```ts
  export type BudgetOutcome =
    | { ok: true; input: NewBudgetLine; notes: string[] }
    | { ok: false; refusal: Refusal };
  export function budgetRow(row: BlockRow, ctx: PromoteContext): BudgetOutcome;
  ```

**Rules.** `budget_lines.season_id` is `NOT NULL`, so a null `ctx.seasonId` refuses with `no-season` (W11) — refuse **before** parsing, so the register reports one clear reason per block rather than one per row. The quantity is stored as **text** exactly as written (`12,000kw`, `תפריט שלם לשבוע`), with `quantityNum` set only when `parseQuantity` yields a number. A blank label refuses with `no-label`. Arithmetic mismatches are **flagged, never blocked**: `listBudgetLines` already computes `arithmeticOff`, so the promoter only adds a note. `category` is `'camp'` — a dancefloor block is a misclassification resolved at confirm time, not here.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/import/promote/budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { budgetRow } from './budget';

const CTX: PromoteContext = {
  seasonId: 'season-26', recordedBy: 'lead@shliff.test', blockId: 'block-2',
};

function row(cells: Record<string, string>, sheetRow = 4): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('budgetRow', () => {
  it('keeps a quantity with a unit exactly as written and derives no number from prose', () => {
    const out = budgetRow(row({
      item: 'חשמל לקאמפ', quantity: '12,000kw', unit_cost: '7500', total: '7500', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantityText).toBe('12,000kw');
    expect(out.input.quantityNum).toBe(12000);
    expect(out.input.total).toBe(7500);
    expect(out.input.category).toBe('camp');
  });

  it('keeps a prose quantity as text with no number at all', () => {
    const out = budgetRow(row({
      item: 'אוכל', quantity: 'תפריט שלם לשבוע', unit_cost: '', total: '5000', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantityText).toBe('תפריט שלם לשבוע');
    expect(out.input.quantityNum).toBeUndefined();
  });

  it('carries the why column into rationale', () => {
    const out = budgetRow(row({
      item: 'הפתעות', quantity: '', unit_cost: '', total: '5852.3',
      note: 'תוספת של 1,000 שקלים - לחיזוק',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.rationale).toBe('תוספת של 1,000 שקלים - לחיזוק');
  });

  it('notes an arithmetic mismatch without refusing the row', () => {
    const out = budgetRow(row({
      item: 'שירותים נסורת', quantity: '5', unit_cost: '125', total: '1625', note: '',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.total).toBe(1625);
    expect(out.notes.join(' ')).toMatch(/חשבון/);
  });

  it('refuses every row when the sheet has no season', () => {
    const out = budgetRow(row({
      item: 'חשמל לקאמפ', quantity: '', unit_cost: '', total: '7500', note: '',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-season');
  });

  it('refuses a סה"כ row', () => {
    const out = budgetRow(row({
      item: 'סה"כ', quantity: '', unit_cost: '', total: '64375.3', note: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row with no total', () => {
    const out = budgetRow(row({
      item: 'חשמל לקאמפ', quantity: '', unit_cost: '', total: '', note: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses a label of only invisible marks', () => {
    const out = budgetRow(row({
      item: '‏', quantity: '', unit_cost: '', total: '7500', note: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-label');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/budget.test.ts
```

Expected: FAIL, 8 failures.

- [ ] **Step 3: Implement `src/lib/import/promote/budget.ts`**

```ts
import type { NewBudgetLine } from '@/lib/money/budget';
import { parseNumber } from '@/lib/coerce/number';
import { parseQuantity } from '@/lib/coerce/quantity';
import { isBlank } from '@/lib/text/normalize';
import { toAgorot } from '@/lib/money';
import type { BlockRow } from './rows';
import { isTotalRow, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type BudgetOutcome =
  | { ok: true; input: NewBudgetLine; notes: string[] }
  | { ok: false; refusal: Refusal };

export function budgetRow(row: BlockRow, ctx: PromoteContext): BudgetOutcome {
  // budget_lines.season_id is NOT NULL. A budget belonging to no season is
  // not a fact the system can hold, and inventing one would be the guess
  // this wave refuses. Checked first so the register shows one reason.
  if (ctx.seasonId === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-season', 'לגיליון לא נקבעה עונה, ותקציב חייב עונה'),
    };
  }
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא סעיף'),
    };
  }

  const total = parseNumber(row.cells.total ?? '');
  if (total === null) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין עלות כוללת בשורה') };
  }

  const label = (row.cells.item ?? '').trim();
  if (isBlank(label)) {
    return { ok: false, refusal: refuse(row, 'no-label', 'אין שם לסעיף') };
  }

  // Quantity is stored as the text the workbook holds. Only a genuinely
  // numeric quantity also yields a number — "תפריט שלם לשבוע" yields none.
  const quantity = parseQuantity(row.cells.quantity ?? '');
  const unitCost = parseNumber(row.cells.unit_cost ?? '');
  const rationale = (row.cells.note ?? '').trim();

  const notes: string[] = [];
  if (quantity.value !== null && unitCost !== null) {
    // Convert to agorot BEFORE multiplying: `quantity.value * unitCost` is
    // float arithmetic on money, which the Global Constraints forbid. The
    // count may legitimately be fractional, so the product is rounded.
    const expected = Math.round(toAgorot(unitCost) * quantity.value);
    if (expected !== toAgorot(total)) {
      // Flagged, never blocked (W20 / req 11). The workbooks contain three
      // of these and they are the camp's own arithmetic, not ours to fix.
      notes.push('החשבון בשורה לא מסתדר: כמות × מחיר ליחידה שונה מהעלות הכוללת');
    }
  }

  const input: NewBudgetLine = {
    seasonId: ctx.seasonId,
    label,
    total,
    category: 'camp',
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(quantity.text ? { quantityText: quantity.text } : {}),
    ...(quantity.value !== null ? { quantityNum: quantity.value } : {}),
    ...(unitCost !== null ? { unitCost } : {}),
    ...(rationale ? { rationale } : {}),
  };

  return { ok: true, input, notes };
}
```

- [ ] **Step 4: Run and verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/budget.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-test**

1. Set `quantityNum: quantity.value ?? 0` unconditionally → "keeps a prose quantity as text with no number at all" must fail.
2. Turn the arithmetic note into a refusal → "notes an arithmetic mismatch without refusing the row" must fail.
3. Remove the `ctx.seasonId === null` guard → "refuses every row when the sheet has no season" must fail.
4. Replace the agorot computation with the float form `toAgorot(quantity.value * unitCost)` → check whether any test fails. If none does, **add** a fixture that only float arithmetic gets wrong (a unit cost of `0.1` with a quantity of `3` against a total of `0.3`) and report that the existing tests could not see it. This is the Global Constraints' "never do float arithmetic on money" rule; a surviving mutation here means the rule is unguarded.

- [ ] **Step 6: Full suite, typecheck, lint, then commit**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
git add src/lib/import/promote/budget.ts src/lib/import/promote/budget.test.ts
git commit -F - <<'MSG'
feat(promote): budget lines, with the quantity kept as the workbook wrote it

Quantity is text first and a number only when it really is one. 12,000kw
keeps its unit, תפריט שלם לשבוע keeps its prose and yields no number, and
neither is rounded into something the sheet does not say.

Arithmetic that does not add up is noted and kept, never refused — three
such rows exist in the camp's own workbooks and they are the camp's
arithmetic to correct, not ours to silently fix.

A budget with no season refuses rather than promoting: budget_lines.season_id
is NOT NULL, and a budget belonging to no season is not a fact this system
can hold.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 5: The ticket-round promoter

**Files:**
- Create: `src/lib/import/promote/tickets.ts`
- Test: `src/lib/import/promote/tickets.test.ts`

**Interfaces:**
- Consumes: Task 2's exports.
- Produces:
  ```ts
  export type TicketOutcome =
    | { ok: true; input: NewTicketRound; notes: string[] }
    | { ok: false; refusal: Refusal };
  export function ticketRow(row: BlockRow, ctx: PromoteContext): TicketOutcome;
  ```

**Rules.** `ticket_rounds.season_id` is `NOT NULL`, so a null season refuses with `no-season`. Fields are `round` → `label`, `quantity` → `quantity` (integer, only when numeric), `price` → `price`, `total` → `total`. `eventId` is never set — linking a round to an event needs a human. `sold` is left at its default `false`; the workbook column does not distinguish planned from sold reliably, and asserting otherwise would be a guess.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/import/promote/tickets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { ticketRow } from './tickets';

const CTX: PromoteContext = {
  seasonId: 'season-26', recordedBy: 'lead@shliff.test', blockId: 'block-3',
};

function row(cells: Record<string, string>, sheetRow = 3): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('ticketRow', () => {
  it('reads a round with quantity, price and total', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '13500',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.label).toBe('ארלי בירד');
    expect(out.input.quantity).toBe(150);
    expect(out.input.price).toBe(90);
    expect(out.input.total).toBe(13500);
    expect(out.input.seasonId).toBe('season-26');
    expect(out.input.sourceRow).toBe(3);
  });

  it('never links a round to an event', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '13500',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.eventId).toBeUndefined();
  });

  it('keeps a round whose quantity is not a number', () => {
    const out = ticketRow(row({
      round: 'כרטיסי חבר', quantity: 'לא ידוע', price: '', total: '4000',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.quantity).toBeUndefined();
    expect(out.input.total).toBe(4000);
  });

  it('refuses when the sheet has no season', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '13500',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-season');
  });

  it('refuses a סה"כ row', () => {
    const out = ticketRow(row({
      round: 'סה"כ', quantity: '', price: '', total: '171000',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row with no total', () => {
    const out = ticketRow(row({
      round: 'ארלי בירד', quantity: '150', price: '90', total: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses a label of only invisible marks', () => {
    const out = ticketRow(row({
      round: '‏', quantity: '', price: '', total: '4000',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-label');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/tickets.test.ts
```

Expected: FAIL, 7 failures.

- [ ] **Step 3: Implement `src/lib/import/promote/tickets.ts`**

```ts
import type { NewTicketRound } from '@/lib/money/funding';
import { parseNumber } from '@/lib/coerce/number';
import { isBlank } from '@/lib/text/normalize';
import type { BlockRow } from './rows';
import { isTotalRow, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type TicketOutcome =
  | { ok: true; input: NewTicketRound; notes: string[] }
  | { ok: false; refusal: Refusal };

export function ticketRow(row: BlockRow, ctx: PromoteContext): TicketOutcome {
  if (ctx.seasonId === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-season', 'לגיליון לא נקבעה עונה, וסבב כרטיסים חייב עונה'),
    };
  }
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא סבב'),
    };
  }

  const total = parseNumber(row.cells.total ?? '');
  if (total === null) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין סה״כ לסבב') };
  }

  const label = (row.cells.round ?? '').trim();
  if (isBlank(label)) {
    return { ok: false, refusal: refuse(row, 'no-label', 'אין שם לסבב') };
  }

  const quantity = parseNumber(row.cells.quantity ?? '');
  const price = parseNumber(row.cells.price ?? '');

  // eventId stays unset: linking a round to one of the camp's events is a
  // judgement a lead makes, not something a label can be matched on.
  // `sold` keeps its default false — the column does not reliably
  // distinguish planned from sold, and claiming otherwise would be a guess.
  const input: NewTicketRound = {
    seasonId: ctx.seasonId,
    label,
    total,
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(quantity !== null ? { quantity: Math.round(quantity) } : {}),
    ...(price !== null ? { price } : {}),
  };

  return { ok: true, input, notes: [] };
}
```

- [ ] **Step 4: Run and verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/tickets.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation-test**

1. Set `quantity: quantity ?? 0` unconditionally → "keeps a round whose quantity is not a number" must fail.
2. Remove the `no-season` guard → "refuses when the sheet has no season" must fail.
3. Set `sold: true` → check whether any test fails. If none does, **add** an assertion that `sold` is left unset, and report that the suite could not see it.

- [ ] **Step 6: Full suite, typecheck, lint, then commit**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
git add src/lib/import/promote/tickets.ts src/lib/import/promote/tickets.test.ts
git commit -F - <<'MSG'
feat(promote): ticket rounds, with nothing claimed about what sold

A round keeps its label, its total, and a quantity or price only when the
cell really holds one. sold stays at its default because the workbook
column does not reliably separate planned from sold, and eventId stays
unset because linking a round to one of the camp's events is a lead's
judgement, not a label match.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 6: The obligation promoter

**Files:**
- Create: `src/lib/import/promote/obligations.ts`
- Test: `src/lib/import/promote/obligations.test.ts`

**Interfaces:**
- Consumes: Task 2's exports.
- Produces:
  ```ts
  export type ObligationOutcome =
    | { ok: true; input: NewObligation; partyRaw: string | null; notes: string[] }
    | { ok: false; refusal: Refusal };
  export function obligationRow(row: BlockRow, ctx: PromoteContext): ObligationOutcome;
  ```

**Why `partyRaw` is separate.** `resolveName` needs a database, and this module stays pure so every refusal is testable from a cell array. The promoter hands the raw name up; `promote.ts` (Task 7) resolves it, sets `partyPersonId` on exactly one exact match, and otherwise leaves `partyName` as written and calls `recordUnlinkedName`.

**Rules.** `obligations.season_id` is nullable, so a null season is fine. Direction defaults to `camp_owes` — every obligation block in these workbooks is money the camp owes (`חוב יוסף`, the reimbursement lines); a block that is the other way round is a misclassification handled at confirm time. **A blank party is not a refusal.** W8 is explicit: a reimbursement with an empty name becomes an obligation with no party, flagged, never dropped — this is the link the camp lost once and must never lose again. `openedOn` uses the row's date when present, and the block's sheet has no date of its own, so a row with no date refuses with `no-date`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/import/promote/obligations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BlockRow } from './rows';
import type { PromoteContext } from './types';
import { obligationRow } from './obligations';

const CTX: PromoteContext = {
  seasonId: 'season-25', recordedBy: 'lead@shliff.test', blockId: 'block-4',
};

function row(cells: Record<string, string>, sheetRow = 12): BlockRow {
  return { sheetRow, cells, raw: Object.values(cells) };
}

describe('obligationRow', () => {
  it('reads a debt the camp owes, with its party kept as raw text', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '15240', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.direction).toBe('camp_owes');
    expect(out.input.amount).toBe(15240);
    expect(out.input.description).toBe('חוב יוסף');
    expect(out.partyRaw).toBe('יוסף');
    expect(out.input.partyPersonId).toBeUndefined();
    expect(out.input.seasonId).toBe('season-25');
  });

  it('keeps a nameless reimbursement as an obligation with no party, flagged', () => {
    const out = obligationRow(row({
      party: '', description: 'החזר הוצאות', amount: '480', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.partyRaw).toBeNull();
    expect(out.input.partyName).toBeUndefined();
    expect(out.notes.join(' ')).toMatch(/בלי שם/);
  });

  it('treats a party of only invisible marks as no party at all', () => {
    const out = obligationRow(row({
      party: '‏', description: 'החזר הוצאות', amount: '480', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.partyRaw).toBeNull();
    expect(out.notes.join(' ')).toMatch(/בלי שם/);
  });

  it('promotes with a null season when the sheet has none', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '15240', date: '20/05/2025',
    }), { ...CTX, seasonId: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.seasonId).toBeUndefined();
  });

  it('refuses a סה"כ row', () => {
    const out = obligationRow(row({
      party: '', description: 'סה"כ', amount: '5954', date: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('total-row');
  });

  it('refuses a row with no amount', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-amount');
  });

  it('refuses a row with no readable date', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: 'חוב יוסף', amount: '15240', date: '',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-date');
  });

  it('refuses a row with no description', () => {
    const out = obligationRow(row({
      party: 'יוסף', description: '', amount: '15240', date: '20/05/2025',
    }), CTX);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.reason).toBe('no-description');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/obligations.test.ts
```

Expected: FAIL, 8 failures.

- [ ] **Step 3: Implement `src/lib/import/promote/obligations.ts`**

```ts
import type { NewObligation } from '@/lib/money/obligations';
import { parseNumber } from '@/lib/coerce/number';
import { parseDate } from '@/lib/coerce/date';
import { isBlank } from '@/lib/text/normalize';
import type { BlockRow } from './rows';
import { isTotalRow, isBlankRow, refuse } from './rows';
import type { PromoteContext, Refusal } from './types';

export type ObligationOutcome =
  | { ok: true; input: NewObligation; partyRaw: string | null; notes: string[] }
  | { ok: false; refusal: Refusal };

/**
 * One obligation row.
 *
 * `partyRaw` is handed up rather than resolved here: `resolveName` needs a
 * database, and keeping this function pure is what makes every refusal
 * testable from a cell array. `promote.ts` does the resolving.
 */
export function obligationRow(row: BlockRow, ctx: PromoteContext): ObligationOutcome {
  if (isBlankRow(row.raw)) {
    return { ok: false, refusal: refuse(row, 'blank-row', 'שורה ריקה') };
  }
  if (isTotalRow(row.raw)) {
    return {
      ok: false,
      refusal: refuse(row, 'total-row', 'שורת סה״כ היא סכום מחושב, לא חוב'),
    };
  }

  const amount = parseNumber(row.cells.amount ?? '');
  if (amount === null || amount === 0) {
    return { ok: false, refusal: refuse(row, 'no-amount', 'אין סכום לחוב') };
  }

  const description = (row.cells.description ?? '').trim();
  if (isBlank(description)) {
    return { ok: false, refusal: refuse(row, 'no-description', 'אין תיאור לחוב') };
  }

  const parsed = parseDate(row.cells.date ?? '');
  if (!parsed.ok || parsed.date === null) {
    return {
      ok: false,
      refusal: refuse(row, 'no-date', `אין תאריך פתיחה קריא: ${parsed.raw || '(ריק)'}`),
    };
  }

  // A blank party is NOT a refusal. The camp has two reimbursements whose
  // payee was never recorded; dropping them would lose the debt itself.
  // They become obligations with no party, flagged, and Wave 1 already
  // refuses to let an unnamed obligation be settled.
  const partyCell = (row.cells.party ?? '').trim();
  const partyRaw = isBlank(partyCell) ? null : partyCell;
  const notes: string[] = [];
  if (partyRaw === null) {
    notes.push('החוב נרשם בלי שם — הקאמפ חייב כסף ולא יודע למי');
  }

  const input: NewObligation = {
    direction: 'camp_owes',
    description,
    amount: Math.abs(amount),
    openedOn: parsed.date,
    sourceBlockId: ctx.blockId,
    sourceRow: row.sheetRow,
    ...(ctx.seasonId ? { seasonId: ctx.seasonId } : {}),
  };

  return { ok: true, input, partyRaw, notes };
}
```

- [ ] **Step 4: Run and verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/obligations.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-test**

1. Turn a blank party into a refusal → "keeps a nameless reimbursement as an obligation with no party" must fail. **This is the behaviour the camp lost data to once; if this mutation survives, stop and say so.**
2. Replace `isBlank(partyCell)` with `!partyCell` → "treats a party of only invisible marks as no party at all" must fail.
3. Change `direction: 'camp_owes'` to `'owed_to_camp'` → "reads a debt the camp owes" must fail.

- [ ] **Step 6: Full suite, typecheck, lint, then commit**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
git add src/lib/import/promote/obligations.ts src/lib/import/promote/obligations.test.ts
git commit -F - <<'MSG'
feat(promote): obligations, and a nameless debt that is kept rather than dropped

A reimbursement with no payee recorded becomes an obligation with no
party, flagged. The camp has two of these and they are the reason this
rule exists: dropping the row would lose the debt along with the name.
Wave 1 already refuses to let an unnamed obligation be settled, so the
row is visible and safe.

The party name is handed up rather than resolved here. resolveName needs
a database and this module stays pure, which is what makes every refusal
testable from a cell array alone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 7: `promoteBlock` — dispatch, write, and delete what the block no longer produces

**Files:**
- Create: `src/lib/import/promote/promote.ts`
- Test: `src/lib/import/promote/promote.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6, plus `resolveName` / `recordUnlinkedName` from `@/lib/members/identity`, and `sheetEligibility` from Task 1.
- Produces:
  ```ts
  export async function promoteBlock(
    db: AnyDb, blockId: string, opts: { dryRun: boolean; recordedBy: string },
  ): Promise<PromotionResult>;
  ```

**Behaviour.**
1. Load the block, its mapping, and its sheet (for `seasonId`).
2. Refuse the **whole block** when: the archetype has no promoter (`no-promoter`), the sheet is `undecided` / `ambiguous` / `superseded`, or the block is unconfirmed. A whole-block refusal is one `Refusal` at `sheetRow = block.top`.
3. Otherwise run every row through the archetype's promoter.
4. For obligations, resolve `partyRaw`: exactly one exact match sets `partyPersonId`; anything else sets `partyName` to the raw string and calls `recordUnlinkedName(db, raw, 'import')`, adding a note.
5. Write each success as an upsert on `(source_block_id, source_row)`.
6. Delete every row of this block's target table carrying this `source_block_id` whose `source_row` is not in the produced set (W5).
7. `dryRun` skips steps 5 and 6 entirely and returns `id: null` on every row.

**`recordEntry` validates; the promoter does not call it.** `recordEntry` throws on a non-positive amount and on a blank description. The promoter writes to the table directly, so those guards do not run — which is exactly why `ledgerRow` refuses `no-amount` and `no-description` itself. Keep the two in step: a row `ledgerRow` accepts must be one `recordEntry` would also have accepted.

**Writing directly, not through `createBudgetLine` et al.** The domain creators insert without conflict handling, so a second run would throw on the unique constraint rather than update. The promoter therefore inserts with `.onConflictDoUpdate({ target: [t.sourceBlockId, t.sourceRow], set: {...} })` against the table directly. Keep the field mapping identical to the domain creator's — read each one before writing this.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/import/promote/promote.test.ts`. Build a real block with a helper, then assert behaviour:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { ledgerEntries, budgetLines, obligations } from '@/db/schema/money';
import { listMovements } from '@/lib/money/ledger';
import { listBudgetLines, budgetTotalAgorot } from '@/lib/money/budget';
import { listObligations } from '@/lib/money/obligations';
import { listUnlinkedNames } from '@/lib/members/identity';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import { promoteBlock } from './promote';

let db: TestDb;
let s26: string;
let sheetId: string;

const LEDGER_MAP: ColumnMapping[] = [
  { column: 1, field: 'date', confidence: 1 },
  { column: 2, field: 'description', confidence: 1 },
  { column: 3, field: 'outflow', confidence: 1 },
  { column: 4, field: 'inflow', confidence: 1 },
];

async function addSheet(filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}/${name}`, storageKey: `k/${name}`,
    sizeBytes: 1, uploadedBy: 'lead@shliff.test', status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name, index: 0, rowCount: 20, colCount: 6,
  }).returning();
  return sheet.id;
}

async function addBlock(
  onSheet: string, archetype: BlockArchetype, grid: string[][],
  columnMap: ColumnMapping[], opts: { confirmed?: boolean; top?: number } = {},
): Promise<string> {
  const top = opts.top ?? 1;
  const [block] = await db.insert(blocks).values({
    sheetId: onSheet, top, left: 1, bottom: top + grid.length - 1, right: 4,
    archetype, confidence: '1.0000', headerRow: top, fingerprint: null,
    pipelineVersion: 1, rawGrid: grid,
    confirmedBy: opts.confirmed === false ? null : 'lead@shliff.test',
    confirmedAt: opts.confirmed === false ? null : new Date(),
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap, source: 'admin',
  });
  return block.id;
}

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
  sheetId = await addSheet('2026.xlsx', 'סיכום כללי');
  await setSheetSeason(db, sheetId, s26);
});

const LEDGER_GRID = [
  ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
  ['20/05/2025', 'מקדמה מייצג', '4000', ''],
  ['30/10/2025', 'מסיבת פקאנים', '', '57000'],
  ['', 'מעבר לקובץ חדש', '', '44647'],
  ['', 'סה"כ', '4000', '101647'],
];

describe('promoteBlock — writing', () => {
  it('writes one row per promotable row and stamps provenance', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(result.written).toHaveLength(2);
    expect(result.refused).toHaveLength(2);

    const rows = await db.select().from(ledgerEntries);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sourceBlockId === blockId)).toBe(true);
    expect(rows.map((r) => r.sourceRow).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 3]);
  });

  it('refuses the carry-forward and the total, each with its own reason', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused.map((r) => r.reason).sort())
      .toEqual(['carry-forward', 'total-row']);
  });

  it('a dry run writes nothing and returns no ids', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: true, recordedBy: 'lead@shliff.test' });

    expect(result.written).toHaveLength(2);
    expect(result.written.every((r) => r.id === null)).toBe(true);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});

describe('promoteBlock — idempotency', () => {
  it('running twice leaves the same rows, not duplicates', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const first = await db.select().from(ledgerEntries);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const second = await db.select().from(ledgerEntries);

    expect(second).toHaveLength(2);
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
  });

  it('updates a row in place when the cell behind it changed', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const changed = LEDGER_GRID.map((r) => [...r]);
    changed[1][2] = '4500';
    await db.update(blocks).set({ rawGrid: changed }).where(eq(blocks.id, blockId));
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const moves = await listMovements(db, { seasonId: s26 });
    const row = moves.find((m) => m.description === 'מקדמה מייצג');
    expect(row?.amountAgorot).toBe(450000);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });

  it('deletes a row the block no longer produces', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);

    // The second data row becomes a total, so the block stops producing it.
    const changed = LEDGER_GRID.map((r) => [...r]);
    changed[2][1] = 'סה"כ';
    await db.update(blocks).set({ rawGrid: changed }).where(eq(blocks.id, blockId));
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(result.deleted).toBe(1);
    const rows = await db.select().from(ledgerEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRow).toBe(2);
  });

  it('a dry run never deletes', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const changed = LEDGER_GRID.map((r) => [...r]);
    changed[2][1] = 'סה"כ';
    await db.update(blocks).set({ rawGrid: changed }).where(eq(blocks.id, blockId));

    await promoteBlock(db, blockId, { dryRun: true, recordedBy: 'lead@shliff.test' });
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });
});

describe('promoteBlock — whole-block refusals', () => {
  it('refuses an unconfirmed block', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { confirmed: false });
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.written).toHaveLength(0);
    expect(result.refused).toHaveLength(1);
  });

  it('refuses an archetype with no promoter in this wave', async () => {
    const blockId = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused[0].reason).toBe('no-promoter');
    expect(result.written).toHaveLength(0);
  });

  it('refuses every block on an undecided colliding sheet', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused[0].reason).toBe('sheet-undecided');
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('promotes once the colliding sheet has been resolved', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.written).toHaveLength(2);
  });

  it('refuses the superseded copy while the authoritative one promotes', async () => {
    const other = await addSheet('25.xlsx', 'סיכום כללי');
    await setSheetSeason(db, other, s26);
    await setSheetAuthority(db, sheetId, true);
    const losing = await addBlock(other, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const result = await promoteBlock(db, losing, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.refused[0].reason).toBe('sheet-superseded');
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it('does not double-count a budget when both copies of a sheet are confirmed', async () => {
    const a = await addSheet('25.xlsx', 'תקציב קאמפ ברן 26');
    const b = await addSheet('2026.xlsx', 'תקציב קאמפ ברן 26');
    await setSheetSeason(db, a, s26);
    await setSheetSeason(db, b, s26);

    const map: ColumnMapping[] = [
      { column: 1, field: 'item', confidence: 1 },
      { column: 2, field: 'quantity', confidence: 1 },
      { column: 3, field: 'unit_cost', confidence: 1 },
      { column: 4, field: 'total', confidence: 1 },
    ];
    const grid = [
      ['סוג הוצאה', 'כמות', 'מחיר', 'עלות כוללת'],
      ['בסיס', '1', '58523', '58523'],
    ];
    const ba = await addBlock(a, 'budget_lines', grid, map);
    const bb = await addBlock(b, 'budget_lines', grid, map);

    await promoteBlock(db, ba, { dryRun: false, recordedBy: 'lead@shliff.test' });
    await promoteBlock(db, bb, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(await db.select().from(budgetLines)).toHaveLength(0);
    expect(await budgetTotalAgorot(db, s26)).toBe(0);
  });
});

describe('promoteBlock — party resolution', () => {
  const OBL_MAP: ColumnMapping[] = [
    { column: 1, field: 'party', confidence: 1 },
    { column: 2, field: 'description', confidence: 1 },
    { column: 3, field: 'amount', confidence: 1 },
    { column: 4, field: 'date', confidence: 1 },
  ];
  const OBL_GRID = [
    ['שם', 'פירוט', 'סכום', 'תאריך'],
    ['יוסף', 'חוב יוסף', '15240', '20/05/2025'],
    ['', 'החזר הוצאות', '480', '20/05/2025'],
  ];

  it('links a party when exactly one person matches exactly', async () => {
    await createPerson(db, 'יוסף', 'lead@shliff.test');
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const rows = await listObligations(db, { seasonId: s26 });
    const joseph = rows.find((r) => r.description === 'חוב יוסף');
    expect(joseph?.partyPersonId).not.toBeNull();
  });

  it('keeps the raw name and queues it when nobody matches', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const rows = await listObligations(db, { seasonId: s26 });
    const joseph = rows.find((r) => r.description === 'חוב יוסף');
    expect(joseph?.partyPersonId).toBeNull();
    expect(joseph?.partyName).toBe('יוסף');
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).toContain('יוסף');
  });

  it('keeps a nameless obligation and marks it unnamed', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: false, recordedBy: 'lead@shliff.test' });

    const rows = await listObligations(db, { seasonId: s26 });
    const nameless = rows.find((r) => r.description === 'החזר הוצאות');
    expect(nameless).toBeDefined();
    expect(nameless?.unnamed).toBe(true);
  });

  it('a dry run queues no unlinked names', async () => {
    const blockId = await addBlock(sheetId, 'obligations', OBL_GRID, OBL_MAP);
    await promoteBlock(db, blockId, { dryRun: true, recordedBy: 'lead@shliff.test' });
    expect(await listUnlinkedNames(db)).toHaveLength(0);
    expect(await db.select().from(obligations)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/promote.test.ts
```

Expected: FAIL, cannot resolve `./promote`. Confirm the failure count is 17 (3 writing + 4 idempotency + 6 whole-block + 4 party), not 0.

- [ ] **Step 3: Read before writing**

Read `src/lib/money/ledger.ts` `recordEntry`, `src/lib/money/budget.ts` `createBudgetLine`, `src/lib/money/funding.ts` `createTicketRound`, and `src/lib/money/obligations.ts` `createObligation` in full. The promoter's insert must map fields **exactly** as those do — particularly how each converts a JS number to the `numeric(12,2)` column via `@/lib/money`. Any divergence is a money bug that no type will catch.

- [ ] **Step 4: Implement `src/lib/import/promote/promote.ts`**

Structure (fill in each archetype's insert using what Step 3 told you):

```ts
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { blocks, blockMappings, sheets } from '@/db/schema/source';
import { ledgerEntries, budgetLines, ticketRounds, obligations } from '@/db/schema/money';
import { resolveName, recordUnlinkedName } from '@/lib/members/identity';
import { sheetEligibility } from '@/lib/import/sheets';
import type { BlockArchetype } from '@/lib/classify/types';
import { blockRows } from './rows';
import { ledgerRow } from './ledger';
import { budgetRow } from './budget';
import { ticketRow } from './tickets';
import { obligationRow } from './obligations';
import type { PromotionResult, PromotedRow, Refusal, PromoteContext } from './types';

const TARGETS = {
  ledger: ledgerEntries,
  budget_lines: budgetLines,
  ticket_rounds: ticketRounds,
  obligations,
} as const;

type PromotableArchetype = keyof typeof TARGETS;

function hasPromoter(a: BlockArchetype): a is PromotableArchetype {
  return a in TARGETS;
}

function wholeBlock(
  block: { top: number }, reason: Refusal['reason'], message: string,
): Refusal {
  return { sheetRow: block.top, reason, message, cells: [] };
}

export async function promoteBlock(
  db: AnyDb, blockId: string, opts: { dryRun: boolean; recordedBy: string },
): Promise<PromotionResult> {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) throw new Error(`unknown block ${blockId}`);

  const base: Omit<PromotionResult, 'written' | 'refused' | 'deleted'> = {
    blockId, archetype: block.archetype, dryRun: opts.dryRun,
  };
  const reject = (r: Refusal): PromotionResult =>
    ({ ...base, written: [], refused: [r], deleted: 0 });

  if (!block.confirmedAt) {
    return reject(wholeBlock(block, 'unconfirmed', 'הבלוק עדיין לא אושר'));
  }
  if (!hasPromoter(block.archetype)) {
    return reject(wholeBlock(block, 'no-promoter',
      'לסוג הבלוק הזה אין עדיין מנגנון קידום — הוא מחכה לגל הבא'));
  }

  const eligibility = (await sheetEligibility(db)).get(block.sheetId);
  if (eligibility && eligibility.state !== 'eligible') {
    const messages = {
      undecided: 'אותו גיליון קיים ביותר מקובץ אחד ולא נבחר עותק מוסמך',
      ambiguous: 'יותר מעותק אחד סומן כמוסמך',
      superseded: 'העותק הזה לא נבחר כמוסמך',
    } as const;
    return reject(wholeBlock(block, `sheet-${eligibility.state}`, messages[eligibility.state]));
  }

  const [sheet] = await db.select().from(sheets).where(eq(sheets.id, block.sheetId));
  const [mapping] = await db.select().from(blockMappings)
    .where(eq(blockMappings.blockId, blockId));
  if (!mapping) {
    return reject(wholeBlock(block, 'unmapped-column', 'לבלוק אין מיפוי עמודות'));
  }

  const ctx: PromoteContext = {
    seasonId: sheet?.seasonId ?? null, recordedBy: opts.recordedBy, blockId,
  };

  const written: PromotedRow[] = [];
  const refused: Refusal[] = [];
  const producedRows: number[] = [];

  for (const row of blockRows(block, mapping.columnMap)) {
    // Dispatch to the archetype's pure promoter, collect the outcome,
    // then write. One branch per archetype; each writes with
    // .onConflictDoUpdate targeting [sourceBlockId, sourceRow].
    // ... implement per archetype, following Step 3's field mapping ...
  }

  // W5: a block owns its rows. Anything this block wrote before and no
  // longer produces is unreachable, so it is removed rather than orphaned.
  let deleted = 0;
  if (!opts.dryRun) {
    const table = TARGETS[block.archetype];
    const stale = producedRows.length === 0
      ? await db.delete(table).where(eq(table.sourceBlockId, blockId)).returning()
      : await db.delete(table).where(and(
        eq(table.sourceBlockId, blockId),
        notInArray(table.sourceRow, producedRows),
      )).returning();
    deleted = stale.length;
  }

  return { ...base, written, refused, deleted };
}
```

Party resolution, inside the obligations branch:

```ts
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
```

- [ ] **Step 5: Run and verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/promote.test.ts
```

Expected: PASS, 17 tests.

- [ ] **Step 6: Mutation-test**

1. Remove the whole delete block → "deletes a row the block no longer produces" must fail.
2. Change `.onConflictDoUpdate` to a plain `.insert` → "running twice leaves the same rows" must fail (with a unique-violation, which still counts as a fail).
3. Gate the delete on `opts.dryRun` the wrong way round → "a dry run never deletes" must fail.
4. Drop the `sheet-*` eligibility check → "does not double-count a budget when both copies of a sheet are confirmed" must fail. **This is the wave's central hazard; if this mutation survives, stop and report it.**
5. Move `recordUnlinkedName` outside the `if (!opts.dryRun)` → "a dry run queues no unlinked names" must fail.

- [ ] **Step 7: Full suite, typecheck, lint, then commit**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
git add src/lib/import/promote/promote.ts src/lib/import/promote/promote.test.ts
git commit -F - <<'MSG'
feat(promote): promoteBlock — a block owns its rows

Idempotency on (source_block_id, source_row) is an upsert, so a second run
updates rather than duplicating. But "updates, never duplicates" says
nothing about a row that stops being produced: fix a column map so a line
now refuses and the row it wrote before becomes unreachable. A block
therefore owns its rows, and promotion deletes any the block no longer
produces.

The dry run and the commit are the same code path, with dryRun gating only
the writes — the register cannot drift from what a commit would do,
because it is what a commit would do.

Sheet eligibility is checked before any row is read. Two confirmed copies
of תקציב קאמפ ברן 26 with no choice made write nothing at all, rather than
writing the camp's budget twice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 8: Bulk promotion and the server actions

**Files:**
- Modify: `src/lib/import/promote/promote.ts` (add `promoteAll`)
- Modify: `src/lib/import/promote/promote.test.ts`
- Create: `src/app/(admin)/data/actions.ts`
- Test: `src/app/(admin)/data/actions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BulkResult {
    results: PromotionResult[];
    writtenCount: number; refusedCount: number; deletedCount: number;
  }
  export async function promoteAll(db: AnyDb, opts: { dryRun: boolean; recordedBy: string }): Promise<BulkResult>;

  // server actions
  export async function setSeasonAction(sheetId: string, seasonId: string | null): Promise<void>;
  export async function setAuthorityAction(sheetId: string, authoritative: boolean | null): Promise<void>;
  export async function promoteAllAction(): Promise<BulkResult>;
  ```

`promoteAll` runs `promoteBlock` over **every confirmed block**, in a stable order (`sheets.name`, then `blocks.top`), and aggregates. Blocks that refuse still appear in `results` — that is what the register renders.

- [ ] **Step 1: Add the failing tests to `promote.test.ts`**

```ts
describe('promoteAll', () => {
  it('promotes every eligible confirmed block and counts what it did', async () => {
    const blockId = await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    const parked = await addBlock(sheetId, 'event_lines', LEDGER_GRID, LEDGER_MAP, { top: 10 });
    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });

    expect(result.writtenCount).toBe(2);
    expect(result.results.map((r) => r.blockId).sort()).toEqual([blockId, parked].sort());
    const parkedResult = result.results.find((r) => r.blockId === parked);
    expect(parkedResult?.refused[0].reason).toBe('no-promoter');
  });

  it('skips unconfirmed blocks entirely rather than reporting them as refusals', async () => {
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP, { confirmed: false });
    const result = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(result.results).toHaveLength(0);
  });

  it('is a no-op on a second run when nothing changed', async () => {
    await addBlock(sheetId, 'ledger', LEDGER_GRID, LEDGER_MAP);
    await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    const second = await promoteAll(db, { dryRun: false, recordedBy: 'lead@shliff.test' });
    expect(second.deletedCount).toBe(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/promote.test.ts
```

Expected: 3 new failures — `promoteAll is not a function`.

- [ ] **Step 3: Implement `promoteAll`**

```ts
export interface BulkResult {
  results: PromotionResult[];
  writtenCount: number;
  refusedCount: number;
  deletedCount: number;
}

/**
 * Promotes every confirmed block, in a stable order so two runs produce
 * comparable output. Refusals are kept in `results`: the register is a list
 * of what could not be settled, so a refused block is the point, not noise.
 */
export async function promoteAll(
  db: AnyDb, opts: { dryRun: boolean; recordedBy: string },
): Promise<BulkResult> {
  const confirmed = await db.select({ id: blocks.id })
    .from(blocks)
    .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
    .where(isNotNull(blocks.confirmedAt))
    .orderBy(sheets.name, blocks.top);

  const results: PromotionResult[] = [];
  for (const { id } of confirmed) {
    results.push(await promoteBlock(db, id, opts));
  }

  return {
    results,
    writtenCount: results.reduce((n, r) => n + r.written.length, 0),
    refusedCount: results.reduce((n, r) => n + r.refused.length, 0),
    deletedCount: results.reduce((n, r) => n + r.deleted, 0),
  };
}
```

Add `isNotNull` to the `drizzle-orm` import.

- [ ] **Step 4: Run and verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/promote.test.ts
```

Expected: PASS, 20 tests.

- [ ] **Step 5: Write the server actions**

Create `src/app/(admin)/data/actions.ts`, following `src/app/(admin)/imports/[id]/actions.ts` exactly:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { setSheetSeason, setSheetAuthority } from '@/lib/import/sheets';
import { promoteAll, type BulkResult } from '@/lib/import/promote/promote';

/**
 * Authorization happens here, server-side, on every call. A hidden or
 * disabled control in the UI is never the enforcement mechanism.
 */
export async function setSeasonAction(sheetId: string, seasonId: string | null): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  await setSheetSeason(db, sheetId, seasonId);
  revalidatePath('/data');
}

export async function setAuthorityAction(
  sheetId: string, authoritative: boolean | null,
): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  await setSheetAuthority(db, sheetId, authoritative);
  revalidatePath('/data');
}

export async function promoteAllAction(): Promise<BulkResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  const result = await promoteAll(db, { dryRun: false, recordedBy: admin.email });
  revalidatePath('/data');
  revalidatePath('/money');
  return result;
}
```

- [ ] **Step 6: Test the authorization gate**

Create `src/app/(admin)/data/actions.test.ts`, modelled on `src/app/(admin)/imports/actions.test.ts` — read that file first and mirror its mocking. Each test must assert that the **domain function is never called** for a non-admin, not merely that the action throws:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setSheetSeason: vi.fn(),
  setSheetAuthority: vi.fn(),
  promoteAll: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/import/sheets', () => ({
  setSheetSeason: mocks.setSheetSeason,
  setSheetAuthority: mocks.setSheetAuthority,
}));
vi.mock('@/lib/import/promote/promote', () => ({ promoteAll: mocks.promoteAll }));

beforeEach(() => vi.clearAllMocks());

describe('data server actions', () => {
  it('refuses a non-admin without touching the database', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false });
    const { setSeasonAction, setAuthorityAction, promoteAllAction } = await import('./actions');

    await expect(setSeasonAction('s', 'x')).rejects.toThrow('unauthorized');
    await expect(setAuthorityAction('s', true)).rejects.toThrow('unauthorized');
    await expect(promoteAllAction()).rejects.toThrow('unauthorized');

    expect(mocks.setSheetSeason).not.toHaveBeenCalled();
    expect(mocks.setSheetAuthority).not.toHaveBeenCalled();
    expect(mocks.promoteAll).not.toHaveBeenCalled();
  });

  it('promotes as the signed-in admin', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
    mocks.promoteAll.mockResolvedValue({ results: [], writtenCount: 0, refusedCount: 0, deletedCount: 0 });
    const { promoteAllAction } = await import('./actions');

    await promoteAllAction();
    expect(mocks.promoteAll).toHaveBeenCalledWith({}, {
      dryRun: false, recordedBy: 'lead@shliff.test',
    });
  });
});
```

- [ ] **Step 7: Run, mutation-test, full suite, commit**

```bash
rtk proxy ./node_modules/.bin/vitest run src/app/\(admin\)/data/actions.test.ts
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
```

Mutations: (1) delete the `if (!admin.ok) throw` from `promoteAllAction` → the non-admin test must fail; (2) hardcode `recordedBy: 'someone'` → "promotes as the signed-in admin" must fail.

```bash
git add src/lib/import/promote/ "src/app/(admin)/data/actions.ts" "src/app/(admin)/data/actions.test.ts"
git commit -F - <<'MSG'
feat(promote): one button for every confirmed block, and the actions behind it

promoteAll walks every confirmed block in a stable order and aggregates.
Refused blocks stay in the results rather than being filtered out — the
register is a list of what could not be settled, so a refusal is the point.

Every action calls requireAdmin first and the tests assert the domain
function is never reached for a non-admin, not merely that the call throws.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 9: The register's queries

**Files:**
- Create: `src/lib/data/worklist.ts`
- Test: `src/lib/data/worklist.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces:
  ```ts
  export type BlockState =
    | 'unconfirmed' | 'promoted' | 'refused' | 'superseded' | 'no-promoter';
  export interface WorklistRow {
    blockId: string; sheetId: string; sheetName: string; filename: string;
    archetype: BlockArchetype; top: number; bottom: number;
    seasonId: string | null; seasonName: string | null;
    state: BlockState; rowCount: number; refusals: Refusal[];
  }
  export interface CoverageCell { seasonName: string; archetype: BlockArchetype; promoted: number; blocks: number }
  // SheetRow and SheetState are imported from '@/lib/import/sheets' (Task 1).
  export interface CollisionGroup { name: string; sheets: SheetRow[]; state: SheetState }

  export async function worklist(db: AnyDb, recordedBy: string): Promise<WorklistRow[]>;
  export function coverage(rows: WorklistRow[]): CoverageCell[];
  export async function collisionGroups(db: AnyDb): Promise<CollisionGroup[]>;
  export async function sheetsNeedingSeason(db: AnyDb): Promise<SheetRow[]>;
  export async function flaggedArithmetic(db: AnyDb): Promise<Array<{ seasonName: string; line: BudgetLineRow }>>;
  ```

`worklist` runs `promoteBlock(db, id, { dryRun: true, recordedBy })` per confirmed block — this is where W8's "computed, never stored" lives. `flaggedArithmetic` reuses `listBudgetLines`'s existing `arithmeticOff` field; do **not** recompute it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/data/worklist.test.ts`. Reuse the `addSheet` / `addBlock` helpers from `promote.test.ts` by copying them into this file (they are fixtures, and duplicating them keeps each test file readable on its own). Cover:

```ts
describe('worklist', () => {
  it('reports an unconfirmed block as unconfirmed with no refusals', async () => { /* ... */ });
  it('reports a promoted block with its row count', async () => { /* ... */ });
  it('reports a parked archetype as no-promoter', async () => { /* ... */ });
  it('reports a losing collision copy as superseded', async () => { /* ... */ });
  it('carries each refusal reason through to the row', async () => { /* ... */ });
  it('never writes anything — the ledger is still empty afterwards', async () => {
    // the load-bearing one: worklist is a dry run
  });
});

describe('coverage', () => {
  it('counts promoted rows per season and archetype', async () => { /* ... */ });
  it('shows a zero cell for a season with a confirmed but unpromoted block', async () => { /* ... */ });
});

describe('collisionGroups', () => {
  it('groups two copies of one sheet name in one season', async () => { /* ... */ });
  it('does not group two copies in different seasons', async () => { /* ... */ });
});

describe('flaggedArithmetic', () => {
  it('lists a budget line whose quantity × unit does not equal its total', async () => { /* ... */ });
  it('does not list a line with no quantity or no unit cost', async () => { /* ... */ });
});
```

Write each body out fully — assert real values, not truthiness. The "never writes anything" test is load-bearing: assert `await db.select().from(ledgerEntries)` has length 0 **after** calling `worklist`.

- [ ] **Step 2: Run, verify it fails, implement, run, verify it passes**

```bash
rtk proxy ./node_modules/.bin/vitest run src/lib/data/worklist.test.ts
```

- [ ] **Step 3: Mutation-test**

1. Change `dryRun: true` to `false` inside `worklist` → "never writes anything" must fail. **This is the one that matters: a register that writes when you look at it is a catastrophe.**
2. Recompute `arithmeticOff` with float arithmetic instead of reading `listBudgetLines` → the flagged-arithmetic test must fail.

- [ ] **Step 4: Full suite, typecheck, lint, commit**

```bash
git add src/lib/data/
git commit -F - <<'MSG'
feat(data): the register's queries, computed rather than stored

The worklist is a dry run of every confirmed block. That is the whole
design: a register that reports the last run rather than the current truth
is stale exactly when a lead consults it, which is right after changing a
column map. Computing it means it cannot disagree with what the commit
would do, because it is what the commit would do.

Arithmetic flags read listBudgetLines' existing arithmeticOff rather than
recomputing, so there is one definition of "this does not add up".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 10: Trace, both directions

**Files:**
- Create: `src/lib/money/trace.ts`
- Test: `src/lib/money/trace.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SourceCell {
    blockId: string; sheetId: string; sheetName: string; filename: string;
    sheetRow: number; reference: string;   // `סיכום כללי!A14`
  }
  export interface TracedRow {
    table: 'ledger_entries' | 'budget_lines' | 'ticket_rounds' | 'obligations';
    id: string; label: string; amountAgorot: number; source: SourceCell | null;
  }
  export async function traceRow(db: AnyDb, table: TracedRow['table'], id: string): Promise<SourceCell | null>;
  export async function traceBlock(db: AnyDb, blockId: string): Promise<TracedRow[]>;
  ```

`reference` uses `colLabel` from `@/lib/xlsx/col-label` with the block's `left` column, giving the first mapped column's letter — read that module before using it. A row with a null `source_block_id` traces to `null`, which is the honest answer for a seeded row and is what the register displays as "נרשם ידנית".

- [ ] **Step 1: Write the failing tests**

Cover: a promoted ledger row traces to its sheet and row; the reference string is exactly `סיכום כללי!A6` for a block at `left: 1`, `top: 5`, row 6; a seeded row with no `source_block_id` traces to `null`; `traceBlock` returns every row the block produced across all four tables; `traceBlock` on a block that produced nothing returns an empty array.

- [ ] **Step 2–4: Fail, implement, pass, mutation-test, commit**

Mutations: (1) drop the `left` offset from the column letter → the exact-reference test must fail; (2) return `sheetRow` as the grid index instead of the stored `source_row` → the trace test must fail.

```bash
git add src/lib/money/trace.ts src/lib/money/trace.test.ts
git commit -F - <<'MSG'
feat(money): trace a figure to its cell, and a block to its figures

A trace names a real cell — סיכום כללי!A6 — because source_row is the
absolute sheet row rather than an index into a block that may be
re-detected.

A row with no source_block_id traces to null rather than to a guess. That
is the honest answer for a row the seed wrote from a lead's adjudication,
and the register shows it as such.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 11: `/data` — the unresolved register

**Files:**
- Modify: `src/app/(admin)/data/page.tsx` (full rewrite)
- Delete: `src/app/(admin)/data/data-explorer.tsx`
- Create: `src/app/(admin)/data/register.tsx` (client component: the controls)
- Modify: `src/app/(admin)/data/data.module.css`
- Create: `src/app/(admin)/data/page.test.tsx`

**Interfaces:**
- Consumes: Tasks 8, 9, 10.

**Sections, in this order** (W17–W23):

1. `החלטות שממתינות לך` — sheets with no season (a `<select>` of seasons per sheet), and each collision group with its copies side by side, the line-by-line diff of what differs, and a "בחר עותק זה" control.
2. `רשימת העבודה` — every block, its state, its row count, its refusals.
3. `כיסוי` — the season × archetype matrix.
4. `מה המערכת סירבה לכתוב` — refusals grouped by reason, each with its sheet, row and evidence cells.
5. `חשבון שלא מסתדר` — flagged budget lines.
6. `מאיפה כל שורה הגיעה` — the trace view.
7. `הבלוק כפי שהוא` — raw preview from `raw_grid`.

Plus the bulk promote button, placed under section 1, because it is only safe to press once section 1 is empty.

- [ ] **Step 1: Delete the disk read first, and prove it**

Before writing any UI, write this test in `page.test.tsx` and make it pass by rewriting `page.tsx`:

```ts
it('never reads a workbook from disk', async () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/(admin)/data/page.tsx'), 'utf8',
  );
  expect(source).not.toMatch(/readFileSync|extractWorkbook|detectBlocks/);
  expect(source).not.toMatch(/reference-data/);
});
```

This closes I8 and M14 together: `docs/reference-data` leaves the runtime module graph, so Next stops tracing the camp's real names and debts into the deployed function.

- [ ] **Step 2: Write the rest of the page tests**

Model the file on `src/app/(admin)/money/page.test.tsx` — read it first for how this project renders a server component in a test. Cover, with real assertions:

- Renders a sheet with no season and offers every season in its select.
- Renders a collision group naming both files, and the diff of the differing line.
- The bulk promote button is present, and is disabled while any decision is open.
- A promoted block shows its row count; a parked one shows `no-promoter` copy naming the wave it waits for.
- A refusal renders its Hebrew reason and its evidence cells.
- The empty state, when there is nothing unresolved, names what is complete and links onward to `/money` — an invitation, not an apology.
- `requireAdmin` failing renders nothing and calls no query (assert the query function is never called, not merely that the UI is hidden).
- No `left` or `right` in the new CSS: `expect(readFileSync('.../data.module.css','utf8')).not.toMatch(/\b(left|right)\s*:/)`.

- [ ] **Step 3: Rewrite `page.tsx`**

Server component. `export const dynamic = 'force-dynamic'` stays — it is this repo's convention on all seven admin pages, and `cacheComponents` is not enabled in `next.config.ts`, so the option is still supported in Next 16.3.4. Call `requireAdmin()` first and `notFound()` on failure, matching `money/page.tsx`. Fetch through `worklist`, `coverage`, `collisionGroups`, `sheetsNeedingSeason`, `flaggedArithmetic`, `traceBlock`, and `listSeasons`.

- [ ] **Step 4: Write `register.tsx`**

`'use client'`. Holds only the interactive controls — the season select, the authority buttons, the promote button and its result summary. It imports the server actions from `./actions`. Use `fireEvent` in tests; `@testing-library/user-event` is not installed.

- [ ] **Step 5: Rewrite `data.module.css`**

Logical properties only. Delete every rule belonging to the removed derivation and revision sections.

- [ ] **Step 6: Run, verify, mutation-test**

```bash
rtk proxy ./node_modules/.bin/vitest run src/app/\(admin\)/data/
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
```

Mutations: (1) re-add a `readFileSync` import → the disk test must fail; (2) enable the promote button while a decision is open → that test must fail; (3) remove the `requireAdmin` short-circuit → the authorization test must fail.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/data/"
git commit -F - <<'MSG'
feat(data): the register of what the system could not settle

/data now reads the database only. That closes I8 — it re-parsed three
workbooks off disk on every request and never noticed a confirmed block —
and M14 with it, since docs/reference-data leaves the runtime module graph
and Next stops tracing the camp's real names and debts into the deployed
function.

The page has one job: everything unresolved. Decisions waiting on a lead
first, then the worklist, the coverage matrix, the refusals with their
evidence, the arithmetic that does not add up, and the trace both ways.
The promote button sits under the decisions because it is only safe to
press once they are made.

The budget derivation is gone rather than ported: /money already renders
it from the database.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 12: Dry-run evidence against the live database

**Files:**
- Create: `scripts/dry-run-promote.ts`
- Create: `docs/superpowers/plans/2026-09-15-cutover-evidence.md` (the output, committed)

**This task writes no product code and deletes nothing.** Its deliverable is evidence. It exists because the cutover's one real failure mode — deleting a seeded fact that no block re-creates — is invisible to every test, since tests use a fresh `createTestDb()` and the live database is the only place the seed and the promoter coexist.

**Read `scripts/` first** for how the existing seed runner loads `DATABASE_URL` and constructs the db handle, and follow it.

- [ ] **Step 1: Write the script**

**It runs against a scratch clone, never against `shliff`.** `promoteBlock` reads the sheet's season from the database and calls `sheetEligibility(db)`, and it refuses any block without `confirmedAt` — so "labels held in memory" cannot reach it, and adding an override would put a test-only branch in the production write path. Clone instead:

```bash
docker exec shliff-pg psql -U shliff -d postgres -c "create database shliff_evidence template shliff;"
```

Point the script at `shliff_evidence` via `DATABASE_URL` and, in the clone only:
1. Set a season on each of the 19 sheets, from a map you write by hand after looking at the sheet names, and set `authoritative` on the copy you would choose for each colliding group.
2. Mark every block confirmed, then run `promoteBlock(db, id, { dryRun: true, recordedBy: 'evidence' })` for all of them.
3. For each of the four target tables, print: rows the promoter would write (with `source_row`), rows currently present with a null `source_block_id` (the seeded ones), and the set difference in both directions.
4. Print every refusal, grouped by reason.

- [ ] **Step 2: Run it and check nothing changed**

```bash
rtk proxy npx tsx scripts/dry-run-promote.ts
docker exec shliff-pg psql -U shliff -d shliff -c "select count(*) from ledger_entries where source_block_id is not null;"
docker exec shliff-pg psql -U shliff -d shliff -c "select count(*) from sheets where season_id is not null or authoritative is not null;"
```

Expected: **both return 0** — the live database has neither promoted rows nor labels on it. If either is non-zero, the script pointed at `shliff` rather than the clone: stop, report it, and do not continue to Task 13.

- [ ] **Step 3: Write up the evidence**

Create `docs/superpowers/plans/2026-09-15-cutover-evidence.md` answering, per table, with counts:
- Which seeded rows would the promoter re-create?
- Which seeded rows would it **not** re-create, and are those the adjudications we expect (`funding_targets` ×8, opening balances ×3, the offset settlements) or something unexpected?
- **Specifically: do the twelve ברן 25 reimbursements come from an `obligations` block or from a `budget_lines` block?** The spec assumes the latter and says so is unverified. Settle it here.
- Which refusals are expected, and which reveal a mapping or archetype that needs re-picking at confirm time?

- [ ] **Step 4: Commit the evidence**

```bash
git add scripts/dry-run-promote.ts docs/superpowers/plans/2026-09-15-cutover-evidence.md
git commit -F - <<'MSG'
chore(promote): dry-run evidence before anything is deleted

The cutover's one real failure mode is deleting a seeded fact that no
block re-creates, and no test can see it: tests run on a fresh database
where the seed and the promoter never coexist. So the diff is taken
against the live data first, read-only, and written down.

This also settles the question the spec flagged as unverified — whether
the twelve ברן 25 reimbursements come from an obligations block or from a
budget_lines block.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 13: The cutover

**Files:**
- Modify: `src/lib/seed/camp-seed.ts`
- Modify: `src/lib/seed/camp-seed.test.ts`, `src/lib/money/closures.test.ts`
- Create: `scripts/cutover.ts`

**Do not start this task until Task 12's evidence document is committed and read.** The changes below are the intended shape; where the evidence contradicts them, the evidence wins — say so in the report.

- [ ] **Step 1: Shrink the seed**

`seedCampBaseline` stops writing the facts the promoter now owns, and keeps every fact no block produces. On current evidence that means it keeps: seasons, people, dues, tasks, events, accounts and their opening balances (R10), `funding_targets` (no archetype exists), and the obligation settlements that model the 6,000 offset. Each removal gets a comment naming the block that now produces it.

Update `CampSeedResult`'s counters to match, and fix every test that asserts the old counts. **Do not delete an assertion to make a test pass** — change it to the new expected value and confirm it still discriminates.

- [ ] **Step 2: Write the cutover script**

`scripts/cutover.ts` deletes, from the four target tables only, rows whose `source_block_id` **is null** and which Task 12's evidence proved the promoter re-creates. It prints what it will delete and requires an explicit `--commit` flag; without it, it is a dry run. It never touches `funding_targets`, `accounts`, `obligation_settlements`, `dues`, `payments` or `tasks`.

- [ ] **Step 3: Verify on a scratch database first**

Clone the live database into a scratch one in the same container, run the cutover there, then run the bulk promote, then compare `/money`'s figures against the workbooks. Never run either against `shliff` until the scratch run matches.

```bash
docker exec shliff-pg psql -U shliff -d postgres -c "create database shliff_cutover template shliff;"
```

- [ ] **Step 4: Run the full suite, typecheck, lint, commit**

```bash
rtk proxy ./node_modules/.bin/vitest run
rtk proxy ./node_modules/.bin/tsc --noEmit
rtk proxy npm run lint
git add src/lib/seed/ src/lib/money/closures.test.ts scripts/cutover.ts
git commit -F - <<'MSG'
refactor(seed): the seed keeps its rulings and gives up its transcriptions

The promoter now owns every fact a confirmed block produces, so the seed
stops writing them. What stays is the category no block contains: seasons,
people, dues, tasks and events; the three מיקום opening balances, which R10
established are an adjudication rather than a transcription; the eight
funding targets, for which BLOCK_ARCHETYPES has no archetype at all; and
the settlements that model the 6,000 offset as five members' dues.

Row counts in the seed tests changed rather than being deleted. Each was
checked to still fail when the behaviour under it breaks.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PnJ7hi82RbNJJA5btjzwEw
MSG
```

---

### Task 14: Running-app verification

**Files:** none. The deliverable is a written verification report appended to the wave's progress log.

Every defect that mattered in Wave 1 was found here and by nothing else. Tests run on PGlite against fresh databases; this is the only step that runs the real migrations on real Postgres with real data.

- [ ] **Step 1: Apply the migration to a scratch database and confirm it is clean**

Never against `shliff`. Create `shliff_verify` from the template, apply all six migrations, and confirm no error. PGlite cannot make this check.

- [ ] **Step 2: Walk the real flow in the browser**

1. `/data` — every one of the 19 sheets appears, and the collision groups are exactly the ones the spec names.
2. Set a season on each sheet. Confirm the two `סיכום כללי` copies stop colliding once they carry different seasons.
3. Pick the authoritative copy of each genuinely duplicated sheet, using the diff shown.
4. Confirm the 29 blocks in `/imports/[id]`, re-picking the archetype where the classifier was wrong — `תקציב רחבה ברן 25` is `ledger` and is the dancefloor's budget.
5. Press promote. Record the written / refused / deleted counts.
6. Press promote again. Confirm the second run writes nothing and deletes nothing.
7. `/money` — check every figure against the workbooks: ברן 26 ledger 62,000 / 45,271 / 16,729 over 12 moves; ברן 25 50,306.55 / 50,770 / −463.45; the identity closing at 1,200 + 639.29 = 1,839.29; חוב יוסף at 910; twelve reimbursements at 5,954 with exactly two unnamed.
8. Click a figure through to its source cell and confirm the reference is right.
9. Confirm the R22 promise now holds: from an empty `/money`, the `/upload` link leads somewhere that makes figures appear.

- [ ] **Step 3: Write it up**

Record every figure checked, every mismatch found, and — as Wave 1's report did — whether your own verification script went stale against the code. A verification tool is also code that can lie.

- [ ] **Step 4: Commit the report**

---

## Self-Review

**Spec coverage.** W1 → Task 7. W2 → Tasks 7, 9. W3 → Tasks 2, 3–6, 10. W4 → Task 7. W5 → Task 7. W6 → Tasks 3–6. W7 → Task 7. W8 → Tasks 2–6. W9 → Task 3. W10 → Task 1. W11 → Tasks 3–6 (nullable for ledger and obligations, refused for budget and tickets). W12–W14 → Task 1. W15 → Task 8. W16 → Task 11 Step 1. W17–W20 → Tasks 9, 11. W21 → Tasks 10, 11. W22 → Task 11. W23 → Task 11. W24 → Task 11. Section 1's seed/promoter split → Tasks 12, 13. Section 6's `account_balances` refusal → Task 7 (`no-promoter`). Section 10's testing → every task's mutation step and Task 14.

**Known thin spots, deliberately left for the executor to settle with evidence:**
- Tasks 9, 10 and 11 give test *names* and section structure rather than full test bodies. They depend on Task 9's return shapes, which depend on what Task 7's `PromotionResult` turns out to carry in practice. Write them out fully at execution time; do not leave a name without a body.
- Task 13's exact list of what the seed stops writing is set by Task 12's evidence, not by this plan. The plan states the expected answer and says explicitly that the evidence overrides it.
- Task 12's in-memory season map has to be written by hand after looking at the 19 sheet names. That is a judgement about the camp's data, not something this plan can pre-compute.
