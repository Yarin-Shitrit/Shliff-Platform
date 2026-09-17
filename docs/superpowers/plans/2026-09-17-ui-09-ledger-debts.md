# תנועות and חובות Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ledger and the debts register the two screens they have never had. `/money/ledger` shows every movement with נכנס and יצא as separate positive columns, a counterpart, month headers, a source chip, a filter-aware summary strip, and a running balance that appears only when it can be true. `/money/debts` shows both directions with their own subtotals, a settlement meter, dateless debts shown as dateless and sorted last, nameless debts that can be neither settled nor dismissed, and a settlement drawer that finally gives `settleObligation` a user interface — cash or קיזוז, with the library's own Hebrew refusals reaching the screen unchanged.

**Architecture:** Two new Server Component routes under the existing `/money` segment. Neither route re-implements a money rule. `listMovements` in `src/lib/money/ledger.ts` stays the one place the ledger union lives — the קיזוז exclusion, the event-filter rule and the date ordering are read from it, never copied beside it. A new read module, `src/lib/money/ledger-view.ts`, calls `listMovements` and enriches its rows by id with the four things a table needs and a total does not: the budget line, the workbook cell, the counterpart, and the other leg of a transfer. `src/lib/money/debts-view.ts` does the same over `listObligations`. Both modules keep the database query to the page's scope (season, account, event) and apply the saved views, the text search and the sort as pure functions over the returned array, so the summary strip is a reduce over exactly the rows on screen and cannot disagree with the table below it. Writes go through server actions that call the existing library functions and map any non-Hebrew failure to a Hebrew fallback at the boundary (R9).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle + Postgres, CSS Modules, Vitest + @testing-library/react. No new runtime dependencies (R1).

**Spec:** `docs/superpowers/specs/2026-09-17-ui-redesign-design.md`, requirements **D7** (תנועות) and **D8** (חובות), under rulings R1–R12 and foundation requirements A8–A12, C1–C14, E1–E6. Domain rules come from `docs/superpowers/specs/2026-09-12-camp-money-and-data-design.md` — direction is never inferred from a sign, an offset moves no cash, an obligation with no party can never be settled and can never be dismissed, and a season is a label set by hand. The dateless-debt rule comes from `docs/superpowers/plans/2026-09-17-promotion-blockers-and-hardening.md` Task 1, which is merged.

## Global Constraints

- **R1 — no new runtime dependencies.** No component library, no icon package, no chart package. The settlement meter is the existing `src/components/charts/meter.tsx`.
- **R5 — the season is one global control**, carried as `?season=<uuid>`. Neither new route renders a season picker of its own. Camp-wide data says so on screen: nameless obligations belong to the camp, not to a season, and the debts table says that in words.
- **R6 — a drawer is a URL.** The settlement drawer is `?settle=<obligationId>`; the new-movement drawer is `?new=movement`. Both render on the server and survive a refresh.
- **R7 — Server Components by default.** Four client components exist in this plan, and each carries a comment saying why: `attribute-account.tsx`, `new-movement-form.tsx`, `settle-form.tsx`, and nothing else. Saved views, filters and sort are `<Link>`s and a GET form, not client state.
- **R9 — no English reaches a Hebrew screen.** Every action passes failures through `hebrewError`, which returns a Hebrew message unchanged and replaces anything else with the Hebrew fallback after logging it. `src/lib/fees/payments.ts` still throws `a payment amount must be positive`; that string must never render.
- **R11 — every number keeps its provenance.** A promoted row shows its cell; a row a lead typed shows `נרשם ידנית`.
- **A10 — logical properties only**, with the one documented exception: a numeric column is `text-align: right` with `font-variant-numeric: tabular-nums`.
- **A11 — money through plan 01's helper**, always inside `<bdi>`, symbol last, amounts always positive. Direction is carried by the column the amount sits in, never by a sign. Never concatenate `₪` by hand.
- **A12 — dates are `DD/MM/YY` in tables**, through plan 01's date helper.
- **Admin guard.** Every `page.tsx` and every `actions.ts` added here calls `requireAdmin()` — `notFound()` on a page, `{ ok: false, error: 'אין הרשאה' }` in an action. `src/app/admin-guard.test.ts` is a static net that walks every file under `src/app/(admin)` and fails if one does not; a new route that forgets the guard breaks the suite.
- **Domain modules take `db: AnyDb`** as their first parameter and never import `@/db`. Only `page.tsx` and `'use server'` action files import `@/db`.
- **Blankness is `isBlank` from `@/lib/text/normalize`**, never `.trim()`.
- **Money is integer agorot in JS**, converted only by `src/lib/money.ts`. No float arithmetic.
- **E6 — no page reads a file from disk at request time.**
- **E1 — every list screen implements all five empty states** from C10.
- Both routes set `export const dynamic = 'force-dynamic'` and their own `metadata.title` (B8).
- Commands: `npx vitest run <path>`, `npx tsc --noEmit`. Database tests use `createTestDb` from `src/test/db.ts`; component tests carry `/** @vitest-environment jsdom */` as their first line.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

Created by this plan:

```
src/lib/money/source-ref.ts                             a block id → its workbook cell reference
src/lib/money/source-ref.test.ts
src/lib/money/ledger-view.ts                            LedgerRow, the scoped query, the pure views
src/lib/money/ledger-view.test.ts
src/lib/money/debts-view.ts                             DebtRow, the debts query, the per-direction totals
src/lib/money/debts-view.test.ts
src/lib/money/attribution.ts                            assigning an account to a movement that has none
src/lib/money/attribution.test.ts
src/app/(admin)/money/hebrew-error.ts                   R9 at the action boundary
src/app/(admin)/money/hebrew-error.test.ts
src/app/(admin)/money/ledger/page.tsx                   D7
src/app/(admin)/money/ledger/page.test.tsx
src/app/(admin)/money/ledger/ledger.module.css
src/app/(admin)/money/ledger/actions.ts
src/app/(admin)/money/ledger/attribute-account.tsx      client
src/app/(admin)/money/ledger/attribute-account.test.tsx
src/app/(admin)/money/ledger/new-movement-form.tsx      client
src/app/(admin)/money/ledger/new-movement-form.test.tsx
src/app/(admin)/money/debts/page.tsx                    D8
src/app/(admin)/money/debts/page.test.tsx
src/app/(admin)/money/debts/debts.module.css
src/app/(admin)/money/debts/actions.ts
src/app/(admin)/money/debts/settle-form.tsx             client
src/app/(admin)/money/debts/settle-form.test.tsx
```

Modified by this plan:

```
src/lib/money/obligations.ts        + openedOn on ObligationRow, + checkSettlement
src/lib/money/obligations.test.ts
```

Read but never modified by this plan: `src/lib/money/ledger.ts`, `accounts.ts`, `summary.ts`, `trace.ts`, `budget.ts`, `closures.test.ts`, `src/lib/fees/payments.ts`, `src/app/(admin)/money/page.tsx`, `src/app/(admin)/nav.tsx`.

## Dependencies

**Depends on plan 01 (foundation).** This plan consumes, and does not create:

- the money helper — referred to below as `<Money agorot={n} />`, rendering `1,200 ₪` inside `<bdi>` per A11;
- the date helper — referred to below as `formatDate(date)`, rendering `DD/MM/YY` per A12.

If plan 01 named either differently, adapt at the call site — one line per use. **Never create a second money or date helper**; A11 and A12 exist precisely to keep there being one.

**Depends on plan 02 (the shell).** Plan 02 owns the sidebar and adds the כספים group's תנועות → `/money/ledger` and חובות → `/money/debts` items (B1), the season param (R5) and the breadcrumbs (B6). This plan touches no shell file. One note for plan 02: B3 matches the active nav item by path prefix, and `/money` is now a prefix of `/money/ledger` and `/money/debts`, so the matcher must compare whole segments or סקירה כספית will light up on all three screens.

**Depends on plan 03 (the component kit).** Consumed from `src/components/ui/`: `Table` (C1), `SavedViews` (C2), `FilterBar` (C3), `Pill` (C4), `Avatar` (C5), `Drawer` (C6), `ConfirmDialog` (C7), `Banner` (C9), `EmptyState` (C10), `StatTile` (C11), `SourceChip` (C12), `Field` (C13), `Icon` (C14). Their exact props are plan 03's business. **Every test in this plan asserts rendered text, roles and accessible names — never a component's props or class names** — so a prop rename in plan 03 costs one line per call site and breaks no test here.

`SavedViews` is used **without an add affordance**. C2 describes a `+`, but a saved view a lead creates would have to be stored, and this spec changes no table. The six named views below *are* the saved views. A `+` that cannot save is a button that lies.

**Hand-off to plan 08 (the money overview).** Plan 08 owns `src/app/(admin)/money/page.tsx`; this plan never edits it. The contract, which plan 08 implements and this plan's modules satisfy:

- The `התנועות` band becomes a **five-row preview** — `listLedgerRows(db, { seasonId })`, sorted date-descending, first five — followed by one link, `לכל התנועות` → `/money/ledger?season=<id>`.
- The `מה חייבים ומה חייבים לנו` band keeps both directions from `listDebts(db, { seasonId })` with `debtTotals`, followed by `לכל החובות` → `/money/debts?season=<id>`. The unnamed-obligation block itself moves to `/money/debts`; the overview keeps only the count and the link, because req 19's "permanently, and cannot be dismissed" is satisfied by a screen that always shows them, not by every screen showing them.
- **Plan 08 deletes the running-balance column from the overview preview.** Today `money/page.tsx` reduces from zero over the season's movements, which restarts the balance each season and ignores every account's opening balance. The honest rule lives in Task 3 and applies only on `/money/ledger`.

If plan 08 has not landed when this plan runs, nothing here breaks: `/money` keeps today's bands and the two new routes simply exist alongside them.

**Depends on the hardening plan's Task 1**, which is merged: `obligations.opened_on` is nullable with no default, `listObligations` orders `asc nulls last`, and the promoter's note for a dateless debt is `בגיליון אין תאריך לחוב הזה`. That sentence is reused verbatim on screen.

---

### Task 1: A promoted row can name the workbook cell it came from

`SourceChip` (C12) needs `סיכום כללי!A14` for every row that has provenance, and both new tables need it for a whole page of rows at once. `traceRow` in `src/lib/money/trace.ts` already builds that string, one row per call and one query per call, and that file belongs to another in-flight lane. This task adds a batched reader beside it and pins the two to the same answer, so the reference on a table row and the reference in a trace can never drift apart.

**Files:**
- Create: `src/lib/money/source-ref.ts`
- Create: `src/lib/money/source-ref.test.ts`
- Read first: `src/lib/money/trace.ts` (`buildSourceCell`), `src/lib/money/trace.test.ts` (how it builds an upload → sheet → block fixture)

**Interfaces:**

Consumes:
```ts
// @/lib/xlsx/col-label
export function colLabel(oneIndexedColumn: number): string;
// @/db/schema/source
blocks, sheets, uploads   // blocks.left is the block's first column, 1-indexed
// @/lib/money/trace  (test only — never imported by ledger-view or debts-view)
export async function traceRow(
  db: AnyDb, table: TracedRow['table'], id: string,
): Promise<SourceCell | null>;
```

Produces:
```ts
// src/lib/money/source-ref.ts
export interface BlockRef {
  blockId: string;
  sheetId: string;
  sheetName: string;
  filename: string;
  /** The block's first column, 1-indexed — see `blocks.left`. */
  left: number;
}
export function cellReference(ref: BlockRef, sourceRow: number): string;
export async function blockRefs(db: AnyDb, blockIds: string[]): Promise<Map<string, BlockRef>>;
```

**Steps:**

- [ ] 1. Write `src/lib/money/source-ref.test.ts` with a failing test that builds an upload, a sheet and a block the way `src/lib/money/trace.test.ts` does, then asserts the batch reader and the reference formula:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { blockRefs, cellReference } from './source-ref';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

describe('a block reference', () => {
  it('names the block\'s first column at the row\'s absolute sheet position', async () => {
    const { blockId } = await seedBlock(db, { sheetName: 'סיכום כללי', left: 1 });
    const refs = await blockRefs(db, [blockId]);
    expect(cellReference(refs.get(blockId)!, 14)).toBe('סיכום כללי!A14');
  });

  it('reads many blocks in one call, and asks for none when given none', async () => {
    const a = await seedBlock(db, { sheetName: 'סיכום כללי', left: 1 });
    const b = await seedBlock(db, { sheetName: 'תקציב קאמפ ברן 26', left: 4 });
    const refs = await blockRefs(db, [a.blockId, b.blockId, a.blockId]);
    expect(refs.size).toBe(2);
    expect(cellReference(refs.get(b.blockId)!, 29)).toBe('תקציב קאמפ ברן 26!D29');
    expect((await blockRefs(db, [])).size).toBe(0);
  });

  it('leaves out a block id that does not exist rather than inventing a reference', async () => {
    const refs = await blockRefs(db, ['00000000-0000-0000-0000-000000000000']);
    expect(refs.size).toBe(0);
  });
});
```
  Write `seedBlock` as a local helper in this test file, copying the fixture shape from `trace.test.ts`; do not export it and do not edit `trace.test.ts`.

- [ ] 2. Run `npx vitest run src/lib/money/source-ref.test.ts`. Expected failure: `Error: Failed to resolve import "./source-ref" from "src/lib/money/source-ref.test.ts". Does the file exist?`

- [ ] 3. Write `src/lib/money/source-ref.ts`:

```ts
import { eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { blocks, sheets, uploads } from '@/db/schema/source';
import { colLabel } from '@/lib/xlsx/col-label';

export interface BlockRef {
  blockId: string;
  sheetId: string;
  sheetName: string;
  filename: string;
  /** The block's first column, 1-indexed — see `blocks.left`. */
  left: number;
}

/**
 * `סיכום כללי!A14`. `sourceRow` is the absolute 1-indexed sheet row, not an
 * index into the block, so a block re-detected against a moved boundary does
 * not change the cell a figure points at. Same formula as `buildSourceCell`
 * in `trace.ts`; `source-ref.test.ts` pins the two to the same answer.
 */
export function cellReference(ref: BlockRef, sourceRow: number): string {
  return `${ref.sheetName}!${colLabel(ref.left)}${sourceRow}`;
}

/**
 * Every named block's sheet and upload, in one query. A table renders a page
 * of rows at a time, and `traceRow` costs a query per row.
 */
export async function blockRefs(db: AnyDb, blockIds: string[]): Promise<Map<string, BlockRef>> {
  const ids = [...new Set(blockIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      blockId: blocks.id,
      left: blocks.left,
      sheetId: sheets.id,
      sheetName: sheets.name,
      filename: uploads.filename,
    })
    .from(blocks)
    .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .where(inArray(blocks.id, ids));
  return new Map(rows.map((row) => [row.blockId, row]));
}
```

- [ ] 4. Run `npx vitest run src/lib/money/source-ref.test.ts`. All three pass.

- [ ] 5. Add the agreement test to `src/lib/money/source-ref.test.ts` — a failing test that pins this module to `traceRow`:

```ts
import { recordEntry } from './ledger';
import { traceRow } from './trace';

it('agrees with traceRow on the same row, so a chip and a trace cannot drift', async () => {
  const { blockId } = await seedBlock(db, { sheetName: 'סיכום כללי', left: 1 });
  const entryId = await recordEntry(db, {
    occurredOn: new Date('2026-07-11T00:00:00Z'), direction: 'out', amount: 41300,
    description: 'רכש ציוד תשתית', recordedBy: 'lead@example.com',
    sourceBlockId: blockId, sourceRow: 14,
  });
  const traced = await traceRow(db, 'ledger_entries', entryId);
  const refs = await blockRefs(db, [blockId]);
  expect(cellReference(refs.get(blockId)!, 14)).toBe(traced!.reference);
});
```

- [ ] 6. Run `npx vitest run src/lib/money/source-ref.test.ts`. It passes on the code written in step 3 — this test guards a future edit, not a missing behaviour. If it fails, the formula was copied wrong; fix `cellReference`, never `trace.ts`.

- [ ] 7. Run `npx tsc --noEmit`. Clean.

- [ ] 8. Commit: `feat(money): a page of rows can name its workbook cells in one query`

---

### Task 2: The ledger view — one row type, one scoped query, pure views over it

D7's table needs four things a total does not: the budget line, the workbook cell, the counterpart, and the other leg of a transfer. This task adds them **on top of** `listMovements` rather than beside it. `listMovements` owns the union, the `ne(payments.channel, 'קיזוז')` exclusion and the event-filter rule; a second union query would be a second place for those rules to live, and the whole reason the ledger is a union is that two copies of a movement can disagree.

**The database query carries the page's scope only** — season, account, event. Direction, origin, budget line, the text search and the sort are applied as pure functions over the returned array. Three reasons: the summary strip becomes a reduce over exactly the rows on screen, so it cannot disagree with the table; the saved-view counts come from one array instead of six queries; and "scale is trivial, correctness and legibility beat performance everywhere" is this project's stated rule. A season of the camp's ledger is thirteen rows.

**The counterpart column is populated only where the model knows one.** A dues payment knows its payer. A transfer leg knows its sibling's account. A plain `ledger_entries` row has no supplier column in Wave 1's schema, so it renders `—`. The mock shows `הובלות דרום` there; parsing a supplier out of a free-text description would be a guess, and this system does not guess.

**A dues movement's source is always `נרשם ידנית`.** `payments` carries no `source_block_id` — provenance landed on the six money tables, not on `payments` — and this plan adds no column. That is honest: a payment is always recorded by a person on `/fees`.

**Files:**
- Create: `src/lib/money/ledger-view.ts`
- Create: `src/lib/money/ledger-view.test.ts`
- Read first: `src/lib/money/ledger.ts` (all of it), `src/lib/money/ledger.test.ts` (fixture shapes)

**Interfaces:**

Consumes:
```ts
// @/lib/money/ledger
export interface Movement {
  id: string; source: 'ledger' | 'dues'; occurredOn: Date; direction: LedgerDirection;
  amountAgorot: number; description: string; accountId: string | null;
  accountName: string | null; seasonId: string | null; eventId: string | null;
  transferGroupId: string | null;
}
export async function listMovements(db: AnyDb, filter?: MovementFilter): Promise<Movement[]>;
// @/lib/money/source-ref
export async function blockRefs(db: AnyDb, blockIds: string[]): Promise<Map<string, BlockRef>>;
export function cellReference(ref: BlockRef, sourceRow: number): string;
```

Produces:
```ts
// src/lib/money/ledger-view.ts
export type LedgerSort = 'date-asc' | 'date-desc';
export type LedgerView = 'all' | 'in' | 'out' | 'no-account' | 'imported' | 'manual';

/** What the database query is scoped by. Anything else is a pure view. */
export interface LedgerScope { seasonId?: string; accountId?: string; eventId?: string }

export interface LedgerQuery {
  view: LedgerView;
  /** Matched against the description and the counterpart. */
  text?: string;
  budgetLineId?: string;
  sort: LedgerSort;
}

export interface LedgerRow {
  id: string;
  origin: 'ledger' | 'dues';
  occurredOn: Date;
  direction: LedgerDirection;
  /** Always positive. The column it renders in carries the direction. */
  amountAgorot: number;
  description: string;
  accountId: string | null;
  accountName: string | null;
  /** מ/אל. The dues payer, or the other account of a transfer. Null when the
   *  model knows of no counterpart — never parsed out of the description. */
  counterpartName: string | null;
  counterpartPersonId: string | null;
  isTransfer: boolean;
  budgetLineId: string | null;
  budgetLineLabel: string | null;
  seasonId: string | null;
  /** Null for a dues payment, which carries no provenance columns, and for a
   *  ledger entry a lead typed. Both render `נרשם ידנית`. */
  source: { blockId: string; reference: string } | null;
}

export interface LedgerStrip {
  inAgorot: number; outAgorot: number; netAgorot: number; count: number;
}
export interface MonthGroup { key: string; label: string; count: number; rows: LedgerRow[] }

export async function listLedgerRows(db: AnyDb, scope?: LedgerScope): Promise<LedgerRow[]>;
export function applyLedgerView(rows: LedgerRow[], query: LedgerQuery): LedgerRow[];
export function viewCounts(rows: LedgerRow[]): Record<LedgerView, number>;
export function ledgerStrip(rows: LedgerRow[]): LedgerStrip;
export function groupByMonth(rows: LedgerRow[], sort: LedgerSort): MonthGroup[];
```

**Steps:**

- [ ] 1. Write `src/lib/money/ledger-view.test.ts` with failing tests for the query and the row type:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { createAccount } from './accounts';
import { recordEntry, recordTransfer } from './ledger';
import { createBudgetLine } from './budget';
import { listLedgerRows } from './ledger-view';

const LEAD = 'lead@example.com';
let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

describe('the ledger view', () => {
  it('carries the budget line label a movement was spent against', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const lineId = await createBudgetLine(db, {
      seasonId: season.id, label: 'תשתיות', total: 18600,
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-08-28T00:00:00Z'), direction: 'out', amount: 18600,
      description: 'השכרת גנרטור', seasonId: season.id, budgetLineId: lineId,
      recordedBy: LEAD,
    });
    const [row] = await listLedgerRows(db, { seasonId: season.id });
    expect(row.budgetLineLabel).toBe('תשתיות');
    expect(row.amountAgorot).toBe(1860000);
    expect(row.direction).toBe('out');
  });

  it('names the payer as the counterpart of a dues payment, and never a sign', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const person = await createPerson(db, { displayName: 'נועה לוי' });
    await addMember(db, person.id, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await recordPayment(db, {
      dueId: fee.dueId!, amount: 1200, channel: 'מזומן',
      paidOn: new Date('2026-09-10T00:00:00Z'), recordedBy: LEAD,
    });
    const [row] = await listLedgerRows(db, { seasonId: season.id });
    expect(row.origin).toBe('dues');
    expect(row.counterpartName).toBe('נועה לוי');
    expect(row.counterpartPersonId).toBe(person.id);
    expect(row.amountAgorot).toBe(120000);
    expect(row.source).toBeNull();
  });

  it('names the other account as the counterpart of each leg of a transfer', async () => {
    const from = await createAccount(db, { name: 'החשבון של רוני', kind: 'personal' });
    const to = await createAccount(db, { name: 'קופת מסיבות', kind: 'cash' });
    await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 6200,
      occurredOn: new Date('2026-09-12T00:00:00Z'), description: 'העברה לקופת מסיבות',
      recordedBy: LEAD,
    });
    const rows = await listLedgerRows(db);
    expect(rows.every((row) => row.isTransfer)).toBe(true);
    const out = rows.find((row) => row.direction === 'out')!;
    const into = rows.find((row) => row.direction === 'in')!;
    expect(out.counterpartName).toBe('קופת מסיבות');
    expect(into.counterpartName).toBe('החשבון של רוני');
  });

  it('leaves the counterpart empty for a plain entry rather than reading a name out of the description', async () => {
    await recordEntry(db, {
      occurredOn: new Date('2026-09-14T00:00:00Z'), direction: 'out', amount: 3875,
      description: 'השכרת משאית — הובלות דרום', recordedBy: LEAD,
    });
    const [row] = await listLedgerRows(db);
    expect(row.counterpartName).toBeNull();
    expect(row.isTransfer).toBe(false);
  });

  it('inherits the offset exclusion from listMovements rather than restating it', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const person = await createPerson(db, { displayName: 'יוסף' });
    await addMember(db, person.id, season.id);
    await issueFlatDues(db, season.id);
    const [fee] = await listSeasonFees(db, season.id);
    await recordPayment(db, {
      dueId: fee.dueId!, amount: 1200, channel: 'קיזוז', note: 'מול חוב יוסף',
      paidOn: new Date('2026-09-01T00:00:00Z'), recordedBy: LEAD,
    });
    expect(await listLedgerRows(db, { seasonId: season.id })).toHaveLength(0);
  });
});
```

- [ ] 2. Run `npx vitest run src/lib/money/ledger-view.test.ts`. Expected failure: `Error: Failed to resolve import "./ledger-view" from "src/lib/money/ledger-view.test.ts". Does the file exist?`

- [ ] 3. Write `src/lib/money/ledger-view.ts` with `listLedgerRows` only:

```ts
import { eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, budgetLines, ledgerEntries } from '@/db/schema/money';
import type { LedgerDirection } from '@/db/schema/money';
import { dues, payments, persons } from '@/db/schema/camp';
import { listMovements } from './ledger';
import { blockRefs, cellReference } from './source-ref';

export interface LedgerScope { seasonId?: string; accountId?: string; eventId?: string }

export interface LedgerRow { /* …as declared in Interfaces above… */ }

/**
 * The ledger, as a table needs it.
 *
 * Built on `listMovements`, never beside it: that function owns the union of
 * `ledger_entries` and `payments`, the rule that a קיזוז is never part of the
 * ledger because it moves no cash, and the rule that an event filter excludes
 * dues payments rather than ignoring itself. A second union query here would
 * be a second home for all three, and two copies of a movement are exactly
 * what the union exists to prevent.
 *
 * The four extra columns are read back by id, in three queries regardless of
 * how many rows there are.
 */
export async function listLedgerRows(db: AnyDb, scope: LedgerScope = {}): Promise<LedgerRow[]> {
  const movements = await listMovements(db, scope);
  const entryIds = movements.filter((m) => m.source === 'ledger').map((m) => m.id);
  const dueIds = movements.filter((m) => m.source === 'dues').map((m) => m.id);
  const groupIds = [...new Set(movements
    .map((m) => m.transferGroupId)
    .filter((id): id is string => id !== null))];

  const entryRows = entryIds.length === 0 ? [] : await db
    .select({
      id: ledgerEntries.id,
      budgetLineId: ledgerEntries.budgetLineId,
      budgetLineLabel: budgetLines.label,
      sourceBlockId: ledgerEntries.sourceBlockId,
      sourceRow: ledgerEntries.sourceRow,
    })
    .from(ledgerEntries)
    .leftJoin(budgetLines, eq(budgetLines.id, ledgerEntries.budgetLineId))
    .where(inArray(ledgerEntries.id, entryIds));

  const payerRows = dueIds.length === 0 ? [] : await db
    .select({ id: payments.id, personId: dues.personId, displayName: persons.displayName })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .innerJoin(persons, eq(persons.id, dues.personId))
    .where(inArray(payments.id, dueIds));

  // Both legs of every transfer touched by this page, including a leg the
  // page's own scope filtered out — a transfer's counterpart is a fact about
  // the movement, not about the current filter.
  const legRows = groupIds.length === 0 ? [] : await db
    .select({
      transferGroupId: ledgerEntries.transferGroupId,
      direction: ledgerEntries.direction,
      accountName: accounts.name,
    })
    .from(ledgerEntries)
    .leftJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(inArray(ledgerEntries.transferGroupId, groupIds));

  const refs = await blockRefs(db, entryRows
    .map((row) => row.sourceBlockId)
    .filter((id): id is string => id !== null));

  const byEntry = new Map(entryRows.map((row) => [row.id, row]));
  const byPayment = new Map(payerRows.map((row) => [row.id, row]));
  const opposite = (group: string, direction: LedgerDirection): string | null =>
    legRows.find((leg) => leg.transferGroupId === group && leg.direction !== direction)
      ?.accountName ?? null;

  return movements.map((move) => {
    const entry = byEntry.get(move.id);
    const payer = byPayment.get(move.id);
    const ref = entry?.sourceBlockId ? refs.get(entry.sourceBlockId) : undefined;
    return {
      id: move.id,
      origin: move.source,
      occurredOn: move.occurredOn,
      direction: move.direction,
      amountAgorot: move.amountAgorot,
      description: move.description,
      accountId: move.accountId,
      accountName: move.accountName,
      counterpartName: payer?.displayName
        ?? (move.transferGroupId ? opposite(move.transferGroupId, move.direction) : null),
      counterpartPersonId: payer?.personId ?? null,
      isTransfer: move.transferGroupId !== null,
      budgetLineId: entry?.budgetLineId ?? null,
      budgetLineLabel: entry?.budgetLineLabel ?? null,
      seasonId: move.seasonId,
      source: ref && entry?.sourceRow !== null && entry?.sourceRow !== undefined
        ? { blockId: ref.blockId, reference: cellReference(ref, entry.sourceRow) }
        : null,
    };
  });
}
```
  Expand `LedgerRow` to the full declaration from **Interfaces** above.

- [ ] 4. Run `npx vitest run src/lib/money/ledger-view.test.ts`. All five pass.

- [ ] 5. Append failing tests for the pure views to `src/lib/money/ledger-view.test.ts`:

```ts
import { applyLedgerView, viewCounts, ledgerStrip, groupByMonth } from './ledger-view';

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'r1', origin: 'ledger', occurredOn: new Date('2026-09-15T00:00:00Z'),
    direction: 'in', amountAgorot: 1850000, description: 'הכנסות מסיבת גיוס',
    accountId: 'a1', accountName: 'קופת מסיבות', counterpartName: null,
    counterpartPersonId: null, isTransfer: false, budgetLineId: null,
    budgetLineLabel: null, seasonId: 's1', source: null, ...over,
  };
}

describe('the saved views', () => {
  const rows = [
    row({ id: '1', direction: 'in', amountAgorot: 1850000 }),
    row({ id: '2', direction: 'out', amountAgorot: 387500 }),
    row({ id: '3', direction: 'out', amountAgorot: 120000, accountId: null, accountName: null }),
    row({ id: '4', origin: 'dues', direction: 'in', amountAgorot: 120000,
          counterpartName: 'נועה לוי', description: 'דמי קאמפ — נועה לוי' }),
    row({ id: '5', source: { blockId: 'b1', reference: 'סיכום כללי!A14' } }),
  ];

  it('counts every view from one array', () => {
    expect(viewCounts(rows)).toEqual({
      all: 5, in: 3, out: 2, 'no-account': 1, imported: 1, manual: 4,
    });
  });

  it('filters to movements with no account at all', () => {
    const only = applyLedgerView(rows, { view: 'no-account', sort: 'date-asc' });
    expect(only.map((r) => r.id)).toEqual(['3']);
  });

  it('searches the description and the counterpart together', () => {
    expect(applyLedgerView(rows, { view: 'all', text: 'נועה', sort: 'date-asc' })
      .map((r) => r.id)).toEqual(['4']);
    expect(applyLedgerView(rows, { view: 'all', text: 'גיוס', sort: 'date-asc' })
      .map((r) => r.id)).toEqual(['1', '5']);
  });
});

describe('the summary strip', () => {
  it('recomputes with the filter, because it reduces the rows on screen', () => {
    const rows = [
      row({ id: '1', direction: 'in', amountAgorot: 6200000 }),
      row({ id: '2', direction: 'out', amountAgorot: 4527100 }),
    ];
    expect(ledgerStrip(rows)).toEqual({
      inAgorot: 6200000, outAgorot: 4527100, netAgorot: 1672900, count: 2,
    });
    const outOnly = applyLedgerView(rows, { view: 'out', sort: 'date-asc' });
    expect(ledgerStrip(outOnly)).toEqual({
      inAgorot: 0, outAgorot: 4527100, netAgorot: -4527100, count: 1,
    });
  });
});

describe('month group headers', () => {
  it('groups by the month of the movement and labels it in Hebrew', () => {
    const groups = groupByMonth([
      row({ id: '1', occurredOn: new Date('2026-09-15T00:00:00Z') }),
      row({ id: '2', occurredOn: new Date('2026-09-08T00:00:00Z') }),
      row({ id: '3', occurredOn: new Date('2026-08-28T00:00:00Z') }),
    ], 'date-desc');
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['ספטמבר 2026', 2], ['אוגוסט 2026', 1],
    ]);
  });
});
```

- [ ] 6. Run `npx vitest run src/lib/money/ledger-view.test.ts`. Expected failure: `SyntaxError: The requested module './ledger-view' does not provide an export named 'applyLedgerView'`.

- [ ] 7. Add the pure functions to `src/lib/money/ledger-view.ts`:

```ts
export type LedgerSort = 'date-asc' | 'date-desc';
export type LedgerView = 'all' | 'in' | 'out' | 'no-account' | 'imported' | 'manual';
export interface LedgerQuery { view: LedgerView; text?: string; budgetLineId?: string; sort: LedgerSort }
export interface LedgerStrip { inAgorot: number; outAgorot: number; netAgorot: number; count: number }
export interface MonthGroup { key: string; label: string; count: number; rows: LedgerRow[] }

/** Literal, not `Intl`: ICU month names vary between builds, and a group
 *  header that reads differently on a laptop and on the server is a defect a
 *  test would only catch by accident. */
const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const MATCHES: Record<LedgerView, (row: LedgerRow) => boolean> = {
  all: () => true,
  in: (row) => row.direction === 'in',
  out: (row) => row.direction === 'out',
  'no-account': (row) => row.accountId === null,
  imported: (row) => row.source !== null,
  manual: (row) => row.source === null,
};

export function applyLedgerView(rows: LedgerRow[], query: LedgerQuery): LedgerRow[] {
  const needle = query.text?.trim().toLowerCase() ?? '';
  const filtered = rows.filter((row) => (
    MATCHES[query.view](row)
    && (!query.budgetLineId || row.budgetLineId === query.budgetLineId)
    && (needle === ''
      || row.description.toLowerCase().includes(needle)
      || (row.counterpartName?.toLowerCase().includes(needle) ?? false))
  ));
  const ascending = [...filtered].sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime());
  return query.sort === 'date-asc' ? ascending : ascending.reverse();
}

export function viewCounts(rows: LedgerRow[]): Record<LedgerView, number> {
  const counts = {} as Record<LedgerView, number>;
  for (const view of Object.keys(MATCHES) as LedgerView[]) {
    counts[view] = rows.filter(MATCHES[view]).length;
  }
  return counts;
}

/**
 * A reduce over the rows on screen, never a second query. `ledgerTotals` in
 * `ledger.ts` runs its own query and knows nothing about the views above, so
 * using it here would print a set of figures the table below does not show.
 */
export function ledgerStrip(rows: LedgerRow[]): LedgerStrip {
  let inAgorot = 0;
  let outAgorot = 0;
  for (const row of rows) {
    if (row.direction === 'in') inAgorot += row.amountAgorot;
    else outAgorot += row.amountAgorot;
  }
  return { inAgorot, outAgorot, netAgorot: inAgorot - outAgorot, count: rows.length };
}

export function groupByMonth(rows: LedgerRow[], sort: LedgerSort): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const row of rows) {
    const year = row.occurredOn.getUTCFullYear();
    const month = row.occurredOn.getUTCMonth();
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const group = groups.get(key)
      ?? { key, label: `${MONTHS_HE[month]} ${year}`, count: 0, rows: [] };
    group.rows.push(row);
    group.count += 1;
    groups.set(key, group);
  }
  const keys = [...groups.keys()].sort();
  if (sort === 'date-desc') keys.reverse();
  return keys.map((key) => groups.get(key)!);
}
```

- [ ] 8. Run `npx vitest run src/lib/money/ledger-view.test.ts`, then `npx tsc --noEmit`. Both clean.

- [ ] 9. Commit: `feat(money): the ledger gets a row type a table can render, built on the union it already had`

---

### Task 3: A running balance appears only when it can be true

Today `money/page.tsx` shows a `יתרה` column produced by reducing from zero over the season's movements. That number is wrong twice over: it restarts at zero every season, so it is not any account's balance, and it ignores `accounts.opening_balance`, which is exactly the carry-forward the money spec says the ledger cannot derive. It is also summed across accounts, so a row's "balance" mixes cash the camp holds in three different places.

**Ruling (binding): a running balance is shown only when the rows on screen are all of one account's movements, in date order.** In practice: `scope.accountId` is set, `sort` is `date-asc`, and no filter removes rows from the middle of that account's history — including the season filter. A season is a hand-set label on a continuous ledger, not a period, so filtering by season genuinely hides movements that changed that account's cash. When the column is shown, it starts from that account's `opening_balance`, which is what makes its last value equal `accountBalances`'s figure for the account — the test below pins exactly that. When it cannot be shown, the column is absent and one line says why.

**Files:**
- Modify: `src/lib/money/ledger-view.ts`
- Modify: `src/lib/money/ledger-view.test.ts`

**Interfaces:**

Consumes:
```ts
// @/lib/money/accounts  (test only)
export async function accountBalances(db: AnyDb): Promise<AccountBalance[]>;
// @/db/schema/money
accounts.openingBalance   // numeric(12,2), not null, default '0.00'
```

Produces:
```ts
// src/lib/money/ledger-view.ts
export type RunningBalance =
  | { shown: true; openingAgorot: number; balancesAgorot: number[] }
  | { shown: false; reason: string };

export function runningBalanceAvailable(
  scope: LedgerScope, query: LedgerQuery,
): { ok: true } | { ok: false; reason: string };

export async function runningBalanceFor(
  db: AnyDb, rows: LedgerRow[], scope: LedgerScope, query: LedgerQuery,
): Promise<RunningBalance>;
```

**Steps:**

- [ ] 1. Append failing tests to `src/lib/money/ledger-view.test.ts` — both cases, shown and hidden:

```ts
import { accountBalances } from './accounts';
import { runningBalanceAvailable, runningBalanceFor } from './ledger-view';

describe('the running balance', () => {
  it('is shown for one account in date order, and closes on that account\'s balance', async () => {
    const account = await createAccount(db, {
      name: 'קופה מזומן', kind: 'cash', openingBalance: 44647,
    });
    for (const [direction, amount, on] of [
      ['out', 200, '2025-06-02'], ['in', 34646.55, '2025-07-11'], ['out', 400, '2025-08-05'],
    ] as const) {
      await recordEntry(db, {
        occurredOn: new Date(`${on}T00:00:00Z`), direction, amount,
        description: 'תנועה', accountId: account.id, recordedBy: LEAD,
      });
    }
    const scope = { accountId: account.id };
    const query = { view: 'all', sort: 'date-asc' } as const;
    expect(runningBalanceAvailable(scope, query)).toEqual({ ok: true });

    const rows = applyLedgerView(await listLedgerRows(db, scope), query);
    const balance = await runningBalanceFor(db, rows, scope, query);
    expect(balance.shown).toBe(true);
    if (!balance.shown) throw new Error('unreachable');
    expect(balance.openingAgorot).toBe(4464700);
    expect(balance.balancesAgorot).toEqual([4444700, 7909355, 7869355]);

    const derived = (await accountBalances(db))
      .find((row) => row.accountId === account.id)!;
    expect(balance.balancesAgorot.at(-1)).toBe(derived.balanceAgorot);
  });

  it('is hidden across several accounts, and says so', async () => {
    const result = runningBalanceAvailable({}, { view: 'all', sort: 'date-asc' });
    expect(result).toEqual({
      ok: false,
      reason: 'יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.',
    });
  });

  it('is hidden when the season filter is on, because a season is a label and not a period', () => {
    const result = runningBalanceAvailable(
      { accountId: 'a1', seasonId: 's1' }, { view: 'all', sort: 'date-asc' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'הסינון הפעיל מסתיר חלק מהתנועות של החשבון, ולכן יתרה רצה תהיה שגויה.',
    });
  });

  it('is hidden on a direction view and on the newest-first sort', () => {
    expect(runningBalanceAvailable({ accountId: 'a1' }, { view: 'out', sort: 'date-asc' }).ok)
      .toBe(false);
    expect(runningBalanceAvailable({ accountId: 'a1' }, { view: 'all', sort: 'date-desc' }))
      .toEqual({
        ok: false,
        reason: 'יתרה רצה מוצגת רק לפי סדר תאריכים עולה.',
      });
  });

  it('returns the reason rather than a column when it cannot be true', async () => {
    const balance = await runningBalanceFor(db, [], {}, { view: 'all', sort: 'date-asc' });
    expect(balance).toEqual({
      shown: false,
      reason: 'יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.',
    });
  });
});
```

- [ ] 2. Run `npx vitest run src/lib/money/ledger-view.test.ts`. Expected failure: `SyntaxError: The requested module './ledger-view' does not provide an export named 'runningBalanceAvailable'`.

- [ ] 3. Add to `src/lib/money/ledger-view.ts`:

```ts
import { toAgorot } from '@/lib/money';

export type RunningBalance =
  | { shown: true; openingAgorot: number; balancesAgorot: number[] }
  | { shown: false; reason: string };

/**
 * A running balance is a claim about one account: this is what it held after
 * this movement. The claim is true only when the rows on screen are all of
 * that account's movements, in the order they happened.
 *
 * The season filter is in the list of things that break it. A season is a
 * label a lead sets by hand, not a period — `חוב לירון סלע על ברן 25` is
 * dated June 2026 — so a season view hides movements that really did change
 * this account's cash, and a balance computed over what is left would be a
 * number that was never true on any day.
 *
 * The old `/money` version had neither guard: it reduced from zero over one
 * season's movements across every account at once.
 */
export function runningBalanceAvailable(
  scope: LedgerScope, query: LedgerQuery,
): { ok: true } | { ok: false; reason: string } {
  if (!scope.accountId) {
    return { ok: false, reason: 'יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.' };
  }
  if (query.sort !== 'date-asc') {
    return { ok: false, reason: 'יתרה רצה מוצגת רק לפי סדר תאריכים עולה.' };
  }
  const hides = scope.seasonId !== undefined || scope.eventId !== undefined
    || query.view !== 'all' || query.budgetLineId !== undefined
    || (query.text !== undefined && query.text.trim() !== '');
  if (hides) {
    return { ok: false, reason: 'הסינון הפעיל מסתיר חלק מהתנועות של החשבון, ולכן יתרה רצה תהיה שגויה.' };
  }
  return { ok: true };
}

/**
 * Opening balance plus every movement, in order — the same arithmetic
 * `accountBalances` does, arrived at row by row. Starting from
 * `opening_balance` rather than from zero is what makes the last value equal
 * the figure on the account card: the opening is the carry-forward the ledger
 * cannot derive, and dropping it made every balance on the old page short by
 * `44,647`.
 */
export async function runningBalanceFor(
  db: AnyDb, rows: LedgerRow[], scope: LedgerScope, query: LedgerQuery,
): Promise<RunningBalance> {
  const available = runningBalanceAvailable(scope, query);
  if (!available.ok) return { shown: false, reason: available.reason };

  const [account] = await db
    .select({ openingBalance: accounts.openingBalance })
    .from(accounts)
    .where(eq(accounts.id, scope.accountId!));
  const openingAgorot = account ? toAgorot(account.openingBalance) : 0;

  let balance = openingAgorot;
  const balancesAgorot = rows.map((row) => {
    balance += row.direction === 'in' ? row.amountAgorot : -row.amountAgorot;
    return balance;
  });
  return { shown: true, openingAgorot, balancesAgorot };
}
```

- [ ] 4. Run `npx vitest run src/lib/money/ledger-view.test.ts`, then `npx tsc --noEmit`. Both clean.

- [ ] 5. Commit: `feat(money): a running balance is shown only when it is one account in order`

---

### Task 4: `/money/ledger` renders the table

**Files:**
- Create: `src/app/(admin)/money/ledger/page.tsx`
- Create: `src/app/(admin)/money/ledger/page.test.tsx`
- Create: `src/app/(admin)/money/ledger/ledger.module.css`
- Read first: `src/app/(admin)/money/page.tsx` and `page.test.tsx` (the guard, the `force-dynamic`, and the `vi.hoisted` + `vi.mock` pattern for testing an async Server Component)

**Interfaces:**

Consumes:
```ts
// @/lib/auth/guard
export async function requireAdmin(): Promise<{ ok: true; email: string } | { ok: false }>;
// @/lib/members/roster
export async function listSeasons(db: AnyDb): Promise<Season[]>;
// @/lib/money/ledger-view
listLedgerRows, applyLedgerView, viewCounts, ledgerStrip, groupByMonth,
runningBalanceFor
// @/lib/money/accounts
export async function listAccounts(db: AnyDb): Promise<Account[]>;
// plan 01
<Money agorot={number} />, formatDate(date: Date): string
// plan 03
Table, SavedViews, FilterBar, Pill, Avatar, SourceChip, StatTile, EmptyState, Banner, Icon
```

Produces:
```ts
// src/app/(admin)/money/ledger/page.tsx
export const dynamic = 'force-dynamic';
export const metadata = { title: 'תנועות — פלטפורמת שליף' };
export default async function LedgerPage(
  { searchParams }: {
    searchParams: Promise<{
      season?: string; account?: string; view?: string; q?: string;
      budget?: string; sort?: string; new?: string;
    }>;
  },
): Promise<JSX.Element>;
```

**Steps:**

- [ ] 1. Write `src/app/(admin)/money/ledger/page.test.tsx`, mocking the library the way `money/page.test.tsx` does, with failing tests for the columns, the month headers, the source chip and the counterpart:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { LedgerRow } from '@/lib/money/ledger-view';

const { requireAdmin, listSeasons, listAccounts, listLedgerRows, runningBalanceFor } =
  vi.hoisted(() => ({
    requireAdmin: vi.fn(), listSeasons: vi.fn(), listAccounts: vi.fn(),
    listLedgerRows: vi.fn(), runningBalanceFor: vi.fn(),
  }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/money/accounts', () => ({ listAccounts }));
vi.mock('@/lib/money/ledger-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money/ledger-view')>()),
  listLedgerRows, runningBalanceFor,
}));

import LedgerPage from './page';

const SEASON = { id: 's1', name: 'ברן 26', year: 2026, flatRate: '1200.00',
                 plannedSize: 35, startsOn: null };

function row(over: Partial<LedgerRow> = {}): LedgerRow { /* …as in ledger-view.test.ts… */ }

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  listSeasons.mockResolvedValue([SEASON]);
  listAccounts.mockResolvedValue([]);
  listLedgerRows.mockResolvedValue([]);
  runningBalanceFor.mockResolvedValue({ shown: false, reason: 'אין' });
});

async function renderPage(params: Record<string, string> = {}) {
  render(await LedgerPage({ searchParams: Promise.resolve({ season: 's1', ...params }) }));
}

describe('the movements table', () => {
  it('puts every amount in its own positive column, never a signed one', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', direction: 'in', amountAgorot: 1850000, description: 'הכנסות מסיבת גיוס' }),
      row({ id: '2', direction: 'out', amountAgorot: 387500, description: 'השכרת משאית' }),
    ]);
    await renderPage();
    const incoming = screen.getByRole('row', { name: /הכנסות מסיבת גיוס/ });
    expect(within(incoming).getByText('18,500 ₪')).toBeTruthy();
    const outgoing = screen.getByRole('row', { name: /השכרת משאית/ });
    expect(within(outgoing).getByText('3,875 ₪')).toBeTruthy();
    expect(screen.queryByText(/-3,875/)).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'נכנס' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'יצא' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'מ/אל' })).toBeTruthy();
  });

  it('heads each month with its name and its count', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', occurredOn: new Date('2026-09-15T00:00:00Z') }),
      row({ id: '2', occurredOn: new Date('2026-09-08T00:00:00Z') }),
      row({ id: '3', occurredOn: new Date('2026-08-28T00:00:00Z') }),
    ]);
    await renderPage();
    expect(screen.getByText(/ספטמבר 2026/)).toBeTruthy();
    expect(screen.getByText(/אוגוסט 2026/)).toBeTruthy();
  });

  it('shows the workbook cell for a promoted row and נרשם ידנית for a typed one', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', description: 'מיובא', source: { blockId: 'b1', reference: 'סיכום כללי!A14' } }),
      row({ id: '2', description: 'ידני', source: null }),
    ]);
    await renderPage();
    expect(within(screen.getByRole('row', { name: /מיובא/ })).getByText('סיכום כללי!A14')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /ידני/ })).getByText('נרשם ידנית')).toBeTruthy();
  });

  it('names the counterpart where there is one, and shows a dash where there is none', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', origin: 'dues', description: 'דמי קאמפ — נועה לוי',
            counterpartName: 'נועה לוי', counterpartPersonId: 'p1' }),
      row({ id: '2', description: 'קניות למטבח', counterpartName: null }),
    ]);
    await renderPage();
    expect(screen.getByRole('link', { name: 'נועה לוי' })).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /קניות למטבח/ })).getByText('—')).toBeTruthy();
  });

  it('marks a movement with no account rather than leaving the cell blank', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', description: 'מים וקרח', accountId: null, accountName: null }),
    ]);
    await renderPage();
    expect(within(screen.getByRole('row', { name: /מים וקרח/ })).getByText('לא צוין')).toBeTruthy();
  });

  it('is not found for a signed-in non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow();
  });
});
```

- [ ] 2. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`. Expected failure: `Error: Failed to resolve import "./page" from "src/app/(admin)/money/ledger/page.test.tsx". Does the file exist?`

- [ ] 3. Write `src/app/(admin)/money/ledger/page.tsx` and `ledger.module.css`. The page: `requireAdmin()` then `notFound()`; resolve the season from `?season=` against `listSeasons` exactly as `money/page.tsx` does; build `scope` from `?season` and `?account`; build `query` from `?view`, `?q`, `?budget`, `?sort`, defaulting to `{ view: 'all', sort: 'date-desc' }`; call `listLedgerRows` once, then `applyLedgerView`, `viewCounts`, `ledgerStrip`, `groupByMonth` and `runningBalanceFor` over the result. Render, in the mock's order: the page head with the count sentence, `SavedViews`, `FilterBar`, the strip, the banner slot (Task 6 fills it), then the table.

  Column order, right to left: תאריך, תיאור, מ/אל, חשבון, סעיף תקציב, מקור, נכנס, יצא, [יתרה], actions. The four numeric columns follow A10 — physical `text-align: right`, `font-variant-numeric: tabular-nums` — and every amount renders through `<Money>`, always positive.

  Rules to hold while writing it:
  - a month group renders as a group row spanning the table, labelled `{label} · {count} תנועות`;
  - `accountName` null renders `<Pill tone="warn">לא צוין</Pill>`, never an empty cell;
  - `counterpartPersonId` set renders an `Avatar` and a link to `/members/{id}`; a counterpart with no person renders as text; no counterpart renders `—`;
  - `source` renders `<SourceChip reference={…} blockId={…} />`, else `<SourceChip manual />` showing `נרשם ידנית` (R11);
  - `isTransfer` adds `<Pill tone="info">העברה</Pill>` under the description;
  - the empty column for a direction renders `—` in a dimmed cell, so a reader can tell "nothing in this direction" from "no value";
  - `tfoot` carries the row count and the strip's נכנס/יצא totals (C1).

- [ ] 4. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`. All six pass.

- [ ] 5. Append failing tests for the running-balance column and the five empty states (E1, C10):

```tsx
it('shows the running balance column for one account in order', async () => {
  listLedgerRows.mockResolvedValue([row({ id: '1' })]);
  runningBalanceFor.mockResolvedValue({
    shown: true, openingAgorot: 4464700, balancesAgorot: [6314700],
  });
  await renderPage({ account: 'a1', sort: 'date-asc' });
  expect(screen.getByRole('columnheader', { name: 'יתרה' })).toBeTruthy();
  expect(screen.getByText('63,147 ₪')).toBeTruthy();
});

it('hides the column and explains itself in one line when it cannot be true', async () => {
  listLedgerRows.mockResolvedValue([row({ id: '1' })]);
  runningBalanceFor.mockResolvedValue({
    shown: false,
    reason: 'יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.',
  });
  await renderPage();
  expect(screen.queryByRole('columnheader', { name: 'יתרה' })).toBeNull();
  expect(screen.getByText('יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.'))
    .toBeTruthy();
});

it('invites an import when nothing has ever been recorded', async () => {
  await renderPage();
  expect(screen.getByText(/עדיין אין תנועות/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /ייבוא/ })).toBeTruthy();
});

it('says the season is empty rather than the camp, when another season has rows', async () => {
  listSeasons.mockResolvedValue([SEASON, { ...SEASON, id: 's0', name: 'ברן 25', year: 2025 }]);
  await renderPage();
  expect(screen.getByText(/ברן 26/)).toBeTruthy();
  expect(screen.getByText(/לבחור אותה/)).toBeTruthy();
});

it('says a filter is empty rather than the season, and offers to clear it', async () => {
  listLedgerRows.mockResolvedValue([row({ id: '1', direction: 'in' })]);
  await renderPage({ view: 'out' });
  expect(screen.getByText(/אין תנועות שמתאימות לסינון/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'ניקוי הסינון' })).toBeTruthy();
});
```
  The fifth state — "all clear" — does not belong on a ledger: an empty register is never good news. Render the fourth ("nothing you may see") through the admin guard's `notFound()` instead, which is already covered. Record both facts in a comment in the page.

- [ ] 6. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`. Expected failure: `TestingLibraryElementError: Unable to find an element with the text: יתרה רצה מוצגת רק כשבוחרים חשבון אחד…`

- [ ] 7. Add the running-balance column, its one-line explanation, and the four empty states to `page.tsx`.

- [ ] 8. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`, then `npx tsc --noEmit`. Both clean.

- [ ] 9. Commit: `feat(money): תנועות gets its own screen, with in and out as separate columns`

---

### Task 5: Saved views, the filter bar and the summary strip

**Files:**
- Modify: `src/app/(admin)/money/ledger/page.tsx`
- Modify: `src/app/(admin)/money/ledger/page.test.tsx`
- Modify: `src/app/(admin)/money/ledger/ledger.module.css`

**Interfaces:** no new exports. The controls are `<Link>`s that rewrite the search params and one GET `<form>` for the text search, so nothing on this screen is a client component (R7). Every link preserves `?season=` (R5) and the account filter.

**Steps:**

- [ ] 1. Append failing tests to `src/app/(admin)/money/ledger/page.test.tsx`:

```tsx
describe('the saved views and the strip', () => {
  const rows = [
    row({ id: '1', direction: 'in', amountAgorot: 6200000 }),
    row({ id: '2', direction: 'out', amountAgorot: 4527100 }),
    row({ id: '3', direction: 'out', amountAgorot: 120000, accountId: null, accountName: null }),
  ];

  it('offers the six views with their counts, and marks the current one', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'out' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'הכול 3', 'נכנס 1', 'יצא 2', 'בלי חשבון 1', 'מהקבצים 0', 'נרשמו ידנית 3',
    ]);
    expect(screen.getByRole('tab', { name: 'יצא 2' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the season on every view link', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'all' });
    expect(screen.getByRole('tab', { name: /בלי חשבון/ }).getAttribute('href'))
      .toBe('/money/ledger?season=s1&view=no-account');
  });

  it('recomputes the strip with the active view', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'all' });
    const strip = screen.getByRole('group', { name: 'סיכום התנועות המוצגות' });
    expect(within(strip).getByText('62,000 ₪')).toBeTruthy();
    expect(within(strip).getByText('46,471 ₪')).toBeTruthy();
    expect(within(strip).getByText('15,529 ₪')).toBeTruthy();
    expect(screen.getByText('המספרים מתעדכנים לפי הסינון הפעיל')).toBeTruthy();
  });

  it('shows the strip for the filtered set, not for everything', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'in' });
    const strip = screen.getByRole('group', { name: 'סיכום התנועות המוצגות' });
    expect(within(strip).getByText('62,000 ₪')).toBeTruthy();
    expect(within(strip).getByText('0 ₪')).toBeTruthy();
  });

  it('carries the search term back into the field so a reader can see what is filtering', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ q: 'משאית' });
    expect(screen.getByRole('searchbox', { name: 'חיפוש בתיאור או במ/אל' })
      .getAttribute('value')).toBe('משאית');
  });
});
```

- [ ] 2. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`. Expected failure: `TestingLibraryElementError: Unable to find an accessible element with the role "tab"`.

- [ ] 3. Add to `page.tsx`: a `SavedViews` strip of six `<Link>`s built from `viewCounts`, each with `role="tab"` and `aria-selected`; a `FilterBar` holding the search `<form method="get">` (with hidden inputs preserving `season`, `account` and `view`), the account chip, the budget-line chip, the sort chip and the row count; and the summary strip as a `role="group"` labelled `סיכום התנועות המוצגות` with נכנס, יצא, שינוי נטו and the sentence `המספרים מתעדכנים לפי הסינון הפעיל` (verbatim from the artboard). A helper in the page builds every href from the current params so no link drops the season.

- [ ] 4. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`, then `npx tsc --noEmit`. Both clean.

- [ ] 5. Commit: `feat(money): the movements strip counts what is on screen and nothing else`

---

### Task 6: Unattributed money, and the action that fixes it

The banner names a defect and hands the lead the repair: give the movement an account. The mock shows one combined figure; this plan shows two, because `unattributedAgorot` in `accounts.ts` already carries the finding that summing money in and money out "produced a number that was not a quantity of anything". The two sentences underneath are the ones `/money` already uses, word for word (E5).

A `קיזוז` payment never appears here — `listMovements` excludes it — but `attributeMovement` refuses one anyway, reusing `recordPayment`'s own words. The rule is a domain rule and it lives in `src/lib`, not in the action.

**Files:**
- Create: `src/lib/money/attribution.ts`
- Create: `src/lib/money/attribution.test.ts`
- Create: `src/app/(admin)/money/hebrew-error.ts`
- Create: `src/app/(admin)/money/hebrew-error.test.ts`
- Create: `src/app/(admin)/money/ledger/actions.ts`
- Create: `src/app/(admin)/money/ledger/attribute-account.tsx`
- Create: `src/app/(admin)/money/ledger/attribute-account.test.tsx`
- Modify: `src/app/(admin)/money/ledger/page.tsx`, `page.test.tsx`

**Interfaces:**

Produces:
```ts
// src/lib/money/attribution.ts
export interface AttributeInput {
  origin: 'ledger' | 'dues';
  id: string;
  accountId: string;
}
export async function attributeMovement(db: AnyDb, input: AttributeInput): Promise<void>;

// src/app/(admin)/money/hebrew-error.ts
export function hebrewError(error: unknown): string;

// src/app/(admin)/money/ledger/actions.ts
'use server';
export async function attributeMovementAction(input: AttributeInput): Promise<ActionResult>;

// src/app/(admin)/money/ledger/attribute-account.tsx  ('use client')
export function AttributeAccount(props: {
  origin: 'ledger' | 'dues';
  movementId: string;
  description: string;
  accounts: Array<{ id: string; name: string }>;
}): JSX.Element;
```

Refusals, all new and all Hebrew:
- `אין תנועה כזו`
- `אין חשבון כזה`
- `התנועה הזו כבר משויכת לחשבון` — changing an existing attribution is a different act with different consequences for two account balances, and D7 asks only for the fix to a movement that has none.
- `קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון` — verbatim from `recordPayment` in `src/lib/fees/payments.ts`.

**Steps:**

- [ ] 1. Write `src/lib/money/attribution.test.ts` with failing tests for all four refusals and both happy paths:

```ts
describe('attributing a movement to an account', () => {
  it('gives a ledger entry with no account the account it belongs to', async () => {
    const account = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    const entryId = await recordEntry(db, {
      occurredOn: new Date('2026-08-18T00:00:00Z'), direction: 'out', amount: 1200,
      description: 'מים וקרח', recordedBy: LEAD,
    });
    await attributeMovement(db, { origin: 'ledger', id: entryId, accountId: account.id });
    const [row] = await listLedgerRows(db);
    expect(row.accountName).toBe('קופה מזומן');
    expect((await accountBalances(db))[0].balanceAgorot).toBe(-120000);
  });

  it('gives a dues payment with no account the קופה that received it', async () => { /* … */ });

  it('refuses a movement that does not exist', async () => {
    await expect(attributeMovement(db, {
      origin: 'ledger', id: '00000000-0000-0000-0000-000000000000', accountId: account.id,
    })).rejects.toThrow('אין תנועה כזו');
  });

  it('refuses an account that does not exist', async () => { /* 'אין חשבון כזה' */ });

  it('refuses a movement that already names an account', async () => {
    /* 'התנועה הזו כבר משויכת לחשבון' */
  });

  it('refuses a קיזוז, because it moves no cash', async () => {
    /* recordPayment with channel 'קיזוז' and a note, then: */
    await expect(attributeMovement(db, { origin: 'dues', id: paymentId, accountId: account.id }))
      .rejects.toThrow('קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון');
  });
});
```

- [ ] 2. Run `npx vitest run src/lib/money/attribution.test.ts`. Expected failure: `Error: Failed to resolve import "./attribution" from "src/lib/money/attribution.test.ts". Does the file exist?`

- [ ] 3. Write `src/lib/money/attribution.ts`. Select the row first, refuse on each of the four conditions, then `db.update(...).set({ accountId })`. Give the module a header comment saying why the offset refusal is here at all when `listMovements` already hides offsets: the rule belongs to the money, not to the query that happens to filter it, and a second caller must hit the same wall.

- [ ] 4. Run `npx vitest run src/lib/money/attribution.test.ts`. All six pass.

- [ ] 5. Write `src/app/(admin)/money/hebrew-error.test.ts` with failing tests:

```ts
it('passes a Hebrew refusal through untouched', () => {
  expect(hebrewError(new Error('אי אפשר לקזז יותר ממה שחייבים')))
    .toBe('אי אפשר לקזז יותר ממה שחייבים');
});

it('replaces an English message with the Hebrew fallback, and logs it', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(hebrewError(new Error('a payment amount must be positive')))
    .toBe('הפעולה נכשלה. נסו שוב, ואם זה חוזר — פנו למי שמתחזק את המערכת.');
  expect(logged).toHaveBeenCalled();
});

it('replaces anything that is not an Error at all', () => {
  expect(hebrewError({ code: '23505' }))
    .toBe('הפעולה נכשלה. נסו שוב, ואם זה חוזר — פנו למי שמתחזק את המערכת.');
});
```

- [ ] 6. Run `npx vitest run "src/app/(admin)/money/hebrew-error.test.ts"`. Expected failure: `Error: Failed to resolve import "./hebrew-error"`.

- [ ] 7. Write `src/app/(admin)/money/hebrew-error.ts`:

```ts
/** U+0590–U+05FF. A refusal written for a lead is in Hebrew; anything else is
 *  a database error, a driver error or a message the library never meant for a
 *  screen, and R9 says it must not reach one. */
const HEBREW = /[֐-׿]/;
const FALLBACK = 'הפעולה נכשלה. נסו שוב, ואם זה חוזר — פנו למי שמתחזק את המערכת.';

export function hebrewError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (HEBREW.test(message)) return message;
  console.error('[money] unmapped action failure:', error);
  return FALLBACK;
}
```

- [ ] 8. Run `npx vitest run "src/app/(admin)/money/hebrew-error.test.ts"`. All three pass.

- [ ] 9. Write `src/app/(admin)/money/ledger/actions.ts` — `'use server'`, `requireAdmin()` then `{ ok: false, error: 'אין הרשאה' }`, the call to `attributeMovement(db, input)`, `hebrewError` in the catch, `revalidatePath('/money/ledger')` and `revalidatePath('/money')` on success. Model it on `src/app/(admin)/fees/actions.ts`.

- [ ] 10. Write `src/app/(admin)/money/ledger/attribute-account.test.tsx` with failing tests — the control renders a select of accounts, refuses to submit with none chosen, and shows the action's Hebrew error — then write `attribute-account.tsx` as a client component (its comment: it is a client component because it holds an unsubmitted select and renders the action's refusal in place, which a Server Component cannot do). Model it on `src/app/(admin)/fees/exception-form.tsx`. Run the test file at each end of the cycle.

- [ ] 11. Append the banner test to `src/app/(admin)/money/ledger/page.test.tsx`:

```tsx
it('names unattributed money in both directions, never as one sum', async () => {
  listLedgerRows.mockResolvedValue([
    row({ id: '1', direction: 'in', amountAgorot: 120000, accountId: null, accountName: null }),
    row({ id: '2', direction: 'out', amountAgorot: 120000, accountId: null, accountName: null }),
  ]);
  await renderPage();
  const banner = screen.getByRole('status', { name: /בלי לציין חשבון/ });
  expect(within(banner).getByText(/2 תנועות נרשמו בלי לציין חשבון/)).toBeTruthy();
  expect(within(banner).getByText('עד שישויכו הן לא נספרות ביתרה של אף קופה.')).toBeTruthy();
  expect(within(banner).getByText(/נרשמו בלי לציין לאיזה חשבון נכנסו/)).toBeTruthy();
  expect(within(banner).getByText(/נרשמו בלי לציין מאיזה חשבון יצאו/)).toBeTruthy();
  expect(within(banner).queryByText('2,400 ₪')).toBeNull();
  expect(within(banner).getByRole('link', { name: 'שיוך לחשבון' }).getAttribute('href'))
    .toBe('/money/ledger?season=s1&view=no-account');
});

it('offers the fix on the row itself in the בלי חשבון view', async () => {
  listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
  listLedgerRows.mockResolvedValue([
    row({ id: '1', description: 'מים וקרח', accountId: null, accountName: null }),
  ]);
  await renderPage({ view: 'no-account' });
  expect(screen.getByRole('combobox', { name: 'שיוך מים וקרח לחשבון' })).toBeTruthy();
});

it('says nothing at all when every movement names its account', async () => {
  listLedgerRows.mockResolvedValue([row({ id: '1' })]);
  await renderPage();
  expect(screen.queryByRole('status', { name: /בלי לציין חשבון/ })).toBeNull();
});
```

- [ ] 12. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`. Expected failure: `TestingLibraryElementError: Unable to find an accessible element with the role "status"`.

- [ ] 13. Add the banner to `page.tsx`, computed as `ledgerStrip(applyLedgerView(rows, { view: 'no-account', sort }))`, and render `<AttributeAccount>` in the action column of any row whose `accountId` is null.

- [ ] 14. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx" "src/app/(admin)/money/ledger/attribute-account.test.tsx" src/lib/money/attribution.test.ts`, then `npx tsc --noEmit`. All clean.

- [ ] 15. Commit: `feat(money): money with no account says so, and can be given one from the row`

---

### Task 7: The debts view — both directions, dateless last, nameless always

`listObligations` already returns most of a debt row and already orders `asc nulls last`. Two things are missing for D8: `openedOn` never leaves the module, so a screen cannot tell a dateless debt from a dated one; and a season-scoped call drops every nameless obligation, because the workbook rows that have no party also have no season and `season_id = $1` never matches NULL. `summary.ts` already documents that trap and works around it with a second camp-wide query; this module does the same, and says so on screen.

**Files:**
- Modify: `src/lib/money/obligations.ts` (add `openedOn` to `ObligationRow`)
- Modify: `src/lib/money/obligations.test.ts`
- Create: `src/lib/money/debts-view.ts`
- Create: `src/lib/money/debts-view.test.ts`

**Interfaces:**

Consumes:
```ts
// @/lib/money/obligations
export async function listObligations(
  db: AnyDb, filter?: { direction?: ObligationDirection; seasonId?: string },
): Promise<ObligationRow[]>;
export async function unnamedObligations(db: AnyDb): Promise<ObligationRow[]>;
```

Produces:
```ts
// src/lib/money/obligations.ts — one added field
export interface ObligationRow {
  /* …unchanged… */
  /** `null` means the workbook does not say when this debt opened. */
  openedOn: Date | null;
}

// src/lib/money/debts-view.ts
export type DebtView = 'camp_owes' | 'owed_to_camp' | 'settled';

export interface DebtRow extends ObligationRow {
  /** `openedOn === null`. Rendered as `בגיליון אין תאריך לחוב הזה`, sorted last. */
  dateless: boolean;
  source: { blockId: string; reference: string } | null;
}

export interface DebtTotals {
  campOwesAgorot: number; campOwesCount: number;
  owedToCampAgorot: number; owedToCampCount: number;
  settledCount: number;
  unnamedAgorot: number; unnamedCount: number;
  offsetAgorot: number; offsetCount: number;
}

export async function listDebts(
  db: AnyDb, filter?: { seasonId?: string },
): Promise<DebtRow[]>;
export function applyDebtView(rows: DebtRow[], view: DebtView): DebtRow[];
export function debtTotals(rows: DebtRow[]): DebtTotals;
```

**Steps:**

- [ ] 1. Append a failing test to `src/lib/money/obligations.test.ts`:

```ts
it('carries the date the debt opened, and null when the workbook does not say', async () => {
  await createObligation(db, {
    direction: 'camp_owes', partyName: 'אורי', description: 'החזר',
    amount: 300, openedOn: new Date('2026-07-02T00:00:00Z'),
  });
  await createObligation(db, {
    direction: 'camp_owes', partyName: 'תמר גולן', description: 'החזר על מקררים',
    amount: 180, openedOn: null,
  });
  const rows = await listObligations(db, { direction: 'camp_owes' });
  expect(rows[0].openedOn?.toISOString()).toBe('2026-07-02T00:00:00.000Z');
  expect(rows[1].openedOn).toBeNull();
});
```

- [ ] 2. Run `npx vitest run src/lib/money/obligations.test.ts`. Expected failure: `TypeError: rows[0].openedOn?.toISOString is not a function` — the property is absent, so the optional chain yields `undefined`.

- [ ] 3. Add `openedOn: obligation.openedOn,` to the object `listObligations` returns, and `openedOn: Date | null;` to `ObligationRow`, with the comment `/** null means the workbook does not say when this debt opened. */`.

- [ ] 4. Run `npx vitest run src/lib/money/obligations.test.ts`. Every test passes, including the existing ones.

- [ ] 5. Write `src/lib/money/debts-view.test.ts` with failing tests:

```ts
describe('the debts view', () => {
  it('shows a dateless debt as dateless and sorts it last', async () => {
    await createObligation(db, { direction: 'camp_owes', partyName: 'תמר גולן',
      description: 'החזר על מקררים', amount: 180, openedOn: null });
    await createObligation(db, { direction: 'camp_owes', partyName: 'רוני אדלר',
      description: 'מקדמה לגנרטור', amount: 15240,
      openedOn: new Date('2026-07-02T00:00:00Z') });
    const rows = await listDebts(db);
    expect(rows.map((r) => r.description)).toEqual(['מקדמה לגנרטור', 'החזר על מקררים']);
    expect(rows.map((r) => r.dateless)).toEqual([false, true]);
  });

  it('keeps a nameless debt in a season view, because it belongs to no season', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    await createObligation(db, { direction: 'camp_owes', description: 'שולם 500 — מקפיא באיחסון נוסף',
      amount: 500, openedOn: null });
    await createObligation(db, { direction: 'camp_owes', partyName: 'אורי', description: 'החזר',
      amount: 300, seasonId: season.id, openedOn: new Date('2026-07-02T00:00:00Z') });
    const rows = await listDebts(db, { seasonId: season.id });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.unnamed)).toHaveLength(1);
  });

  it('never lists the same debt twice when it is both nameless and in the season', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    await createObligation(db, { direction: 'camp_owes', description: 'שולם 400 — דולב זבל במחסן',
      amount: 400, seasonId: season.id, openedOn: null });
    expect(await listDebts(db, { seasonId: season.id })).toHaveLength(1);
  });

  it('carries the workbook cell a debt came from', async () => { /* seeded block, expect reference */ });

  it('totals each direction separately and never nets them against each other', async () => {
    /* camp_owes 15,240 settled 14,330 → outstanding 910; owed_to_camp 2,350 */
    const totals = debtTotals(await listDebts(db));
    expect(totals.campOwesAgorot).toBe(91000);
    expect(totals.owedToCampAgorot).toBe(235000);
    expect(totals.campOwesCount).toBe(1);
    expect(totals.owedToCampCount).toBe(1);
  });

  it('counts what was closed by offset, which moved no cash', async () => {
    /* one offset settlement of 6,000 with a note */
    const totals = debtTotals(await listDebts(db));
    expect(totals.offsetAgorot).toBe(600000);
    expect(totals.offsetCount).toBe(1);
  });

  it('splits open from settled', async () => {
    const rows = await listDebts(db);
    expect(applyDebtView(rows, 'camp_owes').every((r) => !r.settled)).toBe(true);
    expect(applyDebtView(rows, 'settled').every((r) => r.settled)).toBe(true);
  });
});
```

- [ ] 6. Run `npx vitest run src/lib/money/debts-view.test.ts`. Expected failure: `Error: Failed to resolve import "./debts-view" from "src/lib/money/debts-view.test.ts". Does the file exist?`

- [ ] 7. Write `src/lib/money/debts-view.ts`. `listDebts` calls `listObligations(db, { seasonId })` and, when a season is given, `unnamedObligations(db)` as well, merging by id with a `Map` so a nameless debt that does carry the season appears once. It then re-sorts the merged array dated-ascending with dateless last (the merge can disturb `listObligations`'s own ordering), attaches `dateless` and the batched `source` from `blockRefs`, and returns. `applyDebtView` filters: `camp_owes` and `owed_to_camp` are the open rows of that direction; `settled` is every settled row in both directions. `debtTotals` sums `outstandingAgorot` per direction — never `amountAgorot`, or a partly settled debt reads as though nothing had been paid against it — and walks `settlements` for the offset figures.

  Give `listDebts` a header comment stating the season trap in full: a nameless obligation carries no season, `season_id = $1` never matches NULL, and a season-scoped query alone would make `שולם 500 — מקפיא באיחסון נוסף` appear on no page at all — which is the exact disappearance req 19 exists to prevent.

- [ ] 8. Run `npx vitest run src/lib/money/debts-view.test.ts src/lib/money/obligations.test.ts src/lib/money/closures.test.ts`, then `npx tsc --noEmit`. All clean — `closures.test.ts` is in the list because it pins `חוב יוסף` and the twelve reimbursements through `listObligations`, and this task touched it.

- [ ] 9. Commit: `feat(money): a debt knows whether the workbook gave it a date, and a nameless one shows in every season`

---

### Task 8: `/money/debts` renders both directions

**Files:**
- Create: `src/app/(admin)/money/debts/page.tsx`
- Create: `src/app/(admin)/money/debts/page.test.tsx`
- Create: `src/app/(admin)/money/debts/debts.module.css`

**Interfaces:**

Produces:
```ts
export const dynamic = 'force-dynamic';
export const metadata = { title: 'חובות — פלטפורמת שליף' };
export default async function DebtsPage(
  { searchParams }: {
    searchParams: Promise<{ season?: string; view?: string; settle?: string }>;
  },
): Promise<JSX.Element>;
```

Copy, fixed here:
- The lead: `מה הקאמפ חייב, ומה חייבים לו. חוב נסגר במזומן או בקיזוז מול דמי קאמפ.`
- Tiles: `אנחנו חייבים`, `חייבים לנו`, `נסגר בקיזוז`, the third with the derivation `לא עברו דרך אף קופה`.
- The nameless banner: `<n> חובות בלי שם — <sum> ₪.` then, verbatim from today's `/money`, `אי אפשר לסגור אותם עד שיירשם למי מגיע הכסף.` then `חובות בלי שם מוצגים בכל השנים — הם שייכים לקאמפ, לא לשנה מסוימת.` (R5's requirement that camp-wide data says so).
- A dateless cell: `בגיליון אין תאריך לחוב הזה` — verbatim from the promoter's note.
- A nameless party cell: `<Pill tone="bad">חסר שם</Pill>` and, as the disabled button's description, `אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף` — verbatim from `settleObligation`.

**Steps:**

- [ ] 1. Write `src/app/(admin)/money/debts/page.test.tsx` mocking `@/lib/money/debts-view`, with failing tests:

```tsx
it('heads each direction with its own subtotal and never nets the two', async () => {
  listDebts.mockResolvedValue([
    debt({ id: '1', direction: 'camp_owes', amountAgorot: 1524000,
           settledAgorot: 1433000, outstandingAgorot: 91000, displayParty: 'רוני אדלר' }),
    debt({ id: '2', direction: 'owed_to_camp', amountAgorot: 235000,
           outstandingAgorot: 235000, displayParty: 'מאיה פרץ' }),
  ]);
  await renderPage();
  expect(within(screen.getByRole('group', { name: 'אנחנו חייבים' })).getByText('910 ₪')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'חייבים לנו' })).getByText('2,350 ₪')).toBeTruthy();
  expect(screen.queryByText(/-/)).toBeNull();
});

it('shows how much of a debt has been settled, as a meter and as words', async () => {
  listDebts.mockResolvedValue([debt({ id: '1', amountAgorot: 1524000,
    settledAgorot: 1433000, outstandingAgorot: 91000 })]);
  await renderPage();
  expect(screen.getByText('14,330 מתוך 15,240')).toBeTruthy();
});

it('says a dateless debt has no date, and puts it last', async () => {
  listDebts.mockResolvedValue([
    debt({ id: '1', description: 'מקדמה לגנרטור', dateless: false,
           openedOn: new Date('2026-07-02T00:00:00Z') }),
    debt({ id: '2', description: 'החזר על מקררים', dateless: true, openedOn: null }),
  ]);
  await renderPage();
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows.at(-1)!.textContent).toContain('החזר על מקררים');
  expect(screen.getByText('בגיליון אין תאריך לחוב הזה')).toBeTruthy();
});

it('cannot settle a nameless debt, and says why on the button itself', async () => {
  listDebts.mockResolvedValue([debt({ id: '1', unnamed: true, displayParty: null,
    description: 'שולם 500 — מקפיא באיחסון נוסף', amountAgorot: 50000,
    outstandingAgorot: 50000, source: { blockId: 'b1', reference: 'סיכום כללי!D44' } })]);
  await renderPage();
  const button = screen.getByRole('button', { name: 'סגירה' });
  expect(button.hasAttribute('disabled')).toBe(true);
  const described = document.getElementById(button.getAttribute('aria-describedby')!);
  expect(described!.textContent).toBe('אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף');
});

it('offers no way to dismiss a nameless debt, and keeps its source cell', async () => {
  listDebts.mockResolvedValue([debt({ id: '1', unnamed: true, displayParty: null,
    source: { blockId: 'b1', reference: 'סיכום כללי!D44' } })]);
  await renderPage();
  expect(screen.queryByRole('button', { name: /התעלמות|הסרה|מחיקה/ })).toBeNull();
  expect(screen.getByText('סיכום כללי!D44')).toBeTruthy();
});

it('says nameless debts belong to no season, and shows them anyway', async () => {
  listDebts.mockResolvedValue([debt({ id: '1', unnamed: true, displayParty: null,
    amountAgorot: 54000, outstandingAgorot: 54000, seasonId: null })]);
  await renderPage();
  const banner = screen.getByRole('status', { name: /בלי שם/ });
  expect(within(banner).getByText('אי אפשר לסגור אותם עד שיירשם למי מגיע הכסף.')).toBeTruthy();
  expect(within(banner).getByText(/מוצגים בכל השנים/)).toBeTruthy();
});
```

- [ ] 2. Run `npx vitest run "src/app/(admin)/money/debts/page.test.tsx"`. Expected failure: `Error: Failed to resolve import "./page" from "src/app/(admin)/money/debts/page.test.tsx". Does the file exist?`

- [ ] 3. Write `page.tsx` and `debts.module.css`: guard, season resolution, `listDebts`, `debtTotals`, the three tiles, the nameless banner, the direction segmented control with counts (`אנחנו חייבים`/`חייבים לנו`/`נסגרו` as `<Link>`s, `aria-pressed`), and the table — columns למי, על מה, מתי, סכום, קוזז עד כה, נותר, מקור, actions. Each direction's table is a `role="group"` with the direction as its accessible name and a `tfoot` carrying that direction's subtotal only. Settle is a link to `?settle=<id>` for a named debt and a `disabled` `<button>` with `aria-describedby` for a nameless one. No dismiss control exists anywhere in the file. All five empty states per E1, with `נסגרו` as the one place C10's "all clear" is honest.

- [ ] 4. Run `npx vitest run "src/app/(admin)/money/debts/page.test.tsx"`. All six pass.

- [ ] 5. Run `npx tsc --noEmit`. Clean.

- [ ] 6. Commit: `feat(money): חובות gets its own screen, and a debt with no name keeps its place on it`

---

### Task 9: The settlement drawer — cash or קיזוז

`settleObligation` and its three refusals have existed since Wave 1 with no user interface at all. This task gives them one.

**Ruling (binding): a cash settlement writes a ledger entry; an offset writes nothing but the settlement.** A `camp_owes` debt settled in cash means money left a קופה, so the drawer requires an account and records an `out` entry (an `owed_to_camp` debt settled in cash records an `in`); the settlement then points at that entry through `ledgerEntryId`. An offset moves no cash, so it touches no account, writes no entry and appears nowhere in the ledger — and the drawer says exactly that, beside the choice, where the lead is deciding.

The two writes of a cash settlement are sequential awaits, not one transaction — the same compromise `recordTransfer` documents and for the same reason. The action reduces the window by calling `checkSettlement` first, so every refusal the lead can trigger fires before anything is written. A database failure between the two leaves a ledger entry with no settlement attached: visible on `/money/ledger` as a plain movement, not a silent loss. The reverse order would leave a debt marked settled with no trace of the cash, which is worse.

**Files:**
- Modify: `src/lib/money/obligations.ts` (extract `checkSettlement`)
- Modify: `src/lib/money/obligations.test.ts`
- Create: `src/app/(admin)/money/debts/actions.ts`
- Create: `src/app/(admin)/money/debts/settle-form.tsx`
- Create: `src/app/(admin)/money/debts/settle-form.test.tsx`
- Modify: `src/app/(admin)/money/debts/page.tsx`, `page.test.tsx`

**Interfaces:**

Produces:
```ts
// src/lib/money/obligations.ts
/** Every refusal `settleObligation` makes, without writing anything. */
export async function checkSettlement(db: AnyDb, input: NewSettlement): Promise<void>;

// src/app/(admin)/money/debts/actions.ts
'use server';
export async function settleObligationAction(input: {
  obligationId: string;
  amount: number;
  kind: 'cash' | 'offset';
  /** Required on cash, refused on offset. */
  accountId?: string;
  /** Required on offset. */
  note?: string;
  settledOn: string;
}): Promise<ActionResult>;

// src/app/(admin)/money/debts/settle-form.tsx  ('use client')
export function SettleForm(props: {
  obligationId: string;
  direction: ObligationDirection;
  displayParty: string;
  outstandingAgorot: number;
  accounts: Array<{ id: string; name: string }>;
}): JSX.Element;
```

Refusals reused verbatim: `אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף`, `אי אפשר לקזז יותר ממה שחייבים`, `קיזוז חייב לשאת הערה שאומרת מול מה קוזז`, `סכום קיזוז חייב להיות חיובי`. One new refusal, for the cash path: `סגירה במזומן חייבת לציין מאיזה חשבון יצא הכסף`.

On-screen copy, verbatim from the artboard: the amount hint `אי אפשר לקזז יותר ממה שחייבים`, the note hint `חובה — בלי זה אי אפשר לדעת בעוד שנה מה קרה כאן`, the segmented options `מזומן` / `קיזוז מול דמי קאמפ`, and the standing statement `קיזוז אינו מזיז מזומן, ולכן אינו נכנס לאף חשבון ואינו מופיע בתנועות.`

**Steps:**

- [ ] 1. Append a failing test to `src/lib/money/obligations.test.ts`:

```ts
describe('checkSettlement', () => {
  it('makes every refusal settleObligation makes, and writes nothing', async () => {
    const id = await createObligation(db, { direction: 'camp_owes', description: 'שולם 500',
      amount: 500, openedOn: null });
    await expect(checkSettlement(db, { obligationId: id, amount: 100, kind: 'cash',
      settledOn: new Date(), recordedBy: LEAD }))
      .rejects.toThrow('אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף');

    const named = await createObligation(db, { direction: 'camp_owes', partyName: 'אורי',
      description: 'החזר', amount: 300, openedOn: null });
    await expect(checkSettlement(db, { obligationId: named, amount: 400, kind: 'cash',
      settledOn: new Date(), recordedBy: LEAD }))
      .rejects.toThrow('אי אפשר לקזז יותר ממה שחייבים');
    await expect(checkSettlement(db, { obligationId: named, amount: 100, kind: 'offset',
      settledOn: new Date(), recordedBy: LEAD }))
      .rejects.toThrow('קיזוז חייב לשאת הערה שאומרת מול מה קוזז');

    await checkSettlement(db, { obligationId: named, amount: 100, kind: 'cash',
      settledOn: new Date(), recordedBy: LEAD });
    const [row] = await listObligations(db, { direction: 'camp_owes' });
    expect(row.settlements).toHaveLength(0);
  });
});
```

- [ ] 2. Run `npx vitest run src/lib/money/obligations.test.ts`. Expected failure: `SyntaxError: The requested module './obligations' does not provide an export named 'checkSettlement'`.

- [ ] 3. Extract the four guards out of `settleObligation` into `checkSettlement`, and make `settleObligation`'s first line `await checkSettlement(db, input);`. Move the existing comments with the guards they explain — the `isBlank` reasoning and the unnamed-obligation paragraph belong to the checks, not to the insert.

- [ ] 4. Run `npx vitest run src/lib/money/obligations.test.ts`. Every test passes, the existing ones unchanged.

- [ ] 5. Write `src/app/(admin)/money/debts/actions.ts` with its own failing test file first — `src/app/(admin)/money/debts/actions.test.ts`, mocking `@/db`, `@/lib/auth/guard` and the two library modules — asserting: an offset with no note returns `{ ok: false, error: 'קיזוז חייב לשאת הערה שאומרת מול מה קוזז' }`; an offset never calls `recordEntry`; a cash settlement with no account returns `סגירה במזומן חייבת לציין מאיזה חשבון יצא הכסף` and calls neither library function; a cash settlement on a `camp_owes` debt calls `recordEntry` with `direction: 'out'` and then `settleObligation` with that entry's id; the same on `owed_to_camp` records `direction: 'in'`; a thrown English error is replaced by the Hebrew fallback.

- [ ] 6. Run `npx vitest run "src/app/(admin)/money/debts/actions.test.ts"`. Expected failure: `Error: Failed to resolve import "./actions"`.

- [ ] 7. Write `actions.ts`: `requireAdmin()`; `checkSettlement` first; on `offset`, refuse an `accountId` outright and call `settleObligation` alone; on `cash`, require the account, `recordEntry` with the direction derived from the obligation's own direction and the description `סגירת חוב — {displayParty}`, carrying the obligation's `seasonId` (hand-set, carried over, never inferred from today's date), then `settleObligation` with `ledgerEntryId`. `hebrewError` in the catch; `revalidatePath` for `/money/debts`, `/money/ledger` and `/money`.

- [ ] 8. Run `npx vitest run "src/app/(admin)/money/debts/actions.test.ts"`. All six pass.

- [ ] 9. Write `src/app/(admin)/money/debts/settle-form.test.tsx` with failing tests: the segmented control offers both kinds; choosing קיזוז shows `קיזוז אינו מזיז מזומן, ולכן אינו נכנס לאף חשבון ואינו מופיע בתנועות.` and hides the account select; choosing מזומן shows the account select and hides the note requirement; submitting an offset with a blank note (a single RLM character, to pin `isBlank` rather than `.trim()`) does not call the action and shows `קיזוז חייב לשאת הערה שאומרת מול מה קוזז`; the amount field defaults to the outstanding balance and carries the hint `אי אפשר לקזז יותר ממה שחייבים`; the action's refusal renders in `role="alert"`.

- [ ] 10. Run `npx vitest run "src/app/(admin)/money/debts/settle-form.test.tsx"`. Expected failure: `Error: Failed to resolve import "./settle-form"`.

- [ ] 11. Write `settle-form.tsx` as a client component, modelled on `exception-form.tsx`. Its comment: it is a client component because the choice between cash and קיזוז changes which fields are required and which sentence is true, and that has to happen before submit — the statement that an offset moves no cash has to be visible while the lead is choosing, not after.

- [ ] 12. Run `npx vitest run "src/app/(admin)/money/debts/settle-form.test.tsx"`. All pass.

- [ ] 13. Append a failing test to `src/app/(admin)/money/debts/page.test.tsx`: `?settle=<id>` renders the drawer with the debt's description, date, source cell and meter, and the form; `?settle=` on a nameless debt's id renders the refusal instead of the form; `?settle=` on an unknown id renders the page without a drawer and without throwing.

- [ ] 14. Run `npx vitest run "src/app/(admin)/money/debts/page.test.tsx"`. Expected failure: `TestingLibraryElementError: Unable to find an accessible element with the role "dialog"`.

- [ ] 15. Render the `Drawer` from `?settle=` in `page.tsx` (R6), server-side, with `SettleForm` inside it and `listAccounts` for the account select.

- [ ] 16. Run `npx vitest run "src/app/(admin)/money/debts" src/lib/money/obligations.test.ts src/lib/money/closures.test.ts`, then `npx tsc --noEmit`. All clean.

- [ ] 17. Commit: `feat(money): a debt can finally be closed from the screen, in cash or by offset`

---

### Task 10: Recording a movement by hand

**Decision (binding): recording a plain movement is in scope; recording a transfer is not.**

In scope, because the ledger is unreadable as a register if it can only be written by importing a workbook. `/imports` promotes what a sheet already says and `/fees` records dues; every other shekel the camp handles after the last import would be invisible until someone edits a spreadsheet. R11 also assumes such rows already: "one typed by a lead shows `נרשם ידנית`" is a display state that no screen could ever produce without this form, and Task 6's fix — giving a movement an account — repairs rows this form will create. The artboard carries `תנועה חדשה` in its page head.

Out of scope, the `העברה בין חשבונות` button beside it: the spec's out-of-scope list names transfers explicitly ("writing money rows the model supports but no screen offers yet (accounts, transfers, seasons, events) beyond what D5–D8 name"), and D7's sentence does not name them. A transfer is a two-account form with its own refusal (`אי אפשר להעביר לאותו חשבון`) and its own group-id semantics that no requirement here asks for. The artboard's `ייצוא` button is out of scope for the same reason — no requirement in D7 asks for an export. Neither button is rendered; a disabled button that does nothing is worse than an absent one.

**Files:**
- Create: `src/app/(admin)/money/ledger/new-movement-form.tsx`
- Create: `src/app/(admin)/money/ledger/new-movement-form.test.tsx`
- Modify: `src/app/(admin)/money/ledger/actions.ts` (+ its test file)
- Modify: `src/app/(admin)/money/ledger/page.tsx`, `page.test.tsx`

**Interfaces:**

Consumes:
```ts
// @/lib/money/ledger
export async function recordEntry(db: AnyDb, input: NewEntry): Promise<string>;
// refusals, verbatim:
//   'סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן'
//   'לתנועה חייב להיות תיאור'
```

Produces:
```ts
// src/app/(admin)/money/ledger/actions.ts
export async function recordMovementAction(input: {
  occurredOn: string;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  accountId?: string;
  seasonId?: string;
  budgetLineId?: string;
}): Promise<ActionResult>;

// src/app/(admin)/money/ledger/new-movement-form.tsx  ('use client')
export function NewMovementForm(props: {
  seasonId: string | null;
  seasons: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  budgetLines: Array<{ id: string; label: string }>;
}): JSX.Element;
```

**Steps:**

- [ ] 1. Append failing tests to `src/app/(admin)/money/ledger/actions.test.ts`: the action passes `recordedBy` from `requireAdmin`'s email, never from the client; a zero amount returns `{ ok: false, error: 'סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן' }`; a blank description returns `לתנועה חייב להיות תיאור`; an omitted account is passed through as undefined rather than defaulted, so the row lands in the unattributed banner rather than in a guessed קופה; the season is whatever the form sent and is never derived from `occurredOn`.

- [ ] 2. Run `npx vitest run "src/app/(admin)/money/ledger/actions.test.ts"`. Expected failure: `TypeError: recordMovementAction is not a function`.

- [ ] 3. Add `recordMovementAction` to `actions.ts`.

- [ ] 4. Run `npx vitest run "src/app/(admin)/money/ledger/actions.test.ts"`. All pass.

- [ ] 5. Write `src/app/(admin)/money/ledger/new-movement-form.test.tsx` with failing tests: the direction is a segmented control labelled `נכנס`/`יצא` and there is no sign anywhere in the form; the amount field has `min="0"` and rejects a negative before submit with the library's own sentence; a blank description (a single RLM) does not submit; the account select carries the option `לא צוין` with the hint `תנועה בלי חשבון לא נספרת ביתרה של אף קופה, ותופיע בהתראה למעלה`; the season select defaults to the page's season, offers `ללא שנה`, and carries the hint `השנה נקבעת ביד, לא לפי התאריך`.

- [ ] 6. Run `npx vitest run "src/app/(admin)/money/ledger/new-movement-form.test.tsx"`. Expected failure: `Error: Failed to resolve import "./new-movement-form"`.

- [ ] 7. Write `new-movement-form.tsx`. Its client-component comment: the direction choice and the account choice each change what the rest of the form means, and both refusals have to fire before a write.

- [ ] 8. Run `npx vitest run "src/app/(admin)/money/ledger/new-movement-form.test.tsx"`. All pass.

- [ ] 9. Append a failing test to `page.test.tsx`: the page head carries `תנועה חדשה` linking to `?new=movement&season=s1`; `?new=movement` renders the drawer with the form; the head carries neither `העברה בין חשבונות` nor `ייצוא`.

- [ ] 10. Run `npx vitest run "src/app/(admin)/money/ledger/page.test.tsx"`. Expected failure: `TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "תנועה חדשה"`.

- [ ] 11. Add the action and the `?new=movement` drawer to `page.tsx`, with a comment recording the two deliberate absences and their reason.

- [ ] 12. Run `npx vitest run "src/app/(admin)/money" src/lib/money`, then `npx tsc --noEmit`. All clean.

- [ ] 13. Commit: `feat(money): a movement can be recorded by hand, and a transfer still cannot`

---

## Self-review

Run before calling this plan done.

**D7 — תנועות**
- [ ] `/money/ledger` exists, is admin-guarded, sets its own title, and reads no file from disk.
- [ ] נכנס and יצא are separate columns and every amount in both is positive. No cell anywhere renders a minus sign for a movement.
- [ ] The מ/אל column names the dues payer and the other leg of a transfer, and renders `—` where the model knows of no counterpart rather than parsing one out of a description.
- [ ] Month group headers carry the Hebrew month, the year and the count, from a literal month table rather than ICU.
- [ ] Every row carries its source: a cell reference, or `נרשם ידנית`.
- [ ] The summary strip's נכנס, יצא and שינוי נטו are a reduce over the rows on screen, and a test proves two views produce two different strips.
- [ ] The running balance appears only for one account, date-ascending, with no row-removing filter — season included — and its last value equals `accountBalances`'s figure for that account. Both the shown and the hidden case are tested, and the hidden case renders one sentence saying which condition failed.
- [ ] The unattributed banner reports a count and two directional figures, never one sum, and its two sentences are the ones `/money` already used. Its action reaches the rows, and each such row carries the account select that fixes it.
- [ ] Six saved views with counts; no `+` that cannot save.

**D8 — חובות**
- [ ] `/money/debts` exists, is admin-guarded, and sets its own title.
- [ ] Both directions have their own subtotal, computed from `outstandingAgorot`, and the two are never netted.
- [ ] Every open debt shows a settlement meter and its source cell.
- [ ] A dateless debt says `בגיליון אין תאריך לחוב הזה` and sorts last.
- [ ] A nameless debt: settle is disabled and describes itself with `settleObligation`'s own sentence; no dismiss control exists in the file; the source cell is present; it appears whatever season is selected, and the screen says why.
- [ ] The drawer is a URL, survives a refresh, and offers cash or קיזוז.
- [ ] The three library refusals reach the screen unchanged, character for character.
- [ ] An offset writes no ledger entry and touches no account — proven by a test that compares `listLedgerRows` before and after.
- [ ] The sentence `קיזוז אינו מזיז מזומן, ולכן אינו נכנס לאף חשבון ואינו מופיע בתנועות.` is visible while the lead is choosing, not after.

**Decisions to confirm are recorded in the code, not only here**
- [ ] `ledger-view.ts` says why it builds on `listMovements` instead of beside it.
- [ ] `ledger-view.ts` says why the season filter disqualifies a running balance.
- [ ] `debts-view.ts` says why a nameless obligation needs a second, camp-wide query.
- [ ] `actions.ts` says why a cash settlement writes the entry before the settlement.
- [ ] `page.tsx` on the ledger says why `העברה בין חשבונות` and `ייצוא` are absent.
- [ ] Each of the four client components says why it is one.

**Cross-cutting**
- [ ] `npx tsc --noEmit` is clean.
- [ ] `npx vitest run` is green end to end, including `src/lib/money/closures.test.ts`, which pins the camp's own arithmetic through the two modules this plan edited.
- [ ] `src/app/admin-guard.test.ts` still passes with four new files under `src/app/(admin)`.
- [ ] No string with a Latin letter can reach either screen: every action routes failures through `hebrewError`.
- [ ] No new dependency in `package.json`.
- [ ] `src/app/(admin)/money/page.tsx`, `src/lib/money/ledger.ts`, `accounts.ts`, `summary.ts` and `trace.ts` are unchanged by this plan's diff.
- [ ] Both screens read at 390px wide without horizontal page scroll (D11's "the rest degrade to readable lists").
