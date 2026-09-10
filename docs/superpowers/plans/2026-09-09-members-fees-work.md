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
- Produces: `toAgorot(value: string | number): number`, `fromAgorot(agorot: number): string`, `sumAgorot(values: Array<string | number>): number`, `formatILS(agorot: number): string`. Tables `persons`, `personAliases`, `seasons`, `memberships`, `dues`, `payments`, `campEvents`, `tasks`, `taskAssignments`, and the union types `DueKind`, `PaymentChannel`, `TaskKind`, `TaskStatus`, `AssignmentStatus`, `EventKind`, `PAYMENT_CHANNELS`.

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

  /**
   * Hebrew has no regex word boundary, and naive substring matching is what
   * bit the Phase 1 classifier (`ביט` inside `ביטים`, `בר` inside `ברגים`).
   * Both pairs below are real: all four names appear in the workbooks.
   */
  it('does not match a name that is merely a substring of another', async () => {
    await personWithAlias('נטלי', 'נטלי');
    await personWithAlias('עמירם דהן', 'עמירם דהן');

    // טלי is inside נטלי; עמי is inside עמירם. Neither is a match.
    expect(await resolveName(db, 'טלי')).toMatchObject({
      personId: null, candidates: [],
    });
    expect(await resolveName(db, 'עמי')).toMatchObject({
      personId: null, candidates: [],
    });
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

  // Store the spelling as it was seen, not the normalized form: `normalized`
  // exists for comparison, `alias` is the evidence. normalizeHebrew maps the
  // geresh ׳ to an ASCII apostrophe, so storing it here would silently rewrite
  // `ראנצ׳ו ונטלי` into a spelling that appears in no sheet.
  const [row] = await db.insert(personAliases)
    .values({ personId: null, alias: rawName.trim(), normalized, source })
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
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/identity.ts src/lib/members/identity.test.ts
git commit -m "feat(members): resolve names to people without ever guessing"
```

---
### Task 4: Linking, merging and unmerging people

**Files:**
- Create: `src/lib/members/link.ts`
- Create: `src/lib/members/link.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `persons`, `personAliases`, `memberships`, `dues`, `taskAssignments`; `normalizeHebrew`.
- Produces: `createPerson(db, displayName, email): Promise<string>`, `createPersonFromAlias(db, aliasId, email): Promise<string>`, `linkAlias(db, aliasId, personId, email): Promise<void>`, `unlinkAlias(db, aliasId): Promise<void>`, `mergePersons(db, sourceId, targetId, email): Promise<MergeResult>`, `unmergePerson(db, sourceId): Promise<void>`, `type MergeResult`.

**Design ruling — merge is only permitted when the source carries nothing but
aliases.** If the source person has a membership, a due or a task assignment,
the merge is refused and the blockers are reported. Two reasons: moving a due
could silently combine two people's money, which is the exact failure this
subsystem exists to prevent; and restricting the merge to aliases makes it
exactly reversible from `person_aliases.merged_from_person_id`, with no audit
table. The real-world case — "this unlinked name is the same as that person" —
always has an alias-only source.

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/link.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases, seasons, memberships, dues } from '@/db/schema/camp';
import { recordUnlinkedName, resolveName, listUnlinkedNames } from '@/lib/members/identity';
import {
  createPerson, createPersonFromAlias, linkAlias, unlinkAlias,
  mergePersons, unmergePerson,
} from '@/lib/members/link';

const LEAD = 'lead@shliff.camp';

describe('linking', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('creates a person and their first alias together', async () => {
    const id = await createPerson(db, 'אופק', LEAD);
    const resolution = await resolveName(db, 'אופק');
    expect(resolution.personId).toBe(id);
  });

  it('promotes an unlinked name to a new person and clears the queue', async () => {
    const aliasId = await recordUnlinkedName(db, 'עמירם דהן', 'import');
    const personId = await createPersonFromAlias(db, aliasId, LEAD);

    expect(await listUnlinkedNames(db)).toEqual([]);
    expect((await resolveName(db, 'עמירם דהן')).personId).toBe(personId);
    const [person] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(person.displayName).toBe('עמירם דהן');
  });

  it('links an unlinked name to an existing person and stamps who confirmed it', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);

    expect(await listUnlinkedNames(db)).toEqual([]);
    expect((await resolveName(db, 'אופק כהן')).personId).toBe(ofek);
    const [alias] = await db.select().from(personAliases).where(eq(personAliases.id, aliasId));
    expect(alias.confirmedBy).toBe(LEAD);
    expect(alias.confirmedAt).toBeInstanceOf(Date);
  });

  it('unlinks an alias back into the queue', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);
    await unlinkAlias(db, aliasId);

    expect(await listUnlinkedNames(db)).toHaveLength(1);
    expect((await resolveName(db, 'אופק כהן')).personId).toBeNull();
  });
});

describe('merging', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('moves the source aliases onto the target and hides the source', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);

    const result = await mergePersons(db, source, target, LEAD);
    expect(result).toEqual({ ok: true, movedAliases: 1 });

    // Both spellings now reach one person, and the source no longer competes.
    expect((await resolveName(db, 'אופק כהן')).personId).toBe(target);
    expect((await resolveName(db, 'אופק')).personId).toBe(target);
    const [merged] = await db.select().from(persons).where(eq(persons.id, source));
    expect(merged.mergedIntoId).toBe(target);
  });

  it('refuses to merge a person who has a due, and says why', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 25', year: 2025, flatRate: '1500.00' }).returning();
    await db.insert(dues)
      .values({ personId: source, seasonId: season.id, amount: '1500.00' });

    const result = await mergePersons(db, source, target, LEAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts).toContain('דמי קאמפ');

    // Nothing moved.
    expect((await resolveName(db, 'אופק כהן')).personId).toBe(source);
  });

  it('refuses to merge a person who is on a roster', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    await db.insert(memberships).values({ personId: source, seasonId: season.id });

    const result = await mergePersons(db, source, target, LEAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts).toContain('חברות במחנה');
  });

  it('refuses to merge a person into themselves', async () => {
    const person = await createPerson(db, 'אופק', LEAD);
    const result = await mergePersons(db, person, person, LEAD);
    expect(result.ok).toBe(false);
  });

  it('unmerges exactly, putting every alias back where it came from', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    await mergePersons(db, source, target, LEAD);
    await unmergePerson(db, source);

    expect((await resolveName(db, 'אופק כהן')).personId).toBe(source);
    expect((await resolveName(db, 'אופק')).personId).toBe(target);
    const [restored] = await db.select().from(persons).where(eq(persons.id, source));
    expect(restored.mergedIntoId).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/members/link.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/members/link"`.

- [ ] **Step 3: Write the link module**

Create `src/lib/members/link.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, dues, taskAssignments,
} from '@/db/schema/camp';
import { normalizeHebrew } from '@/lib/text/normalize';

export type MergeResult =
  | { ok: true; movedAliases: number }
  | { ok: false; conflicts: string[] };

export async function createPerson(
  db: AnyDb, displayName: string, email: string,
): Promise<string> {
  const name = normalizeHebrew(displayName);
  const [person] = await db.insert(persons).values({ displayName: name }).returning();
  await db.insert(personAliases).values({
    personId: person.id,
    alias: name,
    normalized: name,
    source: 'manual',
    confirmedBy: email,
    confirmedAt: new Date(),
  });
  return person.id;
}

/** Promotes a queued unlinked name into a person of its own. */
export async function createPersonFromAlias(
  db: AnyDb, aliasId: string, email: string,
): Promise<string> {
  const [alias] = await db.select().from(personAliases)
    .where(eq(personAliases.id, aliasId));
  if (!alias) throw new Error(`unknown alias ${aliasId}`);
  if (alias.personId) throw new Error(`alias ${aliasId} is already linked`);

  const [person] = await db.insert(persons)
    .values({ displayName: alias.alias }).returning();
  await db.update(personAliases)
    .set({ personId: person.id, confirmedBy: email, confirmedAt: new Date() })
    .where(eq(personAliases.id, aliasId));
  return person.id;
}

export async function linkAlias(
  db: AnyDb, aliasId: string, personId: string, email: string,
): Promise<void> {
  await db.update(personAliases)
    .set({ personId, confirmedBy: email, confirmedAt: new Date() })
    .where(eq(personAliases.id, aliasId));
}

export async function unlinkAlias(db: AnyDb, aliasId: string): Promise<void> {
  await db.update(personAliases)
    .set({ personId: null, confirmedBy: null, confirmedAt: null })
    .where(eq(personAliases.id, aliasId));
}

/**
 * Folds `sourceId` into `targetId`.
 *
 * Permitted only when the source carries nothing but aliases. Moving a due or
 * a membership could silently combine two people's money, and refusing keeps
 * the merge exactly reversible from `merged_from_person_id` without an audit
 * table. Callers get the blockers back so a lead can resolve them by hand.
 */
export async function mergePersons(
  db: AnyDb, sourceId: string, targetId: string, email: string,
): Promise<MergeResult> {
  if (sourceId === targetId) return { ok: false, conflicts: ['אותו אדם'] };

  const conflicts: string[] = [];
  const [membership] = await db.select().from(memberships)
    .where(eq(memberships.personId, sourceId)).limit(1);
  if (membership) conflicts.push('חברות במחנה');

  const [due] = await db.select().from(dues)
    .where(eq(dues.personId, sourceId)).limit(1);
  if (due) conflicts.push('דמי קאמפ');

  const [assignment] = await db.select().from(taskAssignments)
    .where(eq(taskAssignments.personId, sourceId)).limit(1);
  if (assignment) conflicts.push('שיבוץ למשימה');

  if (conflicts.length > 0) return { ok: false, conflicts };

  const moved = await db.update(personAliases)
    .set({
      personId: targetId,
      mergedFromPersonId: sourceId,
      confirmedBy: email,
      confirmedAt: new Date(),
    })
    .where(eq(personAliases.personId, sourceId))
    .returning();

  await db.update(persons)
    .set({ mergedIntoId: targetId })
    .where(eq(persons.id, sourceId));

  return { ok: true, movedAliases: moved.length };
}

/** Reverses a merge exactly: every alias goes back to the person it came from. */
export async function unmergePerson(db: AnyDb, sourceId: string): Promise<void> {
  await db.update(personAliases)
    .set({ personId: sourceId, mergedFromPersonId: null })
    .where(eq(personAliases.mergedFromPersonId, sourceId));

  await db.update(persons)
    .set({ mergedIntoId: null })
    .where(eq(persons.id, sourceId));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/members/link.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/lib/members/link.ts src/lib/members/link.test.ts
git commit -m "feat(members): link, merge and unmerge people"
```

---

### Task 5: Dues — the flat rate and its exceptions

**Files:**
- Create: `src/lib/fees/dues.ts`
- Create: `src/lib/fees/dues.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `dues`, `seasons`, `memberships`, `persons`; `toAgorot`, `fromAgorot` from `@/lib/money`.
- Produces: `issueFlatDues(db, seasonId): Promise<number>`, `setException(db, input): Promise<void>`, `clearException(db, personId, seasonId): Promise<void>`, `listDues(db, seasonId): Promise<DueRow[]>`, `type DueRow`, `type ExceptionInput`.

**The rule this task exists to enforce:** an exception with a blank reason or
no decider is **refused on write**. `עמירם דהן 0`, recorded with neither, is
the failure the whole subsystem was commissioned to prevent. This is not the
"warn, never block" rule — that governs *ingested* data; a lead typing into
the UI is not ingestion.

- [ ] **Step 1: Write the failing test**

Create `src/lib/fees/dues.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import {
  issueFlatDues, setException, clearException, listDues,
} from '@/lib/fees/dues';

const LEAD = 'lead@shliff.camp';

describe('dues', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const season = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    seasonId = season.id;
  });

  async function member(name: string) {
    const id = await createPerson(db, name, LEAD);
    await addMember(db, id, seasonId);
    return id;
  }

  it('issues the flat rate to everyone on the roster', async () => {
    await member('אופק');
    await member('יוסף');
    expect(await issueFlatDues(db, seasonId)).toBe(2);

    const rows = await listDues(db, seasonId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.amountAgorot === 150000)).toBe(true);
    expect(rows.every((r) => r.kind === 'flat')).toBe(true);
  });

  it('is idempotent — re-issuing does not overwrite or duplicate', async () => {
    const ofek = await member('אופק');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: ofek, seasonId, amount: 0,
      reason: 'עבודה במקום תשלום', decidedBy: LEAD,
    });

    expect(await issueFlatDues(db, seasonId)).toBe(0);
    const rows = await listDues(db, seasonId);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountAgorot).toBe(0);
  });

  it('records an exception with its reason and decider', async () => {
    const amiram = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: amiram, seasonId, amount: 0,
      reason: 'פטור מלא — הוביל את ההקמה', decidedBy: LEAD,
    });

    const [row] = await listDues(db, seasonId);
    expect(row.kind).toBe('exception');
    expect(row.amountAgorot).toBe(0);
    expect(row.exceptionReason).toBe('פטור מלא — הוביל את ההקמה');
    expect(row.decidedBy).toBe(LEAD);
  });

  it('refuses an exception with no reason', async () => {
    const person = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await expect(setException(db, {
      personId: person, seasonId, amount: 0, reason: '   ', decidedBy: LEAD,
    })).rejects.toThrow(/reason/);
  });

  it('refuses an exception with no decider', async () => {
    const person = await member('עמירם דהן');
    await issueFlatDues(db, seasonId);
    await expect(setException(db, {
      personId: person, seasonId, amount: 0, reason: 'פטור', decidedBy: '',
    })).rejects.toThrow(/decided/);
  });

  it('refuses a negative amount', async () => {
    const person = await member('אופק');
    await issueFlatDues(db, seasonId);
    await expect(setException(db, {
      personId: person, seasonId, amount: -100, reason: 'טעות', decidedBy: LEAD,
    })).rejects.toThrow(/negative/);
  });

  it('restores the flat rate when an exception is cleared', async () => {
    const person = await member('עזריאל');
    await issueFlatDues(db, seasonId);
    await setException(db, {
      personId: person, seasonId, amount: 1000, reason: 'הנחה', decidedBy: LEAD,
    });
    await clearException(db, person, seasonId);

    const [row] = await listDues(db, seasonId);
    expect(row.kind).toBe('flat');
    expect(row.amountAgorot).toBe(150000);
    expect(row.exceptionReason).toBeNull();
  });

  it('reproduces ברן 25: 38 flat + 5 exceptions = 60,955', async () => {
    for (let i = 0; i < 38; i += 1) await member(`חבר ${i}`);
    const exceptions: Array<[string, number]> = [
      ['עזריאל', 1000], ['עדי', 1000], ['דניאל פינטו', 555],
      ['דנה שרון', 1400], ['עמירם דהן', 0],
    ];
    const ids = new Map<string, string>();
    for (const [name] of exceptions) ids.set(name, await member(name));

    await issueFlatDues(db, seasonId);
    for (const [name, amount] of exceptions) {
      await setException(db, {
        personId: ids.get(name)!, seasonId, amount,
        reason: 'חריג מברן 25', decidedBy: LEAD,
      });
    }

    const rows = await listDues(db, seasonId);
    expect(rows).toHaveLength(43);
    expect(rows.filter((r) => r.kind === 'flat')).toHaveLength(38);
    expect(rows.filter((r) => r.kind === 'exception')).toHaveLength(5);
    const total = rows.reduce((sum, r) => sum + r.amountAgorot, 0);
    expect(total).toBe(6095500);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/fees/dues.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/fees/dues"`.

- [ ] **Step 3: Write the dues module**

Create `src/lib/fees/dues.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { dues, seasons, memberships, persons } from '@/db/schema/camp';
import type { DueKind } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';

export interface DueRow {
  dueId: string;
  personId: string;
  displayName: string;
  amountAgorot: number;
  kind: DueKind;
  exceptionReason: string | null;
  decidedBy: string | null;
}

export interface ExceptionInput {
  personId: string;
  seasonId: string;
  /** In shekels. Zero is legitimate; negative is not. */
  amount: number;
  reason: string;
  decidedBy: string;
}

/**
 * Gives every roster member without a due the season's flat rate.
 * Idempotent: an existing due — flat or exception — is left exactly as it is,
 * so re-running after recording exceptions never resets anyone.
 * Returns how many dues were created.
 */
export async function issueFlatDues(db: AnyDb, seasonId: string): Promise<number> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const roster = await db.select({ personId: memberships.personId })
    .from(memberships).where(eq(memberships.seasonId, seasonId));

  const existing = await db.select({ personId: dues.personId })
    .from(dues).where(eq(dues.seasonId, seasonId));
  const have = new Set(existing.map((row) => row.personId));

  const missing = roster.filter((row) => !have.has(row.personId));
  if (missing.length === 0) return 0;

  await db.insert(dues).values(missing.map((row) => ({
    personId: row.personId,
    seasonId,
    amount: season.flatRate,
    kind: 'flat' as const,
  })));
  return missing.length;
}

/**
 * Records that one person owes something other than the flat rate.
 *
 * The reason and the decider are mandatory. This is a hard refusal, not a
 * warning: the "validation warns, never blocks" rule governs data arriving
 * from a spreadsheet, and a lead typing here is not that. A zero due with no
 * recorded reason is exactly what the camp lost last year.
 */
export async function setException(db: AnyDb, input: ExceptionInput): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('an exception must carry a reason');
  if (!input.decidedBy.trim()) throw new Error('an exception must record who decided it');
  if (input.amount < 0) throw new Error('an exception amount may not be negative');

  const updated = await db.update(dues)
    .set({
      amount: fromAgorot(toAgorot(input.amount)),
      kind: 'exception',
      exceptionReason: reason,
      decidedBy: input.decidedBy,
    })
    .where(and(eq(dues.personId, input.personId), eq(dues.seasonId, input.seasonId)))
    .returning();

  if (updated.length === 0) {
    throw new Error('no due for that person in that season — issue the flat dues first');
  }
}

/** Puts a person back on the season's flat rate. */
export async function clearException(
  db: AnyDb, personId: string, seasonId: string,
): Promise<void> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  await db.update(dues)
    .set({
      amount: season.flatRate,
      kind: 'flat',
      exceptionReason: null,
      decidedBy: null,
    })
    .where(and(eq(dues.personId, personId), eq(dues.seasonId, seasonId)));
}

export async function listDues(db: AnyDb, seasonId: string): Promise<DueRow[]> {
  const rows = await db
    .select({
      dueId: dues.id,
      personId: dues.personId,
      displayName: persons.displayName,
      amount: dues.amount,
      kind: dues.kind,
      exceptionReason: dues.exceptionReason,
      decidedBy: dues.decidedBy,
    })
    .from(dues)
    .innerJoin(persons, eq(persons.id, dues.personId))
    .where(eq(dues.seasonId, seasonId))
    .orderBy(asc(persons.displayName));

  return rows.map((row) => ({
    dueId: row.dueId,
    personId: row.personId,
    displayName: row.displayName,
    amountAgorot: toAgorot(row.amount),
    kind: row.kind,
    exceptionReason: row.exceptionReason,
    decidedBy: row.decidedBy,
  }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/fees/dues.test.ts`
Expected: PASS, 8 tests — including the ברן 25 reconciliation to 6,095,500 agorot.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fees/dues.ts src/lib/fees/dues.test.ts
git commit -m "feat(fees): flat dues and exceptions that must carry a reason"
```

---
### Task 6: Payments, including the offset channel

**Files:**
- Create: `src/lib/fees/payments.ts`
- Create: `src/lib/fees/payments.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `dues`, `payments`, `PAYMENT_CHANNELS`, `type PaymentChannel`; `toAgorot`, `fromAgorot`, `sumAgorot`.
- Produces: `recordPayment(db, input): Promise<string>`, `recordOffset(db, input): Promise<string[]>`, `listPayments(db, dueId): Promise<PaymentRow[]>`, `deletePayment(db, paymentId): Promise<void>`, `settlementFor(db, dueId): Promise<Settlement>`, `type PaymentInput`, `type OffsetInput`, `type PaymentRow`, `type Settlement`.

**The case that shapes this module:** in the 2026 workbook, five people —
`יוסף קארינה יונתן ירין ועילאי` — are marked `שולם` for dues none of them
paid in money. One line in a different sheet, inside a `קיזוזים` table under
`חוב יוסף`, reads `6,000`. That is exactly 5 × 1,200, the ברן 26 rate: five
dues settled by writing off part of a debt the camp owed one of them.
`recordOffset` makes that one operation producing five payments that share a
note, so the link survives.

**Ruling: `recordOffset` never splits a total.** The caller passes an explicit
amount per due. The UI may propose an even split, but a lead confirms it. Code
that divided 6,000 by 5 on its own would be guessing at whose dues were
covered.

- [ ] **Step 1: Write the failing test**

Create `src/lib/fees/payments.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import {
  recordPayment, recordOffset, listPayments, deletePayment, settlementFor,
} from '@/lib/fees/payments';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('payments', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    seasonId = season.id;
  });

  async function dueFor(name: string) {
    const personId = await createPerson(db, name, LEAD);
    await addMember(db, personId, seasonId);
    await issueFlatDues(db, seasonId);
    const row = (await listDues(db, seasonId)).find((d) => d.personId === personId)!;
    return { personId, dueId: row.dueId };
  }

  it('records a cash payment and leaves the rest outstanding', async () => {
    const { dueId } = await dueFor('אופק');
    await recordPayment(db, {
      dueId, amount: 500, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.dueAgorot).toBe(120000);
    expect(settlement.paidAgorot).toBe(50000);
    expect(settlement.outstandingAgorot).toBe(70000);
    expect(settlement.settled).toBe(false);
  });

  it('settles a due paid in two goes through different channels', async () => {
    const { dueId } = await dueFor('אופק');
    await recordPayment(db, {
      dueId, amount: 700, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId, amount: 500, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.paidAgorot).toBe(120000);
    expect(settlement.outstandingAgorot).toBe(0);
    expect(settlement.settled).toBe(true);
    expect(settlement.overpaid).toBe(false);
    expect(await listPayments(db, dueId)).toHaveLength(2);
  });

  it('flags an overpayment rather than refusing it', async () => {
    const { dueId } = await dueFor('אופק');
    await recordPayment(db, {
      dueId, amount: 1500, channel: 'העברה', paidOn: WHEN, recordedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.overpaid).toBe(true);
    expect(settlement.outstandingAgorot).toBe(0);
  });

  it('treats a zero due as settled with no payments', async () => {
    const { personId, dueId } = await dueFor('עמירם דהן');
    await setException(db, {
      personId, seasonId, amount: 0, reason: 'פטור מלא', decidedBy: LEAD,
    });

    const settlement = await settlementFor(db, dueId);
    expect(settlement.settled).toBe(true);
    expect(settlement.paidAgorot).toBe(0);
  });

  it('refuses an offset with no note saying what it was set against', async () => {
    const { dueId } = await dueFor('יוסף');
    await expect(recordPayment(db, {
      dueId, amount: 1200, channel: 'קיזוז', paidOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/note/);
  });

  it('refuses an unknown channel', async () => {
    const { dueId } = await dueFor('אופק');
    await expect(recordPayment(db, {
      dueId, amount: 100, channel: 'ביטקוין' as never,
      paidOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/channel/);
  });

  it('refuses a non-positive payment', async () => {
    const { dueId } = await dueFor('אופק');
    await expect(recordPayment(db, {
      dueId, amount: 0, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    })).rejects.toThrow(/positive/);
  });

  it('settles five dues from one 6,000 offset, sharing one note', async () => {
    const names = ['יוסף', 'קארינה', 'יונתן', 'ירין', 'עילאי'];
    const entries = [];
    for (const name of names) {
      const { dueId } = await dueFor(name);
      entries.push({ dueId, amount: 1200 });
    }

    const ids = await recordOffset(db, {
      entries,
      note: 'קיזוז מול חוב יוסף — 6,000',
      paidOn: WHEN,
      recordedBy: LEAD,
    });
    expect(ids).toHaveLength(5);

    for (const { dueId } of entries) {
      const settlement = await settlementFor(db, dueId);
      expect(settlement.settled).toBe(true);
      const [payment] = await listPayments(db, dueId);
      expect(payment.channel).toBe('קיזוז');
      expect(payment.note).toBe('קיזוז מול חוב יוסף — 6,000');
    }
  });

  it('deletes a payment and reopens the due', async () => {
    const { dueId } = await dueFor('אופק');
    const id = await recordPayment(db, {
      dueId, amount: 1200, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });
    expect((await settlementFor(db, dueId)).settled).toBe(true);

    await deletePayment(db, id);
    expect((await settlementFor(db, dueId)).settled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/fees/payments.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/fees/payments"`.

- [ ] **Step 3: Write the payments module**

Create `src/lib/fees/payments.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { dues, payments, PAYMENT_CHANNELS } from '@/db/schema/camp';
import type { PaymentChannel } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';

export interface PaymentInput {
  dueId: string;
  /** In shekels. Must be positive. */
  amount: number;
  channel: PaymentChannel;
  paidOn: Date;
  /** Required when the channel is `קיזוז`. */
  note?: string;
  recordedBy: string;
}

export interface OffsetInput {
  /** One entry per due. Amounts are explicit — this never splits a total. */
  entries: Array<{ dueId: string; amount: number }>;
  /** What the offset was set against. Shared by every payment it creates. */
  note: string;
  paidOn: Date;
  recordedBy: string;
}

export interface PaymentRow {
  id: string;
  amountAgorot: number;
  channel: PaymentChannel;
  paidOn: Date;
  note: string | null;
  recordedBy: string;
}

export interface Settlement {
  dueAgorot: number;
  paidAgorot: number;
  /** Never negative: an overpayment reports zero outstanding and sets `overpaid`. */
  outstandingAgorot: number;
  settled: boolean;
  overpaid: boolean;
}

function validate(input: PaymentInput): void {
  if (!PAYMENT_CHANNELS.includes(input.channel)) {
    throw new Error(`unknown payment channel: ${input.channel}`);
  }
  if (input.amount <= 0) throw new Error('a payment amount must be positive');
  if (input.channel === 'קיזוז' && !input.note?.trim()) {
    throw new Error('an offset must carry a note saying what it was set against');
  }
}

export async function recordPayment(db: AnyDb, input: PaymentInput): Promise<string> {
  validate(input);
  const [row] = await db.insert(payments).values({
    dueId: input.dueId,
    amount: fromAgorot(toAgorot(input.amount)),
    channel: input.channel,
    paidOn: input.paidOn,
    note: input.note?.trim() || null,
    recordedBy: input.recordedBy,
  }).returning();
  return row.id;
}

/**
 * Settles several dues against one debt in a single operation, so the five
 * payments behind `יוסף קארינה יונתן ירין ועילאי — 6,000` all point at the
 * same note instead of looking like five unrelated cash payments.
 */
export async function recordOffset(db: AnyDb, input: OffsetInput): Promise<string[]> {
  if (!input.note.trim()) {
    throw new Error('an offset must carry a note saying what it was set against');
  }
  if (input.entries.length === 0) throw new Error('an offset needs at least one due');

  const ids: string[] = [];
  for (const entry of input.entries) {
    ids.push(await recordPayment(db, {
      dueId: entry.dueId,
      amount: entry.amount,
      channel: 'קיזוז',
      paidOn: input.paidOn,
      note: input.note,
      recordedBy: input.recordedBy,
    }));
  }
  return ids;
}

export async function listPayments(db: AnyDb, dueId: string): Promise<PaymentRow[]> {
  const rows = await db.select().from(payments)
    .where(eq(payments.dueId, dueId))
    .orderBy(asc(payments.paidOn));

  return rows.map((row) => ({
    id: row.id,
    amountAgorot: toAgorot(row.amount),
    channel: row.channel,
    paidOn: row.paidOn,
    note: row.note,
    recordedBy: row.recordedBy,
  }));
}

export async function deletePayment(db: AnyDb, paymentId: string): Promise<void> {
  await db.delete(payments).where(eq(payments.id, paymentId));
}

export async function settlementFor(db: AnyDb, dueId: string): Promise<Settlement> {
  const [due] = await db.select().from(dues).where(eq(dues.id, dueId));
  if (!due) throw new Error(`unknown due ${dueId}`);

  const dueAgorot = toAgorot(due.amount);
  const paidAgorot = (await listPayments(db, dueId))
    .reduce((total, row) => total + row.amountAgorot, 0);

  return {
    dueAgorot,
    paidAgorot,
    outstandingAgorot: Math.max(0, dueAgorot - paidAgorot),
    settled: paidAgorot >= dueAgorot,
    overpaid: paidAgorot > dueAgorot,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/fees/payments.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fees/payments.ts src/lib/fees/payments.test.ts
git commit -m "feat(fees): payments across six channels, including debt offsets"
```

---

### Task 7: The season fee summary

**Files:**
- Create: `src/lib/fees/summary.ts`
- Create: `src/lib/fees/summary.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `seasons`, `memberships`, `dues`, `payments`, `persons`; `toAgorot`.
- Produces: `seasonFeeSummary(db, seasonId): Promise<SeasonFeeSummary>`, `type SeasonFeeSummary`.

This is the number the leads open the site to see, and the one currently typed
by hand into `סה״כ 43 → 60,955`. It must be computed.

- [ ] **Step 1: Write the failing test**

Create `src/lib/fees/summary.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { seasonFeeSummary } from '@/lib/fees/summary';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('seasonFeeSummary', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('reproduces ברן 25 — 38 רגילים, 5 חריגים, 60,955 expected', async () => {
    const season = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    const ids: string[] = [];
    for (let i = 0; i < 38; i += 1) {
      const id = await createPerson(db, `חבר ${i}`, LEAD);
      await addMember(db, id, season.id);
      ids.push(id);
    }
    const exceptions: Array<[string, number]> = [
      ['עזריאל', 1000], ['עדי', 1000], ['דניאל פינטו', 555],
      ['דנה שרון', 1400], ['עמירם דהן', 0],
    ];
    for (const [name] of exceptions) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
      ids.push(id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    for (const [name, amount] of exceptions) {
      const row = rows.find((r) => r.displayName === name)!;
      await setException(db, {
        personId: row.personId, seasonId: season.id, amount,
        reason: 'חריג מברן 25', decidedBy: LEAD,
      });
    }

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.memberCount).toBe(43);
    expect(summary.flatCount).toBe(38);
    expect(summary.exceptionCount).toBe(5);
    expect(summary.expectedAgorot).toBe(6095500);
    expect(summary.collectedAgorot).toBe(0);
    expect(summary.outstandingAgorot).toBe(6095500);
  });

  it('reproduces the ברן 26 plan — 35 × 1,200 = 42,000', async () => {
    const season = await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    });
    for (let i = 0; i < 35; i += 1) {
      const id = await createPerson(db, `חבר ${i}`, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.expectedAgorot).toBe(4200000);
    expect(summary.memberCount).toBe(35);
  });

  it('counts collected money and who is still unpaid', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    for (const name of ['אופק', 'יוסף', 'ירין']) {
      const id = await createPerson(db, name, LEAD);
      await addMember(db, id, season.id);
    }
    await issueFlatDues(db, season.id);
    const rows = await listDues(db, season.id);
    await recordPayment(db, {
      dueId: rows[0].dueId, amount: 1200, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: rows[1].dueId, amount: 600, channel: 'מזומן', paidOn: WHEN, recordedBy: LEAD,
    });

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.expectedAgorot).toBe(360000);
    expect(summary.collectedAgorot).toBe(180000);
    expect(summary.outstandingAgorot).toBe(180000);
    expect(summary.unpaidCount).toBe(2);
  });

  it('names roster members who have no due at all rather than hiding them', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const withDue = await createPerson(db, 'אופק', LEAD);
    await addMember(db, withDue, season.id);
    await issueFlatDues(db, season.id);

    const without = await createPerson(db, 'עמירם דהן', LEAD);
    await addMember(db, without, season.id);

    const summary = await seasonFeeSummary(db, season.id);
    expect(summary.memberCount).toBe(2);
    expect(summary.missingDues).toEqual(['עמירם דהן']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/fees/summary.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/fees/summary"`.

- [ ] **Step 3: Write the summary module**

Create `src/lib/fees/summary.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { seasons, memberships, dues, payments, persons } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';

export interface SeasonFeeSummary {
  seasonId: string;
  seasonName: string;
  flatRateAgorot: number;
  memberCount: number;
  flatCount: number;
  exceptionCount: number;
  expectedAgorot: number;
  collectedAgorot: number;
  outstandingAgorot: number;
  /** Dues with at least one agora still owing. */
  unpaidCount: number;
  /** Roster members with no due row at all — surfaced, never silently skipped. */
  missingDues: string[];
}

export async function seasonFeeSummary(
  db: AnyDb, seasonId: string,
): Promise<SeasonFeeSummary> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);

  const roster = await db
    .select({ personId: memberships.personId, displayName: persons.displayName })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(eq(memberships.seasonId, seasonId));

  const dueRows = await db
    .select({ id: dues.id, personId: dues.personId, amount: dues.amount, kind: dues.kind })
    .from(dues)
    .where(eq(dues.seasonId, seasonId));

  const paymentRows = await db
    .select({ dueId: payments.dueId, amount: payments.amount })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .where(eq(dues.seasonId, seasonId));

  const paidByDue = new Map<string, number>();
  for (const row of paymentRows) {
    paidByDue.set(row.dueId, (paidByDue.get(row.dueId) ?? 0) + toAgorot(row.amount));
  }

  let expectedAgorot = 0;
  let collectedAgorot = 0;
  let unpaidCount = 0;
  let flatCount = 0;
  let exceptionCount = 0;

  for (const due of dueRows) {
    const owed = toAgorot(due.amount);
    const paid = paidByDue.get(due.id) ?? 0;
    expectedAgorot += owed;
    collectedAgorot += paid;
    if (paid < owed) unpaidCount += 1;
    if (due.kind === 'exception') exceptionCount += 1;
    else flatCount += 1;
  }

  const haveDues = new Set(dueRows.map((row) => row.personId));
  const missingDues = roster
    .filter((row) => !haveDues.has(row.personId))
    .map((row) => row.displayName)
    .sort();

  return {
    seasonId,
    seasonName: season.name,
    flatRateAgorot: toAgorot(season.flatRate),
    memberCount: roster.length,
    flatCount,
    exceptionCount,
    expectedAgorot,
    collectedAgorot,
    outstandingAgorot: Math.max(0, expectedAgorot - collectedAgorot),
    unpaidCount,
    missingDues,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/fees/summary.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fees/summary.ts src/lib/fees/summary.test.ts
git commit -m "feat(fees): compute the season summary instead of typing it in"
```

---
### Task 8: Events and the four kinds of task

**Files:**
- Create: `src/lib/work/events.ts`
- Create: `src/lib/work/tasks.ts`
- Create: `src/lib/work/tasks.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `campEvents`, `tasks`, `seasons`, `type TaskKind`, `type TaskStatus`, `type EventKind`; `toAgorot`, `fromAgorot`.
- Produces: `createEvent(db, input): Promise<CampEvent>`, `listEvents(db, seasonId): Promise<CampEvent[]>`, `type NewEvent`, `type CampEvent`; `createTask(db, input): Promise<string>`, `listTasks(db, seasonId, filter?): Promise<TaskRow[]>`, `setTaskStatus(db, taskId, status): Promise<void>`, `type NewTask`, `type TaskRow`.

**Ruling on per-kind validation:** a `shift` must carry a start and an end, and
an `event_task` must name an event. Both are incoherent without them, and
accepting one would mean the coverage report silently ignores it. A
`deliverable`'s budget and a `build`'s deadline stay optional — the רחבה sheet
has owned line items with no deadline, and that is legitimate.

- [ ] **Step 1: Write the failing test**

Create `src/lib/work/tasks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createEvent, listEvents } from '@/lib/work/events';
import { createTask, listTasks, setTaskStatus } from '@/lib/work/tasks';

describe('events', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
  });

  it('records fundraising parties and the burn itself', async () => {
    await createEvent(db, {
      seasonId, name: 'מסיבת פקאנים', kind: 'fundraiser',
      heldOn: new Date('2026-07-18T00:00:00Z'),
    });
    await createEvent(db, { seasonId, name: 'מידברן 26', kind: 'burn' });

    const events = await listEvents(db, seasonId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind).sort()).toEqual(['burn', 'fundraiser']);
  });
});

describe('tasks', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 })).id;
  });

  it('records a deliverable with its budget', async () => {
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'חשמל', budgetAmount: 12950,
    });
    const [task] = await listTasks(db, seasonId);
    expect(task.kind).toBe('deliverable');
    expect(task.budgetAgorot).toBe(1295000);
    expect(task.peopleNeeded).toBe(1);
  });

  it('records a shift needing several people', async () => {
    await createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר',
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
      peopleNeeded: 4,
    });
    const [task] = await listTasks(db, seasonId);
    expect(task.peopleNeeded).toBe(4);
    expect(task.startsAt).toBeInstanceOf(Date);
  });

  it('refuses a shift with no time window', async () => {
    await expect(createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר', peopleNeeded: 4,
    })).rejects.toThrow(/time window/);
  });

  it('refuses a shift that ends before it starts', async () => {
    await expect(createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר',
      startsAt: new Date('2026-10-02T00:00:00Z'),
      endsAt: new Date('2026-10-01T20:00:00Z'),
    })).rejects.toThrow(/before/);
  });

  it('refuses an event task with no event', async () => {
    await expect(createTask(db, {
      seasonId, kind: 'event_task', title: 'כניסה',
    })).rejects.toThrow(/event/);
  });

  it('accepts build work with a deadline and without one', async () => {
    await createTask(db, {
      seasonId, kind: 'build', title: 'הובלת מכולה',
      dueOn: new Date('2026-09-01T00:00:00Z'),
    });
    await createTask(db, { seasonId, kind: 'build', title: 'סידור מחסן' });
    expect(await listTasks(db, seasonId)).toHaveLength(2);
  });

  it('filters by kind', async () => {
    await createTask(db, { seasonId, kind: 'deliverable', title: 'חשמל' });
    await createTask(db, { seasonId, kind: 'build', title: 'סידור מחסן' });

    expect(await listTasks(db, seasonId, { kind: 'deliverable' })).toHaveLength(1);
    expect(await listTasks(db, seasonId, { kind: 'shift' })).toHaveLength(0);
  });

  it('links an event task to its event', async () => {
    const event = await createEvent(db, {
      seasonId, name: 'מסיבת פקאנים', kind: 'fundraiser',
    });
    await createTask(db, {
      seasonId, eventId: event.id, kind: 'event_task', title: 'כניסה', peopleNeeded: 2,
    });
    const [task] = await listTasks(db, seasonId);
    expect(task.eventName).toBe('מסיבת פקאנים');
  });

  it('closes a task', async () => {
    await createTask(db, { seasonId, kind: 'build', title: 'סידור מחסן' });
    const [task] = await listTasks(db, seasonId);
    await setTaskStatus(db, task.taskId, 'done');
    expect((await listTasks(db, seasonId))[0].status).toBe('done');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/work/tasks.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/work/events"`.

- [ ] **Step 3: Write the events module**

Create `src/lib/work/events.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { campEvents } from '@/db/schema/camp';
import type { EventKind } from '@/db/schema/camp';

export type CampEvent = typeof campEvents.$inferSelect;

export interface NewEvent {
  seasonId: string;
  name: string;
  kind: EventKind;
  heldOn?: Date;
}

export async function createEvent(db: AnyDb, input: NewEvent): Promise<CampEvent> {
  const [event] = await db.insert(campEvents).values({
    seasonId: input.seasonId,
    name: input.name,
    kind: input.kind,
    heldOn: input.heldOn ?? null,
  }).returning();
  return event;
}

export async function listEvents(db: AnyDb, seasonId: string): Promise<CampEvent[]> {
  return db.select().from(campEvents)
    .where(eq(campEvents.seasonId, seasonId))
    .orderBy(asc(campEvents.heldOn), asc(campEvents.name));
}
```

- [ ] **Step 4: Write the tasks module**

Create `src/lib/work/tasks.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { tasks, campEvents } from '@/db/schema/camp';
import type { TaskKind, TaskStatus } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';

export interface NewTask {
  seasonId: string;
  eventId?: string;
  kind: TaskKind;
  title: string;
  description?: string;
  /** deliverable: budget in shekels. */
  budgetAmount?: number;
  /** shift: both required. */
  startsAt?: Date;
  endsAt?: Date;
  /** build: optional deadline. */
  dueOn?: Date;
  peopleNeeded?: number;
}

export interface TaskRow {
  taskId: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  budgetAgorot: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  dueOn: Date | null;
  peopleNeeded: number;
  status: TaskStatus;
  eventId: string | null;
  eventName: string | null;
}

/**
 * A shift with no window and an event task with no event are incoherent, and
 * accepting either would make the coverage report quietly wrong. Everything
 * else stays optional: the רחבה sheet has owned line items with no deadline.
 */
function validate(input: NewTask): void {
  if (!input.title.trim()) throw new Error('a task needs a title');
  if (input.kind === 'shift') {
    if (!input.startsAt || !input.endsAt) {
      throw new Error('a shift needs a time window');
    }
    if (input.endsAt <= input.startsAt) {
      throw new Error('a shift may not end before it starts');
    }
  }
  if (input.kind === 'event_task' && !input.eventId) {
    throw new Error('an event task must name its event');
  }
  if (input.peopleNeeded !== undefined && input.peopleNeeded < 1) {
    throw new Error('a task needs at least one person');
  }
}

export async function createTask(db: AnyDb, input: NewTask): Promise<string> {
  validate(input);
  const [row] = await db.insert(tasks).values({
    seasonId: input.seasonId,
    eventId: input.eventId ?? null,
    kind: input.kind,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    budgetAmount: input.budgetAmount === undefined
      ? null
      : fromAgorot(toAgorot(input.budgetAmount)),
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    dueOn: input.dueOn ?? null,
    peopleNeeded: input.peopleNeeded ?? 1,
  }).returning();
  return row.id;
}

export async function listTasks(
  db: AnyDb, seasonId: string, filter?: { kind?: TaskKind },
): Promise<TaskRow[]> {
  const where = filter?.kind
    ? and(eq(tasks.seasonId, seasonId), eq(tasks.kind, filter.kind))
    : eq(tasks.seasonId, seasonId);

  const rows = await db
    .select({
      taskId: tasks.id,
      kind: tasks.kind,
      title: tasks.title,
      description: tasks.description,
      budgetAmount: tasks.budgetAmount,
      startsAt: tasks.startsAt,
      endsAt: tasks.endsAt,
      dueOn: tasks.dueOn,
      peopleNeeded: tasks.peopleNeeded,
      status: tasks.status,
      eventId: tasks.eventId,
      eventName: campEvents.name,
    })
    .from(tasks)
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
    .where(where)
    .orderBy(asc(tasks.kind), asc(tasks.title));

  return rows.map(({ budgetAmount, ...row }) => ({
    ...row,
    budgetAgorot: budgetAmount === null ? null : toAgorot(budgetAmount),
  }));
}

export async function setTaskStatus(
  db: AnyDb, taskId: string, status: TaskStatus,
): Promise<void> {
  await db.update(tasks).set({ status }).where(eq(tasks.id, taskId));
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/lib/work/tasks.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work/events.ts src/lib/work/tasks.ts src/lib/work/tasks.test.ts
git commit -m "feat(work): events and the four kinds of task"
```

---

### Task 9: Assignments and the uncovered-task report

**Files:**
- Create: `src/lib/work/coverage.ts`
- Create: `src/lib/work/coverage.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `tasks`, `taskAssignments`, `persons`, `seasons`, `campEvents`, `type AssignmentStatus`; `TaskRow` from `@/lib/work/tasks`.
- Produces: `assignPerson(db, taskId, personId, email, status?): Promise<string>`, `setAssignmentStatus(db, assignmentId, status): Promise<void>`, `removeAssignment(db, assignmentId): Promise<void>`, `coverageFor(db, seasonId): Promise<TaskCoverage[]>`, `uncoveredTasks(db, seasonId): Promise<TaskCoverage[]>`, `responsibilitiesOf(db, personId): Promise<Responsibility[]>`, `type TaskCoverage`, `type Assignee`, `type Responsibility`.

**Ruling on what counts as covered:** only `accepted` and `done` assignments
count toward `peopleNeeded`. A `proposed` assignment is a lead's intention, not
a commitment, and counting it would report a shift as staffed when nobody has
agreed to work it. `dropped` never counts.

- [ ] **Step 1: Write the failing test**

Create `src/lib/work/coverage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { createEvent } from '@/lib/work/events';
import { createTask, listTasks } from '@/lib/work/tasks';
import {
  assignPerson, setAssignmentStatus, removeAssignment,
  coverageFor, uncoveredTasks, responsibilitiesOf,
} from '@/lib/work/coverage';

const LEAD = 'lead@shliff.camp';

describe('coverage', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 })).id;
  });

  async function shift(title: string, peopleNeeded: number) {
    await createTask(db, {
      seasonId, kind: 'shift', title, peopleNeeded,
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
    });
    return (await listTasks(db, seasonId)).find((t) => t.title === title)!.taskId;
  }

  it('reports a task with nobody on it as uncovered', async () => {
    await shift('משמרת בר', 4);
    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.accepted).toBe(0);
    expect(coverage.uncovered).toBe(true);
    expect(await uncoveredTasks(db, seasonId)).toHaveLength(1);
  });

  it('does not count a proposed assignment as covering anything', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    await assignPerson(db, taskId, ofek, LEAD);

    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.assignees).toHaveLength(1);
    expect(coverage.accepted).toBe(0);
    expect(coverage.uncovered).toBe(true);
  });

  it('counts an accepted assignment and closes the gap', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await setAssignmentStatus(db, assignmentId, 'accepted');

    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.accepted).toBe(1);
    expect(coverage.uncovered).toBe(false);
    expect(await uncoveredTasks(db, seasonId)).toEqual([]);
  });

  it('reports a partly staffed shift as still uncovered', async () => {
    const taskId = await shift('משמרת בר', 4);
    for (const name of ['אופק', 'ירין']) {
      const id = await createPerson(db, name, LEAD);
      const assignmentId = await assignPerson(db, taskId, id, LEAD);
      await setAssignmentStatus(db, assignmentId, 'accepted');
    }

    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.accepted).toBe(2);
    expect(coverage.peopleNeeded).toBe(4);
    expect(coverage.uncovered).toBe(true);
  });

  it('stops counting someone who dropped', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await setAssignmentStatus(db, assignmentId, 'accepted');
    await setAssignmentStatus(db, assignmentId, 'dropped');

    expect((await coverageFor(db, seasonId))[0].uncovered).toBe(true);
  });

  it('refuses to assign the same person to a task twice', async () => {
    const taskId = await shift('משמרת בר', 4);
    const ofek = await createPerson(db, 'אופק', LEAD);
    await assignPerson(db, taskId, ofek, LEAD);
    await expect(assignPerson(db, taskId, ofek, LEAD)).rejects.toThrow();
  });

  it('removes an assignment entirely', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await removeAssignment(db, assignmentId);
    expect((await coverageFor(db, seasonId))[0].assignees).toEqual([]);
  });

  it('ignores cancelled tasks in the uncovered report', async () => {
    const taskId = await shift('משמרת בר', 4);
    const { setTaskStatus } = await import('@/lib/work/tasks');
    await setTaskStatus(db, taskId, 'cancelled');
    expect(await uncoveredTasks(db, seasonId)).toEqual([]);
  });

  it('answers "everything אופק is responsible for" across kinds and events', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const event = await createEvent(db, {
      seasonId, name: 'מסיבת פקאנים', kind: 'fundraiser',
    });
    // The two ownerships the ברן 25 רחבה sheet actually records for אופק.
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'חשמל', budgetAmount: 12950,
    });
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'הובלה', budgetAmount: 4000,
    });
    await createTask(db, {
      seasonId, eventId: event.id, kind: 'event_task', title: 'כניסה',
    });

    for (const title of ['חשמל', 'הובלה', 'כניסה']) {
      const task = (await listTasks(db, seasonId)).find((t) => t.title === title)!;
      const id = await assignPerson(db, task.taskId, ofek, LEAD);
      await setAssignmentStatus(db, id, 'accepted');
    }

    const owned = await responsibilitiesOf(db, ofek);
    expect(owned).toHaveLength(3);
    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל', 'כניסה']);
    expect(owned.find((r) => r.title === 'חשמל')?.budgetAgorot).toBe(1295000);
    expect(owned.find((r) => r.title === 'כניסה')?.eventName).toBe('מסיבת פקאנים');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/work/coverage.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/work/coverage"`.

- [ ] **Step 3: Write the coverage module**

Create `src/lib/work/coverage.ts`:

```ts
import { and, asc, eq, ne } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  tasks, taskAssignments, persons, seasons, campEvents,
} from '@/db/schema/camp';
import type { AssignmentStatus, TaskKind, TaskStatus } from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';

/** Only these count toward `peopleNeeded`. A `proposed` assignment is a lead's
 *  intention, not a commitment — counting it would report a shift as staffed
 *  when nobody has agreed to work it. */
const COUNTS_AS_COVERED: AssignmentStatus[] = ['accepted', 'done'];

export interface Assignee {
  assignmentId: string;
  personId: string;
  displayName: string;
  status: AssignmentStatus;
}

export interface TaskCoverage {
  taskId: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  peopleNeeded: number;
  /** Assignments in `accepted` or `done`. */
  accepted: number;
  uncovered: boolean;
  eventName: string | null;
  assignees: Assignee[];
}

export interface Responsibility {
  taskId: string;
  title: string;
  kind: TaskKind;
  seasonName: string;
  eventName: string | null;
  budgetAgorot: number | null;
  status: AssignmentStatus;
}

export async function assignPerson(
  db: AnyDb, taskId: string, personId: string, email: string,
  status: AssignmentStatus = 'proposed',
): Promise<string> {
  const [row] = await db.insert(taskAssignments)
    .values({ taskId, personId, status, assignedBy: email })
    .returning();
  return row.id;
}

export async function setAssignmentStatus(
  db: AnyDb, assignmentId: string, status: AssignmentStatus,
): Promise<void> {
  await db.update(taskAssignments).set({ status })
    .where(eq(taskAssignments.id, assignmentId));
}

export async function removeAssignment(db: AnyDb, assignmentId: string): Promise<void> {
  await db.delete(taskAssignments).where(eq(taskAssignments.id, assignmentId));
}

export async function coverageFor(db: AnyDb, seasonId: string): Promise<TaskCoverage[]> {
  const taskRows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      status: tasks.status,
      peopleNeeded: tasks.peopleNeeded,
      eventName: campEvents.name,
    })
    .from(tasks)
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
    .where(eq(tasks.seasonId, seasonId))
    .orderBy(asc(tasks.kind), asc(tasks.title));

  const assignmentRows = await db
    .select({
      assignmentId: taskAssignments.id,
      taskId: taskAssignments.taskId,
      personId: taskAssignments.personId,
      displayName: persons.displayName,
      status: taskAssignments.status,
    })
    .from(taskAssignments)
    .innerJoin(persons, eq(persons.id, taskAssignments.personId))
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .where(eq(tasks.seasonId, seasonId))
    .orderBy(asc(persons.displayName));

  const byTask = new Map<string, Assignee[]>();
  for (const row of assignmentRows) {
    const list = byTask.get(row.taskId) ?? [];
    list.push({
      assignmentId: row.assignmentId,
      personId: row.personId,
      displayName: row.displayName,
      status: row.status,
    });
    byTask.set(row.taskId, list);
  }

  return taskRows.map((task) => {
    const assignees = byTask.get(task.taskId) ?? [];
    const accepted = assignees
      .filter((a) => COUNTS_AS_COVERED.includes(a.status)).length;
    return {
      ...task,
      accepted,
      uncovered: task.status === 'open' && accepted < task.peopleNeeded,
      assignees,
    };
  });
}

/** The question that must be answerable before the gate opens. */
export async function uncoveredTasks(
  db: AnyDb, seasonId: string,
): Promise<TaskCoverage[]> {
  return (await coverageFor(db, seasonId)).filter((task) => task.uncovered);
}

/**
 * Everything one person is on the hook for, across all four kinds and every
 * season. This is the `אופק → חשמל` + `אופק → הובלה` query — one call, not a
 * four-way union.
 */
export async function responsibilitiesOf(
  db: AnyDb, personId: string,
): Promise<Responsibility[]> {
  const rows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      seasonName: seasons.name,
      eventName: campEvents.name,
      budgetAmount: tasks.budgetAmount,
      status: taskAssignments.status,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .innerJoin(seasons, eq(seasons.id, tasks.seasonId))
    .leftJoin(campEvents, eq(campEvents.id, tasks.eventId))
    .where(and(
      eq(taskAssignments.personId, personId),
      ne(taskAssignments.status, 'dropped'),
    ))
    .orderBy(asc(seasons.year), asc(tasks.title));

  return rows.map((row) => ({
    taskId: row.taskId,
    title: row.title,
    kind: row.kind,
    seasonName: row.seasonName,
    eventName: row.eventName,
    budgetAgorot: row.budgetAmount === null ? null : toAgorot(row.budgetAmount),
    status: row.status,
  }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/work/coverage.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/lib/work/coverage.ts src/lib/work/coverage.test.ts
git commit -m "feat(work): assignments, coverage gaps and per-person responsibilities"
```

---
### Task 10: The person dossier

**Files:**
- Create: `src/lib/members/dossier.ts`
- Create: `src/lib/members/dossier.test.ts`

**Interfaces:**
- Consumes: `AnyDb`; `persons`, `personAliases`, `memberships`, `seasons`, `dues`; `settlementFor` from `@/lib/fees/payments`; `responsibilitiesOf` from `@/lib/work/coverage`; `toAgorot`.
- Produces: `personDossier(db, personId): Promise<Dossier | null>`, `listPeople(db): Promise<PersonSummary[]>`, `type Dossier`, `type DossierDue`, `type PersonSummary`.

This is the screen that answers "who is אופק" — the one thing the spreadsheets
cannot do, because אופק is five unrelated strings there.

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/dossier.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { recordUnlinkedName } from '@/lib/members/identity';
import { linkAlias } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { createTask, listTasks } from '@/lib/work/tasks';
import { assignPerson, setAssignmentStatus } from '@/lib/work/coverage';
import { personDossier, listPeople } from '@/lib/members/dossier';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('personDossier', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('gathers every spelling, season, due and responsibility for one person', async () => {
    const s25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const s26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);

    await addMember(db, ofek, s25.id);
    await addMember(db, ofek, s26.id, 'lead');
    await issueFlatDues(db, s25.id);
    await issueFlatDues(db, s26.id);

    const due25 = (await listDues(db, s25.id))[0];
    await recordPayment(db, {
      dueId: due25.dueId, amount: 1500, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });

    // The two deliverables the ברן 25 רחבה sheet records for אופק.
    for (const [title, budget] of [['חשמל', 12950], ['הובלה', 4000]] as const) {
      await createTask(db, {
        seasonId: s25.id, kind: 'deliverable', title, budgetAmount: budget,
      });
      const task = (await listTasks(db, s25.id)).find((t) => t.title === title)!;
      const id = await assignPerson(db, task.taskId, ofek, LEAD);
      await setAssignmentStatus(db, id, 'accepted');
    }

    const dossier = await personDossier(db, ofek);
    expect(dossier).not.toBeNull();
    expect(dossier!.displayName).toBe('אופק');
    expect(dossier!.aliases.map((a) => a.alias).sort()).toEqual(['אופק', 'אופק כהן']);
    expect(dossier!.seasons.map((s) => s.seasonName).sort()).toEqual(['ברן 25', 'ברן 26']);

    expect(dossier!.dues).toHaveLength(2);
    const paid = dossier!.dues.find((d) => d.seasonName === 'ברן 25')!;
    expect(paid.paidAgorot).toBe(150000);
    expect(paid.settled).toBe(true);
    const owing = dossier!.dues.find((d) => d.seasonName === 'ברן 26')!;
    expect(owing.outstandingAgorot).toBe(120000);
    expect(owing.settled).toBe(false);

    expect(dossier!.responsibilities).toHaveLength(2);
    expect(dossier!.responsibilities.map((r) => r.title).sort())
      .toEqual(['הובלה', 'חשמל']);
  });

  it('carries an exception reason into the dossier', async () => {
    const season = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const amiram = await createPerson(db, 'עמירם דהן', LEAD);
    await addMember(db, amiram, season.id);
    await issueFlatDues(db, season.id);
    await setException(db, {
      personId: amiram, seasonId: season.id, amount: 0,
      reason: 'פטור מלא — הוביל את ההקמה', decidedBy: LEAD,
    });

    const dossier = await personDossier(db, amiram);
    expect(dossier!.dues[0].kind).toBe('exception');
    expect(dossier!.dues[0].exceptionReason).toBe('פטור מלא — הוביל את ההקמה');
    expect(dossier!.dues[0].decidedBy).toBe(LEAD);
    expect(dossier!.dues[0].settled).toBe(true);
  });

  it('returns null for an unknown person', async () => {
    expect(await personDossier(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('listPeople', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('lists people with what they still owe, hiding merged-away rows', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await createPerson(db, 'אופק', LEAD);
    const yosef = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, ofek, season.id);
    await addMember(db, yosef, season.id);
    await issueFlatDues(db, season.id);

    const rows = await listPeople(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].displayName).toBe('אופק');
    expect(rows[0].outstandingAgorot).toBe(120000);
    expect(rows[0].seasonCount).toBe(1);
  });

  it('excludes a person who was merged into another', async () => {
    const { mergePersons } = await import('@/lib/members/link');
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    await mergePersons(db, source, target, LEAD);

    const rows = await listPeople(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].personId).toBe(target);
    expect(rows[0].aliasCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/members/dossier.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/members/dossier"`.

- [ ] **Step 3: Write the dossier module**

Create `src/lib/members/dossier.ts`:

```ts
import { asc, eq, isNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, seasons, dues,
} from '@/db/schema/camp';
import type { DueKind } from '@/db/schema/camp';
import { settlementFor } from '@/lib/fees/payments';
import { responsibilitiesOf, type Responsibility } from '@/lib/work/coverage';
import { toAgorot } from '@/lib/money';

export interface DossierDue {
  dueId: string;
  seasonName: string;
  amountAgorot: number;
  kind: DueKind;
  exceptionReason: string | null;
  decidedBy: string | null;
  paidAgorot: number;
  outstandingAgorot: number;
  settled: boolean;
}

export interface Dossier {
  personId: string;
  displayName: string;
  notes: string | null;
  mergedIntoId: string | null;
  aliases: Array<{ aliasId: string; alias: string; source: string; confirmedBy: string | null }>;
  seasons: Array<{ seasonName: string; role: string }>;
  dues: DossierDue[];
  responsibilities: Responsibility[];
}

export interface PersonSummary {
  personId: string;
  displayName: string;
  aliasCount: number;
  seasonCount: number;
  outstandingAgorot: number;
}

/** Everything the system knows about one human, in one call. */
export async function personDossier(
  db: AnyDb, personId: string,
): Promise<Dossier | null> {
  const [person] = await db.select().from(persons).where(eq(persons.id, personId));
  if (!person) return null;

  const aliases = await db
    .select({
      aliasId: personAliases.id,
      alias: personAliases.alias,
      source: personAliases.source,
      confirmedBy: personAliases.confirmedBy,
    })
    .from(personAliases)
    .where(eq(personAliases.personId, personId))
    .orderBy(asc(personAliases.alias));

  const seasonRows = await db
    .select({ seasonName: seasons.name, role: memberships.role })
    .from(memberships)
    .innerJoin(seasons, eq(seasons.id, memberships.seasonId))
    .where(eq(memberships.personId, personId))
    .orderBy(asc(seasons.year));

  const dueRows = await db
    .select({
      dueId: dues.id,
      seasonName: seasons.name,
      amount: dues.amount,
      kind: dues.kind,
      exceptionReason: dues.exceptionReason,
      decidedBy: dues.decidedBy,
    })
    .from(dues)
    .innerJoin(seasons, eq(seasons.id, dues.seasonId))
    .where(eq(dues.personId, personId))
    .orderBy(asc(seasons.year));

  const dueDetails: DossierDue[] = [];
  for (const row of dueRows) {
    const settlement = await settlementFor(db, row.dueId);
    dueDetails.push({
      dueId: row.dueId,
      seasonName: row.seasonName,
      amountAgorot: toAgorot(row.amount),
      kind: row.kind,
      exceptionReason: row.exceptionReason,
      decidedBy: row.decidedBy,
      paidAgorot: settlement.paidAgorot,
      outstandingAgorot: settlement.outstandingAgorot,
      settled: settlement.settled,
    });
  }

  return {
    personId: person.id,
    displayName: person.displayName,
    notes: person.notes,
    mergedIntoId: person.mergedIntoId,
    aliases,
    seasons: seasonRows,
    dues: dueDetails,
    responsibilities: await responsibilitiesOf(db, personId),
  };
}

/** The roster index. Merged-away rows are hidden; their aliases live on the
 *  person they were merged into. */
export async function listPeople(db: AnyDb): Promise<PersonSummary[]> {
  const people = await db.select().from(persons)
    .where(isNull(persons.mergedIntoId))
    .orderBy(asc(persons.displayName));

  const summaries: PersonSummary[] = [];
  for (const person of people) {
    const aliases = await db.select({ id: personAliases.id }).from(personAliases)
      .where(eq(personAliases.personId, person.id));
    const seasonRows = await db.select({ id: memberships.id }).from(memberships)
      .where(eq(memberships.personId, person.id));
    const dueRows = await db.select({ id: dues.id }).from(dues)
      .where(eq(dues.personId, person.id));

    let outstandingAgorot = 0;
    for (const due of dueRows) {
      outstandingAgorot += (await settlementFor(db, due.id)).outstandingAgorot;
    }

    summaries.push({
      personId: person.id,
      displayName: person.displayName,
      aliasCount: aliases.length,
      seasonCount: seasonRows.length,
      outstandingAgorot,
    });
  }
  return summaries;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/members/dossier.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/dossier.ts src/lib/members/dossier.test.ts
git commit -m "feat(members): one screen's worth of everything about one person"
```

---

### Task 11: Seed the baseline from the workbooks

**Files:**
- Create: `src/lib/seed/camp-seed.ts`
- Create: `src/lib/seed/camp-seed.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: `seedCampBaseline(db, email): Promise<CampSeedResult>`, `type CampSeedResult`.

**What gets seeded, and the rule behind it.** Only what the workbooks actually
state. Three rulings:

1. **Seasons: ברן 25 and ברן 26 only.** Their flat rates are written down
   (1,500 and 1,200). ברן 23 and ברן 24 have no recorded rate, and inventing
   one to make the list look complete would be the system guessing. A lead can
   add them.
2. **The 38 anonymous `רגילים` are not seeded as people.** They are a count in
   a budget cell, not a roster. `plannedSize` carries the number.
3. **`ראנצ׳ו ונטלי` is seeded as an unlinked name, not as one or two people.**
   The `אחראי` cell for `מייצג` holds two names joined by a conjunction. The
   system does not split it; a lead does. This is the queue demonstrating
   itself on real data.

- [ ] **Step 1: Write the failing test**

Create `src/lib/seed/camp-seed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { getSeasonByName, listRoster } from '@/lib/members/roster';
import { resolveName, listUnlinkedNames } from '@/lib/members/identity';
import { listDues } from '@/lib/fees/dues';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { listEvents } from '@/lib/work/events';
import { responsibilitiesOf } from '@/lib/work/coverage';
import { personDossier } from '@/lib/members/dossier';
import { seedCampBaseline } from '@/lib/seed/camp-seed';

const LEAD = 'lead@shliff.camp';

describe('seedCampBaseline', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('seeds the two seasons whose rates the workbooks state', async () => {
    await seedCampBaseline(db, LEAD);
    const s25 = await getSeasonByName(db, 'ברן 25');
    const s26 = await getSeasonByName(db, 'ברן 26');
    expect(s25?.flatRate).toBe('1500.00');
    expect(s25?.plannedSize).toBe(43);
    expect(s26?.flatRate).toBe('1200.00');
    expect(s26?.plannedSize).toBe(35);
    // ברן 23 and ברן 24 have no recorded rate — not invented.
    expect(await getSeasonByName(db, 'ברן 23')).toBeUndefined();
  });

  it('is idempotent', async () => {
    const first = await seedCampBaseline(db, LEAD);
    const second = await seedCampBaseline(db, LEAD);
    expect(second.seasons).toBe(0);
    expect(second.people).toBe(0);
    expect(second.tasks).toBe(0);
    expect(first.people).toBeGreaterThan(0);
  });

  it('queues ראנצ׳ו ונטלי instead of splitting or guessing', async () => {
    await seedCampBaseline(db, LEAD);
    const queue = await listUnlinkedNames(db);
    expect(queue.map((q) => q.alias)).toContain('ראנצ׳ו ונטלי');
    expect((await resolveName(db, 'ראנצ׳ו ונטלי')).personId).toBeNull();
  });

  it('keeps דניאל פינטו and דניאל ענבר as two people', async () => {
    await seedCampBaseline(db, LEAD);
    const pinto = await resolveName(db, 'דניאל פינטו');
    const inbar = await resolveName(db, 'דניאל ענבר');
    expect(pinto.personId).not.toBeNull();
    expect(inbar.personId).not.toBeNull();
    expect(pinto.personId).not.toBe(inbar.personId);
  });

  it('records the five ברן 25 exceptions with their amounts', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 25'))!;
    const rows = await listDues(db, season.id);
    const exceptions = rows.filter((r) => r.kind === 'exception');

    expect(exceptions).toHaveLength(5);
    const byName = new Map(exceptions.map((r) => [r.displayName, r.amountAgorot]));
    expect(byName.get('עזריאל')).toBe(100000);
    expect(byName.get('עדי')).toBe(100000);
    expect(byName.get('דניאל פינטו')).toBe(55500);
    expect(byName.get('דנה שרון')).toBe(140000);
    expect(byName.get('עמירם דהן')).toBe(0);
    // Every one carries a reason — that is the point.
    expect(exceptions.every((r) => (r.exceptionReason ?? '').length > 0)).toBe(true);
  });

  it('settles the five ברן 26 dues through one 6,000 offset', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 26'))!;
    const summary = await seasonFeeSummary(db, season.id);

    expect(summary.collectedAgorot).toBe(600000);
    expect(summary.memberCount).toBe(5);
    expect(summary.unpaidCount).toBe(0);

    const yosef = await resolveName(db, 'יוסף');
    const dossier = await personDossier(db, yosef.personId!);
    const due26 = dossier!.dues.find((d) => d.seasonName === 'ברן 26')!;
    expect(due26.settled).toBe(true);
  });

  it('gives אופק both of his ברן 25 deliverables', async () => {
    await seedCampBaseline(db, LEAD);
    const ofek = await resolveName(db, 'אופק');
    const owned = await responsibilitiesOf(db, ofek.personId!);

    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל']);
    expect(owned.find((r) => r.title === 'חשמל')?.budgetAgorot).toBe(1295000);
    expect(owned.find((r) => r.title === 'הובלה')?.budgetAgorot).toBe(400000);
  });

  it('seeds the fundraising events for both seasons', async () => {
    await seedCampBaseline(db, LEAD);
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;

    expect((await listEvents(db, s25.id)).map((e) => e.name))
      .toContain('Halloween Underground 311025');
    expect((await listEvents(db, s26.id)).map((e) => e.name))
      .toContain('מסיבת פקאנים');
  });

  it('puts only evidenced people on the ברן 25 roster', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 25'))!;
    const roster = await listRoster(db, season.id);
    // The 38 anonymous רגילים stay a count on the season, not invented rows.
    expect(roster.length).toBeLessThan(38);
    expect(roster.map((r) => r.displayName)).toContain('אופק');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/seed/camp-seed.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/seed/camp-seed"`.

- [ ] **Step 3: Write the seed module**

Create `src/lib/seed/camp-seed.ts`:

```ts
import type { AnyDb } from '@/lib/db-types';
import { createSeason, getSeasonByName, addMember } from '@/lib/members/roster';
import { resolveName, recordUnlinkedName } from '@/lib/members/identity';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordOffset, settlementFor } from '@/lib/fees/payments';
import { createEvent, listEvents } from '@/lib/work/events';
import { createTask, listTasks } from '@/lib/work/tasks';
import { assignPerson, setAssignmentStatus } from '@/lib/work/coverage';

export interface CampSeedResult {
  seasons: number;
  events: number;
  people: number;
  tasks: number;
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
 *  unassigned: its owner cell reads `ראנצ׳ו ונטלי`, two names in one string. */
const BURN_25_DELIVERABLES: Array<{ title: string; budget: number; owner?: string }> = [
  { title: 'מייצג', budget: 41300 },
  { title: 'חשמל', budget: 12950, owner: 'אופק' },
  { title: 'הגברה + תאורה', budget: 30810, owner: 'עמי' },
  { title: 'הובלה', budget: 4000, owner: 'אופק' },
];

const BURN_25_EVENTS = ['House of trance 270925', 'Halloween Underground 311025'];
const BURN_26_EVENTS = ['מסיבת פקאנים', 'SuperNature 18.7', 'SuperNature 3.10'];

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
 * Seeds the roster, dues and work the workbooks actually record.
 *
 * Deliberately partial. Three things are NOT seeded, each for the same reason:
 * the system does not invent what the source does not say.
 *  - ברן 23 and ברן 24 have no recorded flat rate, so they are not created.
 *  - The 38 anonymous `רגילים` are a count in a budget cell, not a roster;
 *    `plannedSize` carries the number instead.
 *  - `ראנצ׳ו ונטלי` is queued as an unlinked name rather than split into one
 *    or two people. A lead decides.
 *
 * Idempotent: safe to run against a database that already has some of this.
 */
export async function seedCampBaseline(
  db: AnyDb, email: string,
): Promise<CampSeedResult> {
  const result: CampSeedResult = { seasons: 0, events: 0, people: 0, tasks: 0 };
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

  // The four owned רחבה deliverables.
  const existingTasks = new Set((await listTasks(db, s25.id)).map((t) => t.title));
  for (const deliverable of BURN_25_DELIVERABLES) {
    if (existingTasks.has(deliverable.title)) continue;
    await createTask(db, {
      seasonId: s25.id,
      kind: 'deliverable',
      title: deliverable.title,
      budgetAmount: deliverable.budget,
    });
    result.tasks += 1;

    if (!deliverable.owner) continue;
    const task = (await listTasks(db, s25.id))
      .find((t) => t.title === deliverable.title)!;
    const owner = await resolveName(db, deliverable.owner);
    if (!owner.personId) continue;
    const assignmentId = await assignPerson(db, task.taskId, owner.personId, email);
    await setAssignmentStatus(db, assignmentId, 'accepted');
  }

  // `מייצג`'s owner cell reads `ראנצ׳ו ונטלי` — two names in one string.
  // The system records it and stops. A lead splits it.
  await recordUnlinkedName(db, 'ראנצ׳ו ונטלי', 'import');

  result.people = counter.people;
  return result;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/seed/camp-seed.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/lib/seed/camp-seed.ts src/lib/seed/camp-seed.test.ts
git commit -m "feat(seed): baseline roster, dues, offsets and deliverables from the workbooks"
```

---
### Task 12: The members section

**Files:**
- Create: `src/lib/action-result.ts`
- Create: `src/app/(admin)/members/actions.ts`
- Create: `src/app/(admin)/members/export/route.ts`
- Create: `src/app/(admin)/members/export/route.test.ts`
- Create: `src/app/(admin)/members/page.tsx`
- Create: `src/app/(admin)/members/unlinked-queue.tsx`
- Create: `src/app/(admin)/members/unlinked-queue.test.tsx`
- Create: `src/app/(admin)/members/[id]/page.tsx`
- Create: `src/app/(admin)/members/members.module.css`

**Interfaces:**
- Consumes: `listPeople`, `personDossier`; `listUnlinkedNames`, `resolveName`; `createPersonFromAlias`, `linkAlias`, `mergePersons`; `listSeasons`, `listRoster`, `addMember`; `formatILS`; `requireAdmin`.
- Produces: server actions `linkNameAction(aliasId, personId)`, `promoteNameAction(aliasId)`, `mergePeopleAction(sourceId, targetId)`, `addMemberAction(personId, seasonId, role)` — each returning `{ ok: boolean; error?: string }`.

**Two rules that shape this UI.** Server actions take only serializable
arguments, so they call `requireAdmin()` and then delegate to the `@/lib`
modules with `db` — never the other way round. And every Latin or numeric run
inside Hebrew text is wrapped in `<bdi>`; the fix wave established that idiom
across the imports pages, follow it.

- [ ] **Step 1: Write the failing component test**

Create `src/app/(admin)/members/unlinked-queue.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const linkNameAction = vi.fn(async () => ({ ok: true }));
const promoteNameAction = vi.fn(async () => ({ ok: true }));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ linkNameAction, promoteNameAction }));

import { UnlinkedQueue } from './unlinked-queue';

const NAMES = [
  { aliasId: 'a1', alias: 'ראנצ׳ו ונטלי', candidates: [] },
  {
    aliasId: 'a2',
    alias: 'אופק כהן',
    candidates: [{ personId: 'p1', displayName: 'אופק', exact: false }],
  },
];

describe('UnlinkedQueue', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists every unlinked name', () => {
    render(<UnlinkedQueue names={NAMES} />);
    expect(screen.getByText('ראנצ׳ו ונטלי')).toBeDefined();
    expect(screen.getByText('אופק כהן')).toBeDefined();
  });

  it('offers a candidate as a suggestion, never as a done deal', () => {
    render(<UnlinkedQueue names={NAMES} />);
    // The candidate is presented as a choice the lead makes.
    expect(screen.getByRole('button', { name: /קשר ל.*אופק/ })).toBeDefined();
    expect(linkNameAction).not.toHaveBeenCalled();
  });

  it('links a name to the person a lead picks', async () => {
    render(<UnlinkedQueue names={NAMES} />);
    await userEvent.click(screen.getByRole('button', { name: /קשר ל.*אופק/ }));
    expect(linkNameAction).toHaveBeenCalledWith('a2', 'p1');
  });

  it('promotes a name with no candidates to a new person', async () => {
    render(<UnlinkedQueue names={NAMES} />);
    const buttons = screen.getAllByRole('button', { name: 'צור אדם חדש' });
    await userEvent.click(buttons[0]);
    expect(promoteNameAction).toHaveBeenCalledWith('a1');
  });

  it('surfaces an action failure instead of silently doing nothing', async () => {
    promoteNameAction.mockResolvedValueOnce({ ok: false, error: 'כבר מקושר' });
    render(<UnlinkedQueue names={NAMES} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'צור אדם חדש' })[0]);
    expect(await screen.findByText('כבר מקושר')).toBeDefined();
  });

  it('says so plainly when the queue is empty', () => {
    render(<UnlinkedQueue names={[]} />);
    expect(screen.getByText('אין שמות שממתינים לשיוך.')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run "src/app/(admin)/members/unlinked-queue.test.tsx"`
Expected: FAIL — `Failed to resolve import "./unlinked-queue"`.

- [ ] **Step 3: Write the shared action result type**

Create `src/lib/action-result.ts`. It lives outside every `'use server'` file
on purpose — a server-action module may only export async functions, and all
three sections need the same shape:

```ts
/** What every server action in the admin sections returns. */
export type ActionResult = { ok: true } | { ok: false; error: string };
```

- [ ] **Step 4: Write the server actions**

Create `src/app/(admin)/members/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { createPersonFromAlias, linkAlias, mergePersons } from '@/lib/members/link';
import { addMember } from '@/lib/members/roster';

export async function linkNameAction(
  aliasId: string, personId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  await linkAlias(db, aliasId, personId, admin.email);
  revalidatePath('/members');
  return { ok: true };
}

export async function promoteNameAction(aliasId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await createPersonFromAlias(db, aliasId, admin.email);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'שגיאה' };
  }
  revalidatePath('/members');
  return { ok: true };
}

export async function mergePeopleAction(
  sourceId: string, targetId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  const result = await mergePersons(db, sourceId, targetId, admin.email);
  if (!result.ok) {
    return { ok: false, error: `לא ניתן למזג — קיימים: ${result.conflicts.join(', ')}` };
  }
  revalidatePath('/members');
  return { ok: true };
}

export async function addMemberAction(
  personId: string, seasonId: string, role: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  await addMember(db, personId, seasonId, role);
  revalidatePath('/members');
  return { ok: true };
}
```

- [ ] **Step 5: Write the unlinked-name queue**

Create `src/app/(admin)/members/unlinked-queue.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { linkNameAction, promoteNameAction } from './actions';
import styles from './members.module.css';

export interface QueuedName {
  aliasId: string;
  alias: string;
  candidates: Array<{ personId: string; displayName: string; exact: boolean }>;
}

/**
 * The leads' queue of names import could not attribute.
 *
 * Every row is a decision, never a fait accompli: candidates are offered as
 * buttons a lead presses. Nothing here links anything on its own.
 */
export function UnlinkedQueue({ names }: { names: QueuedName[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? 'שגיאה');
    });
  }

  if (names.length === 0) {
    return <p className="muted">אין שמות שממתינים לשיוך.</p>;
  }

  return (
    <div>
      {error && <p className="badge-warn" role="alert">{error}</p>}
      <ul className={styles.queue}>
        {names.map((name) => (
          <li key={name.aliasId} className={styles.queueRow}>
            <span className={styles.queueName}>{name.alias}</span>
            <span className={styles.queueActions}>
              {name.candidates.map((candidate) => (
                <button
                  key={candidate.personId}
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => linkNameAction(name.aliasId, candidate.personId))}
                >
                  קשר ל<bdi>{candidate.displayName}</bdi>
                  {!candidate.exact && <span className="muted"> (התאמה חלקית)</span>}
                </button>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => promoteNameAction(name.aliasId))}
              >
                צור אדם חדש
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Run the component test and watch it pass**

Run: `npx vitest run "src/app/(admin)/members/unlinked-queue.test.tsx"`
Expected: PASS, 6 tests.

- [ ] **Step 7: Write the members index page**

Create `src/app/(admin)/members/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listPeople } from '@/lib/members/dossier';
import { listUnlinkedNames, resolveName } from '@/lib/members/identity';
import { formatILS } from '@/lib/money';
import { UnlinkedQueue, type QueuedName } from './unlinked-queue';
import styles from './members.module.css';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const people = await listPeople(db);
  const unlinked = await listUnlinkedNames(db);

  const queue: QueuedName[] = [];
  for (const name of unlinked) {
    const resolution = await resolveName(db, name.alias);
    queue.push({
      aliasId: name.aliasId,
      alias: name.alias,
      candidates: resolution.candidates.map((candidate) => ({
        personId: candidate.personId,
        displayName: candidate.displayName,
        exact: candidate.exact,
      })),
    });
  }

  return (
    <main>
      <h1>חברי מחנה</h1>

      <section className="card">
        <h2>שמות שממתינים לשיוך</h2>
        <p className="muted">
          שמות שהמערכת מצאה בקבצים ולא ידעה לשייך בוודאות. היא לא מנחשת — מיזוג
          של שני אנשים אינו הפיך, ולכן ההחלטה כאן שלכם.
        </p>
        <UnlinkedQueue names={queue} />
      </section>

      <section>
        <h2>אנשים</h2>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>כינויים</th>
                <th>שנים</th>
                <th>יתרה לתשלום</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.personId}>
                  <td>
                    <Link href={`/members/${person.personId}`}>{person.displayName}</Link>
                  </td>
                  <td><bdi>{person.aliasCount}</bdi></td>
                  <td><bdi>{person.seasonCount}</bdi></td>
                  <td className={person.outstandingAgorot > 0 ? 'badge-warn' : undefined}>
                    <bdi>{formatILS(person.outstandingAgorot)} ₪</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {people.length === 0 && (
          <p className="muted">עדיין אין אנשים. הריצו את הזריעה מדף הייבוא.</p>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Write the person dossier page**

Create `src/app/(admin)/members/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { personDossier } from '@/lib/members/dossier';
import { formatILS } from '@/lib/money';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  deliverable: 'אחריות תקציבית',
  shift: 'משמרת',
  build: 'הקמה ולוגיסטיקה',
  event_task: 'משימה באירוע',
};

export default async function PersonPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const { id } = await params;
  const dossier = await personDossier(db, id);
  if (!dossier) notFound();

  return (
    <main>
      <h1>{dossier.displayName}</h1>

      <section className="card">
        <h2>כינויים</h2>
        <p className="muted">כל האיותים שהופיעו בקבצים, מקושרים לאדם אחד.</p>
        <ul>
          {dossier.aliases.map((alias) => (
            <li key={alias.aliasId}>
              {alias.alias}
              {alias.confirmedBy && (
                <span className="muted"> — אושר ע״י <bdi>{alias.confirmedBy}</bdi></span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>דמי קאמפ</h2>
        {dossier.dues.length === 0 && <p className="muted">אין חיוב רשום.</p>}
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>שנה</th><th>לתשלום</th><th>שולם</th><th>יתרה</th><th>הערה</th>
              </tr>
            </thead>
            <tbody>
              {dossier.dues.map((due) => (
                <tr key={due.dueId}>
                  <td>{due.seasonName}</td>
                  <td><bdi>{formatILS(due.amountAgorot)} ₪</bdi></td>
                  <td><bdi>{formatILS(due.paidAgorot)} ₪</bdi></td>
                  <td className={due.settled ? undefined : 'badge-warn'}>
                    <bdi>{formatILS(due.outstandingAgorot)} ₪</bdi>
                  </td>
                  <td>
                    {due.kind === 'exception' ? (
                      <>
                        {due.exceptionReason}
                        {due.decidedBy && (
                          <span className="muted"> — <bdi>{due.decidedBy}</bdi></span>
                        )}
                      </>
                    ) : (
                      <span className="muted">תעריף רגיל</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>אחריות</h2>
        {dossier.responsibilities.length === 0 && <p className="muted">אין משימות משויכות.</p>}
        <ul>
          {dossier.responsibilities.map((item) => (
            <li key={item.taskId}>
              {item.title}
              <span className="muted">
                {' — '}{KIND_LABELS[item.kind] ?? item.kind}, {item.seasonName}
                {item.eventName && <>, {item.eventName}</>}
                {item.budgetAgorot !== null && (
                  <> — תקציב <bdi>{formatILS(item.budgetAgorot)} ₪</bdi></>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 9: Write the roster export**

The spec requires the roster to be exportable. Create
`src/app/(admin)/members/export/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons, listRoster } from '@/lib/members/roster';
import { listDues } from '@/lib/fees/dues';
import { settlementFor } from '@/lib/fees/payments';
import { fromAgorot } from '@/lib/money';

/** Quotes a field for CSV and neutralises spreadsheet formula injection. */
function cell(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get('season');
  const seasons = await listSeasons(db);
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  if (!season) {
    return NextResponse.json({ error: 'no seasons' }, { status: 404 });
  }

  const roster = await listRoster(db, season.id);
  const dues = new Map((await listDues(db, season.id)).map((d) => [d.personId, d]));

  const rows = [['שם', 'תפקיד', 'לתשלום', 'שולם', 'יתרה', 'סוג'].map(cell).join(',')];
  for (const member of roster) {
    const due = dues.get(member.personId);
    const settlement = due ? await settlementFor(db, due.dueId) : null;
    rows.push([
      cell(member.displayName),
      cell(member.role),
      cell(due ? fromAgorot(due.amountAgorot) : ''),
      cell(settlement ? fromAgorot(settlement.paidAgorot) : ''),
      cell(settlement ? fromAgorot(settlement.outstandingAgorot) : ''),
      cell(due?.kind ?? ''),
    ].join(','));
  }

  // BOM so Excel opens the Hebrew as UTF-8 rather than mojibake.
  return new NextResponse(`\uFEFF${rows.join('\r\n')}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition':
        `attachment; filename="shliff-roster-${season.year}.csv"`,
    },
  });
}
```

Create `src/app/(admin)/members/export/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/db', () => ({ db: {} }));

const listSeasons = vi.fn();
const listRoster = vi.fn();
vi.mock('@/lib/members/roster', () => ({ listSeasons, listRoster }));
vi.mock('@/lib/fees/dues', () => ({ listDues: vi.fn(async () => []) }));
vi.mock('@/lib/fees/payments', () => ({ settlementFor: vi.fn() }));

import { GET } from './route';

describe('GET /members/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSeasons.mockResolvedValue([{ id: 's1', name: 'ברן 26', year: 2026 }]);
    listRoster.mockResolvedValue([
      { personId: 'p1', displayName: 'אופק', role: 'member', joinedAt: new Date() },
    ]);
  });

  it('refuses an unauthenticated request', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    const response = await GET(new Request('http://x/members/export'));
    expect(response.status).toBe(401);
  });

  it('returns UTF-8 CSV with a BOM so Excel reads the Hebrew', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
    const response = await GET(new Request('http://x/members/export'));
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('charset=utf-8');
    expect(body.startsWith('\uFEFF')).toBe(true);
    expect(body).toContain('אופק');
  });

  it('neutralises a name that would be read as a formula', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
    listRoster.mockResolvedValue([
      { personId: 'p1', displayName: '=1+1', role: 'member', joinedAt: new Date() },
    ]);
    const body = await (await GET(new Request('http://x/members/export'))).text();
    expect(body).toContain(`"'=1+1"`);
  });
});
```

Run: `npx vitest run "src/app/(admin)/members/export/route.test.ts"`
Expected: PASS, 3 tests.

Add a link to it on the members page, beside the `אנשים` heading:
`<a href="/members/export">ייצוא לקובץ CSV</a>`.

- [ ] **Step 10: Write the stylesheet**

Create `src/app/(admin)/members/members.module.css`. Logical properties only;
the palette comes from the `:root` tokens in `globals.css` — do not redefine them.

```css
.queue { list-style: none; margin: 0; padding: 0; }

.queueRow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  padding-block: 0.5rem;
  border-block-end: 1px solid var(--line);
}

.queueRow:last-child { border-block-end: none; }

.queueName { font-weight: 600; }

.queueActions { display: flex; flex-wrap: wrap; gap: 0.5rem; }

.queueActions button {
  border: 1px solid var(--line);
  border-radius: 0.375rem;
  background: var(--raised);
  color: var(--sand);
  padding-block: 0.25rem;
  padding-inline: 0.75rem;
  font: inherit;
  cursor: pointer;
}

.queueActions button:hover:not(:disabled) { border-color: var(--flare); }
.queueActions button:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 11: Run the full suite and commit**

Run: `npm test && npm run lint`
Expected: PASS, lint exit 0.

```bash
git add src/lib/action-result.ts "src/app/(admin)/members"
git commit -m "feat(members): roster, unlinked-name queue and the person dossier"
```

---

### Task 13: The dues section

**Files:**
- Create: `src/app/(admin)/fees/actions.ts`
- Create: `src/app/(admin)/fees/page.tsx`
- Create: `src/app/(admin)/fees/exception-form.tsx`
- Create: `src/app/(admin)/fees/exception-form.test.tsx`
- Create: `src/app/(admin)/fees/fees.module.css`

**Interfaces:**
- Consumes: `listSeasons`, `getSeasonByName`; `issueFlatDues`, `listDues`, `setException`, `clearException`; `recordPayment`, `settlementFor`, `PAYMENT_CHANNELS`; `seasonFeeSummary`; `formatILS`; `requireAdmin`.
- Produces: server actions `issueDuesAction(seasonId)`, `setExceptionAction(input)`, `clearExceptionAction(personId, seasonId)`, `recordPaymentAction(input)`, each returning `ActionResult`.

**The refusal is the feature.** The exception form must not let a lead save
without a reason, and the server action must refuse it too — the client check
is convenience, the server check is the rule.

- [ ] **Step 1: Write the failing component test**

Create `src/app/(admin)/fees/exception-form.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
const setExceptionAction = vi.fn(async () => ({ ok: true }));
vi.mock('./actions', () => ({ setExceptionAction }));

import { ExceptionForm } from './exception-form';

function renderForm() {
  return render(
    <ExceptionForm
      personId="p1"
      seasonId="s1"
      displayName="עמירם דהן"
      currentAgorot={150000}
    />,
  );
}

describe('ExceptionForm', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('will not save an exception with no reason', async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText('סכום'));
    await userEvent.type(screen.getByLabelText('סכום'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('סיבה');
  });

  it('saves an exception that carries a reason', async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText('סכום'));
    await userEvent.type(screen.getByLabelText('סכום'), '0');
    await userEvent.type(screen.getByLabelText('סיבה'), 'פטור מלא — הוביל את ההקמה');
    await userEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).toHaveBeenCalledWith({
      personId: 'p1',
      seasonId: 's1',
      amount: 0,
      reason: 'פטור מלא — הוביל את ההקמה',
    });
  });

  it('rejects a negative amount before it reaches the server', async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText('סכום'));
    await userEvent.type(screen.getByLabelText('סכום'), '-100');
    await userEvent.type(screen.getByLabelText('סיבה'), 'טעות');
    await userEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).not.toHaveBeenCalled();
  });

  it('shows a server refusal rather than pretending it saved', async () => {
    setExceptionAction.mockResolvedValueOnce({ ok: false, error: 'אין הרשאה' });
    renderForm();
    await userEvent.clear(screen.getByLabelText('סכום'));
    await userEvent.type(screen.getByLabelText('סכום'), '1000');
    await userEvent.type(screen.getByLabelText('סיבה'), 'הנחה');
    await userEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(await screen.findByText('אין הרשאה')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run "src/app/(admin)/fees/exception-form.test.tsx"`
Expected: FAIL — `Failed to resolve import "./exception-form"`.

- [ ] **Step 3: Write the fees actions**

Create `src/app/(admin)/fees/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { issueFlatDues, setException, clearException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import type { PaymentChannel } from '@/db/schema/camp';

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'שגיאה' };
}

export async function issueDuesAction(seasonId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await issueFlatDues(db, seasonId);
  } catch (error) { return failed(error); }
  revalidatePath('/fees');
  return { ok: true };
}

export async function setExceptionAction(input: {
  personId: string; seasonId: string; amount: number; reason: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    // The reason is mandatory here too. The client check is convenience;
    // this one is the rule.
    await setException(db, { ...input, decidedBy: admin.email });
  } catch (error) { return failed(error); }
  revalidatePath('/fees');
  return { ok: true };
}

export async function clearExceptionAction(
  personId: string, seasonId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await clearException(db, personId, seasonId);
  } catch (error) { return failed(error); }
  revalidatePath('/fees');
  return { ok: true };
}

export async function recordPaymentAction(input: {
  dueId: string; amount: number; channel: PaymentChannel; paidOn: string; note?: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await recordPayment(db, {
      dueId: input.dueId,
      amount: input.amount,
      channel: input.channel,
      paidOn: new Date(input.paidOn),
      note: input.note,
      recordedBy: admin.email,
    });
  } catch (error) { return failed(error); }
  revalidatePath('/fees');
  return { ok: true };
}
```

- [ ] **Step 4: Write the exception form**

Create `src/app/(admin)/fees/exception-form.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setExceptionAction } from './actions';
import { formatILS } from '@/lib/money';
import styles from './fees.module.css';

/**
 * Records that one person owes something other than the flat rate.
 *
 * The reason field is mandatory, and this form will not submit without it.
 * A zero due with no recorded reason is exactly what the camp lost last year:
 * `עמירם דהן 0`, and nobody now remembers why.
 */
export function ExceptionForm({
  personId, seasonId, displayName, currentAgorot,
}: {
  personId: string;
  seasonId: string;
  displayName: string;
  currentAgorot: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(String(currentAgorot / 100));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('הסכום חייב להיות מספר שאינו שלילי.');
      return;
    }
    if (!reason.trim()) {
      setError('חריג חייב לכלול סיבה. בלי זה אי אפשר יהיה לדעת בעוד שנה למה.');
      return;
    }

    startTransition(async () => {
      const result = await setExceptionAction({
        personId, seasonId, amount: parsed, reason: reason.trim(),
      });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className={styles.exceptionForm}>
      <p className="muted">
        חריג עבור <bdi>{displayName}</bdi> — כרגע{' '}
        <bdi>{formatILS(currentAgorot)} ₪</bdi>
      </p>
      <label>
        סכום
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        סיבה
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="למשל: פטור מלא — הוביל את ההקמה"
        />
      </label>
      <button type="submit" disabled={pending}>שמור חריג</button>
      {error && <p className="badge-warn" role="alert">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Run the component test and watch it pass**

Run: `npx vitest run "src/app/(admin)/fees/exception-form.test.tsx"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the fees page**

Create `src/app/(admin)/fees/page.tsx`. It renders the season picker, the
computed summary, and the dues table with an exception form per row.

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listDues } from '@/lib/fees/dues';
import { settlementFor } from '@/lib/fees/payments';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { formatILS } from '@/lib/money';
import { ExceptionForm } from './exception-form';
import styles from './fees.module.css';

export const dynamic = 'force-dynamic';

export default async function FeesPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main>
        <h1>דמי קאמפ</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const { season: requested } = await searchParams;
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  const summary = await seasonFeeSummary(db, season.id);
  const rows = await listDues(db, season.id);

  const settled = new Map<string, Awaited<ReturnType<typeof settlementFor>>>();
  for (const row of rows) settled.set(row.dueId, await settlementFor(db, row.dueId));

  return (
    <main>
      <h1>דמי קאמפ</h1>

      <nav className={styles.seasons} aria-label="בחירת שנה">
        {seasons.map((option) => (
          <Link
            key={option.id}
            href={`/fees?season=${option.id}`}
            aria-current={option.id === season.id ? 'page' : undefined}
          >
            {option.name}
          </Link>
        ))}
      </nav>

      <section className="card">
        <h2>{season.name}</h2>
        <dl className={styles.summary}>
          <div><dt>חברים</dt><dd><bdi>{summary.memberCount}</bdi></dd></div>
          <div><dt>רגילים</dt><dd><bdi>{summary.flatCount}</bdi></dd></div>
          <div><dt>חריגים</dt><dd><bdi>{summary.exceptionCount}</bdi></dd></div>
          <div>
            <dt>צפי גבייה</dt>
            <dd><bdi>{formatILS(summary.expectedAgorot)} ₪</bdi></dd>
          </div>
          <div>
            <dt>נגבה</dt>
            <dd><bdi>{formatILS(summary.collectedAgorot)} ₪</bdi></dd>
          </div>
          <div>
            <dt>נותר</dt>
            <dd className={summary.outstandingAgorot > 0 ? 'badge-warn' : undefined}>
              <bdi>{formatILS(summary.outstandingAgorot)} ₪</bdi>
            </dd>
          </div>
        </dl>
        {summary.missingDues.length > 0 && (
          <p className="badge-warn">
            חברים ללא חיוב: {summary.missingDues.join(', ')}
          </p>
        )}
      </section>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>שם</th><th>לתשלום</th><th>שולם</th><th>יתרה</th><th>סוג</th><th>שינוי</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const settlement = settled.get(row.dueId)!;
              return (
                <tr key={row.dueId}>
                  <td>
                    <Link href={`/members/${row.personId}`}>{row.displayName}</Link>
                  </td>
                  <td><bdi>{formatILS(row.amountAgorot)} ₪</bdi></td>
                  <td><bdi>{formatILS(settlement.paidAgorot)} ₪</bdi></td>
                  <td className={settlement.settled ? undefined : 'badge-warn'}>
                    <bdi>{formatILS(settlement.outstandingAgorot)} ₪</bdi>
                  </td>
                  <td>
                    {row.kind === 'exception'
                      ? <span title={row.exceptionReason ?? ''}>חריג</span>
                      : <span className="muted">רגיל</span>}
                  </td>
                  <td>
                    <ExceptionForm
                      personId={row.personId}
                      seasonId={season.id}
                      displayName={row.displayName}
                      currentAgorot={row.amountAgorot}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Write the stylesheet**

Create `src/app/(admin)/fees/fees.module.css`:

```css
.seasons {
  display: flex;
  gap: 0.75rem;
  margin-block-end: 1rem;
}

.seasons a[aria-current='page'] {
  color: var(--sand);
  border-block-end: 2px solid var(--flare);
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin: 0;
}

.summary div { display: flex; flex-direction: column; }
.summary dt { color: var(--dust); font-size: 0.8125rem; }
.summary dd { margin: 0; font-size: 1.125rem; font-weight: 600; }

.exceptionForm {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  align-items: end;
}

.exceptionForm label {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: var(--dust);
}

.exceptionForm input {
  border: 1px solid var(--line);
  border-radius: 0.25rem;
  background: var(--ground);
  color: var(--sand);
  padding: 0.25rem 0.375rem;
  font: inherit;
  inline-size: 9rem;
}

.exceptionForm button {
  border: 1px solid var(--line);
  border-radius: 0.25rem;
  background: var(--raised);
  color: var(--sand);
  padding: 0.3125rem 0.75rem;
  font: inherit;
  cursor: pointer;
}

.exceptionForm button:hover:not(:disabled) { border-color: var(--flare); }
.exceptionForm button:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test && npm run lint`
Expected: PASS, lint exit 0.

```bash
git add "src/app/(admin)/fees"
git commit -m "feat(fees): season summary, dues table and the exception form"
```

---
### Task 14: The work section

**Files:**
- Create: `src/app/(admin)/tasks/actions.ts`
- Create: `src/app/(admin)/tasks/page.tsx`
- Create: `src/app/(admin)/tasks/assign-control.tsx`
- Create: `src/app/(admin)/tasks/assign-control.test.tsx`
- Create: `src/app/(admin)/tasks/tasks.module.css`

**Interfaces:**
- Consumes: `listSeasons`; `listTasks`, `createTask`, `setTaskStatus`; `coverageFor`, `uncoveredTasks`, `assignPerson`, `setAssignmentStatus`, `removeAssignment`; `listPeople`; `formatILS`; `requireAdmin`.
- Produces: server actions `assignPersonAction(taskId, personId)`, `setAssignmentStatusAction(assignmentId, status)`, `removeAssignmentAction(assignmentId)`, `createTaskAction(input)`, `setTaskStatusAction(taskId, status)`, each returning `ActionResult`.

**What the page is for.** Not a to-do list — a coverage report. The uncovered
tasks come first, because "which shifts aren't staffed yet" is the question
that has to be answerable before the gate opens.

- [ ] **Step 1: Write the failing component test**

Create `src/app/(admin)/tasks/assign-control.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
const assignPersonAction = vi.fn(async () => ({ ok: true }));
const setAssignmentStatusAction = vi.fn(async () => ({ ok: true }));
const removeAssignmentAction = vi.fn(async () => ({ ok: true }));
vi.mock('./actions', () => ({
  assignPersonAction, setAssignmentStatusAction, removeAssignmentAction,
}));

import { AssignControl } from './assign-control';

const PEOPLE = [
  { personId: 'p1', displayName: 'אופק' },
  { personId: 'p2', displayName: 'עמי' },
];

function renderControl(assignees: React.ComponentProps<typeof AssignControl>['assignees'] = []) {
  return render(
    <AssignControl
      taskId="t1"
      peopleNeeded={4}
      accepted={assignees.filter((a) => a.status === 'accepted').length}
      assignees={assignees}
      people={PEOPLE}
    />,
  );
}

describe('AssignControl', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows how far short of the required headcount the task is', () => {
    renderControl();
    expect(screen.getByText('0 מתוך 4')).toBeDefined();
  });

  it('assigns the person a lead selects', async () => {
    renderControl();
    await userEvent.selectOptions(screen.getByLabelText('הוסף אדם'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'שבץ' }));
    expect(assignPersonAction).toHaveBeenCalledWith('t1', 'p1');
  });

  it('does nothing when no person is selected', async () => {
    renderControl();
    await userEvent.click(screen.getByRole('button', { name: 'שבץ' }));
    expect(assignPersonAction).not.toHaveBeenCalled();
  });

  it('marks a proposed assignment as accepted', async () => {
    renderControl([
      { assignmentId: 'a1', personId: 'p1', displayName: 'אופק', status: 'proposed' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'אישר' }));
    expect(setAssignmentStatusAction).toHaveBeenCalledWith('a1', 'accepted');
  });

  it('removes an assignment', async () => {
    renderControl([
      { assignmentId: 'a1', personId: 'p1', displayName: 'אופק', status: 'accepted' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'הסר' }));
    expect(removeAssignmentAction).toHaveBeenCalledWith('a1');
  });

  it('surfaces a failure instead of silently doing nothing', async () => {
    assignPersonAction.mockResolvedValueOnce({ ok: false, error: 'כבר משובץ' });
    renderControl();
    await userEvent.selectOptions(screen.getByLabelText('הוסף אדם'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'שבץ' }));
    expect(await screen.findByText('כבר משובץ')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run "src/app/(admin)/tasks/assign-control.test.tsx"`
Expected: FAIL — `Failed to resolve import "./assign-control"`.

- [ ] **Step 3: Write the tasks actions**

Create `src/app/(admin)/tasks/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { createTask, setTaskStatus, type NewTask } from '@/lib/work/tasks';
import {
  assignPerson, setAssignmentStatus, removeAssignment,
} from '@/lib/work/coverage';
import type { AssignmentStatus, TaskStatus } from '@/db/schema/camp';

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'שגיאה' };
}

export async function assignPersonAction(
  taskId: string, personId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await assignPerson(db, taskId, personId, admin.email);
  } catch { return { ok: false, error: 'האדם כבר משובץ למשימה הזו' }; }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function setAssignmentStatusAction(
  assignmentId: string, status: AssignmentStatus,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setAssignmentStatus(db, assignmentId, status);
  } catch (error) { return failed(error); }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function removeAssignmentAction(
  assignmentId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await removeAssignment(db, assignmentId);
  } catch (error) { return failed(error); }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function createTaskAction(
  input: Omit<NewTask, 'startsAt' | 'endsAt' | 'dueOn'> & {
    startsAt?: string; endsAt?: string; dueOn?: string;
  },
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await createTask(db, {
      ...input,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      dueOn: input.dueOn ? new Date(input.dueOn) : undefined,
    });
  } catch (error) { return failed(error); }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function setTaskStatusAction(
  taskId: string, status: TaskStatus,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setTaskStatus(db, taskId, status);
  } catch (error) { return failed(error); }
  revalidatePath('/tasks');
  return { ok: true };
}
```

- [ ] **Step 4: Write the assignment control**

Create `src/app/(admin)/tasks/assign-control.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignPersonAction, setAssignmentStatusAction, removeAssignmentAction,
} from './actions';
import styles from './tasks.module.css';

export interface ControlAssignee {
  assignmentId: string;
  personId: string;
  displayName: string;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  proposed: 'הוצע',
  accepted: 'אישר',
  done: 'בוצע',
  dropped: 'ירד',
};

/**
 * Staffs one task.
 *
 * `accepted` counts what a person has actually agreed to. A `proposed`
 * assignment shows here but does not close the gap — otherwise the coverage
 * report would call a shift staffed when nobody had said yes.
 */
export function AssignControl({
  taskId, peopleNeeded, accepted, assignees, people,
}: {
  taskId: string;
  peopleNeeded: number;
  accepted: number;
  assignees: ControlAssignee[];
  people: Array<{ personId: string; displayName: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? 'שגיאה');
    });
  }

  const short = accepted < peopleNeeded;

  return (
    <div className={styles.assign}>
      <p className={short ? 'badge-warn' : 'muted'}>
        <bdi>{accepted} מתוך {peopleNeeded}</bdi>
      </p>

      <ul className={styles.assignees}>
        {assignees.map((assignee) => (
          <li key={assignee.assignmentId}>
            <bdi>{assignee.displayName}</bdi>
            <span className="muted"> — {STATUS_LABELS[assignee.status] ?? assignee.status}</span>
            {assignee.status === 'proposed' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setAssignmentStatusAction(assignee.assignmentId, 'accepted'))}
              >
                אישר
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => removeAssignmentAction(assignee.assignmentId))}
            >
              הסר
            </button>
          </li>
        ))}
      </ul>

      <label>
        הוסף אדם
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">—</option>
          {people.map((person) => (
            <option key={person.personId} value={person.personId}>
              {person.displayName}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => { if (selected) run(() => assignPersonAction(taskId, selected)); }}
      >
        שבץ
      </button>

      {error && <p className="badge-warn" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Run the component test and watch it pass**

Run: `npx vitest run "src/app/(admin)/tasks/assign-control.test.tsx"`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the tasks page**

Create `src/app/(admin)/tasks/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listTasks } from '@/lib/work/tasks';
import { coverageFor } from '@/lib/work/coverage';
import { listPeople } from '@/lib/members/dossier';
import { formatILS } from '@/lib/money';
import { AssignControl } from './assign-control';
import styles from './tasks.module.css';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  deliverable: 'אחריות תקציבית',
  shift: 'משמרות',
  build: 'הקמה ולוגיסטיקה',
  event_task: 'משימות באירועים',
};

export default async function TasksPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main>
        <h1>משימות</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const { season: requested } = await searchParams;
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  const coverage = await coverageFor(db, season.id);
  const tasks = await listTasks(db, season.id);
  const budgets = new Map(tasks.map((task) => [task.taskId, task.budgetAgorot]));
  const people = await listPeople(db);
  const roster = people.map((p) => ({ personId: p.personId, displayName: p.displayName }));

  const uncovered = coverage.filter((task) => task.uncovered);
  const byKind = new Map<string, typeof coverage>();
  for (const task of coverage) {
    byKind.set(task.kind, [...(byKind.get(task.kind) ?? []), task]);
  }

  return (
    <main>
      <h1>משימות</h1>

      <nav className={styles.seasons} aria-label="בחירת שנה">
        {seasons.map((option) => (
          <Link
            key={option.id}
            href={`/tasks?season=${option.id}`}
            aria-current={option.id === season.id ? 'page' : undefined}
          >
            {option.name}
          </Link>
        ))}
      </nav>

      <section className="card">
        <h2>חסרים אנשים</h2>
        {uncovered.length === 0 ? (
          <p className="muted">כל המשימות מאוישות.</p>
        ) : (
          <ul>
            {uncovered.map((task) => (
              <li key={task.taskId}>
                {task.title}
                <span className="muted">
                  {' — '}{KIND_LABELS[task.kind] ?? task.kind}
                  {', '}<bdi>{task.accepted} מתוך {task.peopleNeeded}</bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {[...byKind.entries()].map(([kind, group]) => (
        <section key={kind}>
          <h2>{KIND_LABELS[kind] ?? kind}</h2>
          {group.map((task) => (
            <article key={task.taskId} className="card">
              <h3>{task.title}</h3>
              <p className="muted">
                {task.eventName && <><bdi>{task.eventName}</bdi>{' · '}</>}
                {budgets.get(task.taskId) !== null
                  && budgets.get(task.taskId) !== undefined && (
                  <>תקציב <bdi>{formatILS(budgets.get(task.taskId)!)} ₪</bdi></>
                )}
              </p>
              <AssignControl
                taskId={task.taskId}
                peopleNeeded={task.peopleNeeded}
                accepted={task.accepted}
                assignees={task.assignees}
                people={roster}
              />
            </article>
          ))}
        </section>
      ))}

      {coverage.length === 0 && (
        <p className="muted">אין משימות לשנה הזו.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Write the stylesheet**

Create `src/app/(admin)/tasks/tasks.module.css`:

```css
.seasons { display: flex; gap: 0.75rem; margin-block-end: 1rem; }

.seasons a[aria-current='page'] {
  color: var(--sand);
  border-block-end: 2px solid var(--flare);
}

.assign { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }

.assignees { list-style: none; margin: 0; padding: 0; display: flex;
  flex-wrap: wrap; gap: 0.75rem; }

.assignees li { display: flex; align-items: center; gap: 0.375rem; }

.assign label { display: flex; align-items: center; gap: 0.375rem;
  font-size: 0.8125rem; color: var(--dust); }

.assign select,
.assign button {
  border: 1px solid var(--line);
  border-radius: 0.25rem;
  background: var(--raised);
  color: var(--sand);
  padding: 0.25rem 0.5rem;
  font: inherit;
  cursor: pointer;
}

.assign button:hover:not(:disabled) { border-color: var(--flare); }
.assign button:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test && npm run lint`
Expected: PASS, lint exit 0.

```bash
git add "src/app/(admin)/tasks"
git commit -m "feat(work): task board built around the coverage gap"
```

---

### Task 15: Wire the sections into the shell

**Files:**
- Modify: `src/app/(admin)/nav.tsx`
- Create: `src/app/(admin)/nav.test.tsx`
- Modify: `src/app/(admin)/page.tsx`
- Modify: `src/app/(admin)/upload/page.tsx` (add the camp-baseline seed button)
- Modify: `src/app/(admin)/upload/actions.ts` (add `seedCampAction`)

**Interfaces:**
- Consumes: `listSeasons`, `seasonFeeSummary`, `uncoveredTasks`, `listUnlinkedNames`, `seedCampBaseline`, `formatILS`, `requireAdmin`.
- Produces: `seedCampAction(): Promise<CampSeedResult>`.

The nav currently marks `/members` and `/fees` as `planned: true` — shown,
never linked. Both now exist. `/tasks` is new.

- [ ] **Step 1: Write the failing nav test**

Create `src/app/(admin)/nav.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/fees' }));

import { Nav } from './nav';

describe('Nav', () => {
  it('links every built section', () => {
    render(<Nav />);
    for (const label of ['סקירה', 'נתונים', 'ייבוא', 'חברי מחנה', 'דמי קאמפ', 'משימות']) {
      expect(screen.getByRole('link', { name: label })).toBeDefined();
    }
  });

  it('leaves nothing marked as בקרוב now that the sections exist', () => {
    render(<Nav />);
    expect(screen.queryByText('בקרוב')).toBeNull();
  });

  it('marks the current section for assistive technology', () => {
    render(<Nav />);
    expect(screen.getByRole('link', { name: 'דמי קאמפ' })
      .getAttribute('aria-current')).toBe('page');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run "src/app/(admin)/nav.test.tsx"`
Expected: FAIL — `בקרוב` is still rendered and `חברי מחנה` is a `<span>`, not a link.

- [ ] **Step 3: Update the nav**

In `src/app/(admin)/nav.tsx`, replace the `SECTIONS` array. Keep the `planned`
support in the `Section` interface and the render branch — future sections will
use it again — but no section sets it now:

```ts
const SECTIONS: Section[] = [
  { href: '/', label: 'סקירה' },
  { href: '/data', label: 'נתונים' },
  { href: '/upload', label: 'ייבוא' },
  { href: '/members', label: 'חברי מחנה' },
  { href: '/fees', label: 'דמי קאמפ' },
  { href: '/tasks', label: 'משימות' },
];
```

- [ ] **Step 4: Run the nav test and watch it pass**

Run: `npx vitest run "src/app/(admin)/nav.test.tsx"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the camp-baseline seed action**

Append to `src/app/(admin)/upload/actions.ts`:

```ts
import { seedCampBaseline, type CampSeedResult } from '@/lib/seed/camp-seed';

export async function seedCampAction(): Promise<CampSeedResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  return seedCampBaseline(db, admin.email);
}
```

In `src/app/(admin)/upload/page.tsx`, render a second seed button beside the
existing workbook one, labelled `זריעת חברי מחנה ודמי קאמפ`, wired to
`seedCampAction`. Follow the existing `seed-button.tsx` shape exactly — it
already wraps its call in try/catch and clears its busy state in a `finally`.

- [ ] **Step 6: Replace the overview page with a live summary**

Rewrite `src/app/(admin)/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { uncoveredTasks } from '@/lib/work/coverage';
import { listUnlinkedNames } from '@/lib/members/identity';
import { formatILS } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  const current = seasons[0];
  const summary = current ? await seasonFeeSummary(db, current.id) : null;
  const uncovered = current ? await uncoveredTasks(db, current.id) : [];
  const unlinked = await listUnlinkedNames(db);

  return (
    <main>
      <h1>סקירה</h1>

      {summary ? (
        <section className="card">
          <h2>{summary.seasonName}</h2>
          <p>
            צפי גבייה <bdi>{formatILS(summary.expectedAgorot)} ₪</bdi>
            {' · '}נגבה <bdi>{formatILS(summary.collectedAgorot)} ₪</bdi>
            {' · '}נותר{' '}
            <bdi className={summary.outstandingAgorot > 0 ? 'badge-warn' : undefined}>
              {formatILS(summary.outstandingAgorot)} ₪
            </bdi>
          </p>
          <p className="muted">
            <bdi>{summary.memberCount}</bdi> חברים —{' '}
            <bdi>{summary.flatCount}</bdi> רגילים,{' '}
            <bdi>{summary.exceptionCount}</bdi> חריגים
          </p>
          <p>
            <Link href={`/fees?season=${summary.seasonId}`}>לדף דמי הקאמפ</Link>
          </p>
        </section>
      ) : (
        <p className="muted">
          עדיין אין שנים במערכת. הריצו את הזריעה מדף <Link href="/upload">הייבוא</Link>.
        </p>
      )}

      {uncovered.length > 0 && (
        <section className="card">
          <h2>משימות שחסרים בהן אנשים</h2>
          <p className="badge-warn"><bdi>{uncovered.length}</bdi> משימות</p>
          <p><Link href="/tasks">לדף המשימות</Link></p>
        </section>
      )}

      {unlinked.length > 0 && (
        <section className="card">
          <h2>שמות שממתינים לשיוך</h2>
          <p className="muted">
            <bdi>{unlinked.length}</bdi> שמות שהמערכת מצאה ולא שייכה — היא לא מנחשת.
          </p>
          <p><Link href="/members">לדף חברי המחנה</Link></p>
        </section>
      )}

      <section>
        <h2>מה יש כאן</h2>
        <ul>
          <li><Link href="/data">נתונים</Link> — כל מה שזוהה בקבצי האקסל, לפי שנה</li>
          <li><Link href="/upload">ייבוא</Link> — העלאת קובץ חדש וזיהוי הטבלאות שבו</li>
          <li><Link href="/members">חברי מחנה</Link> — מי היה בקאמפ, בכל שנה</li>
          <li><Link href="/fees">דמי קאמפ</Link> — מי חייב, מי שילם, ולמה חריג הוא חריג</li>
          <li><Link href="/tasks">משימות</Link> — מי אחראי על מה, ומה עדיין לא מאויש</li>
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS, lint exit 0, typecheck clean.

```bash
git add "src/app/(admin)/nav.tsx" "src/app/(admin)/nav.test.tsx" \
        "src/app/(admin)/page.tsx" "src/app/(admin)/upload"
git commit -m "feat(admin): open the members, fees and tasks sections in the shell"
```

---

### Task 16: The whole story, end to end

**Files:**
- Create: `src/lib/camp-journey.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces: nothing. This task adds no source — it proves the parts compose.

Each earlier task tested its own module against its own fixture. This one runs
the camp's actual year against one database, in order, and checks the numbers
the leads would recognise.

- [ ] **Step 1: Write the journey test**

Create `src/lib/camp-journey.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { getSeasonByName, listRoster, addMember } from '@/lib/members/roster';
import { resolveName, recordUnlinkedName, listUnlinkedNames } from '@/lib/members/identity';
import { createPerson, linkAlias, mergePersons } from '@/lib/members/link';
import { listDues, issueFlatDues } from '@/lib/fees/dues';
import { settlementFor, recordPayment } from '@/lib/fees/payments';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { uncoveredTasks, responsibilitiesOf } from '@/lib/work/coverage';
import { createTask, listTasks } from '@/lib/work/tasks';
import { personDossier } from '@/lib/members/dossier';
import { seedCampBaseline } from '@/lib/seed/camp-seed';

const LEAD = 'lead@shliff.camp';

describe('a year at Shliff', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('runs from seed to a settled season without losing a shekel', async () => {
    await seedCampBaseline(db, LEAD);

    // 1. אופק is one person, with two deliverables — the case the
    //    spreadsheets cannot express.
    const ofek = await resolveName(db, 'אופק');
    expect(ofek.personId).not.toBeNull();
    const owned = await responsibilitiesOf(db, ofek.personId!);
    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל']);

    // 2. A second spelling arrives from an import. Nothing is merged
    //    automatically — it lands in the queue.
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).toContain('אופק כהן');
    expect((await resolveName(db, 'אופק כהן')).personId).toBeNull();

    // 3. A lead links it. Now both spellings reach one dossier.
    await linkAlias(db, aliasId, ofek.personId!, LEAD);
    const dossier = await personDossier(db, ofek.personId!);
    expect(dossier!.aliases.map((a) => a.alias).sort()).toEqual(['אופק', 'אופק כהן']);

    // 4. ברן 25 reconciles: five documented exceptions, each with a reason.
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const dues25 = await listDues(db, s25.id);
    const exceptions = dues25.filter((d) => d.kind === 'exception');
    expect(exceptions).toHaveLength(5);
    expect(exceptions.every((d) => (d.exceptionReason ?? '').length > 0)).toBe(true);
    expect(exceptions.every((d) => d.decidedBy !== null)).toBe(true);

    // 5. ברן 26: five dues, all settled by one 6,000 offset.
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const before = await seasonFeeSummary(db, s26.id);
    expect(before.collectedAgorot).toBe(600000);
    expect(before.outstandingAgorot).toBe(0);

    // 6. A new member joins ברן 26 and pays in two goes through two channels.
    const dana = await createPerson(db, 'דנה', LEAD);
    await addMember(db, dana, s26.id);
    await issueFlatDues(db, s26.id);
    const danaDue = (await listDues(db, s26.id)).find((d) => d.displayName === 'דנה')!;
    expect(danaDue.amountAgorot).toBe(120000);

    const mid = await seasonFeeSummary(db, s26.id);
    expect(mid.expectedAgorot).toBe(720000);
    expect(mid.outstandingAgorot).toBe(120000);
    expect(mid.unpaidCount).toBe(1);

    await recordPayment(db, {
      dueId: danaDue.dueId, amount: 700, channel: 'ביט',
      paidOn: new Date('2026-08-01T00:00:00Z'), recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: danaDue.dueId, amount: 500, channel: 'מזומן',
      paidOn: new Date('2026-08-05T00:00:00Z'), recordedBy: LEAD,
    });
    expect((await settlementFor(db, danaDue.dueId)).settled).toBe(true);

    const after = await seasonFeeSummary(db, s26.id);
    expect(after.expectedAgorot).toBe(720000);
    expect(after.collectedAgorot).toBe(720000);
    expect(after.outstandingAgorot).toBe(0);
    expect(after.unpaidCount).toBe(0);
    expect(after.missingDues).toEqual([]);

    // 7. A bar shift is added and staffed. Coverage tracks it honestly.
    await createTask(db, {
      seasonId: s26.id, kind: 'shift', title: 'משמרת בר', peopleNeeded: 2,
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
    });
    expect((await uncoveredTasks(db, s26.id)).map((t) => t.title)).toEqual(['משמרת בר']);

    const shift = (await listTasks(db, s26.id, { kind: 'shift' }))[0];
    const { assignPerson, setAssignmentStatus } = await import('@/lib/work/coverage');
    for (const personId of [ofek.personId!, dana]) {
      const id = await assignPerson(db, shift.taskId, personId, LEAD);
      await setAssignmentStatus(db, id, 'accepted');
    }
    expect(await uncoveredTasks(db, s26.id)).toEqual([]);

    // 8. The queued `ראנצ׳ו ונטלי` is still unresolved — by design.
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).toContain('ראנצ׳ו ונטלי');
  });

  it('never lets a merge combine two people who both have money', async () => {
    await seedCampBaseline(db, LEAD);
    const ofek = await resolveName(db, 'אופק');
    const yosef = await resolveName(db, 'יוסף');

    // Both are on rosters and both have dues — merging would be irreversible.
    const result = await mergePersons(db, ofek.personId!, yosef.personId!, LEAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts.length).toBeGreaterThan(0);

    // Nothing moved.
    expect((await resolveName(db, 'אופק')).personId).toBe(ofek.personId);
    expect((await resolveName(db, 'יוסף')).personId).toBe(yosef.personId);
  });

  it('re-seeding after a season has been worked changes nothing', async () => {
    await seedCampBaseline(db, LEAD);
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const before = await seasonFeeSummary(db, s26.id);
    const roster = await listRoster(db, s26.id);

    await seedCampBaseline(db, LEAD);

    const after = await seasonFeeSummary(db, s26.id);
    expect(after).toEqual(before);
    expect(await listRoster(db, s26.id)).toHaveLength(roster.length);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/camp-journey.test.ts`
Expected: PASS, 3 tests. If any assertion fails, the defect is in the module it
names — fix that module, not this test.

- [ ] **Step 3: Run everything and commit**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all four clean.

```bash
git add src/lib/camp-journey.test.ts
git commit -m "test: the camp's year end to end, from seed to a settled season"
```

---

## Notes for the executor

**Task order matters.** Tasks 1–11 build a dependency chain: each one's tests
import the previous ones' modules. Task 12 must precede Tasks 13 and 14 — it
creates `src/lib/action-result.ts`, which both of their action files import.
Task 15 must follow 12–14, since it links to pages they create. Task 16 must
be last.

**When a reviewer's finding contradicts this plan,** the spec
(`docs/superpowers/specs/2026-09-09-camp-members-fees-design.md`) is the
binding authority and this plan is its argument. Rule on the conflict, record
the ruling, and keep going.

**Three rulings are load-bearing. Do not quietly relax them:**
1. `resolveName` returns a `personId` only on exactly one exact match.
2. `setException` refuses a blank reason or decider — on the server, not just
   in the form.
3. Only `accepted` and `done` assignments count toward `peopleNeeded`.

**Known deferrals**, already agreed and out of scope: the canonical
transaction ledger (dues do not post to the קופה), member self-service and
logins, instalment plans, reminders, payment processing, and linking
fundraising revenue to the `הורדת מחיר דמי קאמפ` target.
