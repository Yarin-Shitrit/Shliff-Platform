# UI Redesign — Execution Order and Integration Rulings

> **For agentic workers:** this is the coordination document for the twelve
> plans named `2026-09-17-ui-01..12-*.md`. Read it before starting any of
> them. It is not itself a TDD plan; it carries the order, the file
> ownership, and the rulings that resolve where two plans disagreed. A
> ruling here **overrides** the plan it names.

**Spec:** `docs/superpowers/specs/2026-09-17-ui-redesign-design.md`

Each plan was drafted independently against that spec, which is why they
overlap: twelve authors reaching for the same shared function is a signal
that the function is real, not that anyone was careless. What follows names
one owner for each shared thing.

---

## 1. Execution order

Five waves. Inside a wave the lanes are independent and can run in parallel
worktrees; between waves there is a hard gate: `npx tsc --noEmit` clean,
`npx vitest run` green, and a review.

| Wave | Lanes | Plans | Why here |
|---|---|---|---|
| **0** | 1 | **01 Foundation** | Tokens, fonts, `Icon`, money and date helpers. Nothing else compiles against a moving target. Ends with the old token names aliased, so every existing screen still renders. |
| **1** | 2 | **03 Component kit** · **02 Shell** | Both consume only wave 0. The kit is the bigger of the two and gates four screens; the shell gates all of them. |
| **2** | 4 | **07 דמי קאמפ** · **10 משימות** · **06 אנשים** · **08 כספים** | The four screens that depend on nothing but the kit and the shell. Each owns a shared library file the later waves consume (see §3). 07 first among equals: it is the screen the camp uses weekly, and it is where the account picker finally appears. |
| **3** | 2 | **09 תנועות + חובות** · **11 קבצים וייבוא** → **05 לטיפול** | 09 needs 08's widened `Movement` and its source-cell index. 11 and 05 share the import surface and both wait on the same Wave 2 merge, so they run in one lane — 11 first, because 05 consumes its projection (I13). |
| **4** | 1 | **04 בית** | Last screen, because it consumes three things the earlier waves own: 07's fee summary, 10's coverage totals, 05's inbox items. Building it earlier means building it twice. |
| **5** | 1 | **12 מובייל וגימור** | Phones, empty states, toasts, the a11y and copy sweeps, and deleting wave 0's token aliases — which is only safe once every screen has stopped using them. |

**Against the in-flight lanes.** Wave 2 of the promotion work (`worklist.ts`,
the register queries) must merge before plan 05 starts; plan 05 says to stop
and report `BLOCKED` rather than write a second `worklist`, and that
instruction stands. The hardening plan's guard rename has already landed
(`src/proxy.ts`, `b092ab7`), and `trace.ts` landed at `b836cc6`, so plans 02,
05, 06, 08 and 09 consume both rather than waiting.

**Parallelism is capped by the lane count, not by the plan count.** Four
worktrees is what the repo has used; wave 2 is sized to it.

---

## 2. Rulings

### I1 — The coverage aggregate has one name

Plans 04 and 10 both add the "16 of 32 places" figure, under three names
(`summarizeCoverage`, `coverageTotals`, `seasonCoverageTotals`).

**Ruling:** plan 10 owns `src/lib/work/coverage.ts`. The exported names are
plan 10's: `covers(status)`, `summarize(...)` and
`seasonCoverageTotals(db, seasonId)`. Plan 04's Task that edits
`coverage.ts` is deleted; it imports instead. Plan 10's capping rule —
`Math.min(accepted, peopleNeeded)` per task, open tasks only — is the
definition, and plan 04's home tile inherits it.

### I2 — The inbox exposes one server function, and the shell and home both call it

Plan 02 expected `openDecisionCount(db, seasonId)`, plan 04 expected
`openDecisions(db, seasonId, limit)`, and plan 05 wrote
`openDecisionCount(items)` over an in-memory list.

**Ruling:** plan 05 owns `src/lib/inbox/`. It exports exactly two things for
other screens:

```ts
export async function loadInboxItems(db: Db, seasonId: string): Promise<InboxItem[]>;
export function openDecisionCount(items: InboxItem[]): number;
```

The shell's count and the home's preview both call `loadInboxItems` once per
request and derive what they need — the shell takes `openDecisionCount`, the
home takes the first six items with `blocking: true`. No third query. Until
plan 05 lands, the shell renders the count from `listUnlinkedNames` alone and
the home renders its unlinked-names fallback, both of which those plans
already specify.

### I3 — One Hebrew error boundary, many per-area maps

Four plans reached for the same idea: 07 and 12 each create
`src/lib/errors/hebrew.ts`; 09 creates `money/hebrew-error.ts`; 10 creates
`tasks/failure-messages.ts`.

**Ruling:** plan 07 creates `src/lib/errors/hebrew.ts`, containing the
boundary helper, the generic Hebrew fallback and the logging — and nothing
domain-specific. Each screen plan keeps its own map beside its actions
(`fees/error-messages.ts`, `money/hebrew-error.ts`,
`tasks/failure-messages.ts`) and registers it with the helper. Plan 12 does
**not** create the module; its R9 sweep audits the four known
pass-throughs (`fees/actions.ts:14`, `tasks/actions.ts:14`,
`members/actions.ts:30`, `src/lib/import/run-import.ts:58`) and adds the
rendered-text net. Plan 07's prefix-before-Hebrew-letter matching rule is
the shared one: an English message may contain Hebrew (`unknown payment
channel: מזומן`), so the map is consulted first.

### I4 — The toaster is a kit component

Plan 12 modifies `src/components/ui/toaster.tsx`; no plan creates it, and
three screens want toasts before wave 5.

**Ruling:** plan 03 creates it — the mount, the two live regions (polite for
results, assertive for failures) and the `useToast` hook — as a fifteenth
task, with the same test discipline as its neighbours. Plan 12 keeps the
undo table and extends it. Its file entry becomes Modify.

### I5 — One bottom tab bar

Plan 02 creates `shell/tab-bar.tsx`; plan 12 creates `shell/bottom-nav.tsx`.

**Ruling:** the file is `src/app/(admin)/shell/tab-bar.tsx`, owned by plan
02, which ships it behind the `767.98px` breakpoint. Plan 12 modifies it and
owns the five-item phone behaviour.

### I6 — `seasonFeeSummary` is widened once

Plan 04 adds `unpaid: UnpaidMember[]`; plan 07 adds `offsetAgorot`,
`offsetPersonCount` and `unattributedAgorot`. Same function, same pass,
different waves.

**Ruling:** plan 07 owns `src/lib/fees/summary.ts` and widens it with all
four fields in one task, taking plan 04's `UnpaidMember` shape verbatim,
including its rule that the fields come from rows the function already
reads rather than a second query. Plan 04's widening task is deleted; it
consumes.

### I7 — The source-cell index lives in one module

Plan 08 writes `sourceIndexFor`; plan 09 writes `src/lib/money/source-ref.ts`.
Both turn `source_block_id`/`source_row` into a printable cell through
`traceBlock`.

**Ruling:** the module is `src/lib/money/source-ref.ts`, created by plan 08
(wave 2) and consumed by plan 09 (wave 3). Plan 08 also owns the widening of
`Movement` with `sourceBlockId`/`sourceRow`, which plan 09's `ledger-view.ts`
builds on.

### I8 — `/money/ledger` and `/money/debts` belong to plan 09

Plan 08 lists `/money/ledger` among the things it creates.

**Ruling:** plan 08 links to both routes and renders the five-row preview;
plan 09 creates them. Plan 08's link test tolerates a missing route until
wave 3, exactly as its Task 10 Step 6 already records.

### I9 — Drawer URLs go through the kit's helper

Plan 03 defines `?peek=<id>` for previews and `?act=<verb>` for action
drawers, with `openPeekHref`/`closePeekHref` in `drawer-url.ts`. The screens
then invented their own: `?pay=`, `?exception=`, `?settle=`, `?new=`,
`?merge=`.

**Ruling:** previews stay `?peek=<id>`. Action drawers become
`?act=<verb>&id=<id>` — `act=pay`, `act=exception`, `act=settle`,
`act=movement`, `act=task`, `act=merge` — and every screen builds them with
the kit's helper rather than spelling the params. Plans 06, 07, 09 and 10
amend their param names; nothing else about those drawers changes. The
reason is not tidiness: one helper means `esc`, the close control and the
back button cannot disagree about what closes, and plan 03 tests that once.

### I10 — `link.ts` is edited by 05 first, then 06

Plan 05 adds the ignore-state semantics and the suggestion reasons; plan 06
extracts `mergeConflicts` out of `mergePersons`. Different functions, one
file, adjacent waves.

**Ruling:** plan 05's edits land first (wave 3 begins before 06 is
finished only if 06 slipped; if both are in flight, 06 rebases). Neither
plan may reformat the other's functions.

### I11 — `money/page.tsx` is touched by the kit, then rewritten

Plan 03's `StatTile` migration changes one import line on `/money`; plan 08
rewrites the page.

**Ruling:** plan 03's edit stands (wave 1); plan 08 starts from the migrated
import.

### I13 — A block's state is derived once, and לטיפול reads that derivation

Plan 11 builds `src/lib/import/register.ts`, whose `blockStates` and
`sheetLabels` project W17's seven-state vocabulary and a sheet's season,
authority and collision group. Plan 05 assembles the same facts from Wave
2's `worklist` directly. Two derivations of "what state is this block in"
is precisely the failure plan 05 refuses to risk for `worklist` itself — a
file's row, the review rail and the queue would each be able to report a
different number.

**Ruling:** `src/lib/import/register.ts` is the one projection, owned by
plan 11. It is built **on top of** `worklist` — it re-labels, it does not
re-derive, and it does not run a second dry-run pass. Plan 05's
`block-undecided`, `sheet-season` and `sheet-collision` items are built from
`blockStates`/`sheetLabels` rather than from `worklist` directly; its other
four kinds are untouched. This is why wave 3 runs 11 before 05.

Two things stay split, and both plans already say so: bulk promotion across
every file belongs to לטיפול (`promoteAll`), promoting one file belongs to
the review screen (`promoteUpload`), and both report the same four counts.

### I12 — Gendered Hebrew is out, everywhere

Plans 06, 07 and 10 each independently found that the mock's gendered forms
(`טרם שילמה`, `פטורה`) cannot be produced: `persons` records no gender, and
inferring one from a name is exactly the guessing the platform refuses.

**Ruling:** state words are written about the thing, not the person —
`טרם שולם`, `פטור מתשלום`, `שולם בקיזוז`. This applies to every screen and
to the mock, which is now wrong in three places and should not be copied
literally.

---

## 3. Who owns what

Shared files, their owner, and the wave they settle in:

| File | Owner | Wave | Consumers |
|---|---|---|---|
| `src/app/tokens.css`, `globals.css` | 01 | 0 | all |
| `src/components/icon.tsx` | 01 | 0 | all |
| `src/lib/money.ts`, `src/lib/dates.ts` | 01 | 0 | all |
| `src/components/ui/*` (incl. `toaster.tsx`, I4) | 03 | 1 | all screens |
| `src/app/(admin)/layout.tsx`, `shell/*` (incl. `tab-bar.tsx`, I5) | 02 | 1 | all screens, then 12 |
| `src/lib/seasons/*` (`resolveSeason`, `pickSeason`) | 02 | 1 | every season-scoped page |
| `src/lib/errors/hebrew.ts` (I3) | 07 | 2 | 09, 10, 12 |
| `src/lib/fees/summary.ts` (I6) | 07 | 2 | 04, 06 |
| `src/lib/work/coverage.ts` (I1) | 10 | 2 | 02, 04 |
| `src/lib/money/source-ref.ts`, `Movement` widening (I7) | 08 | 2 | 09 |
| `src/lib/members/people-list.ts`, `labels.ts` | 06 | 2 | 04 (names), export route |
| `src/lib/import/register.ts`, `uploads.ts` (I13) | 11 | 3 | 05's block and sheet items |
| `src/lib/inbox/*` (I2) | 05 | 3 | 02, 04 |
| `src/lib/money/ledger-view.ts`, `debts-view.ts` | 09 | 3 | — |

Everything not in this table belongs to exactly one plan.

---

## 4. The gate between waves

Before a wave is called done:

1. `npx tsc --noEmit` is clean.
2. `npx vitest run` is green.
3. Every route the wave touched renders in both themes.
4. The keyboard path through each new screen works: tab order, focus
   visible, `esc` closes what is open, and nothing is reachable only by
   pointer.
5. No English string can reach a Hebrew screen (plan 07's net from wave 2
   onward).
6. The plans' own Self-review sections are re-read against what actually
   shipped, and any ruling that changed is written back into this document.

After wave 5, plan 01's old token aliases (`--ground`, `--raised`, `--line`,
`--sand`, `--dust`, `--flare`, `.badge-warn`) are deleted, and the build
proves nothing referenced them.

---

## 5. Addenda — rulings made during execution

§4 item 6 requires that a ruling which changed be written back into this
document. These were decided while executing wave 0 and while reading plans 02,
03, 06, 07, 08 and 10 against the repo. **Each overrides the plan it names, on
the same terms as the rulings above.** Where one contradicts an earlier ruling in
§2, it says so.

Written 2026-09-17, after plan 01 landed at `a41ffb6`.

### A1 — The icon lives at `src/components/ui/icon.tsx`

**This entry was wrong when first written and has been corrected. §3's table is
overruled here by the spec.**

Plans 03, 07 and 08 all expect `src/components/ui/icon.tsx`. Plan 01's File
Structure and §3 of this document both said `src/components/icon.tsx`, and the
first version of this entry ruled for §3 on the grounds that §3 is binding.

That was a misreading. **§3 resolves plan-against-plan conflicts; it does not
overrule the spec**, which is the authority every plan argues from. Spec §C is
explicit: *"Each component lives in `src/components/ui/` with its own CSS Module
and its own test"* — and `Icon` is **C14**, inside §C. So three plans had read
the spec correctly and two artefacts had not.

The file was moved to `src/components/ui/icon.tsx` (with its module and test)
while plan 01 was still the only consumer, costing two import sites. The file is
declared frozen — no screen plan edits it again — so the move had to happen
before wave 1 or become a sweep across every screen.

`src/components/format.tsx` does **not** move: it is a formatting primitive, not
a kit component, and no plan expects it under `ui/`.

### A2 — Plan 01's other shipped paths, which three plans cite wrongly

| What | Plans expect | Where it actually is |
|---|---|---|
| `Money` | `@/components/ui/money` (08) | `@/components/format` |
| `formatDateShort` | `@/lib/format/date` (08) | `@/lib/dates` |
| `Icon` | `@/components/ui/icon` (03, 07) | `@/components/icon` |

`src/lib/format/` does not exist and will not. No plan may create a second money
component or date module; `formatShekels` is the only place a shekel sign is
attached and `<Money>` the only place a bidi isolate is opened.

### A3 — Drawer URLs keep plan 03's shape, not I9's literal text

**This narrows I9.** Action drawers are **`?peek=<id>&act=<verb>`**, not
`?act=<verb>&id=<id>`. I9's binding requirement is its stated *reason* — one
helper owns the params so `esc`, the close control and the back button cannot
disagree — not that the id sit in a param named `id`. Plan 03's shape satisfies
that with one fewer param, keeps a single id param across preview and action
drawers, and lets an action drawer degrade to the preview on close rather than
needing a second rule.

Everything else in I9 stands: the verbs are `pay`, `exception`, `settle`,
`movement`, `task`, `merge`; every screen builds these through the kit's
`openPeekHref`/`closePeekHref` in `drawer-url.ts` rather than spelling params.

Per-plan rename surface, measured against the repo:

- **07** — `?pay=<personId>` → `?peek=<id>&act=pay`; `?exception=<personId>` →
  `?peek=<id>&act=exception`. Plan 07 builds every URL with its own `feesHref`
  and never mentions `drawer-url.ts`; it must go through the kit helper. Touch
  points: the `FeesHrefParts` interface and `feesHref` body, 6 tests in
  `href.test.ts`, the `searchParams` type and both `params.*` reads in
  `page.tsx`, both drawer header comments, its ruling X, 3 asserted URLs in
  `payment-drawer.test.tsx`, 2 in `fee-table.test.tsx`, and its Self-review line.
- **10** — `?new=task` → `?act=task`. No record id exists, so no `?peek=`. Its
  two popovers are `useState`-driven with their own `Escape` handler and carry no
  param; that is fine, because I9 governs drawers, not popovers.
- **08** — **nothing to rename.** It emits no action verb, already carries the
  record id in `?peek=`, and hands the קיזוז drawer to plan 09.
- **06** — one param, `?merge=<a>,<b>`, which **does not fit either shape**
  because merge needs two ids. Use `?act=merge&peek=<a>&with=<b>`: the primary
  record stays in `peek`, the second is named explicitly.
  `parsePeopleQuery` already rejects a merge param not naming exactly two
  different people.

**A consequence of this ruling, which costs a dependency.** Requiring every
screen to build these URLs through the kit's `drawer-url.ts` **creates a wave-1
dependency that plan 07 did not previously have.** Plan 07 builds all of its URLs
itself in `src/app/(admin)/fees/href.ts` and never mentions the kit helper, which
is why its Dependencies section says "Tasks 1-4 are library and boundary work and
are independent of plans 01-03; they can start immediately."

That remains true of **Tasks 1, 2 and 3**. It is **no longer true of Task 4**,
which creates `href.ts` and must now import plan 03's `drawer-url.ts` — so Task 4
waits on plan 03's Task 12. Any attempt to run plan 07 early must stop after
Task 3. The same applies wherever a plan's own "independent of the kit" claim
rests on it spelling drawer params itself.

### A4 — Plan 03 authors the toaster; plan 02 mounts it

I4 assigns the toaster to plan 03, but **plan 03 contains no such task** — zero
occurrences of "toast" in 4,869 lines. It must be written as **Task 15**. Three
of plan 03's own self-checks go stale and must be updated in the same task: its
"exactly four `'use client'` files" constraint becomes five (a `useToast` hook is
client), its R7 grep list gains the toaster, and Task 14's "18 test files"
becomes 19.

On I4's word "the mount": plan 03 builds `ToastProvider` and `useToast` but does
**not** edit `src/app/(admin)/layout.tsx` — §3 assigns that file to plan 02, so
**plan 02 mounts the provider** in the shell it is already rewriting. Toasts are
therefore invisible until plan 02 lands, which is acceptable inside one wave. The
shape must stay compatible with plan 12 Task 6's contract, which already assumes
a plan-03 toaster it extends rather than replaces.

### A5 — `src/app/(admin)/money/page.tsx`: plan 03 edits it before plan 02

I11 arbitrates plan 03 against plan 08, not against plan 02, and both wave-1
plans touch this file: 03 substitutes the `StatTile` import (line 11), 02 adds
`export const metadata`. The edits are semantically independent but **textually
adjacent**, since metadata conventionally follows the imports — two parallel
worktrees would produce a conflict hunk rather than a clean merge. Wave 1 lists
03 first, so **03's import change lands first and 02 adds metadata on top**. Plan
02's Task 8 keeps ownership of the metadata line.

### A6 — I6 is not satisfied by plan 07 as written

I6 says plan 07 widens `src/lib/fees/summary.ts` with **all four** fields, taking
plan 04's `UnpaidMember` verbatim, and that plan 04's widening task is deleted.
In fact plan 07's Task 3 adds **three** (`offsetAgorot`, `offsetPersonCount`,
`unattributedAgorot`), `UnpaidMember` has zero occurrences in plan 07, and **plan
04 still carries the widening task** at `ui-04-home.md:121`.

Plan 07's Task 3 must additionally:

1. add `unpaid: UnpaidMember[]`, largest outstanding first, with plan 04's shape
   verbatim (`personId`, `displayName`, `dueId`, `kind`, `amountAgorot`,
   `paidAgorot`, `outstandingAgorot`);
2. add plan 04's `.innerJoin(persons, eq(persons.id, dues.personId))` **to the
   dues read specifically**. Stated precisely, because the file is easy to
   misread: `summary.ts` *does* already join `persons`, but on the **roster**
   read (`:36`, `eq(persons.id, memberships.personId)`). The **dues** read
   (`:39-42`) selects only `dues.id`, `personId`, `amount`, `kind` — no join.

   So today a due's person name is resolvable **only** through the roster map,
   and a due belonging to someone who is not on this season's roster has no name
   available at all. That is not hypothetical: it is precisely the row a lead
   most needs to see in `unpaid`, since someone who left the roster still owing
   money is the collection case that gets forgotten. `UnpaidMember.displayName`
   cannot be populated for them without this join;


3. update the `SUMMARY` fixture in its own Task 9 (`fee-rollup.test.tsx`), which
   builds a `SeasonFeeSummary` literal with no `unpaid` field and will stop
   typechecking once the interface widens.

Plan 04's widening task is deleted, as I6 already says.

Note one deliberate departure from I6's "from rows the function already reads":
plan 07's own ruling has `unattributedAgorot` call the existing
`unattributedAgorot(db, seasonId)` rather than re-derive it, on the grounds that
excluding `קיזוז` is a rule and not an optimisation. That stands.

### A7 — I3's per-area maps are passed as arguments, not registered

I3 says each screen "registers" its Hebrew error map with the shared helper. Plan
07 has no registry: `toHebrewError(error, FEE_ERRORS)` takes the map as a
parameter. **The parameter form stands**, and plans 09, 10 and 12 pass their own
arrays the same way. A registry is global mutable state whose behaviour depends
on import order — the kind of thing that works in tests and fails once Next
code-splits the bundle. The parameter form satisfies I3's actual requirement: one
boundary helper, per-area maps, nothing domain-specific in the shared module.

Plan 07's `src/lib/errors/hebrew.ts` exports exactly `toHebrewError`,
`HEBREW_FALLBACK` and a `HebrewErrors` type, with a module-private Hebrew-letter
regex. **Plan 10 does not currently register or pass anything** — its
`tasks/failure-messages.ts` is self-contained with its own `console.error` and
fallback per function. Wiring it through the shared helper is unwritten work that
plan 10 must add.

I3's prefix-before-Hebrew-letter rule is confirmed necessary and correctly stated
in plan 07: the map is consulted first by prefix, because an English message may
itself contain Hebrew (`unknown payment channel: מזומן`); only an unmatched
message is then tested for a Hebrew letter and passed through; everything else is
logged once and replaced by the fallback.

### A8 — I7's `source-ref.ts` must actually be created

I7 names `src/lib/money/source-ref.ts` as plan 08's, consumed by plan 09.
**Plan 08 contains zero references to it** — it puts `sourceKey(table, id)` and
`sourceIndexFor(db, refs)` inside its new `src/lib/money/overview.ts` and treats
the already-merged `src/lib/money/trace.ts` (`b836cc6`) as the provenance module.

`trace.ts` genuinely is the one place that knows how `source_block_id` +
`source_row` becomes `תנועות קופה!A14`, and it stays untouched. But the
**indexing helper belongs in `source-ref.ts` as I7 says**: leaving it inside
`overview.ts` makes plan 09 import a `/money`-overview module for a generic
concern, which is how a second copy gets written later. Plan 08's Task 4 creates
`source-ref.ts` wrapping `trace.ts`; `overview.ts` keeps only what is about the
overview.

Plan 08's `Movement` widening (`sourceBlockId`, `sourceRow`) is correct as
written and remains plan 08's, per I7.

### A9 — I12 is not yet satisfied; three plans carry gendered copy

I12 removed the mock's gendered *state pills*, and all three plans did that
correctly. But gender-inflected copy survives elsewhere, predicated on the person
rather than the thing:

- **Plan 07** — `{name} יחזור לתעריף הרגיל…` in the clear-exception confirmation
  (`יחזור`, masculine singular); `למשל: פטור מלא — הוביל את ההקמה` as a
  reason-field placeholder (`הוביל`); and `חבר אחד ברשימת {season}…` in the
  missing-dues banner (masculine singular noun for a person of unknown gender).
- **Plan 10** — `אישר` and `ירד` as assignment-status labels, with `אישר`
  doubling as the accept **button** label where an imperative belongs; and
  `כבר משובץ` in the candidate meta. Also a non-gender agreement inconsistency:
  `מאויש` against `מאוישות` for the same concept.
- **Plan 06** — writes `פטור` where I12 writes `פטור מתשלום`.

**Each plan's own grep net misses its own violations.** Plan 07's is
`/שילמה|שילם /`, plan 06's is `/שילמה|פטורה|שילם /`, plan 10's covers
`שילמה|פטורה|פטור|שולם`. None catches `יחזור`, `הוביל`, `אישר`, `ירד`, `משובץ`
or the plural `שילמו`. **Plan 12's R9/I12 sweep must grep for inflected verbs and
participles, not just the four words the mock used.**

Not a violation, but recorded: the plural forms (`טרם שילמו`, `שילמו חלקית`,
`כולם שילמו`, `לא חזרו השנה`) are not gender-marked in Hebrew, though they are
written about people rather than the thing. They are saved-view labels in plans
06 and 07; leaving them is defensible, since I12's concern is gender and not
grammatical subject. I12's canonical `פטור מתשלום` never appears in plan 07 at
all — its zero-amount exception state is `אין מה לגבות`, which is about the thing
and reads better; that stands.

### A10 — Line-number citations in plans 06, 07 and 08 are stale; the strings are not

Every Hebrew message and code fragment these plans quote still matches
character-for-character, but many locations have drifted. **Implementers must
grep for the quoted string and never apply a cited line number blindly.**

Worst cases found: plan 07 cites the `קיזוז אינו מזיז מזומן` refusal four times
as `payments.ts:58` — it is at **72**; `dues.ts` throws cited at 104/107/109/122/144
are at **113/116/118/131/156**; `fees/page.tsx:79-81` is a comment block, with
the copy at **86-87**; `exception-form.tsx:41` is at **43**;
`member-fee-row.tsx`'s delete button is cited as both `249-255` and `245-251`.
Plan 02 cites `fees/page.tsx:20-33` for a season fallback that is at **31**, with
the season strip at **40**. Plan 06 says to read `describe('mergePersons')` in
`link.test.ts`; the blocks are named `linking` and `merging`.

Still exact and trustworthy: plan 07's `fees/page.tsx:40-50` and `:25`,
`actions.ts:13-15`, `camp.ts:120`, `payments.ts:18`; **all four of plan 10's
citations into `coverage.ts`** (`:12`, `:76-78`, `:116`, `:152`) and all five of
its `tasks/page.tsx` ranges; plan 06's `export/route.ts`, `add-member.tsx`,
`actions.ts:30`, and every `shared.css` line number. Plan 08 cites **no** line
numbers at all, anchoring on quoted code — which is why only one of its anchors
went stale (`budget.ts`'s `arithmeticOff:` call, collapsed to one line by
`0aa83cd`/`757d28d`). **That is the practice the remaining plans should follow.**

### A11 — Mock citations resolve to `docs/superpowers/mock/`

Plans cite the mock as `scratchpad/mock/...`, a temporary directory that no
longer exists. The whole mock is now in the repo at `docs/superpowers/mock/` —
13 flat `.html` artboards, `shared.css`, plus `icons.mjs`, `build.mjs`,
`contrast.mjs`, `layout.json` and `assets/logo-{dark,light}.png`. Plan 01's
`icons.mjs` citation and plan 02's `build.mjs` (`sidebar()`, `OVERLAYS`)
citations both resolve there. **`support.js`, which plan 02 also cites, never
existed** — the sidebar and overlay markup must be reconstructed from
`shared.css` and the spec rather than read.

Line numbers *inside* `shared.css` are all still exact.

### A12 — Known plan-vs-repo defects to fix when the task is reached

- **Plan 10, Task 4** — the test "never offers a person who was merged away"
  calls `addMember(db, merged, seasonId)` then `mergePersons(db, merged, survivor,
  LEAD)`. `link.ts:92-94` pushes the conflict `'חברות במחנה'` when the *source*
  has a membership and returns `{ok: false}` without setting `mergedIntoId`, so
  the merge is refused, both people stay unmerged members, and the assertion
  fails. The fixture must not give the source a membership.
- **Plan 10, Task 6** knowingly leaves `tsc` red for five tasks (removing
  `assignPersonAction` breaks `assign-control.tsx` until Task 11 deletes it). So
  tasks 6-10 cannot each satisfy a clean-`tsc` gate individually; only the
  boundary at Task 11 can. Do not report that as a failure.
- **Plan 08, Task 3** — its `ledger.test.ts` snippet reuses `s26` and `cash` from
  a `beforeEach` that does not exist (the real one is `db = await
  createTestDb();` alone) and copies a helper called `seedBlock` from
  `trace.test.ts`, whose helpers are named `addSheet`/`addBlock`. Those fixtures
  must be written, not reused.
- **Plan 08, Tasks 9-10** — applied literally, they leave
  `התנועות האחרונות` **before** `התקציב`, failing plan 08's own order assertion
  (`איפה הכסף, מה חייבים…, התקציב, התנועות האחרונות`). Task 10 must relocate the
  band, which the plan never says to do. Also: Task 8 deletes the in-file
  `ObligationsTable` without naming the now-unused `Meter` import for removal;
  Task 10's whole-screen test uses fixtures `budgetLine()` and `movement()` that
  the plan never defines; and its "five fallback sentences" are **seven**, in two
  phrasings (the rewritten snippets do cover both).
- **Plan 06** — Task 4 step 9 deletes `members.module.css` while
  `merge-control.tsx` still imports it (deleted in Task 8), so step 10's
  "`merge-control.test.tsx` still passes" breaks on a missing CSS module;
  reorder. It says to lift "four" tests from `merge-control.test.tsx` — there are
  five, one with no analogue. Task 10 appends to `actions.test.ts`, which only
  exists after Task 5, an undeclared 10→5 dependency. Its Dependencies says plan
  05 is needed "before Task 5", but the `/inbox` banner is built in **Task 4**.
  Its Self-review expects four `'use client'` directives counting "the two in
  `add-member.tsx`" — that file has one directive for two exports, so the real
  count is three. And I10's extraction of `mergeConflicts` would **drop two
  load-bearing comments** at `link.ts:104-113` and `:118-126`; preserve them.
- **Plan 10** cites plan 03 as `...-ui-03-components.md`; the file is
  `...-ui-03-component-kit.md`.

### A13 — Two things every plan's gate must now include

1. **Run the full suite as `npx vitest run --maxWorkers=4 --hookTimeout 60000`.**
   Uncapped, ~19 pglite-backed suites fail with `Hook timed out in 10000ms` from
   resource contention — about 110 spurious failures — and the failing run also
   **under-reports the total**, because an aborted suite never registers its
   remaining tests. A "baseline + N" gate taken from an uncapped run is wrong.
   A red is *timing-shaped* (a hook timing out, which says nothing about the
   code) or *assertion-shaped* (it names a value). Never call a timing-shaped red
   pre-existing or out of scope without re-running it capped and alone.
2. **Verify the plan's values against the spec, not against the plan.** Where one
   author wrote both a plan's tests and its implementation in one sitting, the
   two can agree with each other about the wrong thing, and every downstream gate
   inherits that agreement. The only escape is an authority the author did not
   write. For plan 01 this caught nothing — all 27 light and 22 dark values were
   correct — but the check cost minutes and no other gate in the process could
   have caught that class of error.

### A14 — An open question for the camp lead, not a ruling

Measured against a clone of the real database, **`no-season` is 96 of 234
refusals — 41%, the largest single category.** Eight of 19 sheets are ברן 23/24,
seasons that do not exist in the database, and `budget_lines.season_id` /
`ticket_rounds.season_id` are NOT NULL, so those blocks refuse wholesale.

**No screen in any of the twelve plans creates a season.** Plan 02's B4 names a
`שנה חדשה` affordance and then defers it by its own Ruling S4, because it points
at a settings screen no plan builds; `createSeason` appears across the plans only
in test fixtures. So the register's largest rail item is one a lead cannot act
on — which satisfies the letter of "make the uncertainty visible" and breaks the
point of it, against the standing rule that *every figure links to the page that
can change it*.

Three options, none of them this document's to choose: **(a)** a screen where a
lead types the two seasons' real numbers — `createSeason` already exists and is
tested in `src/lib/members/roster.ts`, so this is a server action and a form;
**(b)** a seed entry in `seedCampBaseline`, once someone supplies the real 23/24
`flat_rate` and `planned_size` — they cannot be invented, because a wrong
`flat_rate` silently changes what the dues and identity calculations say about
those years; **(c)** leave those eight sheets unpromotable and say so plainly,
once, in the register — defensible, since these are closed years whose money is
already history.

Related, for plan 05's design: `no-amount` is 73 (31%), mostly sub-table noise
because `detectBlocks` does not split side-by-side tables — so those are one
artifact, not 73 decisions a lead should work through. **Zero obligations
promote**, and 16 seeded rows (13 debts, 3 ticket rounds) have no promotion path,
so `/inbox` will show debts that exist in the money screens but come from nowhere
the register can explain; the honest framing is "entered by hand, no workbook
behind it", which is R11's `נרשם ידנית` case rather than anything refusal-shaped.
`no-date` is now 0, down from 24 before the date-parser fix. `retained` is 0
today and will only appear once leads start re-confirming blocks — design for it,
but do not calibrate it as a common case.

### A15 — Two register states that lie, and what plans 05 and 11 must not build on yet

A peer session's final review of the register found two defects in how block
state is reported. **Do not write rail copy, coverage-matrix copy or empty-state
copy against either state until that fix has merged.**

1. **The register reports what a promotion *would* write as though it had been
   written.** A block that is confirmed but never promoted reads `promoted` with
   a row count, and `coverage().promoted` sums would-be rows. So `/inbox`'s
   coverage matrix would tell a lead a season is covered **before the promote
   button was ever pressed.**

   This is worse than a guess, which is what the platform's core rule forbids —
   it is a false claim about what is in the database. A lead who trusts it stops
   chasing rows that were never written.

2. **A season-less budget block reads `promoted, 0 rows` where the spec says
   `refused`.** That is the `no-season` case, which is **96 of 234 refusals in
   the real data — 41%, the largest single category.** Rendering the largest
   refusal class as a successful promotion of nothing would hide the single
   biggest thing a lead needs to act on.

Both are being fixed in the wave-2 lane. The instruction for plans 05 and 11 is
narrow: **derive block state from the corrected projection when it lands, and do
not calibrate any copy — counts, empty states, "most common refusal" — against
numbers measured before it.**

**Update, 2026-09-18 — fixed upstream, and NOT YET ON THIS BRANCH.** The peer
session merged the correction into `main` (`45fa275`) and deleted
`feat/camp-members-fees`. `BlockState` gains `confirmed-not-promoted`;
`WorklistRow` splits the one count into two, `rowCount` (rows that exist,
counted in the four target tables) and `wouldWrite` (what a commit would write
now); `coverage().promoted` sums the honest one. The season-less budget block
reads `refused`.

**The trap this leaves is worth naming, because checking for it the obvious way
gives the wrong answer.** `src/lib/data/worklist.ts` exists on
`feat/ui-01-foundation` — it has existed all along — so "is the file there?"
answers yes while the branch still carries the version that lies. The gate on
plan 05 was never about the file's presence; it is about *which* copy is
underneath it. Verify with content, not a path:
`grep -c confirmed-not-promoted src/lib/data/worklist.ts` must be non-zero, and
`git diff HEAD main -- src/lib/data/worklist.ts` must be empty.

**Therefore plan 05 and plan 11 remain BLOCKED on this branch until `main` is
merged in** (at the time of writing: main +21, this branch +102). Neither the
corrected register nor plan 11's `confirmBlock(…, budgetCategory?)` lever is
reachable from here yet.

### A16 — The icon set is frozen at 65; two plans cite glyphs that do not exist

`src/components/ui/icon.tsx` ships the whole set at once and **no screen plan
edits it again** — an icon record every parallel lane appends to is a merge
conflict with a schedule. The consequence nobody wrote down: **a plan citing a
glyph outside those 65 has no recourse but substitution**, and the failure
surfaces as a blank square rather than a compile error if the name reaches the
component as a string.

Audited every plan's `<Icon name="…">` references against the shipped record.
Two real cases:

| plan | glyph cited | exists? | substitute |
|---|---|---|---|
| 03 (EmptyState, `not-permitted`) | `lock` | no | **`ban`** — the nearest "no entry" glyph. Already applied. |
| 11 (imports) | `file` | no | **`sheet`** — a document glyph is in the set under that name. |

Everything else checks out: every other `<Icon name>` in every plan resolves.

**Rule for any plan that finds a glyph missing:** substitute from the 65 and say
so in the report. Do **not** add to `ICON_PATHS` — the record is frozen for a
reason, and a sixty-sixth entry added by one lane is a conflict for every other.
If no glyph in the set carries the meaning, that is worth escalating rather than
approximating, because an icon that means nearly the right thing is worse than a
word.

### A17 — One `<bdi>` per phrase, not one per number

**18 places across six plans** write a mixed phrase as two isolates —
`<bdi>{a}</bdi> מתוך <bdi>{b}</bdi>` — and **every paired test that queries the
whole phrase will fail against it.** `@testing-library/dom`'s `getNodeText` reads
only *direct* text-node children, so `getByText('1 מתוך 9')` never matches when
the numbers sit in child elements.

Counts: plan 07 ×8, plans 05 and 11 ×3 each, plan 10 ×2, plans 03 and 08 ×1.
None has shipped — a Drawer implementer hit it first and fixed it.

**Ruling: wrap the whole phrase in one `<bdi>`** when a number and words form a
single readable sentence fragment. Both forms are visually correct — A11 only
requires that an amount be isolated, and a phrase beginning with a Hebrew letter
resolves RTL either way — so the tie is broken by testability and by existing
precedent (`assign-control.tsx` already does this). Separate isolates stay correct
where two *independent* amounts sit adjacent with no shared phrase between them.

**The reason this is a ruling and not a note:** when the paired test fails, the
cheap fix is to weaken the query — `getByText(/1/)`, or an assertion on
`textContent` — and a weakened query is a test that stops checking the thing the
phrase exists to say. The markup is what should change.

### A18 — The plans' sample code predates the rulings, and systematically contradicts them

Across wave 1, **five independent implementers refused defects in their own
briefs' sample code**. Not one was a typo; every one was the brief faithfully
reflecting a world that no longer exists, because the sample code was written
before the tokens and rulings it now has to obey.

| defect in brief | contradicts | found in |
|---|---|---|
| `outline: none` in sample CSS | **A9**, never remove a focus ring | 3 separate tasks |
| `<bdi>{a}</bdi> word <bdi>{b}</bdi>` | its own paired test — see **A17** | 2 tasks, independently |
| literal `z-index: 40` | the z-index ladder tokens | 2 tasks |
| `` `${formatILS(x)}₪` `` | `money.ts`'s explicit prohibition | 1 task |
| `role="menu"`/`"menuitem"` on link panels | the shipped `season-switch.tsx` ruling | 1 task |
| hard-coded `16px` phone input | `--input-font-phone` | 1 task |
| icon sizes 12/13 | **C14**'s 14/15/16/20 ladder | 1 task |
| a `lock` glyph | the frozen 65-glyph set — see **A16** | 1 task |

**What made this work is worth keeping.** Every dispatch carried the standing
constraints *in the prompt itself*, with the line "these override the brief."
Without that, a faithful implementer would have shipped each defect — and each
would have been defensible, because the plan said so. Five agents each chose the
constraint over the sample and said so in their reports.

**The rule for waves 2 through 5:** a plan's prose states intent and is
authoritative; a plan's **sample code is a sketch from before the foundation
existed** and loses to any standing constraint it contradicts. An implementer who
finds such a conflict should refuse the sample, follow the constraint, and record
it — not silently do either one.

The deeper reason this keeps happening: twelve plans were drafted in parallel
against a spec, then wave 0 built the foundation they all assume. Everything
written before that foundation landed is, in effect, a prediction of it — and
predictions drift. **Trust the plan's argument; verify its code.**

### A19 — A create drawer has no record, and the kit had no URL for one

A3 put every drawer URL behind `src/components/ui/drawer-url.ts`, so that `esc`,
the close button and the browser's back button can never disagree about which
params survive. R5 is what that protects: `season`, the saved view, the filters,
the search and the sort all outlive a drawer.

The kit shipped two builders, `openPeekHref` and `closePeekHref`. Both assume a
drawer is **about a record**. A *create* drawer is not — there is no id to carry,
so it wants `?act=<verb>` with no `peek`, and `openPeekHref` always sets `peek`.

Two screens hit this independently: the season screen's `?act=season` and plan
10's `?act=task`. The first hand-built a local `newSeasonHref`. **That copy was
correct** — it imported `PEEK_PARAM`/`ACT_PARAM` rather than spelling them, and
it preserved every other param — so nothing was broken. It is recorded here
anyway, because *a correct duplicate is how this kind of rule erodes*: the third
copy is the one that forgets `params.delete(PEEK_PARAM)` and leaves a record
drawer and a create drawer both open, and nothing about that copy looks wrong at
review time. A3's guarantee is not "the params are spelled right"; it is "one
function decides", and two functions deciding the same thing is already the
failure, not a near miss.

**Ruling: the kit gains `openActHref(pathname, current, act)` — an `act` with no
`peek`, everything else preserved — and `season-switch.tsx` migrates to it. No
screen builds an act-only href by hand.** Plan 10's Task 9 imports it rather than
writing the third copy.

Its test has to cover a repeated param (two `tag` values, say), because the
module's private `build()` uses `append`, not `set`: a test with only
single-valued params passes just as happily against the regression.

### A20 — A Hebrew refusal should say it is one, not be guessed at by alphabet

`toHebrewError(error, map)` resolves in three steps: the map by English prefix
first, then a passthrough for a message that carries a Hebrew letter and no Latin
one, then the generic fallback with a log.

Step two is an inference, and two deliberate refusals now depend on it —
`recordPaymentAction`'s `הקופה שנבחרה לא קיימת או נסגרה.` and the season screen's.
Both survive today because neither happens to contain a Latin character.

**The failure is silent and it is one interpolation away.** A refusal that names
the thing it is refusing — an account called `Petty Cash`, a person's email, a
row id — contains Latin letters, fails the predicate, and is replaced by
`משהו השתבש. הפעולה לא נשמרה.` The lead loses the specific reason, the screen
looks correct, and no test goes red: the assertion that would catch it is one
nobody writes, because the author of the refusal believes they wrote Hebrew and
they did. This is the taxonomy's *instrument that cannot report absence* — the
predicate answers "is this Hebrew?" when the question is "did someone mean this?"

**Ruling: mark the refusal instead of sniffing it.** A `HebrewRefusal` error type,
checked **before** the map, whose message is returned verbatim. This is purely
additive — no signature changes, no existing call site moves — so the two
refusals above migrate to `throw new HebrewRefusal(...)` and nothing else needs
to. The alphabet passthrough stays as a fallback but **starts logging when it
fires**, which turns a silent inference into a visible one and gives us the list
of call sites still relying on it. It can be deleted when that list empties.

**Sequencing: this lands after the current wave-2 lanes, not during.** Plans 07
and 10 are both consuming `src/lib/errors/hebrew.ts` right now. Editing a file
two running lanes depend on is the shared-file collision that this session has
already ruled must serialise — and the fix being additive does not make the merge
safe, only the design.

### A21 — The merge that unblocks plans 11 and 05, and how to know it worked

`main` (`45fa275`) carries wave 2's register correction, plan 11's
`confirmBlock(…, budgetCategory?)` lever, and **migration `0007`
(`block_mappings.budget_category`)**. None of the three is reachable from
`feat/ui-01-foundation`, which is +102/-21 against it. `grep -r budgetCategory
src/ drizzle/` on this branch returns nothing at all.

**Merge `main` in before starting plan 11. Not before the wave-2 lanes drain** —
a tree-wide merge under four concurrent writers costs more than it saves.

Verify the merged result by what the code does, never by what exists:

| check | passing answer |
|---|---|
| `grep -c confirmed-not-promoted src/lib/data/worklist.ts` | non-zero |
| `git diff HEAD main -- src/lib/data/worklist.ts` | empty |
| `confirmBlock` in `imports/[id]/actions.ts` | accepts a 4th `budgetCategory?` arg |
| `ls drizzle/ \| grep 0007` | present |
| full suite, isolated | above **both** parents (this branch 1321, main 890) |

**The migration is a trap with a misleading signature.** The PGlite harness
applies everything in `drizzle/`, so tests that build their own database pick up
`0007` automatically once merged and nothing looks wrong. But a `shliff`-backed
scratch clone taken *before* the merge has no `budget_category` column, and code
reading it against that clone fails as a missing column — which reads like a bug
in the code that was just written, not like a stale fixture. **Any scratch clone
made before the merge is void; take a fresh one after.**

### A22 — Deleting the four dancefloor budget lines is the camp lead's call

Not this session's, and not the peer's. They are real budget rows, four task
references point at them, and no foreign key protects those references.

"The confirm screen is built" is the **start** of the evidence chain, not the
end. Before it is even put to the lead: the screen renders the category on a
branch that actually contains the `confirmBlock` lever; a lead sets
`תקציב רחבה ברן 25` to `dancefloor`; and a dry run on a clone taken *after* that
shows the promoted rows landing as `dancefloor` and staying out of
`budgetTotalAgorot(camp)`. Report the screen; never report the deletion as safe.

### A23 — Plan 05 must not ship its promote-everything button (BINDING, overrides the plan)

Plan 05's file table creates `src/app/(admin)/inbox/bulk-promote.tsx`, "the
promote-everything button". **It does not ship in that shape.**

A peer session cut the live database over on 2026-09-18 and observed, on the
clone rather than by reasoning: re-promoting block `66ad3b61` re-inserts two rows
the promoter fabricates from a summary sub-table, `42,000` and `22,375.30`. Those
sum to `64,375.30`, which is ברן 26's entire budget — **the re-promotion exactly
doubles it, and the cutover script cannot repair it afterwards.**

**Plan 05's own Ruling 2 does not catch this, and it is worth being precise about
why, because the gate looks like it should.** `blocksPromotion(item)` is true for
`sheet-collision`, `block-undecided`, and `sheet-season` with a live `no-season`
refusal — the three states where a *decision is still open*. Block `66ad3b61` has
no open decision. It is confirmed, eligible, and the predicate returns **false**,
so the button is enabled and proceeds. Ruling 2 asks "is anyone still deciding?";
this hazard asks "would doing it again duplicate rows". A gate that answers the
first question cannot refuse the second, and passes it confidently.

**Ruling: until the block's bounds are narrowed or a per-row veto exists (Wave
3), the register may render what promotion *would* do and must not offer to do
it in bulk.** A control scoped to a single un-promoted block is acceptable; a
control that calls `promoteAll` is not. Plan 11's per-file promote is unaffected
— it composes `promoteBlock` over one upload's blocks and never calls
`promoteAll` (its own binding ruling says so).

This is the hazard class the kickoff named — "a dry-run flag that writes to the
live database on page load" — arriving as a button instead of a flag. The
register's whole value is that it tells a lead the truth about what has landed;
a control that silently doubles a budget from that same screen destroys exactly
the trust the screen exists to build.

**Provenance: observed by the peer session on a clone, not re-derived here, and
deliberately not re-tested against live.** The arithmetic was checked
(`42000 + 22375.30 === 64375.30`); the duplication behaviour was not, because
confirming it costs a write to the camp's real money.
