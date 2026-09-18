# Money & Ledger — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the camp a single place that answers "how much money do we have, where is it, what is owed in both directions, and how do dues and fundraising add up to the budget" — derived from database rows, never typed in.

**Architecture:** Seven additive tables plus two columns. `ledger_entries` holds every movement that is not a dues payment; `payments` gains a nullable `account_id` and is read alongside it by a union in one module, so no row is ever dual-written. Obligations are debts in either direction, discharged by settlements that point at either a ledger entry (cash) or a payment (offset). A new admin section at `/money` renders it with hand-rolled SVG charts.

**Tech Stack:** Next.js 16 (App Router, React 19 server components), Drizzle ORM on Postgres, PGlite for tests, vitest, CSS Modules. No chart library — SVG by hand.

**Spec:** `docs/superpowers/specs/2026-09-12-camp-money-and-data-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **Never guess.** Where the system is unsure it surfaces the uncertainty rather than resolving it. An unattributed amount is displayed, not assigned.
- **Money is `numeric(12,2)` in Postgres and integer agorot in JS.** `src/lib/money.ts` (`toAgorot`, `fromAgorot`, `sumAgorot`, `formatILS`) is the only converter. Never do float arithmetic on money.
- **Blankness checks on user input use `isBlank` from `@/lib/text/normalize`, never `.trim()`.** `.trim()` leaves invisible directional marks standing, and an RTL browser injects those on copy-paste.
- **Hebrew RTL throughout.** CSS logical properties only — `margin-inline`, `padding-block`, `border-inline-start/end`, `text-align: start/end`. Never `left`/`right`. Wrap Latin, numeric and mixed-direction runs in `<bdi>`. All UI copy in Hebrew.
- **SVG has no logical properties.** Chart geometry takes an explicit `direction` parameter; `text-anchor="start"` is wrong in Hebrew.
- **Admin-only.** Every page and server action calls `requireAdmin()` and returns `notFound()` when it fails. UI hiding is never the enforcement.
- **`@/db` throws at import time without `DATABASE_URL`** and must never enter the module graph of a `'use server'` file or a test. Domain modules under `@/lib` take `db: AnyDb` as their first parameter and import nothing from `@/db`.
- **Additive migrations only.** Schema files must be listed explicitly in `drizzle.config.ts`; a guard test enforces it.
- **`npx drizzle-kit generate` is safe — it writes SQL files and never touches a database.** Never run `drizzle-kit push` or `drizzle-kit migrate`: a live dev database on `localhost:5432` holds the camp's real seeded data.
- **Never run `npm install`.** If you hit `Cannot find module @rolldown/binding-darwin-arm64`, repair with `npm install --no-save @rolldown/binding-darwin-arm64@1.2.8`.
- **Run tests with `./node_modules/.bin/vitest run`** (default reporter). Do not pass `--reporter=basic`: it does not exist in vitest 5, the loader failure still exits 0, and **zero tests run**. Never trust an exit code — read the test COUNT and treat a missing count as a failed run.
- **`@testing-library/user-event` is not installed.** Use `fireEvent`.
- **`vi.mock` factories referencing a plain top-level `const` throw a hoisting `ReferenceError`.** Use `vi.hoisted`.
- **`git commit -m` in this zsh performs command substitution on backticked spans** and silently deletes them. Use `git commit -F -` with a quoted heredoc.
- **`docs/reference-data/` is read-only.** Never modify those workbooks.

## File Structure

**Created:**

| file | responsibility |
|---|---|
| `src/db/schema/money.ts` | The seven wave-1 tables and their enum types. Nothing else. |
| `src/lib/money/accounts.ts` | Accounts and derived balances. |
| `src/lib/money/ledger.ts` | Ledger entries, transfers, and the union read over entries + payments. |
| `src/lib/money/budget.ts` | Budget lines, the arithmetic check, the season-to-season derivation. |
| `src/lib/money/funding.ts` | Funding targets, ticket rounds, the dues/fundraising identity. |
| `src/lib/money/obligations.ts` | Obligations in both directions and their settlements. |
| `src/lib/money/summary.ts` | The single aggregate the page reads. |
| `src/components/charts/geometry.ts` | Direction-aware bar/line geometry. Pure functions, no JSX. |
| `src/components/charts/bar-list.tsx` | Horizontal bar list (accounts, event profit). |
| `src/components/charts/stacked-bar.tsx` | Plan-over-actual stacked bar with an unfilled remainder track. |
| `src/components/charts/meter.tsx` | One ratio against a limit (obligation settlement progress). |
| `src/components/charts/stat-tile.tsx` | A figure with a label and a derivation line. |
| `src/components/charts/charts.module.css` | Shared chart tokens and the validated series palette. |
| `src/app/(admin)/money/page.tsx` | The `/money` route, seven bands. |
| `src/app/(admin)/money/money.module.css` | Page layout. |

**Modified:**

| file | change |
|---|---|
| `drizzle.config.ts` | Add `./src/db/schema/money.ts` to `schema`. |
| `src/test/db.ts` | Import and register the money schema so PGlite tests see it. |
| `src/db/schema/camp.ts` | `payments.accountId`, `tasks.budgetLineId`. |
| `src/lib/fees/payments.ts` | `accountId` on `PaymentInput`; the `קיזוז`-has-no-account invariant. |
| `src/lib/seed/camp-seed.ts` | Seed accounts, ledger, budget, funding, obligations from the workbooks. |
| `src/app/(admin)/nav.tsx` | Add `כספים`. |
| `src/app/(admin)/page.tsx` | Link it from `סקירה`. |

---

### Task 1: The money schema

**Files:**
- Create: `src/db/schema/money.ts`
- Modify: `drizzle.config.ts`, `src/test/db.ts`, `src/db/schema/camp.ts`
- Create: `src/db/schema/money.test.ts`
- Create: `drizzle/0003_*.sql` (generated)

**Interfaces:**
- Consumes: `persons`, `seasons`, `campEvents`, `payments`, `tasks` from `@/db/schema/camp`; `blocks` from `@/db/schema/source`.
- Produces: tables `accounts`, `ledgerEntries`, `budgetLines`, `fundingTargets`, `ticketRounds`, `obligations`, `obligationSettlements`; types `AccountKind`, `LedgerDirection`, `ObligationDirection`, `SettlementKind`, `BudgetCategory`.

- [ ] **Step 1: Write the failing test**

`src/db/schema/money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '@/test/db';
import { accounts, ledgerEntries, obligations } from '@/db/schema/money';

describe('money schema', () => {
  it('is listed in drizzle.config.ts', () => {
    const config = readFileSync(join(process.cwd(), 'drizzle.config.ts'), 'utf8');
    expect(config).toContain('./src/db/schema/money.ts');
  });

  it('creates an account and derives nothing on it', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(accounts).values({
      name: 'קופת מזומן', kind: 'cash', openingBalance: '0.00',
    }).returning();
    expect(row.name).toBe('קופת מזומן');
    expect(row).not.toHaveProperty('balance');
  });

  it('stores a movement as a direction plus a positive amount', async () => {
    const db = await createTestDb();
    const [entry] = await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-07-18T00:00:00Z'),
      direction: 'in',
      amount: '57000.00',
      description: 'רווח מסיבת פקאנים',
      recordedBy: 'lead@example.com',
    }).returning();
    expect(entry.direction).toBe('in');
    expect(entry.amount).toBe('57000.00');
  });

  it('lets an obligation exist with no party at all', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(obligations).values({
      direction: 'camp_owes',
      description: 'מקפיא באיחסון נוסף',
      amount: '500.00',
      openedOn: new Date('2025-05-20T00:00:00Z'),
    }).returning();
    expect(row.partyPersonId).toBeNull();
    expect(row.partyName).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/db/schema/money.test.ts`
Expected: FAIL — cannot resolve `@/db/schema/money`.

- [ ] **Step 3: Write the schema**

`src/db/schema/money.ts`:

```ts
import {
  pgTable, uuid, text, integer, timestamp, numeric, boolean, unique,
} from 'drizzle-orm/pg-core';
import { persons, seasons, campEvents } from './camp';
import { blocks } from './source';

export type AccountKind = 'cash' | 'bank' | 'personal' | 'event_float';
export type LedgerDirection = 'in' | 'out';
export type ObligationDirection = 'camp_owes' | 'owed_to_camp';
export type SettlementKind = 'cash' | 'offset';
export type BudgetCategory = 'camp' | 'dancefloor';

/**
 * Where money physically sits. `עו״ש אופק` is a member's *personal* current
 * account holding camp funds — `holderPersonId` says so out loud rather than
 * pretending the camp has one קופה.
 *
 * There is deliberately no `balance` column. A balance is `openingBalance`
 * plus movements in, minus movements out, and a stored copy would be a second
 * truth that drifts.
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind').$type<AccountKind>().notNull(),
  holderPersonId: uuid('holder_person_id')
    .references(() => persons.id, { onDelete: 'set null' }),
  /** What the ledger cannot derive, because the earlier book is not loaded. */
  openingBalance: numeric('opening_balance', { precision: 12, scale: 2 })
    .notNull().default('0.00'),
  openingOn: timestamp('opening_on', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

/**
 * One movement of money that is not a dues payment. Dues payments live in
 * `payments` and carry their own `accountId`; the two are read together by
 * `listMovements` and never copied into each other.
 *
 * `seasonId` is nullable and set by hand, never inferred from `occurredOn`:
 * `חוב לירון סלע על ברן 25 — 14,000` is dated June 2026 and belongs to ברן 25.
 */
export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  occurredOn: timestamp('occurred_on', { withTimezone: true }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  direction: text('direction').$type<LedgerDirection>().notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description').notNull(),
  seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  eventId: uuid('event_id').references(() => campEvents.id, { onDelete: 'set null' }),
  budgetLineId: uuid('budget_line_id'),
  /** Two entries sharing this id are one transfer between accounts. */
  transferGroupId: uuid('transfer_group_id'),
  recordedBy: text('recorded_by').notNull(),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('ledger_entries_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/**
 * One planned expense for a season.
 *
 * `quantityText` is the truth: the workbook's quantity column holds `12,000kw`,
 * `מכולה`, `תפריט שלם לשבוע` and `מקרר תעשייתי` beside plain numbers, and
 * storing it numeric would destroy it. `quantityNum` exists only so that
 * `quantity × unit ≠ total` stays checkable.
 */
export const budgetLines = pgTable('budget_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  quantityText: text('quantity_text'),
  quantityNum: numeric('quantity_num', { precision: 12, scale: 2 }),
  unitCost: numeric('unit_cost', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  /** The workbook's `why` column: `תוספת של 1,000 שקלים - לחיזוק`. */
  rationale: text('rationale'),
  category: text('category').$type<BudgetCategory>().notNull().default('camp'),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('budget_lines_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/** One line of the year's fundraising plan — `הורדת מחיר דמי קאמפ 22,375.3`. */
export const fundingTargets = pgTable('funding_targets', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  note: text('note'),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('funding_targets_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/** Planned or sold ticket revenue — `סבב ג׳ 165 × 200`. */
export const ticketRounds = pgTable('ticket_rounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => campEvents.id, { onDelete: 'set null' }),
  label: text('label').notNull(),
  quantity: integer('quantity'),
  price: numeric('price', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  sold: boolean('sold').notNull().default(false),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('ticket_rounds_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/**
 * A debt in either direction. `חוב יוסף 15,240` and `אורי 300` are the same
 * fact at different sizes.
 *
 * Both party columns are nullable on purpose. `שולם 500 — מקפיא באיחסון נוסף`
 * genuinely records no name, and the system must keep that row rather than
 * drop it or invent an owner. An obligation with no party can never be marked
 * settled — see `settleObligation`.
 */
export const obligations = pgTable('obligations', {
  id: uuid('id').defaultRandom().primaryKey(),
  direction: text('direction').$type<ObligationDirection>().notNull(),
  partyPersonId: uuid('party_person_id')
    .references(() => persons.id, { onDelete: 'set null' }),
  /** The raw string when the source names someone but no confident link exists. */
  partyName: text('party_name'),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  openedOn: timestamp('opened_on', { withTimezone: true }).notNull().defaultNow(),
  sourceBlockId: uuid('source_block_id').references(() => blocks.id, { onDelete: 'set null' }),
  sourceRow: integer('source_row'),
}, (table) => [
  unique('obligations_source_key').on(table.sourceBlockId, table.sourceRow),
]);

/**
 * How an obligation gets discharged. This is the join that has never existed:
 * `חוב יוסף` → a 6,000 offset → five ברן 26 dues, instead of five payments
 * sharing a free-text note.
 */
export const obligationSettlements = pgTable('obligation_settlements', {
  id: uuid('id').defaultRandom().primaryKey(),
  obligationId: uuid('obligation_id').notNull()
    .references(() => obligations.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  kind: text('kind').$type<SettlementKind>().notNull(),
  ledgerEntryId: uuid('ledger_entry_id')
    .references(() => ledgerEntries.id, { onDelete: 'set null' }),
  /** Set when this settlement was an offset against a member's dues. */
  paymentId: uuid('payment_id'),
  note: text('note'),
  settledOn: timestamp('settled_on', { withTimezone: true }).notNull(),
  recordedBy: text('recorded_by').notNull(),
});
```

- [ ] **Step 4: Add the two columns to the camp schema**

In `src/db/schema/camp.ts`, add to `payments`:

```ts
  /** Which קופה received this money. Null means unattributed — shown, never
   *  guessed. A `קיזוז` payment moves no cash and must never carry one. */
  accountId: uuid('account_id'),
```

and to `tasks`:

```ts
  /** The budget line this deliverable spends against. `budgetAmount` above is
   *  deprecated in place: kept for existing rows, written by nothing. */
  budgetLineId: uuid('budget_line_id'),
```

Do not add cross-file `.references()` here — `camp.ts` must not import `money.ts`, or the two schema files become circular. The foreign keys are declared from the money side.

- [ ] **Step 5: Register the schema**

In `drizzle.config.ts`, add `'./src/db/schema/money.ts'` to the `schema` array.

In `src/test/db.ts`:

```ts
import * as money from '@/db/schema/money';

export type TestDb = ReturnType<typeof drizzle<typeof source & typeof camp & typeof money>>;
```

and in `createTestDb`, change the final line to:

```ts
  return drizzle(client, { schema: { ...source, ...camp, ...money } });
```

- [ ] **Step 6: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `drizzle/0003_*.sql`. Read it and confirm it contains only `CREATE TABLE` and `ALTER TABLE ... ADD COLUMN` — **no `DROP`**. If it contains a drop, stop and report it.

Do **not** run `drizzle-kit push` or `drizzle-kit migrate`.

- [ ] **Step 7: Run the tests**

Run: `./node_modules/.bin/vitest run src/db/schema/money.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/money.ts src/db/schema/money.test.ts src/db/schema/camp.ts \
        drizzle.config.ts src/test/db.ts drizzle/
git commit -F - <<'MSG'
feat(money): seven tables for the ledger, the plan and what is owed

No balance column anywhere: a balance is opening plus in minus out, and a
stored copy is a second truth that drifts. Both party columns on an
obligation are nullable because the ברן 25 sheet genuinely records two
reimbursements with no name, and losing those rows is the failure this
phase exists to prevent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Accounts and derived balances

**Files:**
- Create: `src/lib/money/accounts.ts`, `src/lib/money/accounts.test.ts`

**Interfaces:**
- Consumes: `accounts`, `ledgerEntries` from `@/db/schema/money`; `payments` from `@/db/schema/camp`; `AnyDb`; `toAgorot`/`fromAgorot`.
- Produces:
  - `createAccount(db, input: NewAccount): Promise<Account>`
  - `listAccounts(db): Promise<Account[]>`
  - `accountBalances(db): Promise<AccountBalance[]>` where `AccountBalance = { accountId, name, kind, holderPersonId, holderName, balanceAgorot }`
  - `unattributedAgorot(db): Promise<{ paymentsAgorot: number; entriesAgorot: number }>`

- [ ] **Step 1: Write the failing test**

`src/lib/money/accounts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { ledgerEntries } from '@/db/schema/money';
import { createAccount, listAccounts, accountBalances } from './accounts';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

describe('accounts', () => {
  it('derives a balance from opening plus in minus out', async () => {
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash', openingBalance: 1000 });
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date(), direction: 'in', amount: '750.50',
        description: 'הכנסה', accountId: account.id, recordedBy: 'lead' },
      { occurredOn: new Date(), direction: 'out', amount: '166.50',
        description: 'הוצאה', accountId: account.id, recordedBy: 'lead' },
    ]);

    const [balance] = await accountBalances(db);
    expect(balance.balanceAgorot).toBe(158400);
  });

  it('names the person holding a personal account', async () => {
    const db2 = await createTestDb();
    const { createPerson } = await import('@/lib/members/link');
    const personId = await createPerson(db2, 'אופק', 'lead@example.com');
    await createAccount(db2, {
      name: 'עו״ש אופק', kind: 'personal', holderPersonId: personId, openingBalance: 14079.55,
    });

    const [balance] = await accountBalances(db2);
    expect(balance.kind).toBe('personal');
    expect(balance.holderName).toBe('אופק');
    expect(balance.balanceAgorot).toBe(1407955);
  });

  it('refuses a blank account name', async () => {
    await expect(createAccount(db, { name: '  ‏ ', kind: 'cash' }))
      .rejects.toThrow(/שם/);
  });

  it('lists a closed account but keeps it out of nothing', async () => {
    const a = await createAccount(db, { name: 'וייבז', kind: 'event_float', closedAt: new Date() });
    expect((await listAccounts(db)).map((row) => row.id)).toContain(a.id);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/money/accounts.test.ts`
Expected: FAIL — cannot resolve `./accounts`.

- [ ] **Step 3: Implement**

`src/lib/money/accounts.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { AccountKind } from '@/db/schema/money';
import { persons, payments } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export type Account = typeof accounts.$inferSelect;

export interface NewAccount {
  name: string;
  kind: AccountKind;
  holderPersonId?: string;
  /** In shekels. */
  openingBalance?: number;
  openingOn?: Date;
  closedAt?: Date;
}

export interface AccountBalance {
  accountId: string;
  name: string;
  kind: AccountKind;
  holderPersonId: string | null;
  holderName: string | null;
  balanceAgorot: number;
}

export async function createAccount(db: AnyDb, input: NewAccount): Promise<Account> {
  if (isBlank(input.name)) throw new Error('לחשבון חייב להיות שם');
  const [row] = await db.insert(accounts).values({
    name: input.name,
    kind: input.kind,
    holderPersonId: input.holderPersonId ?? null,
    openingBalance: fromAgorot(toAgorot(input.openingBalance ?? 0)),
    openingOn: input.openingOn ?? null,
    closedAt: input.closedAt ?? null,
  }).returning();
  return row;
}

export async function listAccounts(db: AnyDb): Promise<Account[]> {
  return db.select().from(accounts).orderBy(accounts.name);
}

/**
 * Opening balance, plus every movement in, minus every movement out — from
 * both `ledger_entries` and `payments`, because a dues payment is money that
 * physically arrived somewhere.
 */
export async function accountBalances(db: AnyDb): Promise<AccountBalance[]> {
  const rows = await db
    .select({
      accountId: accounts.id,
      name: accounts.name,
      kind: accounts.kind,
      holderPersonId: accounts.holderPersonId,
      holderName: persons.displayName,
      openingBalance: accounts.openingBalance,
    })
    .from(accounts)
    .leftJoin(persons, eq(persons.id, accounts.holderPersonId))
    .orderBy(accounts.name);

  const entries = await db
    .select({ accountId: ledgerEntries.accountId, direction: ledgerEntries.direction,
              amount: ledgerEntries.amount })
    .from(ledgerEntries);

  const paid = await db
    .select({ accountId: payments.accountId, amount: payments.amount })
    .from(payments);

  const delta = new Map<string, number>();
  for (const row of entries) {
    if (!row.accountId) continue;
    const signed = row.direction === 'in' ? toAgorot(row.amount) : -toAgorot(row.amount);
    delta.set(row.accountId, (delta.get(row.accountId) ?? 0) + signed);
  }
  for (const row of paid) {
    if (!row.accountId) continue;
    delta.set(row.accountId, (delta.get(row.accountId) ?? 0) + toAgorot(row.amount));
  }

  return rows.map((row) => ({
    accountId: row.accountId,
    name: row.name,
    kind: row.kind,
    holderPersonId: row.holderPersonId,
    holderName: row.holderName ?? null,
    balanceAgorot: toAgorot(row.openingBalance) + (delta.get(row.accountId) ?? 0),
  }));
}

/**
 * Money the system holds but cannot place. Shown on the page as its own line,
 * because an unattributed shekel assigned to a guessed account is worse than
 * one the page admits it cannot place.
 *
 * `קיזוז` payments are excluded: they move no cash, so having no account is
 * correct for them rather than missing.
 */
export async function unattributedAgorot(
  db: AnyDb,
): Promise<{ paymentsAgorot: number; entriesAgorot: number }> {
  const [p] = await db
    .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(sql`${payments.accountId} is null and ${payments.channel} <> 'קיזוז'`);

  const [e] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(sql`${ledgerEntries.accountId} is null`);

  return { paymentsAgorot: toAgorot(p.total), entriesAgorot: toAgorot(e.total) };
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/money/accounts.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Mutation check**

Change `openingBalance` to be ignored in `accountBalances` (return only the delta). Re-run: the first test must FAIL. Restore.
Change the `קיזוז` exclusion in `unattributedAgorot` to include offsets. No
test covers it — **add one**, and make sure it can actually fail. A test that
calls `unattributedAgorot` on an empty database asserts nothing: it returns 0
whether the exclusion is there or not, so the mutation survives it. The test
has to record a real offset first:

```ts
  it('does not count an offset as unattributed money', async () => {
    // An offset settles a debt against a due. No cash moves, so carrying no
    // account is correct for it rather than missing — unlike a cash payment
    // with no account, which is money the camp cannot place.
    const { recordOffset } = await import('@/lib/fees/payments');
    await recordOffset(db, {
      entries: [{ dueId, amount: 1200 }],
      note: 'קיזוז מול חוב יוסף',
      paidOn: new Date(),
      recordedBy: LEAD,
    });
    expect((await unattributedAgorot(db)).paymentsAgorot).toBe(0);
  });
```

Set up a person, season and due in `beforeEach` so `dueId` exists.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money/accounts.ts src/lib/money/accounts.test.ts
git commit -F - <<'MSG'
feat(money): accounts, with balances derived rather than stored

A personal account naming its holder is the point: camp money living in a
member's current account is normal here, and the model says so instead of
flattening three places into one number.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: The ledger and the union read

**Files:**
- Create: `src/lib/money/ledger.ts`, `src/lib/money/ledger.test.ts`

**Interfaces:**
- Consumes: `ledgerEntries`, `accounts`; `payments`, `dues`, `persons` from `@/db/schema/camp`.
- Produces:
  - `recordEntry(db, input: NewEntry): Promise<string>`
  - `recordTransfer(db, input: TransferInput): Promise<[string, string]>`
  - `listMovements(db, filter?: MovementFilter): Promise<Movement[]>` where `Movement = { id, source: 'ledger' | 'dues', occurredOn, direction, amountAgorot, description, accountId, accountName, seasonId, eventId }`
  - `ledgerTotals(db, filter?): Promise<{ inAgorot, outAgorot, netAgorot, count }>`

- [ ] **Step 1: Write the failing test**

`src/lib/money/ledger.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createAccount } from './accounts';
import { recordEntry, recordTransfer, listMovements, ledgerTotals } from './ledger';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

const LEAD = 'lead@example.com';

describe('the ledger', () => {
  it('reproduces the ברן 25 bottom line from its eight movements', async () => {
    const rows: Array<[('in' | 'out'), number, string]> = [
      ['in', 44647, 'מעבר לקובץ חדש'],
      ['out', 200, 'תרומה אבישי פרץ'],
      ['out', 8850, 'מכולה אוג 25-26'],
      ['out', 20660, 'מקדמה במה ברן 25'],
      ['in', 34646.55, 'רווח מסיבה נמל'],
      ['out', 20660, 'חצי שני למייצג נטלי'],
      ['out', 400, 'מברגה לקאמפ'],
      ['in', 15660, 'מסיבת האלווין 30/10'],
    ];
    for (const [direction, amount, description] of rows) {
      await recordEntry(db, {
        occurredOn: new Date('2025-06-01T00:00:00Z'),
        direction, amount, description, recordedBy: LEAD,
      });
    }

    const totals = await ledgerTotals(db);
    expect(totals.count).toBe(8);
    expect(totals.outAgorot).toBe(5077000);
    expect(totals.inAgorot).toBe(9495355);
    expect(totals.netAgorot).toBe(4418355);
  });

  it('refuses a non-positive amount, because direction carries the sign', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'out', amount: -50,
      description: 'שלילי', recordedBy: LEAD,
    })).rejects.toThrow(/חיובי/);
  });

  it('refuses a blank description', async () => {
    await expect(recordEntry(db, {
      occurredOn: new Date(), direction: 'in', amount: 50,
      description: ' ‎ ', recordedBy: LEAD,
    })).rejects.toThrow(/תיאור/);
  });

  it('writes a transfer as two entries sharing a group', async () => {
    const from = await createAccount(db, { name: 'וייבז', kind: 'event_float', openingBalance: 5000 });
    const to = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });

    await recordTransfer(db, {
      fromAccountId: from.id, toAccountId: to.id, amount: 1200,
      occurredOn: new Date(), description: 'העברה לקופה', recordedBy: LEAD,
    });

    const moves = await listMovements(db);
    expect(moves).toHaveLength(2);
    expect(new Set(moves.map((m) => m.direction))).toEqual(new Set(['in', 'out']));
  });

  it('refuses a transfer to the same account', async () => {
    const a = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    await expect(recordTransfer(db, {
      fromAccountId: a.id, toAccountId: a.id, amount: 10,
      occurredOn: new Date(), description: 'עצמי', recordedBy: LEAD,
    })).rejects.toThrow(/אותו חשבון/);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/money/ledger.test.ts`
Expected: FAIL — cannot resolve `./ledger`.

- [ ] **Step 3: Implement**

`src/lib/money/ledger.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import type { LedgerDirection } from '@/db/schema/money';
import { payments, dues, persons } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface NewEntry {
  occurredOn: Date;
  direction: LedgerDirection;
  /** In shekels. Must be positive — `direction` carries the sign. */
  amount: number;
  description: string;
  accountId?: string;
  seasonId?: string;
  eventId?: string;
  budgetLineId?: string;
  transferGroupId?: string;
  recordedBy: string;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  occurredOn: Date;
  description: string;
  recordedBy: string;
  seasonId?: string;
}

export interface Movement {
  id: string;
  /** Which table it came from. The ledger is a union, never a copy. */
  source: 'ledger' | 'dues';
  occurredOn: Date;
  direction: LedgerDirection;
  amountAgorot: number;
  description: string;
  accountId: string | null;
  accountName: string | null;
  seasonId: string | null;
  eventId: string | null;
}

export interface MovementFilter {
  seasonId?: string;
  accountId?: string;
  eventId?: string;
}

function validate(input: NewEntry): void {
  if (input.amount <= 0) {
    throw new Error('סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן');
  }
  if (isBlank(input.description)) throw new Error('לתנועה חייב להיות תיאור');
}

export async function recordEntry(db: AnyDb, input: NewEntry): Promise<string> {
  validate(input);
  const [row] = await db.insert(ledgerEntries).values({
    occurredOn: input.occurredOn,
    direction: input.direction,
    amount: fromAgorot(toAgorot(input.amount)),
    description: input.description,
    accountId: input.accountId ?? null,
    seasonId: input.seasonId ?? null,
    eventId: input.eventId ?? null,
    budgetLineId: input.budgetLineId ?? null,
    transferGroupId: input.transferGroupId ?? null,
    recordedBy: input.recordedBy,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

/**
 * Two entries sharing a `transferGroupId`. Written as a pair rather than as
 * one signed row so that every account's balance stays a plain sum, and so a
 * transfer can never be half-visible on one side.
 */
export async function recordTransfer(
  db: AnyDb, input: TransferInput,
): Promise<[string, string]> {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error('אי אפשר להעביר לאותו חשבון');
  }
  const group = randomUUID();
  const out = await recordEntry(db, {
    occurredOn: input.occurredOn, direction: 'out', amount: input.amount,
    description: input.description, accountId: input.fromAccountId,
    seasonId: input.seasonId, transferGroupId: group, recordedBy: input.recordedBy,
  });
  const into = await recordEntry(db, {
    occurredOn: input.occurredOn, direction: 'in', amount: input.amount,
    description: input.description, accountId: input.toAccountId,
    seasonId: input.seasonId, transferGroupId: group, recordedBy: input.recordedBy,
  });
  return [out, into];
}

/**
 * The ledger, read. A union of `ledger_entries` and `payments` — never a copy
 * of one into the other, so no row can disagree with its twin because no row
 * has one.
 */
export async function listMovements(
  db: AnyDb, filter: MovementFilter = {},
): Promise<Movement[]> {
  const entryWhere = [];
  if (filter.seasonId) entryWhere.push(eq(ledgerEntries.seasonId, filter.seasonId));
  if (filter.accountId) entryWhere.push(eq(ledgerEntries.accountId, filter.accountId));
  if (filter.eventId) entryWhere.push(eq(ledgerEntries.eventId, filter.eventId));

  const entries = await db
    .select({
      id: ledgerEntries.id,
      occurredOn: ledgerEntries.occurredOn,
      direction: ledgerEntries.direction,
      amount: ledgerEntries.amount,
      description: ledgerEntries.description,
      accountId: ledgerEntries.accountId,
      accountName: accounts.name,
      seasonId: ledgerEntries.seasonId,
      eventId: ledgerEntries.eventId,
    })
    .from(ledgerEntries)
    .leftJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(entryWhere.length ? and(...entryWhere) : undefined)
    .orderBy(asc(ledgerEntries.occurredOn));

  const dueWhere = [];
  if (filter.seasonId) dueWhere.push(eq(dues.seasonId, filter.seasonId));
  if (filter.accountId) dueWhere.push(eq(payments.accountId, filter.accountId));

  const paid = filter.eventId ? [] : await db
    .select({
      id: payments.id,
      occurredOn: payments.paidOn,
      amount: payments.amount,
      accountId: payments.accountId,
      accountName: accounts.name,
      seasonId: dues.seasonId,
      displayName: persons.displayName,
    })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .innerJoin(persons, eq(persons.id, dues.personId))
    .leftJoin(accounts, eq(accounts.id, payments.accountId))
    .where(dueWhere.length ? and(...dueWhere) : undefined)
    .orderBy(asc(payments.paidOn));

  const all: Movement[] = [
    ...entries.map((row) => ({
      id: row.id, source: 'ledger' as const, occurredOn: row.occurredOn,
      direction: row.direction, amountAgorot: toAgorot(row.amount),
      description: row.description, accountId: row.accountId,
      accountName: row.accountName ?? null, seasonId: row.seasonId, eventId: row.eventId,
    })),
    ...paid.map((row) => ({
      id: row.id, source: 'dues' as const, occurredOn: row.occurredOn,
      direction: 'in' as const, amountAgorot: toAgorot(row.amount),
      description: `דמי קאמפ — ${row.displayName}`, accountId: row.accountId,
      accountName: row.accountName ?? null, seasonId: row.seasonId, eventId: null,
    })),
  ];

  return all.sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime());
}

export async function ledgerTotals(
  db: AnyDb, filter: MovementFilter = {},
): Promise<{ inAgorot: number; outAgorot: number; netAgorot: number; count: number }> {
  const moves = await listMovements(db, filter);
  let inAgorot = 0;
  let outAgorot = 0;
  for (const move of moves) {
    if (move.direction === 'in') inAgorot += move.amountAgorot;
    else outAgorot += move.amountAgorot;
  }
  return { inAgorot, outAgorot, netAgorot: inAgorot - outAgorot, count: moves.length };
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/money/ledger.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation check**

- Make `recordTransfer` write only the `out` entry. The transfer test must FAIL.
- Make `validate` accept `amount === 0`. Add a test if none fails.
- Make `listMovements` drop the `payments` half. `ledgerTotals` on a season with dues must FAIL — **if no test covers that, write one now**, because the union is the whole point of the module.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money/ledger.ts src/lib/money/ledger.test.ts
git commit -F - <<'MSG'
feat(money): the ledger, as a union rather than a copy

Dues payments are read alongside ledger entries, never posted into them.
A copy would need a transaction and a standing invariant forever, and
deletePayment would silently orphan its twin; a union cannot drift because
there is only ever one row.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Dues payments name their account

**Files:**
- Modify: `src/lib/fees/payments.ts`, `src/lib/fees/payments.test.ts`

**Interfaces:**
- Produces: `PaymentInput` gains `accountId?: string`. `recordPayment` throws when a `קיזוז` payment carries one.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/fees/payments.test.ts`:

```ts
  it('records which קופה received the money', async () => {
    const { createAccount } = await import('@/lib/money/accounts');
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    const id = await recordPayment(db, {
      dueId, amount: 1200, channel: 'מזומן', paidOn: new Date(),
      accountId: account.id, recordedBy: LEAD,
    });
    const [row] = await listPayments(db, dueId);
    expect(row.id).toBe(id);
    expect(row.accountId).toBe(account.id);
  });

  /**
   * An offset settles a debt against a due. No cash changes hands, so naming
   * an account would invent a movement that never happened — and would make
   * that קופה's derived balance wrong.
   */
  it('refuses an account on a קיזוז, because no cash moved', async () => {
    const { createAccount } = await import('@/lib/money/accounts');
    const account = await createAccount(db, { name: 'קופת מזומן', kind: 'cash' });
    await expect(recordPayment(db, {
      dueId, amount: 1200, channel: 'קיזוז', note: 'מול חוב יוסף',
      paidOn: new Date(), accountId: account.id, recordedBy: LEAD,
    })).rejects.toThrow(/קיזוז/);
  });
```

- [ ] **Step 2: Run and verify they fail**

Run: `./node_modules/.bin/vitest run src/lib/fees/payments.test.ts`
Expected: FAIL — `accountId` is not a known property.

- [ ] **Step 3: Implement**

In `src/lib/fees/payments.ts`, add to `PaymentInput`:

```ts
  /** Which קופה received this money. Never set on a `קיזוז`. */
  accountId?: string;
```

add to `PaymentRow`:

```ts
  accountId: string | null;
```

extend `validate`:

```ts
  if (input.channel === 'קיזוז' && input.accountId) {
    throw new Error('קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון');
  }
```

pass it through in `recordPayment`'s `values` (`accountId: input.accountId ?? null`) and map it in `listPayments`.

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/fees/`
Expected: PASS — every previously passing fees test still passes, plus 2.

- [ ] **Step 5: Mutation check**

Delete the `קיזוז` guard. The second test must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fees/payments.ts src/lib/fees/payments.test.ts
git commit -F - <<'MSG'
fix(fees): a payment says which קופה received it

This is what ends ברן 25 dues existing in two places. An offset is the
exception and is refused an account outright: it settles a debt, no cash
moves, and naming a קופה would make that account's derived balance wrong.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: Budget lines, the arithmetic check and the derivation

**Files:**
- Create: `src/lib/money/budget.ts`, `src/lib/money/budget.test.ts`

**Interfaces:**
- Produces:
  - `createBudgetLine(db, input: NewBudgetLine): Promise<string>`
  - `listBudgetLines(db, seasonId): Promise<BudgetLineRow[]>` where `BudgetLineRow = { id, label, quantityText, quantityNumAgorot, unitCostAgorot, totalAgorot, rationale, category, arithmeticOff: boolean }`
  - `budgetTotalAgorot(db, seasonId): Promise<number>`
  - `budgetDerivation(db, fromSeasonId, toSeasonId): Promise<DerivationRow[]>` where `DerivationRow = { label, actualAgorot: number | null, forecastAgorot: number | null, bufferAgorot: number | null, rationale: string }`

- [ ] **Step 1: Write the failing test**

`src/lib/money/budget.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createBudgetLine, listBudgetLines, budgetTotalAgorot, budgetDerivation } from './budget';

let db: TestDb;
let s25: string;
let s26: string;

beforeEach(async () => {
  db = await createTestDb();
  s25 = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43 })).id;
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('budget lines', () => {
  it('keeps a non-numeric quantity exactly as written', async () => {
    await createBudgetLine(db, {
      seasonId: s26, label: 'חשמל לקאמפ', quantityText: '12,000kw',
      unitCost: 7500, total: 7500, category: 'camp',
    });
    const [line] = await listBudgetLines(db, s26);
    expect(line.quantityText).toBe('12,000kw');
    expect(line.quantityNumAgorot).toBeNull();
    expect(line.arithmeticOff).toBe(false);
  });

  it('flags quantity × unit ≠ total without blocking it', async () => {
    const id = await createBudgetLine(db, {
      seasonId: s26, label: 'שירותים נסורת', quantityText: '5', quantityNum: 5,
      unitCost: 125, total: 1625, category: 'camp',
    });
    expect(id).toBeTruthy();
    const [line] = await listBudgetLines(db, s26);
    expect(line.arithmeticOff).toBe(true);
  });

  it('sums the ברן 26 budget to 64,375.30', async () => {
    for (const [label, total] of [['בסיס', 58523], ['הפתעות', 5852.3]] as const) {
      await createBudgetLine(db, { seasonId: s26, label, total, category: 'camp' });
    }
    expect(await budgetTotalAgorot(db, s26)).toBe(6437530);
  });

  it('derives 26 from 25 and carries a 25 line that 26 dropped', async () => {
    await createBudgetLine(db, { seasonId: s25, label: 'סולם 5 מ׳', total: 1280, category: 'camp' });
    await createBudgetLine(db, { seasonId: s25, label: 'הובלה', total: 4000, category: 'camp' });
    await createBudgetLine(db, {
      seasonId: s26, label: 'הובלה', total: 9000, category: 'camp',
      rationale: 'תוספת של 2000 שקלים',
    });

    const rows = await budgetDerivation(db, s25, s26);
    const hovala = rows.find((r) => r.label === 'הובלה')!;
    expect(hovala.actualAgorot).toBe(400000);
    expect(hovala.forecastAgorot).toBe(900000);
    expect(hovala.bufferAgorot).toBe(500000);

    const dropped = rows.find((r) => r.label === 'סולם 5 מ׳')!;
    expect(dropped.forecastAgorot).toBeNull();
    expect(dropped.bufferAgorot).toBe(-128000);
  });

  it('refuses a blank label', async () => {
    await expect(createBudgetLine(db, {
      seasonId: s26, label: '‏  ', total: 100, category: 'camp',
    })).rejects.toThrow(/שם/);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/money/budget.test.ts`
Expected: FAIL — cannot resolve `./budget`.

- [ ] **Step 3: Implement**

`src/lib/money/budget.ts`:

```ts
import { asc, eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { budgetLines } from '@/db/schema/money';
import type { BudgetCategory } from '@/db/schema/money';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank, normalizeHebrew } from '@/lib/text/normalize';

/** Tolerance for the arithmetic check, in agorot. Half a shekel, matching the
 *  rounding the workbook itself does. */
const ARITHMETIC_TOLERANCE = 50;

export interface NewBudgetLine {
  seasonId: string;
  label: string;
  quantityText?: string;
  /** Only when the quantity really is a number. */
  quantityNum?: number;
  unitCost?: number;
  total: number;
  rationale?: string;
  category: BudgetCategory;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface BudgetLineRow {
  id: string;
  label: string;
  quantityText: string | null;
  quantityNumAgorot: number | null;
  unitCostAgorot: number | null;
  totalAgorot: number;
  rationale: string | null;
  category: BudgetCategory;
  /** `quantity × unit ≠ total`. Flagged, never blocked. */
  arithmeticOff: boolean;
}

export interface DerivationRow {
  label: string;
  actualAgorot: number | null;
  forecastAgorot: number | null;
  bufferAgorot: number | null;
  rationale: string;
}

export async function createBudgetLine(db: AnyDb, input: NewBudgetLine): Promise<string> {
  if (isBlank(input.label)) throw new Error('לשורת תקציב חייב להיות שם');
  const [row] = await db.insert(budgetLines).values({
    seasonId: input.seasonId,
    label: input.label,
    quantityText: input.quantityText ?? null,
    quantityNum: input.quantityNum === undefined
      ? null : fromAgorot(toAgorot(input.quantityNum)),
    unitCost: input.unitCost === undefined ? null : fromAgorot(toAgorot(input.unitCost)),
    total: fromAgorot(toAgorot(input.total)),
    rationale: input.rationale ?? null,
    category: input.category,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listBudgetLines(
  db: AnyDb, seasonId: string,
): Promise<BudgetLineRow[]> {
  const rows = await db.select().from(budgetLines)
    .where(eq(budgetLines.seasonId, seasonId))
    .orderBy(asc(budgetLines.label));

  return rows.map((row) => {
    const totalAgorot = toAgorot(row.total);
    const quantityNumAgorot = row.quantityNum === null ? null : toAgorot(row.quantityNum);
    const unitCostAgorot = row.unitCost === null ? null : toAgorot(row.unitCost);

    // quantity is in agorot only because it shares the numeric converter;
    // the product is (qty/100) * unitAgorot, so divide the extra factor out.
    const expected = quantityNumAgorot === null || unitCostAgorot === null
      ? null
      : Math.round((quantityNumAgorot * unitCostAgorot) / 100);

    return {
      id: row.id,
      label: row.label,
      quantityText: row.quantityText,
      quantityNumAgorot,
      unitCostAgorot,
      totalAgorot,
      rationale: row.rationale,
      category: row.category,
      arithmeticOff: expected !== null
        && Math.abs(expected - totalAgorot) > ARITHMETIC_TOLERANCE,
    };
  });
}

export async function budgetTotalAgorot(db: AnyDb, seasonId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${budgetLines.total}), 0)` })
    .from(budgetLines)
    .where(eq(budgetLines.seasonId, seasonId));
  return toAgorot(row.total);
}

/**
 * What one season's budget became in the next. Matching is on the normalized
 * label, which is how the workbook itself relates the two sheets.
 *
 * A line present in `from` and absent from `to` is kept with a null forecast
 * and a negative buffer, rather than dropped — a line that disappeared is a
 * budget decision, and hiding it makes the two totals look reconciled when
 * they are not.
 */
export async function budgetDerivation(
  db: AnyDb, fromSeasonId: string, toSeasonId: string,
): Promise<DerivationRow[]> {
  const before = await listBudgetLines(db, fromSeasonId);
  const after = await listBudgetLines(db, toSeasonId);

  const actuals = new Map(before.map((row) => [normalizeHebrew(row.label), row]));
  const carried = new Set(after.map((row) => normalizeHebrew(row.label)));

  const rows: DerivationRow[] = after.map((row) => {
    const actual = actuals.get(normalizeHebrew(row.label)) ?? null;
    return {
      label: row.label,
      actualAgorot: actual ? actual.totalAgorot : null,
      forecastAgorot: row.totalAgorot,
      bufferAgorot: actual ? row.totalAgorot - actual.totalAgorot : null,
      rationale: row.rationale ?? '',
    };
  });

  for (const row of before) {
    if (carried.has(normalizeHebrew(row.label))) continue;
    rows.push({
      label: row.label,
      actualAgorot: row.totalAgorot,
      forecastAgorot: null,
      bufferAgorot: -row.totalAgorot,
      rationale: 'לא נכלל בתקציב הבא',
    });
  }

  return rows;
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/money/budget.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation check**

- Make `arithmeticOff` always `false`. Test 2 must FAIL.
- Drop the "carry a line the next season dropped" loop. Test 4 must FAIL.
- Change `ARITHMETIC_TOLERANCE` to `0`. Test 1 must still PASS (its quantity is non-numeric) — if it fails, the non-numeric path is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money/budget.ts src/lib/money/budget.test.ts
git commit -F - <<'MSG'
feat(money): budget lines, with the quantity kept as written

The workbook's quantity column holds 12,000kw, מכולה and תפריט שלם לשבוע
beside plain numbers. Storing it numeric would destroy it, so the text is
the truth and a parallel number exists only to keep qty x unit checkable.
Mismatches are flagged and never blocked, as in Phase 1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Funding targets, ticket rounds, and the identity

**Files:**
- Create: `src/lib/money/funding.ts`, `src/lib/money/funding.test.ts`

**Interfaces:**
- Produces:
  - `createFundingTarget(db, input)`, `listFundingTargets(db, seasonId)`, `fundingTotalAgorot(db, seasonId)`
  - `createTicketRound(db, input)`, `listTicketRounds(db, seasonId)`, `ticketTotalAgorot(db, seasonId)`
  - `duesFundingIdentity(db, seasonId): Promise<DuesFundingIdentity>`

- [ ] **Step 1: Write the failing test**

`src/lib/money/funding.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createBudgetLine } from './budget';
import {
  createFundingTarget, fundingTotalAgorot,
  createTicketRound, ticketTotalAgorot, duesFundingIdentity,
} from './funding';

let db: TestDb;
let s26: string;

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('the fundraising plan', () => {
  it('sums the ברן 26 plan to 135,375.30', async () => {
    const plan: Array<[string, number]> = [
      ['חוב', 15000], ['תיקון ותחזוק מייצג', 5000], ['חשמל רחבה', 16000],
      ['הגברה', 35000], ['הובלה', 6000], ['תאורה לייזרים', 20000],
      ['מכולות', 16000], ['הורדת מחיר דמי קאמפ', 22375.3],
    ];
    for (const [label, amount] of plan) {
      await createFundingTarget(db, { seasonId: s26, label, amount });
    }
    expect(await fundingTotalAgorot(db, s26)).toBe(13537530);
  });

  it('sums the ticket projection to 171,000', async () => {
    await createTicketRound(db, { seasonId: s26, label: 'כרטיסים עד כה', total: 60000 });
    await createTicketRound(db, { seasonId: s26, label: 'סבב ג׳', quantity: 165, price: 200, total: 33000 });
    await createTicketRound(db, { seasonId: s26, label: 'סבב ד׳', quantity: 195, price: 400, total: 78000 });
    expect(await ticketTotalAgorot(db, s26)).toBe(17100000);
  });

  /**
   * The thesis of the camp's finances, and a sentence that appears in no cell
   * of any workbook: the full budget per head is 1,839.29, dues are 1,200, and
   * fundraising covers the 639.29 difference.
   */
  it('closes the dues/fundraising identity for ברן 26', async () => {
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 64375.3, category: 'camp' });
    await createFundingTarget(db, { seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 22375.3 });

    const id = await duesFundingIdentity(db, s26);
    expect(id.budgetTotalAgorot).toBe(6437530);
    expect(id.duesCoverAgorot).toBe(4200000);
    expect(id.fundingTargetAgorot).toBe(2237530);
    expect(id.perPersonFullAgorot).toBe(183929);
    expect(id.perPersonFundingAgorot).toBe(63929);
    expect(id.flatRateAgorot).toBe(120000);
    expect(id.closes).toBe(true);
  });

  it('reports a gap rather than hiding it when the halves do not add up', async () => {
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 70000, category: 'camp' });
    await createFundingTarget(db, { seasonId: s26, label: 'גיוס', amount: 22375.3 });
    const id = await duesFundingIdentity(db, s26);
    expect(id.closes).toBe(false);
  });

  it('refuses to invent a per-person figure with no planned size', async () => {
    const s = (await createSeason(db, { name: 'ברן 27', year: 2027, flatRate: 1000 })).id;
    const id = await duesFundingIdentity(db, s);
    expect(id.plannedSize).toBeNull();
    expect(id.perPersonFullAgorot).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/money/funding.test.ts`
Expected: FAIL — cannot resolve `./funding`.

- [ ] **Step 3: Implement**

`src/lib/money/funding.ts`:

```ts
import { asc, eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { fundingTargets, ticketRounds } from '@/db/schema/money';
import { seasons } from '@/db/schema/camp';
import { budgetTotalAgorot } from './budget';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface NewFundingTarget {
  seasonId: string;
  label: string;
  amount: number;
  note?: string;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface NewTicketRound {
  seasonId: string;
  eventId?: string;
  label: string;
  quantity?: number;
  price?: number;
  total: number;
  sold?: boolean;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface DuesFundingIdentity {
  seasonId: string;
  budgetTotalAgorot: number;
  plannedSize: number | null;
  flatRateAgorot: number;
  /** flatRate × plannedSize — what dues are expected to cover. */
  duesCoverAgorot: number | null;
  fundingTargetAgorot: number;
  /** The whole budget divided by the camp, null when the size is unknown. */
  perPersonFullAgorot: number | null;
  /** The fundraising target divided by the camp. */
  perPersonFundingAgorot: number | null;
  /**
   * Whether `flatRate + perPersonFunding === perPersonFull`. Computed from two
   * independent divisions rather than by subtraction, so that a budget and a
   * fundraising target which do not actually add up are reported as not
   * adding up instead of being made to look as though they do.
   */
  closes: boolean;
}

export async function createFundingTarget(
  db: AnyDb, input: NewFundingTarget,
): Promise<string> {
  if (isBlank(input.label)) throw new Error('ליעד גיוס חייב להיות שם');
  const [row] = await db.insert(fundingTargets).values({
    seasonId: input.seasonId,
    label: input.label,
    amount: fromAgorot(toAgorot(input.amount)),
    note: input.note ?? null,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listFundingTargets(db: AnyDb, seasonId: string) {
  return db.select().from(fundingTargets)
    .where(eq(fundingTargets.seasonId, seasonId))
    .orderBy(asc(fundingTargets.label));
}

export async function fundingTotalAgorot(db: AnyDb, seasonId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${fundingTargets.amount}), 0)` })
    .from(fundingTargets)
    .where(eq(fundingTargets.seasonId, seasonId));
  return toAgorot(row.total);
}

export async function createTicketRound(db: AnyDb, input: NewTicketRound): Promise<string> {
  if (isBlank(input.label)) throw new Error('לסבב כרטיסים חייב להיות שם');
  const [row] = await db.insert(ticketRounds).values({
    seasonId: input.seasonId,
    eventId: input.eventId ?? null,
    label: input.label,
    quantity: input.quantity ?? null,
    price: input.price === undefined ? null : fromAgorot(toAgorot(input.price)),
    total: fromAgorot(toAgorot(input.total)),
    sold: input.sold ?? false,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listTicketRounds(db: AnyDb, seasonId: string) {
  return db.select().from(ticketRounds)
    .where(eq(ticketRounds.seasonId, seasonId))
    .orderBy(asc(ticketRounds.label));
}

export async function ticketTotalAgorot(db: AnyDb, seasonId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ticketRounds.total}), 0)` })
    .from(ticketRounds)
    .where(eq(ticketRounds.seasonId, seasonId));
  return toAgorot(row.total);
}

export async function duesFundingIdentity(
  db: AnyDb, seasonId: string,
): Promise<DuesFundingIdentity> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const budget = await budgetTotalAgorot(db, seasonId);
  const funding = await fundingTotalAgorot(db, seasonId);
  const flatRateAgorot = toAgorot(season.flatRate);
  const size = season.plannedSize;

  if (!size) {
    return {
      seasonId, budgetTotalAgorot: budget, plannedSize: null, flatRateAgorot,
      duesCoverAgorot: null, fundingTargetAgorot: funding,
      perPersonFullAgorot: null, perPersonFundingAgorot: null, closes: false,
    };
  }

  const perPersonFull = Math.round(budget / size);
  const perPersonFunding = Math.round(funding / size);

  return {
    seasonId,
    budgetTotalAgorot: budget,
    plannedSize: size,
    flatRateAgorot,
    duesCoverAgorot: flatRateAgorot * size,
    fundingTargetAgorot: funding,
    perPersonFullAgorot: perPersonFull,
    perPersonFundingAgorot: perPersonFunding,
    closes: flatRateAgorot + perPersonFunding === perPersonFull,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/money/funding.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation check**

- Compute `perPersonFunding` as `perPersonFull - flatRateAgorot` instead of dividing. Test 4 ("reports a gap") must FAIL — this is the mutation that matters most, because subtraction makes `closes` trivially true and the page would then always claim the halves add up.
- Change `Math.round` to `Math.floor`. **Expect this to SURVIVE the five tests
  above, and treat that as the finding.** ברן 26's remainders are ≈0.43, so
  floor and round agree: `6437530/35 → 183929` and `2237530/35 → 63929` either
  way, and the identity closes under both. Write a sixth test whose numbers
  actually cross the .5 boundary — e.g. budget 10.03 and funding 6.03 over a
  camp of 4, where round gives 251 and 151 but floor gives 250 and 150 — and
  verify it fails on the mutant and passes on correct code. Do not put the
  figure 183926 in a comment or anywhere else: it is wrong, it came from an
  earlier draft of this plan, and it does not correspond to any floor of this
  data.
- Return `perPersonFullAgorot: 0` instead of `null` with no planned size. Test 5 must FAIL.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money/funding.ts src/lib/money/funding.test.ts
git commit -F - <<'MSG'
feat(money): the fundraising plan, and the identity behind the rate

64,375.30 for 35 people is 1,839.29 each; dues are 1,200; fundraising
covers the 639.29 difference. The two per-head figures are divided
independently rather than one subtracted from the other, so a budget and a
target that do not actually add up are reported as not adding up.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 7: Obligations and settlements

**Files:**
- Create: `src/lib/money/obligations.ts`, `src/lib/money/obligations.test.ts`

**Interfaces:**
- Produces:
  - `createObligation(db, input: NewObligation): Promise<string>`
  - `listObligations(db, filter?): Promise<ObligationRow[]>` where `ObligationRow = { id, direction, partyPersonId, partyName, displayParty: string | null, description, amountAgorot, settledAgorot, outstandingAgorot, settled: boolean, unnamed: boolean, settlements: SettlementRow[] }`
  - `settleObligation(db, input: NewSettlement): Promise<string>`
  - `unnamedObligations(db): Promise<ObligationRow[]>`

- [ ] **Step 1: Write the failing test**

`src/lib/money/obligations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createObligation, listObligations, settleObligation, unnamedObligations } from './obligations';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

const LEAD = 'lead@example.com';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('obligations', () => {
  it('reproduces חוב יוסף: 15,240 owed, 14,330 offset, 910 left', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף',
      description: 'חוב יוסף', amount: 15240, openedOn: WHEN,
    });
    for (const [amount, note] of [
      [4410, '3 כרטיס + רכב'], [2780, '3 כרטיס לבד'], [1140, 'ביט מאורי'],
      [6000, 'יוסף קארינה יונתן ירין ועילאי'],
    ] as const) {
      await settleObligation(db, {
        obligationId: id, amount, kind: 'offset', note, settledOn: WHEN, recordedBy: LEAD,
      });
    }
    const [row] = await listObligations(db);
    expect(row.amountAgorot).toBe(1524000);
    expect(row.settledAgorot).toBe(1433000);
    expect(row.outstandingAgorot).toBe(91000);
    expect(row.settled).toBe(false);
    expect(row.settlements).toHaveLength(4);
  });

  /**
   * Two of the twelve ברן 25 reimbursements have no name at all. The camp
   * cannot say who to pay back, and the system must keep saying so rather
   * than dropping the row or inventing an owner.
   */
  it('keeps an obligation with no party, and refuses to settle it', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', description: 'מקפיא באיחסון נוסף',
      amount: 500, openedOn: WHEN,
    });

    const [row] = await unnamedObligations(db);
    expect(row.id).toBe(id);
    expect(row.unnamed).toBe(true);
    expect(row.displayParty).toBeNull();

    await expect(settleObligation(db, {
      obligationId: id, amount: 500, kind: 'cash', settledOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/בלי שם/);
  });

  it('requires a note on an offset, as recordOffset already does', async () => {
    const id = await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף', description: 'חוב',
      amount: 100, openedOn: WHEN,
    });
    await expect(settleObligation(db, {
      obligationId: id, amount: 100, kind: 'offset', note: ' ‏ ',
      settledOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/קיזוז/);
  });

  it('refuses to settle more than is owed', async () => {
    const id = await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'אורי', description: 'חוב',
      amount: 100, openedOn: WHEN,
    });
    await settleObligation(db, {
      obligationId: id, amount: 60, kind: 'offset', note: 'חלקי',
      settledOn: WHEN, recordedBy: LEAD,
    });
    await expect(settleObligation(db, {
      obligationId: id, amount: 50, kind: 'offset', note: 'יותר מדי',
      settledOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/יותר/);
  });

  it('separates the two directions', async () => {
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף', description: 'א', amount: 10, openedOn: WHEN,
    });
    await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'רן', description: 'ב', amount: 20, openedOn: WHEN,
    });
    expect(await listObligations(db, { direction: 'camp_owes' })).toHaveLength(1);
    expect(await listObligations(db, { direction: 'owed_to_camp' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/money/obligations.test.ts`
Expected: FAIL — cannot resolve `./obligations`.

- [ ] **Step 3: Implement**

`src/lib/money/obligations.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { obligations, obligationSettlements } from '@/db/schema/money';
import type { ObligationDirection, SettlementKind } from '@/db/schema/money';
import { persons } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface NewObligation {
  direction: ObligationDirection;
  partyPersonId?: string;
  partyName?: string;
  description: string;
  amount: number;
  seasonId?: string;
  openedOn: Date;
  sourceBlockId?: string;
  sourceRow?: number;
}

export interface NewSettlement {
  obligationId: string;
  amount: number;
  kind: SettlementKind;
  ledgerEntryId?: string;
  paymentId?: string;
  /** Required on an offset: what it was set against. */
  note?: string;
  settledOn: Date;
  recordedBy: string;
}

export interface SettlementRow {
  id: string;
  amountAgorot: number;
  kind: SettlementKind;
  ledgerEntryId: string | null;
  paymentId: string | null;
  note: string | null;
  settledOn: Date;
}

export interface ObligationRow {
  id: string;
  direction: ObligationDirection;
  partyPersonId: string | null;
  partyName: string | null;
  /** The linked person's name, else the raw string, else null. */
  displayParty: string | null;
  description: string;
  amountAgorot: number;
  settledAgorot: number;
  outstandingAgorot: number;
  settled: boolean;
  /** No linked person and no recorded name. Can never be settled. */
  unnamed: boolean;
  seasonId: string | null;
  sourceBlockId: string | null;
  sourceRow: number | null;
  settlements: SettlementRow[];
}

export async function createObligation(db: AnyDb, input: NewObligation): Promise<string> {
  if (isBlank(input.description)) throw new Error('לחוב חייב להיות תיאור');
  if (input.amount <= 0) throw new Error('סכום חוב חייב להיות חיובי');
  const [row] = await db.insert(obligations).values({
    direction: input.direction,
    partyPersonId: input.partyPersonId ?? null,
    partyName: isBlank(input.partyName) ? null : input.partyName!,
    description: input.description,
    amount: fromAgorot(toAgorot(input.amount)),
    seasonId: input.seasonId ?? null,
    openedOn: input.openedOn,
    sourceBlockId: input.sourceBlockId ?? null,
    sourceRow: input.sourceRow ?? null,
  }).returning();
  return row.id;
}

export async function listObligations(
  db: AnyDb, filter: { direction?: ObligationDirection; seasonId?: string } = {},
): Promise<ObligationRow[]> {
  const where = [];
  if (filter.direction) where.push(eq(obligations.direction, filter.direction));
  if (filter.seasonId) where.push(eq(obligations.seasonId, filter.seasonId));

  const rows = await db
    .select({
      obligation: obligations,
      personName: persons.displayName,
    })
    .from(obligations)
    .leftJoin(persons, eq(persons.id, obligations.partyPersonId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(obligations.openedOn));

  const all = await db.select().from(obligationSettlements)
    .orderBy(asc(obligationSettlements.settledOn));

  const byObligation = new Map<string, SettlementRow[]>();
  for (const row of all) {
    const list = byObligation.get(row.obligationId) ?? [];
    list.push({
      id: row.id,
      amountAgorot: toAgorot(row.amount),
      kind: row.kind,
      ledgerEntryId: row.ledgerEntryId,
      paymentId: row.paymentId,
      note: row.note,
      settledOn: row.settledOn,
    });
    byObligation.set(row.obligationId, list);
  }

  return rows.map(({ obligation, personName }) => {
    const settlements = byObligation.get(obligation.id) ?? [];
    const amountAgorot = toAgorot(obligation.amount);
    const settledAgorot = settlements.reduce((n, s) => n + s.amountAgorot, 0);
    return {
      id: obligation.id,
      direction: obligation.direction,
      partyPersonId: obligation.partyPersonId,
      partyName: obligation.partyName,
      displayParty: personName ?? obligation.partyName ?? null,
      description: obligation.description,
      amountAgorot,
      settledAgorot,
      outstandingAgorot: Math.max(0, amountAgorot - settledAgorot),
      settled: settledAgorot >= amountAgorot,
      unnamed: !obligation.partyPersonId && !obligation.partyName,
      seasonId: obligation.seasonId,
      sourceBlockId: obligation.sourceBlockId,
      sourceRow: obligation.sourceRow,
      settlements,
    };
  });
}

/**
 * Discharges part or all of an obligation.
 *
 * An obligation with no party can never be settled. `שולם 500 — מקפיא
 * באיחסון נוסף` records money a member fronted and no name at all; marking it
 * settled would close the only record that anyone is owed anything, which is
 * exactly how the link was lost the first time.
 */
export async function settleObligation(db: AnyDb, input: NewSettlement): Promise<string> {
  if (input.amount <= 0) throw new Error('סכום קיזוז חייב להיות חיובי');
  if (input.kind === 'offset' && isBlank(input.note)) {
    throw new Error('קיזוז חייב לשאת הערה שאומרת מול מה קוזז');
  }

  const [obligation] = await db.select().from(obligations)
    .where(eq(obligations.id, input.obligationId));
  if (!obligation) throw new Error(`unknown obligation ${input.obligationId}`);

  if (!obligation.partyPersonId && !obligation.partyName) {
    throw new Error('אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף');
  }

  const existing = await db.select().from(obligationSettlements)
    .where(eq(obligationSettlements.obligationId, input.obligationId));
  const already = existing.reduce((n, row) => n + toAgorot(row.amount), 0);
  if (already + toAgorot(input.amount) > toAgorot(obligation.amount)) {
    throw new Error('אי אפשר לקזז יותר ממה שחייבים');
  }

  const [row] = await db.insert(obligationSettlements).values({
    obligationId: input.obligationId,
    amount: fromAgorot(toAgorot(input.amount)),
    kind: input.kind,
    ledgerEntryId: input.ledgerEntryId ?? null,
    paymentId: input.paymentId ?? null,
    note: isBlank(input.note) ? null : input.note!,
    settledOn: input.settledOn,
    recordedBy: input.recordedBy,
  }).returning();
  return row.id;
}

export async function unnamedObligations(db: AnyDb): Promise<ObligationRow[]> {
  return (await listObligations(db)).filter((row) => row.unnamed);
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/money/obligations.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation check**

- Delete the "no party" guard in `settleObligation`. Test 2 must FAIL.
- Delete the over-settlement guard. Test 4 must FAIL.
- Change `unnamed` to `!obligation.partyPersonId` only (ignoring `partyName`).
  **Expect this to SURVIVE the five tests above, and treat that as the
  finding.** Test 1 never asserts `unnamed`, and test 2's obligation has
  neither a person nor a name, so it reads `true` either way. Write a test
  that pins the case the mutation actually breaks: an obligation with a
  `partyName` but no `partyPersonId` — `יוסף` — must have `unnamed === false`
  and must be absent from `unnamedObligations`. Without it, a known creditor
  could silently fall into the "nobody knows who is owed" queue and become
  unsettleable.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money/obligations.ts src/lib/money/obligations.test.ts
git commit -F - <<'MSG'
feat(money): debts in both directions, and the join that never existed

חוב יוסף is now 15,240 owed, 14,330 settled and 910 outstanding as derived
figures, with the 6,000 line pointing at the five dues it discharged rather
than at a free-text note.

An obligation with no party can never be marked settled. Two of the twelve
ברן 25 reimbursements record no name, and closing them would destroy the
only evidence that someone is owed money.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 8: The season money summary

**Files:**
- Create: `src/lib/money/summary.ts`, `src/lib/money/summary.test.ts`

**Interfaces:**
- Consumes: `accountBalances` and `unattributedAgorot` (Task 2), `ledgerTotals`
  (Task 3), `listObligations` (Task 7), `duesFundingIdentity` (Task 6), and
  `seasons`.
- Deliberately does **not** consume `seasonFeeSummary`. Dues collected is
  already inside `ledgerTotals`, because `listMovements` unions `payments`
  with `ledger_entries`. Adding the fees summary alongside it would put the
  same shekels on the page twice and invite a caller to sum them.
- Produces: `seasonMoneySummary(db, seasonId): Promise<SeasonMoneySummary>` — one call, one shape, so the page never issues a second query to fill a hole.

- [ ] **Step 1: Write the failing test**

`src/lib/money/summary.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createAccount } from './accounts';
import { recordEntry } from './ledger';
import { createBudgetLine } from './budget';
import { createFundingTarget } from './funding';
import { createObligation } from './obligations';
import { seasonMoneySummary } from './summary';

let db: TestDb;
let s26: string;

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('the season money summary', () => {
  it('gathers balances, totals, the identity and what is owed in one call', async () => {
    const kupa = await createAccount(db, { name: 'קופת מזומן', kind: 'cash', openingBalance: 1584 });
    await recordEntry(db, {
      occurredOn: new Date('2026-07-18T00:00:00Z'), direction: 'in', amount: 57000,
      description: 'רווח מסיבת פקאנים', accountId: kupa.id, seasonId: s26, recordedBy: 'lead',
    });
    await createBudgetLine(db, { seasonId: s26, label: 'הכל', total: 64375.3, category: 'camp' });
    await createFundingTarget(db, { seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 22375.3 });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'יוסף', description: 'חוב יוסף',
      amount: 15240, openedOn: new Date('2026-06-01T00:00:00Z'), seasonId: s26,
    });

    const summary = await seasonMoneySummary(db, s26);

    expect(summary.seasonName).toBe('ברן 26');
    expect(summary.totalBalanceAgorot).toBe(5858400);
    expect(summary.accounts).toHaveLength(1);
    expect(summary.identity.closes).toBe(true);
    expect(summary.identity.perPersonFullAgorot).toBe(183929);
    expect(summary.ledger.inAgorot).toBe(5700000);
    expect(summary.campOwesAgorot).toBe(1524000);
    expect(summary.owedToCampAgorot).toBe(0);
  });

  it('reports unattributed money rather than folding it into an account', async () => {
    await recordEntry(db, {
      occurredOn: new Date(), direction: 'in', amount: 250,
      description: 'בלי חשבון', seasonId: s26, recordedBy: 'lead',
    });
    const summary = await seasonMoneySummary(db, s26);
    expect(summary.unattributed.entriesAgorot).toBe(25000);
    expect(summary.totalBalanceAgorot).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/money/summary.test.ts`
Expected: FAIL — cannot resolve `./summary`.

- [ ] **Step 3: Implement**

`src/lib/money/summary.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { seasons } from '@/db/schema/camp';
import { accountBalances, unattributedAgorot } from './accounts';
import type { AccountBalance } from './accounts';
import { ledgerTotals } from './ledger';
import { listObligations } from './obligations';
import type { ObligationRow } from './obligations';
import { duesFundingIdentity } from './funding';
import type { DuesFundingIdentity } from './funding';

export interface SeasonMoneySummary {
  seasonId: string;
  seasonName: string;
  accounts: AccountBalance[];
  totalBalanceAgorot: number;
  unattributed: { paymentsAgorot: number; entriesAgorot: number };
  ledger: { inAgorot: number; outAgorot: number; netAgorot: number; count: number };
  identity: DuesFundingIdentity;
  campOwes: ObligationRow[];
  owedToCamp: ObligationRow[];
  campOwesAgorot: number;
  owedToCampAgorot: number;
  /** Obligations with no party. Never empty-able by settling them. */
  unnamed: ObligationRow[];
}

/**
 * Everything the money page needs, in one call.
 *
 * Deliberately one shape rather than seven exported queries: the page is a
 * server component, and a summary that forces a second round trip to fill a
 * hole is a data-shape defect, not a page defect.
 *
 * Account balances are camp-wide, not season-scoped — a קופה does not reset
 * at the burn. Ledger totals and obligations are season-scoped.
 */
export async function seasonMoneySummary(
  db: AnyDb, seasonId: string,
): Promise<SeasonMoneySummary> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const accounts = await accountBalances(db);
  const campOwes = await listObligations(db, { direction: 'camp_owes', seasonId });
  const owedToCamp = await listObligations(db, { direction: 'owed_to_camp', seasonId });

  const sumOutstanding = (rows: ObligationRow[]) =>
    rows.reduce((n, row) => n + row.outstandingAgorot, 0);

  return {
    seasonId,
    seasonName: season.name,
    accounts,
    totalBalanceAgorot: accounts.reduce((n, row) => n + row.balanceAgorot, 0),
    unattributed: await unattributedAgorot(db),
    ledger: await ledgerTotals(db, { seasonId }),
    identity: await duesFundingIdentity(db, seasonId),
    campOwes,
    owedToCamp,
    campOwesAgorot: sumOutstanding(campOwes),
    owedToCampAgorot: sumOutstanding(owedToCamp),
    unnamed: [...campOwes, ...owedToCamp].filter((row) => row.unnamed),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/money/summary.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/money/summary.ts src/lib/money/summary.test.ts
git commit -F - <<'MSG'
feat(money): one summary call for the whole page

One shape rather than seven exported queries. A summary that forces the
page into a second round trip to fill a hole is a data-shape defect, and
this project has paid for that one before.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 9: Chart geometry, direction-aware

**Files:**
- Create: `src/components/charts/geometry.ts`, `src/components/charts/geometry.test.ts`

**Interfaces:**
- Produces:
  - `barGeometry(input: { valueAgorot, maxAgorot, width, direction }): { x, width }`
  - `stackGeometry(input: { segmentsAgorot: number[], totalAgorot, width, direction, gap }): Array<{ x, width }>`
  - `linePoints(input: { values: number[], width, height, direction }): Array<{ x, y }>`
  - `textAnchorFor(direction): 'start' | 'end'`

- [ ] **Step 1: Write the failing test**

`src/components/charts/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { barGeometry, stackGeometry, linePoints, textAnchorFor } from './geometry';

/**
 * SVG has no logical properties. In Hebrew a horizontal bar must grow from
 * the right — the inline-start edge — and every anchor mirrors with it. Every
 * one of these assertions was a real defect class in this codebase's CSS
 * before logical properties were adopted; SVG reintroduces it.
 */
describe('chart geometry in RTL', () => {
  it('grows a bar leftward from the right edge', () => {
    const bar = barGeometry({ valueAgorot: 2500, maxAgorot: 10000, width: 400, direction: 'rtl' });
    expect(bar.width).toBe(100);
    expect(bar.x).toBe(300);
  });

  it('grows a bar rightward from zero in LTR', () => {
    const bar = barGeometry({ valueAgorot: 2500, maxAgorot: 10000, width: 400, direction: 'ltr' });
    expect(bar.width).toBe(100);
    expect(bar.x).toBe(0);
  });

  it('gives a zero-valued bar no width and still places it on the start edge', () => {
    expect(barGeometry({ valueAgorot: 0, maxAgorot: 10000, width: 400, direction: 'rtl' }))
      .toEqual({ x: 400, width: 0 });
  });

  it('never divides by a zero maximum', () => {
    expect(barGeometry({ valueAgorot: 500, maxAgorot: 0, width: 400, direction: 'rtl' }))
      .toEqual({ x: 400, width: 0 });
  });

  it('lays stacked segments from the start edge with a 2px surface gap', () => {
    const segments = stackGeometry({
      segmentsAgorot: [4200000, 2237530], totalAgorot: 6437530,
      width: 400, direction: 'rtl', gap: 2,
    });
    expect(segments).toHaveLength(2);
    // first segment hugs the right edge. toBeCloseTo, not toBe: these are
    // floats, and 400 - w + w is not reliably 400.
    expect(segments[0].x + segments[0].width).toBeCloseTo(400, 6);
    // second sits to its left, separated by the gap
    expect(segments[0].x - (segments[1].x + segments[1].width)).toBeCloseTo(2, 6);
  });

  it('mirrors line points so time runs right to left', () => {
    const points = linePoints({ values: [0, 50, 100], width: 200, height: 50, direction: 'rtl' });
    expect(points[0].x).toBe(200);
    expect(points[2].x).toBe(0);
    // y is inverted: the largest value sits at the top
    expect(points[2].y).toBe(0);
    expect(points[0].y).toBe(50);
  });

  it('anchors text to the correct edge per direction', () => {
    expect(textAnchorFor('rtl')).toBe('end');
    expect(textAnchorFor('ltr')).toBe('start');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `./node_modules/.bin/vitest run src/components/charts/geometry.test.ts`
Expected: FAIL — cannot resolve `./geometry`.

- [ ] **Step 3: Implement**

`src/components/charts/geometry.ts`:

```ts
export type Direction = 'rtl' | 'ltr';

export interface BarInput {
  valueAgorot: number;
  maxAgorot: number;
  width: number;
  direction: Direction;
}

export interface Box { x: number; width: number }

/**
 * SVG has no logical properties, so direction is an explicit parameter rather
 * than something CSS can be trusted to mirror. In `rtl` a bar starts at the
 * right edge and grows leftward.
 */
export function barGeometry(input: BarInput): Box {
  const ratio = input.maxAgorot > 0
    ? Math.min(1, Math.max(0, input.valueAgorot / input.maxAgorot))
    : 0;
  const width = ratio * input.width;
  return {
    x: input.direction === 'rtl' ? input.width - width : 0,
    width,
  };
}

export interface StackInput {
  segmentsAgorot: number[];
  totalAgorot: number;
  width: number;
  direction: Direction;
  /** Surface-coloured gap between adjacent fills. */
  gap: number;
}

export function stackGeometry(input: StackInput): Box[] {
  const boxes: Box[] = [];
  let offset = 0;

  for (const segment of input.segmentsAgorot) {
    const ratio = input.totalAgorot > 0
      ? Math.min(1, Math.max(0, segment / input.totalAgorot))
      : 0;
    const width = Math.max(0, ratio * input.width - input.gap);
    boxes.push({
      x: input.direction === 'rtl' ? input.width - offset - width : offset,
      width,
    });
    offset += ratio * input.width;
  }

  return boxes;
}

export interface LineInput {
  values: number[];
  width: number;
  height: number;
  direction: Direction;
}

export function linePoints(input: LineInput): Array<{ x: number; y: number }> {
  const count = input.values.length;
  if (count === 0) return [];

  const max = Math.max(...input.values);
  const min = Math.min(...input.values);
  const span = max - min || 1;
  const step = count > 1 ? input.width / (count - 1) : 0;

  return input.values.map((value, index) => {
    const progress = index * step;
    return {
      x: input.direction === 'rtl' ? input.width - progress : progress,
      y: input.height - ((value - min) / span) * input.height,
    };
  });
}

/** `text-anchor="start"` is wrong in Hebrew. */
export function textAnchorFor(direction: Direction): 'start' | 'end' {
  return direction === 'rtl' ? 'end' : 'start';
}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/components/charts/geometry.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation check — this is the one the spec names first**

- Make `barGeometry` always return `x: 0`. Tests 1, 3 and 4 must FAIL.
- Make `textAnchorFor` always return `'start'`. Test 7 must FAIL.
- Remove the `maxAgorot > 0` guard. Test 4 must FAIL — but not with `NaN`:
  `500 / 0` is `Infinity`, which the clamp turns into a ratio of 1, so the bar
  renders at **full width** instead of zero. That is the more dangerous
  failure of the two, because a full bar looks like real data rather than like
  a bug.
- Remove the gap subtraction in `stackGeometry`. Test 5 must FAIL.

- [ ] **Step 6: Commit**

```bash
git add src/components/charts/geometry.ts src/components/charts/geometry.test.ts
git commit -F - <<'MSG'
feat(charts): geometry that knows which way the page reads

SVG has no logical properties, so direction is an explicit parameter. In
Hebrew a horizontal bar grows from the right edge and text anchors to end;
getting that wrong looks fine in a unit test and wrong in the browser,
which is why the geometry is pure and tested away from the DOM.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 10: The chart components

**Files:**
- Create: `src/components/charts/charts.module.css`, `src/components/charts/stat-tile.tsx`, `src/components/charts/bar-list.tsx`, `src/components/charts/stacked-bar.tsx`, `src/components/charts/meter.tsx`
- Create: `src/components/charts/bar-list.test.tsx`, `src/components/charts/stacked-bar.test.tsx`

**Interfaces:**
- Consumes: `geometry.ts`, `formatILS` from `@/lib/money`.
- Produces:
  - `<StatTile label value derivation? tone? />`
  - `<BarList items={[{ id, label, valueAgorot, tone？, note? }]} />`
  - `<StackedBar segments={[{ id, label, valueAgorot, series }]} totalAgorot remainderLabel? />`
  - `<Meter label valueAgorot totalAgorot />`

- [ ] **Step 1: Write the failing tests**

`src/components/charts/bar-list.test.tsx`:

The `@vitest-environment jsdom` docblock is **required and must be the first
thing in the file**. `vitest.config.ts` sets `environment: 'node'` globally, so
every component test in this repo opts into a DOM per file — see
`src/app/(admin)/nav.test.tsx`. Without it, `render` fails with no `document`.

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarList } from './bar-list';

describe('BarList', () => {
  it('renders every item with its value and a table view', () => {
    render(<BarList items={[
      { id: 'a', label: 'עו״ש אופק', valueAgorot: 1407955 },
      { id: 'b', label: 'קופת מזומן', valueAgorot: 158400 },
    ]} />);
    expect(screen.getByText('עו״ש אופק')).toBeTruthy();
    expect(screen.getByText(/14,079.55/)).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows a note beside an item that carries one, with its own icon', () => {
    render(<BarList items={[{
      id: 'a', label: 'עו״ש אופק', valueAgorot: 1407955,
      tone: 'warning', note: 'חשבון פרטי של חבר מחנה',
    }]} />);
    expect(screen.getByText('חשבון פרטי של חבר מחנה')).toBeTruthy();
    // status never carries meaning by colour alone
    expect(screen.getByRole('img', { name: /אזהרה/ })).toBeTruthy();
  });

  it('renders nothing but an invitation when there are no items', () => {
    render(<BarList items={[]} emptyMessage="עדיין אין חשבונות" />);
    expect(screen.getByText('עדיין אין חשבונות')).toBeTruthy();
  });
});
```

`src/components/charts/stacked-bar.test.tsx` (same jsdom docblock requirement):

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StackedBar } from './stacked-bar';

describe('StackedBar', () => {
  it('direct-labels both segments and names them in a legend', () => {
    render(<StackedBar
      segments={[
        { id: 'dues', label: 'דמי קאמפ', valueAgorot: 4200000, series: 1 },
        { id: 'raise', label: 'גיוס', valueAgorot: 2237530, series: 2 },
      ]}
      totalAgorot={6437530}
    />);
    expect(screen.getByText('דמי קאמפ')).toBeTruthy();
    expect(screen.getByText('גיוס')).toBeTruthy();
    expect(screen.getByText(/42,000/)).toBeTruthy();
    expect(screen.getByText(/22,375.30/)).toBeTruthy();
  });

  it('shows the unfilled remainder as a named gap, not a third series', () => {
    render(<StackedBar
      segments={[{ id: 'raised', label: 'גויס', valueAgorot: 1000000, series: 1 }]}
      totalAgorot={2237530}
      remainderLabel="נותר לגייס"
    />);
    expect(screen.getByText('נותר לגייס')).toBeTruthy();
    expect(screen.getByText(/12,375.30/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `./node_modules/.bin/vitest run src/components/charts/`
Expected: FAIL — cannot resolve `./bar-list`.

- [ ] **Step 3: Write the shared stylesheet**

`src/components/charts/charts.module.css`:

```css
/*
 * Series colours are the documented dark steps of the validated palette,
 * checked against this app's real card surface (#141210) with
 * scripts/validate_palette.js: lightness band PASS, chroma floor PASS,
 * CVD separation worst all-pairs ΔE 9.4 (deutan), normal-vision worst
 * ΔE 20.9, contrast ≥ 3:1 PASS.
 *
 * --flare (#EB7837) is deliberately absent. It fails the dark lightness band
 * (OKLCH L 0.694 against a 0.67 ceiling) and drops the CVD pair into the warn
 * band, so it stays what it already is: the UI accent for links and warnings.
 *
 * Status `serious` (#ec835a) is also absent: it sits ~5.8 ΔE from series
 * orange and almost on top of --flare, and three oranges meaning three
 * different things is how a page lies. Status here is good/warning/critical
 * only, always with an icon and a word.
 */
.viz {
  --series-1: #d95926;
  --series-2: #3987e5;
  --series-3: #199e70;
  --track: #2b2724;
  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-critical: #d03b3b;
}

.row {
  display: grid;
  grid-template-columns: minmax(6rem, 10rem) 1fr auto;
  gap: 0.75rem;
  align-items: center;
  margin-block-end: 0.5rem;
}

.label { color: var(--sand); font-size: 0.875rem; }
.value { color: var(--sand); font-size: 0.875rem; font-variant-numeric: tabular-nums; }
.note { color: var(--dust); font-size: 0.8125rem; }

.track { fill: var(--track); }
.mark1 { fill: var(--series-1); }
.mark2 { fill: var(--series-2); }
.mark3 { fill: var(--series-3); }

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-block-start: 0.5rem;
  font-size: 0.8125rem;
  color: var(--dust);
}

/* Its own element so the label is matchable on its own; text wears text
 * tokens, never the series colour — the swatch beside it carries identity. */
.legendLabel { color: var(--dust); }

.swatch {
  inline-size: 0.625rem;
  block-size: 0.625rem;
  border-radius: 0.125rem;
  display: inline-block;
  margin-inline-end: 0.375rem;
}

/* The table view is the relief channel a contrast WARN obligates, and the
 * non-visual reading of every chart. Visually hidden, never display:none. */
.tableView {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.tile { padding-block: 0.5rem; }
.tileValue {
  font-family: var(--font-display), Georgia, serif;
  font-size: 1.75rem;
  font-variant-numeric: tabular-nums;
}
.tileLabel { color: var(--dust); font-size: 0.8125rem; }
.tileDerivation { color: var(--dust-dim); font-size: 0.75rem; }
```

- [ ] **Step 4: Write the components**

`src/components/charts/stat-tile.tsx`:

```tsx
import { formatILS } from '@/lib/money';
import styles from './charts.module.css';

export function StatTile({ label, valueAgorot, derivation }: {
  label: string;
  valueAgorot: number;
  /** The arithmetic behind the figure, so no number is unexplained. */
  derivation?: string;
}) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>
        <bdi>{formatILS(valueAgorot)} ₪</bdi>
      </div>
      {derivation ? <div className={styles.tileDerivation}>{derivation}</div> : null}
    </div>
  );
}
```

`src/components/charts/bar-list.tsx`:

```tsx
import { formatILS } from '@/lib/money';
import { barGeometry } from './geometry';
import styles from './charts.module.css';

const WIDTH = 320;
const HEIGHT = 14;

export interface BarItem {
  id: string;
  label: string;
  valueAgorot: number;
  tone?: 'warning' | 'critical';
  note?: string;
}

/**
 * Nominal categories: every bar wears the same series-1 hue. Colouring a
 * nominal bar by its value spends the identity channel re-encoding what the
 * bar's length already shows.
 */
export function BarList({ items, emptyMessage }: {
  items: BarItem[];
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="muted">{emptyMessage ?? 'אין מה להציג כאן עדיין'}</p>;
  }

  const max = Math.max(...items.map((item) => item.valueAgorot), 0);

  return (
    <div className={styles.viz}>
      {items.map((item) => {
        const bar = barGeometry({
          valueAgorot: item.valueAgorot, maxAgorot: max, width: WIDTH, direction: 'rtl',
        });
        return (
          <div key={item.id} className={styles.row}>
            <span className={styles.label}>
              {item.label}
              {item.tone ? (
                <span role="img" aria-label={item.tone === 'warning' ? 'אזהרה' : 'שגיאה'}>
                  {' '}⚠
                </span>
              ) : null}
            </span>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" aria-hidden="true">
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={4} className={styles.track} />
              <rect x={bar.x} y={0} width={bar.width} height={HEIGHT} rx={4}
                    className={styles.mark1} />
            </svg>
            <span className={styles.value}><bdi>{formatILS(item.valueAgorot)} ₪</bdi></span>
            {item.note ? <span className={styles.note}>{item.note}</span> : null}
          </div>
        );
      })}
      <table className={styles.tableView}>
        <caption>הנתונים שמאחורי התרשים</caption>
        <thead><tr><th>שם</th><th>סכום</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.label}</td>
              <td><bdi>{formatILS(item.valueAgorot)} ₪</bdi></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/components/charts/stacked-bar.tsx`:

```tsx
import { formatILS } from '@/lib/money';
import { stackGeometry } from './geometry';
import styles from './charts.module.css';

const WIDTH = 640;
const HEIGHT = 22;
const GAP = 2;

export interface Segment {
  id: string;
  label: string;
  valueAgorot: number;
  /** Palette slot, 1-3. Assigned in fixed order, never cycled. */
  series: 1 | 2 | 3;
}

const MARK = { 1: styles.mark1, 2: styles.mark2, 3: styles.mark3 } as const;

/**
 * Part-to-whole plus progress against a limit. The unfilled remainder is the
 * track showing through, never a third series — a shortfall means "not yet",
 * which is a state, and states do not take identity colours.
 */
export function StackedBar({ segments, totalAgorot, remainderLabel }: {
  segments: Segment[];
  totalAgorot: number;
  remainderLabel?: string;
}) {
  const boxes = stackGeometry({
    segmentsAgorot: segments.map((s) => s.valueAgorot),
    totalAgorot, width: WIDTH, direction: 'rtl', gap: GAP,
  });
  const filled = segments.reduce((n, s) => n + s.valueAgorot, 0);
  const remainder = Math.max(0, totalAgorot - filled);

  return (
    <div className={styles.viz}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" aria-hidden="true">
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={4} className={styles.track} />
        {segments.map((segment, index) => (
          <rect key={segment.id} x={boxes[index].x} y={0} width={boxes[index].width}
                height={HEIGHT} rx={4} className={MARK[segment.series]} />
        ))}
      </svg>

      <div className={styles.legend}>
        {segments.map((segment) => (
          <span key={segment.id}>
            <span className={styles.swatch}
                  style={{ background: `var(--series-${segment.series})` }} />
            {/* The label is its own element so a test can match it exactly;
                a span reading "דמי קאמפ 42,000 ₪" matches neither half. */}
            <span className={styles.legendLabel}>{segment.label}</span>{' '}
            <bdi>{formatILS(segment.valueAgorot)} ₪</bdi>
          </span>
        ))}
        {remainderLabel && remainder > 0 ? (
          <span>
            <span className={styles.swatch} style={{ background: 'var(--track)' }} />
            <span className={styles.legendLabel}>{remainderLabel}</span>{' '}
            <bdi>{formatILS(remainder)} ₪</bdi>
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

`src/components/charts/meter.tsx`:

```tsx
import { formatILS } from '@/lib/money';
import { barGeometry } from './geometry';
import styles from './charts.module.css';

const WIDTH = 200;
const HEIGHT = 10;

/** One ratio against a limit — settled against owed. */
export function Meter({ label, valueAgorot, totalAgorot }: {
  label: string;
  valueAgorot: number;
  totalAgorot: number;
}) {
  const bar = barGeometry({
    valueAgorot, maxAgorot: totalAgorot, width: WIDTH, direction: 'rtl',
  });
  return (
    <span className={styles.viz}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
           aria-label={`${label}: ${formatILS(valueAgorot)} מתוך ${formatILS(totalAgorot)} שקלים`}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={4} className={styles.track} />
        <rect x={bar.x} y={0} width={bar.width} height={HEIGHT} rx={4} className={styles.mark1} />
      </svg>
    </span>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `./node_modules/.bin/vitest run src/components/charts/`
Expected: PASS, 12 tests (7 geometry + 3 bar-list + 2 stacked-bar).

- [ ] **Step 6: Mutation check**

- Remove the `<table className={styles.tableView}>` from `BarList`. Test 1 must FAIL — the table view is the relief channel, not decoration.
- Remove the `role="img"` label from `Meter`. Add a test if none covers it.
- Change `styles.tableView` to `display: none`. No test will catch this; **add an assertion** that the table is present in the accessibility tree.

- [ ] **Step 7: Commit**

```bash
git add src/components/charts/
git commit -F - <<'MSG'
feat(charts): four forms, a validated palette, and a table under each

Series colours are the documented dark steps checked against this app's
real card surface with the palette validator, not chosen by eye. The brand
flare is deliberately excluded: it fails the dark lightness band and sits
almost on top of status-serious, and three oranges meaning three different
things is how a page lies.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 11: The money page

**Files:**
- Create: `src/app/(admin)/money/page.tsx`, `src/app/(admin)/money/money.module.css`
- Modify: `src/app/(admin)/nav.tsx`, `src/app/(admin)/nav.test.tsx`, `src/app/(admin)/page.tsx`

**Interfaces:**
- Consumes: `seasonMoneySummary`, `listMovements`, `listBudgetLines`, `budgetDerivation`, the chart components, `requireAdmin`, `listSeasons`.

- [ ] **Step 1: Write the failing nav test**

Add to `src/app/(admin)/nav.test.tsx`:

```tsx
  it('links כספים', () => {
    render(<Nav />);
    const link = screen.getByRole('link', { name: 'כספים' });
    expect(link.getAttribute('href')).toBe('/money');
  });
```

- [ ] **Step 2: Run and verify it fails**

Run: `./node_modules/.bin/vitest run src/app/\(admin\)/nav.test.tsx`
Expected: FAIL — no such link.

- [ ] **Step 3: Add the nav entry**

In `src/app/(admin)/nav.tsx`, insert into `SECTIONS` after `/fees`:

```ts
  { href: '/money', label: 'כספים' },
```

- [ ] **Step 4: Build the page**

`src/app/(admin)/money/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { seasonMoneySummary } from '@/lib/money/summary';
import { listMovements } from '@/lib/money/ledger';
import { listBudgetLines, budgetDerivation } from '@/lib/money/budget';
import { formatILS } from '@/lib/money';
import { StatTile } from '@/components/charts/stat-tile';
import { BarList } from '@/components/charts/bar-list';
import { StackedBar } from '@/components/charts/stacked-bar';
import { Meter } from '@/components/charts/meter';
import styles from './money.module.css';

export const dynamic = 'force-dynamic';

export default async function MoneyPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main>
        <h1>כספים</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const { season: requested } = await searchParams;
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  const summary = await seasonMoneySummary(db, season.id);
  const movements = await listMovements(db, { seasonId: season.id });
  const budget = await listBudgetLines(db, season.id);
  const { identity } = summary;

  // `listSeasons` is ordered by year descending, so the first season older
  // than this one is its predecessor. Without one there is nothing to derive
  // from, and the section is omitted rather than rendered empty.
  const previousSeason = seasons.find((option) => option.year < season.year);
  const derivation = previousSeason
    ? await budgetDerivation(db, previousSeason.id, season.id)
    : [];

  return (
    <main>
      <h1>כספים</h1>

      <nav className={styles.seasons} aria-label="בחירת שנה">
        {seasons.map((option) => (
          <Link key={option.id} href={`/money?season=${option.id}`}
                aria-current={option.id === season.id ? 'page' : undefined}>
            {option.name}
          </Link>
        ))}
      </nav>

      <section className={styles.lead}>
        <p className={styles.hero}><bdi>{formatILS(identity.flatRateAgorot)} ₪</bdi></p>
        {identity.perPersonFullAgorot !== null && identity.perPersonFundingAgorot !== null ? (
          <p className={styles.thesis}>
            כל חבר משלם. התקציב המלא הוא{' '}
            <bdi>{formatILS(identity.budgetTotalAgorot)} ₪</bdi> ל־
            <bdi>{identity.plannedSize}</bdi> איש —{' '}
            <bdi>{formatILS(identity.perPersonFullAgorot)} ₪</bdi> לאדם.
            הגיוס מכסה <bdi>{formatILS(identity.perPersonFundingAgorot)} ₪</bdi> מכל אחד מהם.
          </p>
        ) : (
          <p className="muted">
            אי אפשר לחשב עלות לאדם בלי גודל מחנה מתוכנן לשנה הזו.
          </p>
        )}
        {!identity.closes && identity.perPersonFullAgorot !== null ? (
          <p className="badge-warn">
            ⚠ דמי הקאמפ והגיוס לא מסתכמים לתקציב. משהו כאן לא מתאים — התקציב,
            היעד או גודל המחנה.
          </p>
        ) : null}

        <StackedBar
          segments={[
            { id: 'dues', label: 'דמי קאמפ', valueAgorot: identity.duesCoverAgorot ?? 0, series: 1 },
            { id: 'raise', label: 'יעד גיוס', valueAgorot: identity.fundingTargetAgorot, series: 2 },
          ]}
          totalAgorot={identity.budgetTotalAgorot}
        />
      </section>

      <section className={styles.tiles}>
        <StatTile label="יתרה בכל החשבונות" valueAgorot={summary.totalBalanceAgorot}
                  derivation={`${summary.accounts.length} חשבונות`} />
        <StatTile label="נכנס בשנה הזו" valueAgorot={summary.ledger.inAgorot}
                  derivation={`${summary.ledger.count} תנועות`} />
        <StatTile label="יצא בשנה הזו" valueAgorot={summary.ledger.outAgorot} />
        <StatTile label="אנחנו חייבים" valueAgorot={summary.campOwesAgorot} />
      </section>

      <section className="card">
        <h2>איפה הכסף</h2>
        <BarList
          emptyMessage="עדיין לא נרשמו חשבונות."
          items={summary.accounts.map((account) => ({
            id: account.accountId,
            label: account.name,
            valueAgorot: account.balanceAgorot,
            tone: account.kind === 'personal' ? ('warning' as const) : undefined,
            note: account.kind === 'personal'
              ? `חשבון פרטי של ${account.holderName ?? 'חבר מחנה'} שמחזיק כסף של הקאמפ`
              : undefined,
          }))}
        />
        {summary.unattributed.paymentsAgorot + summary.unattributed.entriesAgorot > 0 ? (
          <p className="badge-warn">
            ⚠ <bdi>
              {formatILS(summary.unattributed.paymentsAgorot + summary.unattributed.entriesAgorot)} ₪
            </bdi>{' '}
            נרשמו בלי לציין לאיזה חשבון נכנסו.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>מה חייבים ומה חייבים לנו</h2>
        {summary.campOwes.length === 0 && summary.owedToCamp.length === 0 ? (
          <p className="muted">אין חובות רשומים לשנה הזו.</p>
        ) : (
          <table>
            <thead>
              <tr><th>למי</th><th>על מה</th><th>סכום</th><th>קוזז</th><th>נותר</th></tr>
            </thead>
            <tbody>
              {[...summary.campOwes, ...summary.owedToCamp].map((row) => (
                <tr key={row.id}>
                  <td>{row.displayParty ?? <span className="badge-warn">⚠ חסר שם</span>}</td>
                  <td>{row.description}</td>
                  <td><bdi>{formatILS(row.amountAgorot)} ₪</bdi></td>
                  <td>
                    <Meter label={row.description} valueAgorot={row.settledAgorot}
                           totalAgorot={row.amountAgorot} />
                  </td>
                  <td><bdi>{formatILS(row.outstandingAgorot)} ₪</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {summary.unnamed.length > 0 ? (
          <p className="badge-warn">
            ⚠ <bdi>{summary.unnamed.length}</bdi> חובות בלי שם. אי אפשר לסגור
            אותם עד שיירשם למי מגיע הכסף.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>התנועות</h2>
        {movements.length === 0 ? (
          <p className="muted">
            עדיין אין תנועות ל<bdi>{season.name}</bdi>.
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr><th>תאריך</th><th>תיאור</th><th>חשבון</th><th>נכנס</th><th>יצא</th></tr>
              </thead>
              <tbody>
                {movements.map((move) => (
                  <tr key={`${move.source}-${move.id}`}>
                    <td><bdi>{move.occurredOn.toLocaleDateString('he-IL')}</bdi></td>
                    <td>{move.description}</td>
                    <td>{move.accountName ?? <span className="muted">לא צוין</span>}</td>
                    <td>{move.direction === 'in'
                      ? <bdi>{formatILS(move.amountAgorot)} ₪</bdi> : null}</td>
                    <td>{move.direction === 'out'
                      ? <bdi>{formatILS(move.amountAgorot)} ₪</bdi> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {derivation.length > 0 ? (
        <section className="card">
          <h2>מאיפה התקציב הזה בא</h2>
          <p className="muted">
            כל סעיף מול מה שהוצא עליו ב<bdi>{previousSeason!.name}</bdi>.
          </p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>סעיף</th><th>בפועל</th><th>בתקציב</th><th>הפרש</th><th>למה</th>
                </tr>
              </thead>
              <tbody>
                {derivation.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.actualAgorot === null
                      ? <span className="muted">סעיף חדש</span>
                      : <bdi>{formatILS(row.actualAgorot)} ₪</bdi>}</td>
                    <td>{row.forecastAgorot === null
                      ? <span className="muted">ירד מהתקציב</span>
                      : <bdi>{formatILS(row.forecastAgorot)} ₪</bdi>}</td>
                    <td>{row.bufferAgorot === null ? '' : (
                      <bdi className={row.bufferAgorot < 0 ? 'badge-warn' : undefined}>
                        {row.bufferAgorot > 0 ? '+' : ''}{formatILS(row.bufferAgorot)} ₪
                      </bdi>
                    )}</td>
                    <td className="muted">{row.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>התקציב</h2>
        {budget.length === 0 ? (
          <p className="muted">
            עדיין לא נרשם תקציב ל<bdi>{season.name}</bdi>.
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr><th>סעיף</th><th>כמות</th><th>ליחידה</th><th>סה״כ</th><th>למה</th></tr>
              </thead>
              <tbody>
                {budget.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.label}
                      {line.arithmeticOff ? (
                        <span className="badge-warn" title="כמות × מחיר ליחידה אינו שווה לסה״כ">
                          {' '}⚠
                        </span>
                      ) : null}
                    </td>
                    <td><bdi>{line.quantityText ?? ''}</bdi></td>
                    <td>{line.unitCostAgorot === null
                      ? '' : <bdi>{formatILS(line.unitCostAgorot)} ₪</bdi>}</td>
                    <td><bdi>{formatILS(line.totalAgorot)} ₪</bdi></td>
                    <td className="muted">{line.rationale ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
```

`src/app/(admin)/money/money.module.css`:

```css
.seasons { display: flex; gap: 1rem; margin-block-end: 1.5rem; }
.seasons a[aria-current='page'] { color: var(--sand); text-decoration: none; }

.lead {
  border-inline-start: 3px solid var(--flare);
  padding-inline-start: 1rem;
  margin-block-end: 2rem;
}

.hero {
  font-family: var(--font-display), Georgia, serif;
  font-size: clamp(2.5rem, 8vw, 4rem);
  line-height: 1.1;
  margin-block: 0 0.25rem;
  font-variant-numeric: tabular-nums;
}

.thesis {
  max-inline-size: 42rem;
  color: var(--dust);
  margin-block: 0 1rem;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
  margin-block-end: 2rem;
}
```

- [ ] **Step 5: Update the overview page**

`src/app/(admin)/page.tsx` was rebuilt in commit `7fe31d7` into a live
dashboard — it no longer contains the "not built yet" paragraph an earlier
draft of this plan expected. **Read the file before editing it.**

Add one entry to its `מה יש כאן` list, placed directly after the
`דמי קאמפ` line so the money entries sit together:

```tsx
          <li><Link href="/money">כספים</Link> — איפה הכסף, מה נכנס ויצא, ומה חייבים</li>
```

Change nothing else on that page. Its season figures, its collected-against-
expected bar and its two conditional sections are not this task's business,
and the bar in particular is a deliberate, commented design choice — do not
"unify" it with the new chart components.

- [ ] **Step 6: Run the tests and the type check**

Run: `./node_modules/.bin/vitest run`
Expected: PASS, full suite. Read the COUNT.

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(admin\)/money/ src/app/\(admin\)/nav.tsx src/app/\(admin\)/nav.test.tsx src/app/\(admin\)/page.tsx
git commit -F - <<'MSG'
feat(money): the page, leading on the sentence no workbook contains

The budget is 64,375.30 for 35 people, which is 1,839.29 each; dues are
1,200 and fundraising covers the 639.29 difference. Both halves sit in one
sheet and nothing in it states the relationship, so the page opens with it.

When the halves do not add up the page says so rather than quietly
rendering a bar that looks fine.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 12: Seed the workbooks' money

**Files:**
- Modify: `src/lib/seed/camp-seed.ts`, `src/lib/seed/camp-seed.test.ts`

**Interfaces:**
- Produces: `CampSeedResult` gains `accounts`, `movements`, `budgetLines`, `fundingTargets`, `obligations`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/seed/camp-seed.test.ts`:

```ts
  it('seeds the three ברן 25 accounts, including the personal one', async () => {
    await seedCampBaseline(db, LEAD);
    const { accountBalances } = await import('@/lib/money/accounts');
    const balances = await accountBalances(db);
    const names = balances.map((row) => row.name);
    expect(names).toContain('קופת מזומן');
    expect(names).toContain('עו״ש אופק');
    expect(names).toContain('וייבז קלוז פרינדס');

    const ofek = balances.find((row) => row.name === 'עו״ש אופק')!;
    expect(ofek.kind).toBe('personal');
    expect(ofek.holderName).toBe('אופק');
  });

  it('reproduces the ברן 26 ledger bottom line', async () => {
    await seedCampBaseline(db, LEAD);
    const { getSeasonByName } = await import('@/lib/members/roster');
    const { ledgerTotals } = await import('@/lib/money/ledger');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const totals = await ledgerTotals(db, { seasonId: s26.id });
    expect(totals.outAgorot).toBe(4527100);
    expect(totals.inAgorot).toBe(6200000);
    expect(totals.netAgorot).toBe(1672900);
  });

  it('closes the ברן 26 dues/fundraising identity from seeded rows', async () => {
    await seedCampBaseline(db, LEAD);
    const { getSeasonByName } = await import('@/lib/members/roster');
    const { duesFundingIdentity } = await import('@/lib/money/funding');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const identity = await duesFundingIdentity(db, s26.id);
    expect(identity.budgetTotalAgorot).toBe(6437530);
    expect(identity.perPersonFullAgorot).toBe(183929);
    expect(identity.perPersonFundingAgorot).toBe(63929);
    expect(identity.closes).toBe(true);
  });

  it('seeds חוב יוסף with 910 outstanding', async () => {
    await seedCampBaseline(db, LEAD);
    const { listObligations } = await import('@/lib/money/obligations');
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const yosef = rows.find((row) => row.description.includes('יוסף'))!;
    expect(yosef.amountAgorot).toBe(1524000);
    expect(yosef.settledAgorot).toBe(1433000);
    expect(yosef.outstandingAgorot).toBe(91000);
  });

  it('seeds all twelve reimbursements, including the two with no name', async () => {
    await seedCampBaseline(db, LEAD);
    const { listObligations, unnamedObligations } = await import('@/lib/money/obligations');
    const all = await listObligations(db, { direction: 'camp_owes' });
    const reimbursements = all.filter((row) => row.description !== 'חוב יוסף');
    expect(reimbursements).toHaveLength(12);
    expect(reimbursements.reduce((n, row) => n + row.amountAgorot, 0)).toBe(595400);
    expect(await unnamedObligations(db)).toHaveLength(2);
  });

  it('is idempotent', async () => {
    await seedCampBaseline(db, LEAD);
    const first = await seedCampBaseline(db, LEAD);
    expect(first.accounts).toBe(0);
    expect(first.movements).toBe(0);
    expect(first.obligations).toBe(0);
  });

  /**
   * `budget_lines` is the single home for a planned amount. The four ברן 25
   * deliverables carried theirs on the task itself; they now point at budget
   * lines instead, and nothing writes `budgetAmount` again. Two homes for one
   * number means "total planned spend" is a union and "did we come in on
   * budget" forks in two.
   */
  it('gives the four ברן 25 deliverables budget lines instead of amounts', async () => {
    await seedCampBaseline(db, LEAD);
    const { getSeasonByName } = await import('@/lib/members/roster');
    const { listBudgetLines } = await import('@/lib/money/budget');
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;

    const dancefloor = (await listBudgetLines(db, s25.id))
      .filter((line) => line.category === 'dancefloor');
    expect(dancefloor.map((line) => line.label).sort())
      .toEqual(['הגברה + תאורה', 'הובלה', 'חשמל', 'מייצג'].sort());
    expect(dancefloor.reduce((n, line) => n + line.totalAgorot, 0)).toBe(8906000);

    const { listTasks } = await import('@/lib/work/tasks');
    for (const task of await listTasks(db, s25.id)) {
      if (task.kind !== 'deliverable') continue;
      expect(task.budgetLineId).not.toBeNull();
    }
  });
```

- [ ] **Step 3a: Guard the property that actually matters — no double counting**

`tasks.budgetAmount` is **not** removed. It appears in nine files including
`new-task-form.tsx`, a working screen where a lead types a deliverable's
budget, and Wave 1 ships no budget-line picker to replace it. Deleting a
feature to satisfy a naming rule is a bad trade.

What must be true instead is narrower and more useful: a season's budget total
comes from `budget_lines` alone, so a deliverable carrying its own
`budgetAmount` can never be counted twice.

Add to `src/lib/money/budget.test.ts`:

```ts
  /**
   * `budget_lines` is the single source for a season's planned spend.
   * `tasks.budgetAmount` still exists and is still written by the task form —
   * it is one deliverable's own figure, not part of the budget total. If it
   * ever leaked into this sum, every owned deliverable would be counted
   * twice and the ברן 26 total would stop reconciling with the workbook.
   */
  it('never counts a task budget toward the season budget', async () => {
    const { createTask } = await import('@/lib/work/tasks');
    await createTask(db, {
      seasonId: s26, kind: 'deliverable', title: 'חשמל', budgetAmount: 12950,
    });
    expect(await budgetTotalAgorot(db, s26)).toBe(0);

    await createBudgetLine(db, {
      seasonId: s26, label: 'חשמל', total: 12950, category: 'dancefloor',
    });
    expect(await budgetTotalAgorot(db, s26)).toBe(1295000);
  });
```

Also add `budgetLineId` to `TaskRow` and to the `select` in `listTasks`
(`src/lib/work/tasks.ts`), and accept an optional `budgetLineId` on
`createTask`'s input — the seed needs it to link the four ברן 25
deliverables. Do not touch `budgetAmount` anywhere.

- [ ] **Step 2: Run and verify they fail**

Run: `./node_modules/.bin/vitest run src/lib/seed/camp-seed.test.ts`
Expected: FAIL — `accounts` is not on the result.

- [ ] **Step 3: Implement the seed**

In `src/lib/seed/camp-seed.ts`, add the data constants near the existing ones:

```ts
/**
 * The ברן 25 `מיקום` block, with its stated balances as opening balances.
 *
 * They are openings rather than derived totals because the sheet's ledger rows
 * carry no account at all — it never says which קופה any movement touched. So
 * the honest reading is: these three figures are what the camp counted, and
 * every seeded movement is unattributed until someone says otherwise.
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

/** `סיכום כללי` of `קופת קאמפ 25’`. The 44,647 `מעבר לקובץ חדש` row is NOT
 *  here: under a continuous ledger it is the previous book's closing balance,
 *  and importing it as income double-counts. It is carried as an opening
 *  balance instead — unattributed, because the sheet does not say which
 *  account held it. */
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

/** `תקציב קאמפ ברן 26`, summing to 64,375.30. */
const BUDGET_26: Array<[string, string | null, number | null, number, string]> = [
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
  ['100 ק״ג עצים + תוספת אחסנה', '1', 500, 500, 'ירידה של 1000 ש״ח'],
  ['גנרטור', '1', 2200, 2200, 'קונים עוד אחד'],
  ['30 מ׳ לייקרה + 50 מ׳ בד זול', '1', 1000, 1000, 'תוספת של 430 ש״ח'],
  ['תקציב הפתעות דק׳ 90', '10% תקציב', 5852.3, 5852.3, ''],
];

/** `תקציב גיוס לשנה`, summing to 135,375.30. */
const FUNDING_26: Array<[string, number]> = [
  ['חוב', 15000], ['תיקון ותחזוק מייצג', 5000], ['חשמל רחבה', 16000],
  ['הגברה', 35000], ['הובלה', 6000], ['תאורה לייזרים', 20000],
  ['מכולות', 16000], ['הורדת מחיר דמי קאמפ', 22375.3],
];

const TICKETS_26: Array<[string, number | null, number | null, number]> = [
  ['כרטיסים עד כה', null, null, 60000],
  ['סבב ג׳', 165, 200, 33000],
  ['סבב ד׳', 195, 400, 78000],
];

/** The `חוב יוסף` block and its `קיזוזים`. */
const YOSEF_COMPONENTS = 15240;
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
```

Then extend `seedCampBaseline` to create each group, guarded by an existence
check so the function stays idempotent, incrementing the new counters. Use
`resolveName` for `holder` and for each reimbursement name — a name that does
not resolve to exactly one person is stored as `partyName` text, never linked.

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run src/lib/seed/`
Expected: PASS, all existing seed tests plus 6.

- [ ] **Step 5: Mutation check**

- Seed the `44,647 מעבר לקובץ חדש` row as income. The ברן 25 ledger test must FAIL.
- Give the two nameless reimbursements a placeholder name. The "two with no name" test must FAIL.
- Drop one `YOSEF_OFFSETS` entry. The `910` test must FAIL.

- [ ] **Step 6: Commit**

```bash
git add src/lib/seed/camp-seed.ts src/lib/seed/camp-seed.test.ts
git commit -F - <<'MSG'
feat(seed): the camp's money as the workbooks actually record it

The 44,647 carry-forward is deliberately not seeded as income: under a
continuous ledger it is the previous book's closing balance and importing
it double-counts.

The two nameless reimbursements are seeded with no party, because the camp
genuinely cannot say who to pay back and a placeholder would be the system
inventing an owner for real money.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 13: The closure test, end to end

**Files:**
- Create: `src/lib/money/closures.test.ts`

This task adds no production code. It pins the workbooks' own arithmetic as a
single regression net, so that any later change that quietly breaks one of the
camp's real totals fails loudly.

- [ ] **Step 1: Write the test**

`src/lib/money/closures.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { seedCampBaseline } from '@/lib/seed/camp-seed';
import { getSeasonByName } from '@/lib/members/roster';
import { accountBalances } from './accounts';
import { ledgerTotals } from './ledger';
import { budgetTotalAgorot } from './budget';
import { fundingTotalAgorot, ticketTotalAgorot, duesFundingIdentity } from './funding';
import { listObligations, unnamedObligations } from './obligations';

const LEAD = 'lead@example.com';
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await seedCampBaseline(db, LEAD);
});

/**
 * The workbooks contain their own proofs. Each of these is an identity that
 * holds in the camp's own sheets, reproduced from database rows. They exist so
 * that a change which quietly breaks one of the camp's real totals fails here
 * rather than in front of a lead.
 */
describe('the workbooks own arithmetic', () => {
  it('ברן 26 ledger: 62,000 in, 45,271 out, 16,729 net', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const totals = await ledgerTotals(db, { seasonId: s26.id });
    expect(totals.inAgorot).toBe(6200000);
    expect(totals.outAgorot).toBe(4527100);
    expect(totals.netAgorot).toBe(1672900);
  });

  it('ברן 26 budget: 64,375.30', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await budgetTotalAgorot(db, s26.id)).toBe(6437530);
  });

  it('ברן 26 fundraising plan: 135,375.30', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await fundingTotalAgorot(db, s26.id)).toBe(13537530);
  });

  it('ברן 26 ticket projection: 171,000', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await ticketTotalAgorot(db, s26.id)).toBe(17100000);
  });

  it('the dues/fundraising identity closes: 1,200 + 639.29 = 1,839.29', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const identity = await duesFundingIdentity(db, s26.id);
    expect(identity.flatRateAgorot).toBe(120000);
    expect(identity.perPersonFundingAgorot).toBe(63929);
    expect(identity.perPersonFullAgorot).toBe(183929);
    expect(identity.closes).toBe(true);
  });

  it('חוב יוסף: 15,240 − 14,330 = 910', async () => {
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const yosef = rows.find((row) => row.description.includes('יוסף'))!;
    expect(yosef.amountAgorot).toBe(1524000);
    expect(yosef.settledAgorot).toBe(1433000);
    expect(yosef.outstandingAgorot).toBe(91000);
  });

  it('the twelve reimbursements sum to 5,954, the surprises budget line', async () => {
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const reimbursements = rows.filter((row) => row.description !== 'חוב יוסף');
    expect(reimbursements.reduce((n, r) => n + r.amountAgorot, 0)).toBe(595400);
  });

  it('two of them can never be closed, because nobody knows who is owed', async () => {
    const unnamed = await unnamedObligations(db);
    expect(unnamed).toHaveLength(2);
    expect(unnamed.every((row) => row.displayParty === null)).toBe(true);
  });

  /**
   * The workbook's ברן 25 sheet nets to 44,183.55 — but only because its
   * income column includes `מעבר לקובץ חדש 44,647`, the previous book's
   * closing balance. Under a continuous ledger that row is not income, so the
   * seeded season nets to −463.45 and the 44,647 lives as an opening balance.
   * The identity still has to close; it just closes honestly.
   */
  it('ברן 25 nets to −463.45 once the carry-forward is not income', async () => {
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const totals = await ledgerTotals(db, { seasonId: s25.id });
    expect(totals.inAgorot).toBe(5030655);
    expect(totals.outAgorot).toBe(5077000);
    expect(totals.netAgorot).toBe(-46345);

    // and the 44,647 the workbook booked as income is exactly what reconciles
    // that net back to the מיקום block's 44,183.55
    expect(totals.netAgorot + 4464700).toBe(4418355);
  });

  it('the מיקום block reproduces: 1,584 + 28,520 + 14,079.55 = 44,183.55', async () => {
    const balances = await accountBalances(db);
    const byName = new Map(balances.map((row) => [row.name, row.balanceAgorot]));
    expect(byName.get('קופת מזומן')).toBe(158400);
    expect(byName.get('וייבז קלוז פרינדס')).toBe(2852000);
    expect(byName.get('עו״ש אופק')).toBe(1407955);
    expect(balances.reduce((n, row) => n + row.balanceAgorot, 0)).toBe(4418355);
  });

  it('derives a balance rather than storing one', async () => {
    const { listMovements } = await import('./ledger');
    const { recordEntry } = await import('./ledger');
    const balances = await accountBalances(db);
    const kupa = balances.find((row) => row.name === 'קופת מזומן')!;

    await recordEntry(db, {
      occurredOn: new Date('2026-09-01T00:00:00Z'), direction: 'out', amount: 84,
      description: 'בדיקה', accountId: kupa.accountId, recordedBy: LEAD,
    });

    const after = (await accountBalances(db))
      .find((row) => row.name === 'קופת מזומן')!;
    expect(after.balanceAgorot).toBe(kupa.balanceAgorot - 8400);

    // and the movement is visible in the ledger, not swallowed by a stored total
    const moves = await listMovements(db, { accountId: kupa.accountId });
    expect(moves.some((m) => m.description === 'בדיקה')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the full suite**

Run: `./node_modules/.bin/vitest run`
Expected: PASS. **Read the COUNT** and record it in the progress notes. A run that reports no count is a failed run regardless of exit code.

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → exit 0.

- [ ] **Step 3: See it running**

```bash
npx tsx scripts/seed-camp.ts
npm run dev
```

Open `/money` for both ברן 25 and ברן 26. Confirm on screen:
- the hero reads `1,200 ₪` with the 1,839.29 / 639.29 sentence beneath it for ברן 26
- `עו״ש אופק` appears with its warning and names אופק
- the obligations table shows `910 ₪` outstanding against חוב יוסף
- two rows read `⚠ חסר שם`
- the ברן 25 page does not crash on a season with no budget rows

Screenshot each and attach to the task report. A task is not done until the running page has been seen.

- [ ] **Step 4: Commit**

```bash
git add src/lib/money/closures.test.ts
git commit -F - <<'MSG'
test(money): pin the arithmetic the workbooks already prove

Eight identities that hold in the camp's own sheets, reproduced from
database rows. They exist so a change that quietly breaks one of the real
totals fails here rather than in front of a lead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**Spec coverage.** Requirements 1–20 and 32–34 map to Tasks 1–13. Requirements 21–26 (events) are Wave 3 and are out of this plan by design. Requirements 27–31 and 35–38 (promotion, provenance, `/data`) are Wave 2 and out of this plan by design — note that Task 1 already creates the `source_block_id` / `source_row` columns those tasks will fill, so Wave 2 needs no migration of its own for them. Requirement 39 (admin-only) is enforced in Task 11 and inherited by every page. Requirement 12 (`tasks.budget_amount` deprecated in place) is covered by Task 1 (the column) and Task 12 Steps 1 and 3a (the guard test, the four deliverables' migration, and removing `budgetAmount` from `createTask`).

**Placeholder scan.** Task 12 Step 3 says "extend `seedCampBaseline` to create each group" without showing the loop bodies. That is the one place in this plan that describes rather than shows. It is acceptable only because the data constants above it are complete and the existing function already demonstrates the idempotent-create idiom four times; the implementer should follow `BURN_25_EVENTS` exactly. If the executing agent finds it ambiguous, that is a plan defect — say so rather than guessing.

**Type consistency.** `AccountKind` is imported in Task 12 from `@/db/schema/money` — confirm the import is added. `ObligationRow.displayParty` is used in Task 11 and defined in Task 7. `DuesFundingIdentity.duesCoverAgorot` is nullable and Task 11 uses `?? 0` for the chart segment. `Movement.source` is `'ledger' | 'dues'` and Task 11 keys rows on it to avoid an id collision between the two tables.
