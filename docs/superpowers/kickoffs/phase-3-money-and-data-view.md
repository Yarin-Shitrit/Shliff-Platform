# Phase 3 kickoff — money management and the data view

Paste everything below into a fresh Claude Code session started in
`/Users/yarin/GitProjects/Shliff_Platform`.

---

I lead Shliff, an Israeli Burning Man (MidBurn) camp. This repo is the camp's
admin platform. Two phases are already built, tested and merged — read
`docs/superpowers/specs/` and `docs/superpowers/plans/` before proposing
anything, and check `git log` on the current branch, because work may have
landed after this prompt was written.

**Use `superpowers:brainstorming` first.** This is architectural: a new
subsystem plus a rework of an existing page. Do not skip to a plan. Ask me
questions one at a time, propose 2-3 approaches with trade-offs and a
recommendation, present the design in sections for my approval, then write a
spec, then use `superpowers:writing-plans`, then execute with
`superpowers:subagent-driven-development`.

**Load these skills when they become relevant, not upfront:** `dataviz` before
you write a single line of chart code or choose chart colours — it is
mandatory for any chart, in any medium. `frontend-design` when you reach visual
direction. `superpowers:writing-plans` and
`superpowers:subagent-driven-development` at the transitions.

## What I want

**1. A money management page — the camp's whole financial picture in one place.**

Today the money lives in scattered spreadsheet cells and in three separate
places in this app. I want to see, for a season: what came in, what went out,
what is owed to us, what we owe, and where the cash physically is. The camp
runs like a production company whose workers are volunteers who pay to take
part, so "who owes what" and "what did the party earn" are the same ledger.

The real shape of it, from the camp's own workbooks:

- **Money sits in several places at once.** A cash box (`קופת מזומן`, 1,584),
  a member's *personal* current account holding camp funds (`עו״ש אופק`,
  14,079.55), and event floats. That last one matters: camp money living in an
  individual's bank account is normal here and the system should represent it
  honestly rather than pretend there is one account.
- **Events are the main income.** `רווח מסיבה נמל` 34,646.55, `מסיבת האלווין`
  15,660, `מסיבת פקאנים` 57,000. Each has its own costs and its own profit.
- **Debts run in both directions and get settled by offset, not cash.**
  `חוב יוסף` — the camp owed a member 15,240, settled 14,330 of it by offsets,
  910 outstanding. One of those offset lines is `יוסף קארינה יונתן ירין ועילאי
  6,000`, which is five people's ברן 26 dues at 1,200 each. That case is
  already modelled — see `recordOffset` in `src/lib/fees/payments.ts`.
- **Members front their own cash and get reimbursed.** Twelve lines in the ברן
  25 sheet totalling 5,954, and **two of them have no name recorded at all**,
  so the camp cannot say who to pay back. The system must never lose that link
  again.
- **Dues and fundraising are the two halves of one budget.** ברן 26 budgets
  64,375.3; dues at 1,200 x 35 cover 42,000; a budget line named
  `הורדת מחיר דמי קאמפ` covers the remaining 22,375.3 — fundraising explicitly
  targeted at keeping dues low. The rate fell from 1,500 to 1,200 between
  burns. Showing that relationship is the single most useful thing this page
  could do.

**Scope decision I want your recommendation on, early:** Phase 2 deliberately
deferred the canonical transaction ledger. Dues payments record against the
member, not against the קופה, so ברן 25's collected dues exist in two places.
Decide with me whether Phase 3 builds that ledger or keeps deferring it — and
say what it costs either way.

**2. Rework the data view (`/data`).**

It has a known, recorded defect: it reads the three `.xlsx` files off disk and
re-parses them on **every request** under `force-dynamic`, and never touches
the database — even though the same workbooks are already ingested into
Postgres. Upload a new workbook and it will never appear there. This is logged
as finding **I8** in
`.superpowers/sdd/2026-09-09-ingestion-pipeline/progress.md`.

I want it reading the database, faster, and genuinely explorable rather than a
wall of tables. Treat "what would a camp lead actually want to see here" as an
open design question, not a given.

## What already exists — do not rebuild it

- **Phase 1**: Excel ingestion. Recursive XY-cut block detection, Hebrew
  classification, layout fingerprinting so a confirmed mapping auto-applies to
  the same layout next year, an import review UI. 19 sheets, 29 blocks, 20
  distinct fingerprints from the three reference workbooks.
- **Phase 2**: members, dues and work. Person identity with manual linking and
  reversible merges, per-season roster, dues with mandatory exception reasons,
  payments across six channels including `קיזוז` offsets, a computed season
  summary, events, four kinds of work, and a coverage report.
- Roughly 293+ tests. Everything is TDD'd, and the suite is the contract.

## Constraints that bind everything

- **Never guess.** Where the system is unsure it surfaces the uncertainty
  rather than resolving it. `resolveName` returns a person only on exactly one
  exact match. Import never merges two people. This is the project's spine —
  read `src/lib/members/identity.ts` to see what it looks like in practice.
- **Hebrew RTL throughout.** CSS logical properties only — `margin-inline`,
  `padding-block`, `border-inline-start/end`, `text-align: start/end`. Never
  `left`/`right`. Wrap Latin, numeric and mixed-direction runs in `<bdi>`.
  All UI copy in Hebrew.
- **Money is `numeric(12,2)` in Postgres and integer agorot in JS.** Never do
  float arithmetic on money. `src/lib/money.ts` is the only converter.
- **Blankness checks on user input use `isBlank` from
  `@/lib/text/normalize`, never `.trim()`** — `.trim()` leaves invisible
  directional marks standing, and an RTL browser injects those on copy-paste.
  This defect was found three separate times before it got a name.
- **Admin-only.** Every server action and page calls `requireAdmin()`. No page
  is public. UI hiding is never the enforcement.
- **`@/db` throws at import time without `DATABASE_URL`** and must never enter
  the module graph of a `'use server'` file or a test. Domain modules under
  `@/lib` take `db: AnyDb` as their first parameter.
- **The repository must stay private.** `docs/reference-data/` holds real names
  and amounts and is read-only — never modify those workbooks.
- Additive migrations only. Schema files must be listed explicitly in
  `drizzle.config.ts`; a guard test enforces it.

## Tooling hazards on this machine — each of these has cost real time

- **The `rtk` shell hook intermittently swallows vitest output**, printing only
  `vitest parser: All parsing tiers failed`. Worse, **a parse error runs ZERO
  tests and still exits 0.** Never trust an exit code — read the test COUNT and
  treat a missing count as a failed run. Route through `rtk proxy <command>`.
- **`git commit -m "..."` in this zsh performs command substitution on
  backticked spans** and silently deletes them from the message. Use
  `git commit -F -` with a quoted heredoc.
- **Never run `npm install`** — npm/cli#4828 drops the rolldown native binding
  and breaks every test. If you hit
  `Cannot find module @rolldown/binding-darwin-arm64`, repair with
  `npm install --no-save @rolldown/binding-darwin-arm64@1.2.8`.
- `@testing-library/user-event` is **not** installed; use `fireEvent`.
- `vi.mock` factories referencing a plain top-level `const` throw a hoisting
  `ReferenceError`; use `vi.hoisted`.
- **A live dev database on localhost:5432 holds the camp's real seeded data.**
  Never run `drizzle-kit push`/`migrate` against it and never let a test write
  to it. Tests use PGlite. Docker Desktop sometimes stops; restart it and the
  `shliff-pg` container.
- If you run tasks in parallel git worktrees: the tooling may cut them from a
  **stale base**, and a worktree has no `node_modules` (symlink the main
  checkout's; do not install) and cannot run `npm run build`.

## How I want you to work

Subagent-driven, one implementer per task, with a review after each. Two
things I have learned running the previous phases that I want carried forward:

1. **Mutation-test the tests.** After a task passes, break each behaviour on
   purpose and check that a test fails. On this project a mutation that
   *survived* was repeatedly the most valuable finding — it means a behaviour
   could regress with nothing noticing. Several shipped "passing" modules had
   figures no test actually guarded.
2. **Most defects were in my plan, not in the implementation.** Reviewers
   earned their cost on design questions — a merge that silently destroyed its
   own undo pointer, a validation defeatable by invisible characters, a data
   shape that forced a second query. Point them at the design, not just the
   diff.

Finally: I want to *see* it. Seed data, run it, and check the real page renders
real numbers before telling me a task is done. Several defects on this project
were only visible in the running app — an empty board that was technically
correct, an export that silently gave the wrong season.
