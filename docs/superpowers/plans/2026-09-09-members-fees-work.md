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
