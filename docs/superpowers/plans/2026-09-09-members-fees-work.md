# Camp Members, Fees & Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the camp a lasting roster, a dues ledger that records *why* someone paid what they paid, and a list of work with owners — replacing first-name columns bolted onto the cash spreadsheet.

**Architecture:** Nine additive Postgres tables behind three new admin sections. Logic lives in plain modules under `src/lib/` that take a `Db` as their first argument; `'use server'` action files are thin authorization wrappers that delegate to them. No table in Phase 1's schema is touched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Drizzle ORM 0.45.2, Postgres (Neon prod / PGlite in tests), Vitest 5, Auth.js v5.

**Spec:** `docs/superpowers/specs/2026-09-09-camp-members-fees-design.md`

## Global Constraints

- **Never guess.** Where the system is unsure — a name that might be an existing person, an amount that does not reconcile — it surfaces the uncertainty rather than resolving it silently. Import **never** merges two people automatically.
- **Admin-only.** Every server action and route calls `requireAdmin()` from `@/lib/auth/guard`. UI hiding is never the enforcement mechanism. No page is public.
- **Ingested data warns, never blocks.** Reconciliation mismatches are flags, not errors. **Exception:** a lead typing a new record in the UI is not ingestion — an exception due with an empty reason is refused on write (spec §3).
- **Hebrew RTL.** All UI copy in Hebrew. CSS uses **logical properties only** — `margin-inline`, `padding-block`, `inset-block-start`, `border-inline-start/end`, `text-align: start/end`. Never `left`/`right`/`margin-left`. Wrap Latin/neutral runs inside Hebrew text in `<bdi>`.
- **Money is `numeric(12,2)` in Postgres, integer agorot in JS.** Never do arithmetic on floats. Never sum strings.
- **`@/db` throws at import time without `DATABASE_URL`.** Never import it — even transitively — into a `'use server'` module's dependency graph at module scope, or into a test. Logic modules take `db: AnyDb` as their first parameter. This bit the project three times in Phase 1.
- **Schema files must be listed in `drizzle.config.ts`.** `src/db/config.test.ts` fails otherwise. Glob patterns are forbidden (they pulled test files into migrations).
- **Additive migrations only.** Never edit an existing file in `drizzle/`.
- **Never modify anything under `docs/reference-data/`** — read-only fixtures.
- Correctness and legibility beat performance everywhere. Scale is tens of people.
- Run tests with `npm test`. Never run `npm install` (npm/cli#4828 drops the rolldown native binding and breaks every test).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01S6YgSJL5XNvSn2LXAQgwxg
  ```

## File Structure

**Data layer**
- `src/db/schema/camp.ts` — the nine tables. One file: they are one subsystem and always change together.
- `src/lib/money.ts` — agorot conversion, formatting, summation. Pure, no deps.

**Domain logic** (each takes `db: AnyDb` first; none imports `@/db`)
- `src/lib/members/identity.ts` — alias normalization, candidate matching, resolving a name to a person.
- `src/lib/members/link.ts` — the admin operations that create the links identity.ts only proposes: attach alias, create person, merge, unmerge.
- `src/lib/members/roster.ts` — seasons and memberships.
- `src/lib/members/dossier.ts` — everything about one person, across every table.
- `src/lib/fees/dues.ts` — issue flat dues, record exceptions.
- `src/lib/fees/payments.ts` — record payments, compute settlement.
- `src/lib/fees/summary.ts` — per-season רגילים / חריגים / סה״כ.
- `src/lib/work/events.ts` — fundraising parties and the burn.
- `src/lib/work/tasks.ts` — the four task kinds.
- `src/lib/work/coverage.ts` — assignments and uncovered-task reporting.
- `src/lib/seed/camp-seed.ts` — seasons, events and named people from the workbooks.

**UI**
- `src/app/(admin)/members/` — `page.tsx`, `actions.ts`, `[id]/page.tsx`, `unlinked.tsx`, `members.module.css`
- `src/app/(admin)/fees/` — `page.tsx`, `actions.ts`, `due-row.tsx`, `fees.module.css`
- `src/app/(admin)/tasks/` — `page.tsx`, `actions.ts`, `task-card.tsx`, `tasks.module.css`
- `src/app/(admin)/page.tsx` — overview gains a live season summary
- `src/app/(admin)/nav.tsx` — un-plan `/members` and `/fees`, add `/tasks`

---
### Task 1: Money primitives and the nine tables

**Files:**
- Create: `src/lib/money.ts`
- Create: `src/lib/money.test.ts`
- Create: `src/db/schema/camp.ts`
- Create: `src/db/schema/camp.test.ts`
- Modify: `drizzle.config.ts`
- Modify: `src/db/index.ts`
- Modify: `src/test/db.ts`
- Generated: `drizzle/0002_*.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `toAgorot(value: string | number): number`, `fromAgorot(agorot: number): string`, `sumAgorot(values: Array<string | number>): number`, `formatILS(agorot: number): string`. Tables `persons`, `personAliases`, `seasons`, `memberships`, `dues`, `payments`, `campEvents`, `tasks`, `taskAssignments`, and the union types `DueKind`, `PaymentChannel`, `TaskKind`, `TaskStatus`, `AssignmentStatus`, `PAYMENT_CHANNELS`.

- [ ] **Step 1: Write the failing money test**

Create `src/lib/money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toAgorot, fromAgorot, sumAgorot, formatILS } from '@/lib/money';

describe('money', () => {
  it('converts a numeric(12,2) string to integer agorot', () => {
    expect(toAgorot('60955.00')).toBe(6095500);
    expect(toAgorot('1500')).toBe(150000);
    expect(toAgorot(0)).toBe(0);
  });

  it('rounds away binary float error rather than truncating', () => {
    // 33740.55 * 100 is 3374054.9999999995 in IEEE 754.
    expect(toAgorot('33740.55')).toBe(3374055);
    expect(toAgorot('11390.8')).toBe(1139080);
  });

  it('round-trips through storage form', () => {
    expect(fromAgorot(6095500)).toBe('60955.00');
    expect(fromAgorot(1139080)).toBe('11390.80');
    expect(toAgorot(fromAgorot(3374055))).toBe(3374055);
  });

  it('refuses a non-integer agorot value', () => {
    expect(() => fromAgorot(1.5)).toThrow(/integer/);
  });

  it('refuses a value that is not a number', () => {
    expect(() => toAgorot('לא מספר')).toThrow(/not a number/);
  });

  it('sums without drift', () => {
    // The twelve ברן 25 reimbursement lines.
    const lines = [300, 65, 400, 709, 820, 200, 335, 500, 400, 40, 580, 1605];
    expect(sumAgorot(lines)).toBe(595400);
    expect(sumAgorot(['33740.55', '11390.8'])).toBe(4513135);
  });

  it('formats for display, dropping empty decimals', () => {
    expect(formatILS(6095500)).toBe('60,955');
    expect(formatILS(3374055)).toBe('33,740.55');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/money.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/money"`.

- [ ] **Step 3: Write the money module**

Create `src/lib/money.ts`:

```ts
/**
 * Money is stored as `numeric(12,2)` and comes back from Postgres as a string.
 * In JS we work in integer agorot so that summing a season's dues never drifts.
 * Never do arithmetic on the parsed float directly.
 */

export function toAgorot(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${value}`);
  return Math.round(n * 100);
}

export function fromAgorot(agorot: number): string {
  if (!Number.isInteger(agorot)) throw new Error(`agorot must be an integer: ${agorot}`);
  return (agorot / 100).toFixed(2);
}

export function sumAgorot(values: Array<string | number>): number {
  return values.reduce<number>((total, value) => total + toAgorot(value), 0);
}

/** Display form: `60,955` when the decimals are empty, `33,740.55` otherwise. */
export function formatILS(agorot: number): string {
  return (agorot / 100).toLocaleString('he-IL', {
    minimumFractionDigits: agorot % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/money.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the schema**

Create `src/db/schema/camp.ts`:

```ts
import {
  pgTable, uuid, text, integer, timestamp, numeric, unique,
} from 'drizzle-orm/pg-core';

export type DueKind = 'flat' | 'exception';
export type TaskKind = 'deliverable' | 'shift' | 'build' | 'event_task';
export type TaskStatus = 'open' | 'done' | 'cancelled';
export type AssignmentStatus = 'proposed' | 'accepted' | 'done' | 'dropped';
export type EventKind = 'fundraiser' | 'burn';

/** Channels observed in the workbooks. `קיזוז` settles a due against a debt
 *  the camp owes the payer — the ברן 26 `יוסף קארינה יונתן ירין ועילאי 6,000`
 *  line is five such payments. */
export const PAYMENT_CHANNELS = [
  'מזומן', 'אשראי', 'ביט', 'פייבוקס', 'העברה', 'קיזוז',
] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

/**
 * A lasting human. Survives across burns. Deliberately shaped as a general
 * party record: when the ledger phase lands, suppliers and members must not
 * fork into two identity systems.
 */
export const persons = pgTable('persons', {
  id: uuid('id').defaultRandom().primaryKey(),
  displayName: text('display_name').notNull(),
  notes: text('notes'),
  /** Set when this person was merged into another. The row is kept rather than
   *  deleted so a merge can be undone and no alias ever disappears. */
  mergedIntoId: uuid('merged_into_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every spelling of a name seen in a source sheet. `אופק` and `אופק כהן` are
 * two aliases of one person.
 *
 * `personId` is nullable on purpose: a name that import could not confidently
 * attribute is stored here unlinked, and appears in the leads' queue. That is
 * the whole "never auto-merge" mechanism — an unlinked name is visible and
 * costs a lead five seconds; a wrongly merged one silently combines two
 * people's dues, debts and ownerships.
 */
export const personAliases = pgTable('person_aliases', {
  id: uuid('id').defaultRandom().primaryKey(),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  /** `normalizeHebrew(alias)` — the form matching compares. */
  normalized: text('normalized').notNull(),
  /** manual | import */
  source: text('source').notNull(),
  /** Set when this alias moved here in a merge, naming the person it came
   *  from. It is what makes a merge exactly reversible without a log table. */
  mergedFromPersonId: uuid('merged_from_person_id'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (table) => [
  // Deliberately NOT unique on `normalized` alone: two real people may share a
  // first name, and blocking that would force a wrong merge. Matching returns
  // every candidate and a lead decides.
  unique('person_aliases_person_normalized_key').on(table.personId, table.normalized),
]);

export const seasons = pgTable('seasons', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** `ברן 26` */
  name: text('name').notNull().unique(),
  year: integer('year').notNull(),
  /** Flat per-person dues. ברן 25: 1500.00, ברן 26: 1200.00. */
  flatRate: numeric('flat_rate', { precision: 12, scale: 2 }).notNull(),
  /** Camp size the budget assumes. ברן 25: 43, ברן 26: 35. */
  plannedSize: integer('planned_size'),
  startsOn: timestamp('starts_on', { withTimezone: true }),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  personId: uuid('person_id').notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  /** lead | member */
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('memberships_person_season_key').on(table.personId, table.seasonId),
]);

/** One person's obligation for one season. */
export const dues = pgTable('dues', {
  id: uuid('id').defaultRandom().primaryKey(),
  personId: uuid('person_id').notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  kind: text('kind').$type<DueKind>().notNull().default('flat'),
  /** Required when kind is 'exception'. `עמירם דהן 0` recorded with no reason
   *  and no decider is the failure this column exists to prevent. */
  exceptionReason: text('exception_reason'),
  decidedBy: text('decided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('dues_person_season_key').on(table.personId, table.seasonId),
]);

/** Money actually received against a due. */
export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  dueId: uuid('due_id').notNull().references(() => dues.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  channel: text('channel').$type<PaymentChannel>().notNull(),
  paidOn: timestamp('paid_on', { withTimezone: true }).notNull(),
  /** Required when channel is 'קיזוז': what the payment was offset against. */
  note: text('note'),
  recordedBy: text('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A fundraising party, or the burn itself. Deliberately minimal this phase:
 *  it exists so tasks (and later, revenue) have something to hang off. */
export const campEvents = pgTable('camp_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').$type<EventKind>().notNull(),
  heldOn: timestamp('held_on', { withTimezone: true }),
});

/**
 * Something that must be done, by someone, in some context. One table with a
 * `kind` rather than four tables: "everything אופק is responsible for" must be
 * one query, and uncovered-task reporting must span all four kinds at once.
 * The optional columns carry what only some kinds need.
 */
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  seasonId: uuid('season_id').notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => campEvents.id, { onDelete: 'set null' }),
  kind: text('kind').$type<TaskKind>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  /** deliverable: the budget the owner is responsible for. */
  budgetAmount: numeric('budget_amount', { precision: 12, scale: 2 }),
  /** shift: the time window to staff. */
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  /** build: the deadline. */
  dueOn: timestamp('due_on', { withTimezone: true }),
  peopleNeeded: integer('people_needed').notNull().default(1),
  status: text('status').$type<TaskStatus>().notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskAssignments = pgTable('task_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  status: text('status').$type<AssignmentStatus>().notNull().default('proposed'),
  assignedBy: text('assigned_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('task_assignments_task_person_key').on(table.taskId, table.personId),
]);
```

- [ ] **Step 6: Wire the schema into the three places that must know about it**

In `drizzle.config.ts`, add the new file to the explicit list (a glob is forbidden — it pulled test files into migrations in Phase 1):

```ts
schema: [
  './src/db/schema/source.ts',
  './src/db/schema/auth.ts',
  './src/db/schema/camp.ts',
],
```

In `src/db/index.ts`:

```ts
import * as source from './schema/source';
import * as camp from './schema/camp';
// ...
export const db = drizzle(client, { schema: { ...source, ...camp } });
```

In `src/test/db.ts`:

```ts
import * as source from '@/db/schema/source';
import * as camp from '@/db/schema/camp';

export type TestDb = ReturnType<typeof drizzle<typeof source & typeof camp>>;
// ...
return drizzle(client, { schema: { ...source, ...camp } });
```

- [ ] **Step 7: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `drizzle/0002_*.sql` creating nine tables. **Read it** and confirm it only contains `CREATE TABLE` / `ALTER TABLE ... ADD CONSTRAINT` for the new tables. If it proposes dropping or altering anything from `0000_` or `0001_`, stop — the schema import wiring is wrong. Never edit an existing migration file.

- [ ] **Step 8: Write the schema shape test**

Create `src/db/schema/camp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '@/test/db';
import {
  persons, personAliases, seasons, memberships, dues, payments,
  campEvents, tasks, taskAssignments, PAYMENT_CHANNELS,
} from '@/db/schema/camp';

describe('camp schema', () => {
  it('creates every table from the migrations', async () => {
    const db = await createTestDb();
    for (const table of [
      persons, personAliases, seasons, memberships, dues,
      payments, campEvents, tasks, taskAssignments,
    ]) {
      expect(await db.select().from(table)).toEqual([]);
    }
  });

  it('keeps one due per person per season', async () => {
    const db = await createTestDb();
    const [person] = await db.insert(persons)
      .values({ displayName: 'אופק' }).returning();
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 25', year: 2025, flatRate: '1500.00' }).returning();

    await db.insert(dues)
      .values({ personId: person.id, seasonId: season.id, amount: '1500.00' });

    await expect(
      db.insert(dues)
        .values({ personId: person.id, seasonId: season.id, amount: '1200.00' }),
    ).rejects.toThrow();
  });

  it('lets two people share a normalized alias', async () => {
    const db = await createTestDb();
    const [a] = await db.insert(persons).values({ displayName: 'אופק כהן' }).returning();
    const [b] = await db.insert(persons).values({ displayName: 'אופק לוי' }).returning();

    await db.insert(personAliases)
      .values({ personId: a.id, alias: 'אופק', normalized: 'אופק', source: 'manual' });
    // Two real people may share a first name. The schema must not force a merge.
    await expect(
      db.insert(personAliases)
        .values({ personId: b.id, alias: 'אופק', normalized: 'אופק', source: 'manual' }),
    ).resolves.toBeDefined();
  });

  it('offers the six observed payment channels', () => {
    expect(PAYMENT_CHANNELS).toContain('קיזוז');
    expect(PAYMENT_CHANNELS).toHaveLength(6);
  });
});
```

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, including the pre-existing `src/db/config.test.ts` which asserts every schema file on disk is listed in `drizzle.config.ts`. If that one fails, Step 6's config edit was missed.

- [ ] **Step 10: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts src/db/schema/camp.ts \
        src/db/schema/camp.test.ts drizzle.config.ts src/db/index.ts \
        src/test/db.ts drizzle/
git commit -m "feat(camp): money primitives and the members/fees/work schema"
```

---
### Task 2: Seasons and the roster

**Files:**
- Create: `src/lib/db-types.ts`
- Create: `src/lib/members/roster.ts`
- Create: `src/lib/members/roster.test.ts`

**Interfaces:**
- Consumes: `persons`, `seasons`, `memberships` from `@/db/schema/camp`; `fromAgorot`, `toAgorot` from `@/lib/money`.
- Produces: `type AnyDb`; `createSeason`, `listSeasons`, `getSeasonByName`, `addMember`, `listRoster`, `removeMember`, `type RosterEntry`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/roster.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons } from '@/db/schema/camp';
import {
  createSeason, listSeasons, getSeasonByName,
  addMember, listRoster, removeMember,
} from '@/lib/members/roster';

describe('roster', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  async function person(name: string) {
    const [row] = await db.insert(persons).values({ displayName: name }).returning();
    return row;
  }

  it('creates a season with its flat rate', async () => {
    const season = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    expect(season.flatRate).toBe('1500.00');
    expect(season.plannedSize).toBe(43);
  });

  it('lists seasons newest first', async () => {
    await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    expect((await listSeasons(db)).map((s) => s.name)).toEqual(['ברן 26', 'ברן 25']);
  });

  it('finds a season by name', async () => {
    await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    expect((await getSeasonByName(db, 'ברן 26'))?.year).toBe(2026);
    expect(await getSeasonByName(db, 'ברן 99')).toBeUndefined();
  });

  it('adds members and lists the roster alphabetically', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    const yosef = await person('יוסף');
    await addMember(db, ofek.id, season.id);
    await addMember(db, yosef.id, season.id, 'lead');

    const roster = await listRoster(db, season.id);
    expect(roster.map((r) => r.displayName)).toEqual(['אופק', 'יוסף']);
    expect(roster.find((r) => r.displayName === 'יוסף')?.role).toBe('lead');
  });

  it('is idempotent — adding the same member twice does not duplicate', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    await addMember(db, ofek.id, season.id);
    await addMember(db, ofek.id, season.id, 'lead');

    const roster = await listRoster(db, season.id);
    expect(roster).toHaveLength(1);
    expect(roster[0].role).toBe('lead');
  });

  it('keeps a person across seasons', async () => {
    const s25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const s26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    await addMember(db, ofek.id, s25.id);
    await addMember(db, ofek.id, s26.id);

    expect(await listRoster(db, s25.id)).toHaveLength(1);
    expect(await listRoster(db, s26.id)).toHaveLength(1);
  });

  it('removes a member from one season only', async () => {
    const s25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const s26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    await addMember(db, ofek.id, s25.id);
    await addMember(db, ofek.id, s26.id);
    await removeMember(db, ofek.id, s26.id);

    expect(await listRoster(db, s25.id)).toHaveLength(1);
    expect(await listRoster(db, s26.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/members/roster.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/members/roster"`.

- [ ] **Step 3: Write the shared database type**

Create `src/lib/db-types.ts`:

```ts
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';

/**
 * Either the real Postgres handle or a PGlite test handle.
 *
 * Both imports are type-only and erased at compile time, so importing this
 * never triggers `@/db`'s `DATABASE_URL` check. Every domain module takes
 * `db: AnyDb` as its first parameter rather than importing `@/db` itself —
 * that is what keeps them testable and keeps `@/db` out of the module graph
 * of `'use server'` files.
 */
export type AnyDb = Db | TestDb;
```

- [ ] **Step 4: Write the roster module**

Create `src/lib/members/roster.ts`:

```ts
import { and, asc, desc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { persons, seasons, memberships } from '@/db/schema/camp';
import { fromAgorot, toAgorot } from '@/lib/money';

export type Season = typeof seasons.$inferSelect;

export interface RosterEntry {
  personId: string;
  displayName: string;
  role: string;
  joinedAt: Date;
}

export interface NewSeason {
  name: string;
  year: number;
  /** In shekels, e.g. 1500. Stored as numeric(12,2). */
  flatRate: number;
  plannedSize?: number;
  startsOn?: Date;
}

export async function createSeason(db: AnyDb, input: NewSeason): Promise<Season> {
  const [season] = await db.insert(seasons).values({
    name: input.name,
    year: input.year,
    flatRate: fromAgorot(toAgorot(input.flatRate)),
    plannedSize: input.plannedSize ?? null,
    startsOn: input.startsOn ?? null,
  }).returning();
  return season;
}

export async function listSeasons(db: AnyDb): Promise<Season[]> {
  return db.select().from(seasons).orderBy(desc(seasons.year), desc(seasons.name));
}

export async function getSeasonByName(db: AnyDb, name: string): Promise<Season | undefined> {
  const [season] = await db.select().from(seasons).where(eq(seasons.name, name));
  return season;
}

/** Idempotent: re-adding an existing member updates their role. */
export async function addMember(
  db: AnyDb, personId: string, seasonId: string, role: string = 'member',
): Promise<void> {
  await db.insert(memberships)
    .values({ personId, seasonId, role })
    .onConflictDoUpdate({
      target: [memberships.personId, memberships.seasonId],
      set: { role },
    });
}

export async function listRoster(db: AnyDb, seasonId: string): Promise<RosterEntry[]> {
  const rows = await db
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(eq(memberships.seasonId, seasonId))
    .orderBy(asc(persons.displayName));
  return rows;
}

export async function removeMember(
  db: AnyDb, personId: string, seasonId: string,
): Promise<void> {
  await db.delete(memberships).where(
    and(eq(memberships.personId, personId), eq(memberships.seasonId, seasonId)),
  );
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/lib/members/roster.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db-types.ts src/lib/members/roster.ts src/lib/members/roster.test.ts
git commit -m "feat(members): seasons and per-season roster"
```

---

### Task 3: Resolving a name to a person, without ever guessing

**Files:**
- Create: `src/lib/members/identity.ts`
- Create: `src/lib/members/identity.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `persons`, `personAliases`; `normalizeHebrew` from `@/lib/text/normalize`.
- Produces: `resolveName(db, rawName): Promise<NameResolution>`, `recordUnlinkedName(db, rawName, source): Promise<string>`, `listUnlinkedNames(db): Promise<UnlinkedName[]>`, `type NameCandidate`, `type NameResolution`, `type UnlinkedName`.

**The rule this task exists to enforce:** `resolveName` returns a `personId`
**only** when exactly one alias matches exactly. Every other outcome — several
exact matches, a partial match, no match at all — returns `personId: null` and
lists what it saw. It never picks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/identity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases } from '@/db/schema/camp';
import {
  resolveName, recordUnlinkedName, listUnlinkedNames,
} from '@/lib/members/identity';

describe('resolveName', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  async function personWithAlias(displayName: string, alias: string) {
    const [row] = await db.insert(persons).values({ displayName }).returning();
    await db.insert(personAliases).values({
      personId: row.id, alias, normalized: alias, source: 'manual',
    });
    return row;
  }

  it('resolves a single exact match', async () => {
    const ofek = await personWithAlias('אופק', 'אופק');
    const result = await resolveName(db, 'אופק');
    expect(result.personId).toBe(ofek.id);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exact).toBe(true);
  });

  it('normalizes punctuation and padding before matching', async () => {
    const person = await personWithAlias('רן', 'רן');
    // Padding, an NBSP and a directional mark must not defeat the match.
    expect((await resolveName(db, '  רן‏ ')).personId).toBe(person.id);
  });

  it('refuses to pick when two people share a name', async () => {
    await personWithAlias('אופק כהן', 'אופק');
    await personWithAlias('אופק לוי', 'אופק');

    const result = await resolveName(db, 'אופק');
    expect(result.personId).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.exact)).toBe(true);
  });

  it('offers a partial match as a candidate but does not resolve it', async () => {
    await personWithAlias('אופק', 'אופק');

    const result = await resolveName(db, 'אופק כהן');
    expect(result.personId).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exact).toBe(false);
  });

  it('returns nothing at all for an unknown name', async () => {
    await personWithAlias('יוסף', 'יוסף');
    const result = await resolveName(db, 'עמירם דהן');
    expect(result.personId).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.normalized).toBe('עמירם דהן');
  });

  it('ignores aliases that are not linked to anyone', async () => {
    await recordUnlinkedName(db, 'אופק', 'import');
    const result = await resolveName(db, 'אופק');
    expect(result.personId).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});

describe('unlinked names', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('records a name with no person and lists it', async () => {
    await recordUnlinkedName(db, 'עמירם דהן', 'import');
    const queue = await listUnlinkedNames(db);
    expect(queue).toHaveLength(1);
    expect(queue[0].alias).toBe('עמירם דהן');
    expect(queue[0].normalized).toBe('עמירם דהן');
  });

  it('does not queue the same name twice', async () => {
    await recordUnlinkedName(db, 'עמירם דהן', 'import');
    await recordUnlinkedName(db, ' עמירם דהן ', 'import');
    expect(await listUnlinkedNames(db)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/members/identity.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/members/identity"`.

- [ ] **Step 3: Write the identity module**

Create `src/lib/members/identity.ts`:

```ts
import { and, asc, eq, isNull, isNotNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { persons, personAliases } from '@/db/schema/camp';
import { normalizeHebrew } from '@/lib/text/normalize';

export interface NameCandidate {
  personId: string;
  displayName: string;
  /** The stored alias that matched. */
  alias: string;
  /** True when the normalized forms are identical, false for a partial match. */
  exact: boolean;
}

export interface NameResolution {
  normalized: string;
  /**
   * Set only when exactly one alias matched exactly. `null` for every other
   * outcome — several exact matches, a partial match, or nothing at all.
   * A caller that wants a person for a `null` resolution must ask a lead.
   */
  personId: string | null;
  candidates: NameCandidate[];
}

export interface UnlinkedName {
  aliasId: string;
  alias: string;
  normalized: string;
  source: string;
}

/**
 * Looks a name up against every linked alias.
 *
 * Deliberately conservative: merging two people's dues, debts and ownerships
 * is not reversible from the UI, so this never picks between candidates. It
 * reports what it saw and leaves the decision to a lead.
 */
export async function resolveName(db: AnyDb, rawName: string): Promise<NameResolution> {
  const normalized = normalizeHebrew(rawName);
  if (!normalized) return { normalized, personId: null, candidates: [] };

  const linked = await db
    .select({
      personId: personAliases.personId,
      displayName: persons.displayName,
      alias: personAliases.alias,
      normalized: personAliases.normalized,
    })
    .from(personAliases)
    .innerJoin(persons, eq(persons.id, personAliases.personId))
    .where(and(isNotNull(personAliases.personId), isNull(persons.mergedIntoId)));

  const candidates: NameCandidate[] = [];
  for (const row of linked) {
    const exact = row.normalized === normalized;
    const partial = !exact
      && (row.normalized.startsWith(`${normalized} `)
        || normalized.startsWith(`${row.normalized} `));
    if (exact || partial) {
      candidates.push({
        personId: row.personId as string,
        displayName: row.displayName,
        alias: row.alias,
        exact,
      });
    }
  }

  const exactMatches = candidates.filter((c) => c.exact);
  const personId = exactMatches.length === 1 ? exactMatches[0].personId : null;
  return { normalized, personId, candidates };
}

/**
 * Stores a name that could not be attributed to a person. It sits in the
 * leads' queue until someone links it or promotes it to a new person.
 */
export async function recordUnlinkedName(
  db: AnyDb, rawName: string, source: 'import' | 'manual',
): Promise<string> {
  const normalized = normalizeHebrew(rawName);
  const [existing] = await db.select().from(personAliases).where(
    and(isNull(personAliases.personId), eq(personAliases.normalized, normalized)),
  );
  if (existing) return existing.id;

  const [row] = await db.insert(personAliases)
    .values({ personId: null, alias: normalized, normalized, source })
    .returning();
  return row.id;
}

export async function listUnlinkedNames(db: AnyDb): Promise<UnlinkedName[]> {
  const rows = await db
    .select({
      aliasId: personAliases.id,
      alias: personAliases.alias,
      normalized: personAliases.normalized,
      source: personAliases.source,
    })
    .from(personAliases)
    .where(isNull(personAliases.personId))
    .orderBy(asc(personAliases.normalized));
  return rows;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/members/identity.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/identity.ts src/lib/members/identity.test.ts
git commit -m "feat(members): resolve names to people without ever guessing"
```

---
