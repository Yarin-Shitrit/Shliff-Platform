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
| `src/components/ui/icon.tsx` | 01 | 0 | all | *(corrected — see A1; this table said `src/components/icon.tsx` and the spec's §C wins)* |
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

### A23a — How strong A23 actually is, stated honestly

A23 is a paragraph in a document. A faithful implementer who reads it does not
build the button; an implementer who misses it builds exactly what plan 05's file
table tells them to build, and nothing in the code refuses. **The camp's budget
is currently protected by an agreement between two sessions, not by a control.**

The right fix is at the action layer: `promoteAllAction` requiring a scope, so
that no page can re-promote `66ad3b61` whatever it chooses to render. That is
this project's own stated principle — make the violation unexpressible rather
than discouraged, the same move as `DestructiveBulkAction` leaving no raw
callback for R8 to be forgotten through. A23 would then be a *consequence of the
API* rather than a promise about a file.

That change is in the promotion lane's half of the repo and has been put to the
camp lead, who declared that work closed. **Until it lands, A23 is the only thing
between a faithful implementer and a doubled budget — treat it as load-bearing,
not as a filed note.** If it lands, this addendum records the signature and A23
relaxes to a consequence.

### A24 — The ticket figure is two incommensurable numbers, and must never render as one

ברן 26's ticket total reads `310,125`. It is `171,000` plus `139,125`.

**The first is the camp's own projection of ticket income. The second is what one
party actually took at the gate.** One is a plan, the other is history, and
**nothing in the schema currently knows the difference** — which is why they were
summed at all.

Any screen that surfaces a ticket figure (08 money, 09 ledger, 05 inbox, 04 home)
**renders them as two numbers that do not reconcile, never as one total.** A sum
of two incommensurable things is a guess wearing a total's clothing, and the
platform's rule against guessing applies to arithmetic exactly as it applies to
name matching: what cannot be resolved becomes a visible decision, not a silent
one. Neither figure replaces the other; do not label either "actual" or
"expected" as though the schema supported the distinction. It does not.

### A25 — A13's gate command is incomplete, and two ways a lane's own tools lied

**The command every plan's gate must use is now:**

```
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=json --outputFile=<unique path per run>
```

Three separate defects made the shorter form untrustworthy, all found on
2026-09-18 while wave 2 ran four lanes concurrently.

**1. `--hookTimeout` does not raise `testTimeout`.** `vitest.config.ts:8` sets
`testTimeout: 20_000`; they are separate options. A suite that builds its PGlite
database *inside the test body* rather than in a `beforeEach` blows the 20s test
cap while every hook sits inside its raised 60s one. The symptom is
`Test timed out in 20000ms` — **Test**, not Hook — so it does not match A13's
stated phantom-failure signature and is a real timeout rather than a fabricated
one. Load-conditional: measured at **28,913 ms** under four lanes, passing inside
20s with two drained. The measurement to trust held concurrent load constant and
varied only the timeout; a re-run under different load varies two things.

**2. `.vitest/json/output.json` is one shared path.** Every concurrent lane
overwrites it, so it reports whoever wrote last. Caught reporting `0 tests,
success: false` for a run whose console said `3 passed` — the file was 42 minutes
stale and held another lane's failed RED step. The false green is the dangerous
direction: a peer's passing run read as your own lets a RED look GREEN and a
commit land on code nobody watched pass. Every run needs its own `--outputFile`.
Note the trap's shape: reading this file is the *correct* workaround for the rtk
hook mangling vitest's console output, so the fix for one broken instrument lands
squarely on a second one, and three separate agents reached for it independently.

**3. `git rm` leaks into other lanes' commits at the staging step.** Two commits
this wave swept another lane's deletions (`c8be2fd`, `4b1ff9a`). `git rm` stages
the deletion immediately into the shared index, where any concurrent `git add -A`
or bare `git commit` carries it off under a message describing neither change.
**Deletions use plain `rm <path>` then `git commit -- <path>`.** Never `git rm`,
and never `git add -A`, while another lane is running. Content always landed
correctly; only the labels were wrong, and rewriting shared history under
concurrent writers is worse than a mislabelled commit.

**Plus a twelfth unfailable test, and the best-disguised one yet.** Plan 07's
Task 6 asserted a delete confirmation by querying `getByRole('dialog')` — but the
kit's `ConfirmDialog` is an `alertdialog`, and the `Drawer` behind it is the
`dialog`. The query matched the drawer, whose own text already carries the
amount, channel, date, name and every account option. **Every assertion passed
against a build with no confirmation step at all.** Fixed in Tasks 6 and 7.

### A26 — Kit gap: a totals row cannot be named

`Table`'s `<tfoot>` has no accessible name, so a totals row cannot be queried or
announced as `סיכום`. Reported by plan 07 rather than patched, since the kit is
read-only to screen lanes. Decide it when a plan needs a named footer.

### A27 — `toHebrewError` cannot see the error it is being asked about

**Two lanes hit this independently, which is what makes it systemic rather than
incidental.** Drizzle throws `DrizzleQueryError`, whose own `.message` is the
parameterised SQL text (`Failed query: insert into "seasons" (...) ...`). The
driver's real message — and `constraint`, and `code` — sit on `.cause`.
**`src/lib/errors/hebrew.ts:34` reads `error.message` and never walks the
chain.** So every map keyed on a Postgres constraint violation silently misses,
and a lead gets the generic fallback for exactly the failures a screen most wants
to explain.

Three treatments now exist in the tree, which is two too many:

1. `src/lib/errors/hebrew.ts` — reads `.message` only. The shared module, and the
   one that is wrong.
2. `src/app/(admin)/tasks/failure-messages.ts` — plan 10 wrote a bounded
   innermost-cause unwrapper (cycle-guarded). **The correct fix, in the wrong
   place**: it is local to one screen.
3. `src/app/(admin)/shell/actions.ts:96` — the season screen matches the prefix
   `Failed query: insert into "seasons"`, i.e. the *wrapper's SQL*.

The third deserves care, because its author reasoned about the risk and wrote the
reasoning down: `name` is argued to be the only constraint that insert can still
violate after the preceding validation. That is true today. **But it is an
invariant held by a comment.** Add a constrained column, or let a validation
check drift, and the screen tells a lead `כבר קיימת שנה בשם "X".` for a failure
that has nothing to do with the name — a wrong Hebrew message delivered
confidently, which is worse than the fallback it replaced. The platform's rule
against guessing applies here: a specific cause claimed from a generic symptom is
a guess.

**Ruling: one task, after wave 2 drains, consolidates all of it.** Move plan 10's
unwrapper into `src/lib/errors/hebrew.ts`; add A20's `HebrewRefusal` sentinel in
the same pass, since it is the same module and the same seam; migrate the season
screen to match on `.cause.constraint === 'seasons_name_unique'` rather than SQL
text. Plan 10's local unwrapper then collapses into the shared one.

Sequenced, not immediate: plan 06 is still consuming this module.

### A28 — Two kit gaps three screens have now worked around

**No date, number or select control.** `src/components/ui/` has `field.tsx` and
nothing else for input. The season drawer, the new-task drawer and the fees
drawers have each dropped a native `<input type="date">`/`number` inside the
kit's `Field`, styled from `field.module.css`'s tokens. Three independent
workarounds to the same gap is the signal that the control is real; it was
correct not to invent it mid-lane, and it should be built before wave 5's polish
sweep rather than during it.

**`Popover` cannot host a multi-select.** `popover.tsx:168` closes on any click
whose target matches `a, button`, so a popover whose options are buttons closes
on the first selection. Plan 10 hand-rolled the assign popover for this reason
and asked for a second opinion: **affirmed** — a multi-select that closes on each
pick is unusable, and the kit's rule is right for the menus it was written for.
The kit should eventually take a dismissal policy rather than hard-coding one;
until then, hand-rolling with the same keyboard and focus behaviour is correct.

### A29 — The gate command, fourth and final correction

```
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=default --reporter=json --outputFile=<unique path per run>
```

**`--reporter=json` alone REPLACES the default reporter.** The run then loses the
console summary *and* the `Unhandled Errors` block. On this machine the real
failure mode is a worker `SIGKILL` under memory pressure — which is an unhandled
error — so the process exits 1 while the JSON reports `numFailedTests: 0` and
nothing on screen says why. One such run printed seven `Some tests are still
running when generating the JSON report` warnings and claimed
`total 1662, passed 1614, failed 0`: **48 tests unaccounted for.**

**Always cross-check the exit code against the failure count. A non-zero exit
with zero failed tests means workers died, not that the suite is green.**

**And a killed worker's un-run tests are reported `pending`, not failed.** 32
tests across four files came back skipped during the four-lane wave
(`budget.test.ts` 17, `link.test.ts` 6, `roster.test.ts` 5, `worklist.test.ts`
4); re-run alone they were 74/74 with zero pending, and **no `.skip` existed in
any of the four files**. Verify that before believing a skip. This is the
nastiest disguise of the four, because a failure demands investigation while a
skip reads as somebody's deliberate choice — the suite stays green and the
missing coverage is invisible.

**Worth stating plainly: this command has now been wrong four times, and each
fix introduced the next fault.** Uncapped workers fabricated ~110 hook timeouts →
capping exposed a `testTimeout` the hook flag does not raise → reading the JSON
to dodge the rtk console mangling landed on a path every lane overwrites →
isolating the JSON with `--reporter=json` silently dropped the unhandled-error
block. Every one of the four looked like the fix for the last. **The lesson is
not the flags; it is that a measurement instrument needs its own oracle, and the
cheapest one here is a second reporter that fails differently.**

### A30 — A lane verifies its own scope; only the controller runs the full suite

Wave 3's three lanes all died at the 600s stream watchdog within minutes of each
other. None had a code problem: each was running a **full-suite** verification,
concurrently, on a box with under 1 GB of free swap. Three suites of ~1,760 tests
spinning up their own PGlite instances is roughly three times the memory the
machine had left, so the kernel started killing workers and every lane stalled
waiting on output that would never come.

**Dispatch rule for every remaining wave: a lane runs only the suites in its own
scope. The full suite is the controller's, run once at the wave gate.** Put this
in the dispatch prompt — an agent cannot discover it, because from inside one
lane a full-suite run looks like diligence rather than like a third of the box.

Two honest notes on cause. The controller had just restarted `shliff-pg` on the
lead's approval, which added pressure to an already-thrashing box; the restart
was correct and approved, but it was a contributing factor and not an innocent
bystander. And the watchdog message itself — *"no progress for 600s"* — points at
the agent, which is the wrong place to look: the agent was fine and the machine
was out of memory. That is the same misdirection as a stopped container reading
as your own diff.

**Recovery that worked, and should be reused:** re-establish ground truth from
`git log`, `git status` and a real `tsc` run, **never from the agent's last
message**. Here all seven of one lane's commits had landed while its final words
were "now the full-suite verification", and another lane's three files sat
uncommitted while its last words were "13/13 green". Verify by content, not by
report: `grep -c HebrewRefusal src/lib/errors/hebrew.ts` settled in one command
what the report could only assert.

### A20a — The sentinel has landed; three live call sites remain, and they were already broken

A20 and A27 are implemented (eight commits, `08e9d4d`..`f2414f3`). The shape
plans 09/11/05 write against:

```ts
export type HebrewErrors      = ReadonlyArray<readonly [prefix: string,     hebrew: string]>;
export type HebrewConstraints = ReadonlyArray<readonly [constraint: string, hebrew: string]>;
export class HebrewRefusal extends Error {}
export function isHebrewRefusal(value: unknown): value is HebrewRefusal;
export function toHebrewError(error, map: HebrewErrors, constraints: HebrewConstraints = []): string;
```

`constraints` is a **third optional argument**, so every two-arg call site is
untouched. Resolution order: refusal (**outermost** first — a refusal is a
decision, and the outermost was made with the most context) → constraints
(**innermost** first) → prefix map (innermost, then outward) → alphabet
passthrough, which now **logs** → fallback. Constraints match **exactly**, never
by prefix: they are identifiers, and `seasons_name_unique` beginning with
`seasons_name` is spelling, not kinship.

**`causeChain` is deliberately not exported, and no screen may reimplement one.**
`toHebrewError` walks the chain itself; a caller that unwraps first loses both a
marked refusal on an outer link and the wrapper's own message. Plan 10 had
exactly that defect and `3bdc02f` removed it.

**Three library throws were already losing their message, today, before any of
this.** They interpolate a uuid, and a uuid is hex:

| site | message |
|---|---|
| `src/lib/money/summary.ts:57` | `עונה לא נמצאה: ${seasonId}` |
| `src/lib/money/obligations.ts:180` | `חוב לא קיים: ${input.obligationId}` |
| `src/lib/money/funding.ts:152` | `עונה לא נמצאה: ${seasonId}` |

The passthrough requires a Hebrew letter **and no Latin letter** — the Latin test
exists so that a driver message like
`invalid input value for enum payment_channel: "מזומן"` is not echoed raw, since
this schema's own enum labels are Hebrew. A uuid always contains `a`–`f`, so all
three fail the predicate and a lead sees `משהו השתבש. הפעולה לא נשמרה.` instead
of the reason. Confirmed by measuring the two predicates, not by reading them.

**This is the clearest vindication of A20 available: the hazard was not
hypothetical and not future — it was already shipping in three places, and
nothing was red.** Assigned to plan 09's lane, which owns all three files. The
~11 other bare-Hebrew library throws carry **static** strings, contain no Latin,
and are safe; they are not to be changed opportunistically.

### A22a — Correction: the dancefloor evidence chain has not started

**A22 said plan 11's confirm screen rendering the budget category would unblock a
decision about the four dancefloor lines. That screen did not exist when A22 was
written, and still does not.** Plan 11's Tasks 1-11 built plumbing only:
`BlockStateRow.budgetCategory` reads from the **mapping**, never from a promoted
row; no control sets it and no screen shows it. The confirm screen is Tasks 13
and 15, dispatched separately and later.

**Nothing currently makes deleting those four rows safe, and no part of the
evidence chain has begun.** The chain, restated so nobody shortens it again: the
screen renders the category on a branch carrying the `confirmBlock` lever → a
lead sets `תקציב רחבה ברן 25` to `dancefloor` → a dry run **on a clone taken after
the cutover** shows those rows landing as `dancefloor` and staying out of
`budgetTotalAgorot(camp)` → the camp lead decides. Four task references point at
those rows with no foreign key protecting them.

**How this was got wrong is worth more than the correction.** The controller's
dispatch asserted the screen was in the lane because the controller believed the
lane was the whole plan. It was not — see A31. An implementer inheriting that
assertion would have had every reason to repeat it.

### A31 — Plan 11 has 15 tasks; four of them were never dispatched

The shell hook's filtered `grep` truncated a plan's task list to 11 rows **and
reported the match count as 11**. The file has 15. `rtk proxy grep -c` and
`grep … | wc -l` both say 15. Acting on that reading, Tasks 12-15 — the review
master-detail, the column mapping, the raw grid, and the pre-flight with the
promote button — were never assigned. They are now dispatched.

A truncated list that announces itself costs nothing. One reporting a count that
matches its own truncation is indistinguishable from a complete answer. **Take no
count that decides scope from a hook-filtered `grep`**: use `| wc -l` or
`rtk proxy grep -c`. Other plans were checked and none were affected — every
other task list fell under the cap.

### A32 — I13's guarantee is one projection, not one mechanism (RULING)

I13 says `register.ts` **re-labels** `worklist` rather than re-deriving. Plan 11
reports this is not literally implementable, and the reasons hold:
`WorklistRow` carries no `confidence`, `mappingSource`, `columnMap` or
`confirmedAt`, so `needs-review` versus `recognised` versus `blocked` cannot be
recovered by relabelling. **And `worklist` dry-runs every confirmed block, which
a file list must not do per page load** — that is precisely the hazard the
project was warned about, a dry run firing on render.

**Ruling: I13's guarantee is that exactly one block-state projection exists, that
plan 11 owns it, and that it and `worklist` agree on what `promoted` means —
rows counted in the four target tables, never rows a dry run predicts. The
re-labelling mechanism is not binding.** Plan 05 consumes plan 11's projection
and does not call `worklist` for file-list purposes. Plan 11's implementation as
specified satisfies the guarantee and stands.

**Also caught, and worth recording because the failure was silent:** the plan's
`blockState` precedence was wrong — an unconfirmed `unknown` block read
`no-promoter`, which `reviewStep` treats as settled, so **a file of unclassified
tables would have reported zero open decisions and read as finished.** That is
the platform's first rule inverted: what the system cannot resolve was being
presented as nothing to decide. Corrected and pinned by two new tests, with every
original assertion still passing.

### A33 — `?season=all` is permitted (RULING), and a report correction

**Ruling: `?season=all` is a legitimate value of the season parameter and does
not violate R5.** R5 requires that the chosen season survive a drawer, a filter
and a navigation; it does not require that the choice always be a single season.
R4 is the reason: a season is a **hand-set label on a continuous ledger**, so a
running balance is only *true* when computed across that continuum. A column that
can only be correct unfiltered, on a page that always resolves one season, is a
column that can never appear — and shipping an unreachable figure is worse than
shipping none. The lane added a visible affordance on the season chip and a test
pinning it; both are required, because an all-seasons view that does not say so
on screen is exactly the silent state the platform forbids.

**The A20 defect class is now closed in `src/lib/`.** All three uuid-interpolating
refusals are `HebrewRefusal`, each with a comment saying why, and a sweep for
`throw new Error(\`…${…}\`)` containing a Hebrew letter returns **zero**. The
remaining bare-Hebrew library throws carry static strings, contain no Latin, and
are correctly served by the passthrough.

**Correction — "grep cannot match Hebrew in this environment" does not
reproduce.** Plan 09 reported it after a real zero-match against a file provably
containing the string. Tested three ways against a `node` oracle: literal `grep`,
`grep -F` and an `[֐-׿]` range class all match correctly, and a real repo string
(`עונה לא נמצאה` in `summary.ts:62`) greps fine. Unicode normalization is not the
cause either — NFC and NFD are identical for unpointed Hebrew.

**So the general claim is false and the specific observation was real, and the
cause is undetermined.** Most likely the shell hook's output filtering, which has
now been caught eliding source lines and truncating `grep` match counts — but
that is a hypothesis, not a measurement, and this document does not record
hypotheses as causes. Verifying Hebrew with `Read` or `node` costs little and is
robust against every candidate; do that when it matters.

### A34 — The per-file promote covers `confirmed` blocks only (RULING)

`promoteUpload` filters `b.state === 'confirmed' || b.state === 'promoted'`, so
the per-file button **re-promotes blocks that already promoted**. Plan 11 found
the symptom — the button counted 1 while the action touched 4 — and made the
count match the action. **That is the wrong direction, and the mechanism says
why.**

`promoteBlock` deletes a block's prior rows before writing, which makes
re-promotion idempotent — **except for rows something else references.** Those
are `retained`, not deleted (`promote.ts:251`). Re-promoting a block whose rows
are referenced can therefore keep the old rows *and* write new ones. That is not
a variant of A23's hazard; **it is the same hazard.**

**CORRECTED 2026-09-19 — the precondition matters and this section originally
understated it.** A *plain* repeated press does **not** duplicate. `staleRows`
skips rows the run itself produces, so the retained class is never entered
(`deleted: 0, retained: 0`), and the upsert on `(source_block_id, source_row)`
refreshes each row in place, id and all. Measured on a rolled-back probe against
the real dancefloor block: a plain re-promotion re-creates only the junk row,
`93,370 → 98,920`.

**The duplication requires that the produced row set stop matching what is
stored.** Forcing that — moving one referenced row's `source_row` off the
produced set — reproduces it exactly: `retained: 1`, a second מייצג written
beside the retained one, the task still following the old row,
`93,370 → 140,220`. **So the trigger is a re-detection — changed block bounds, or
a re-import that shifts a `source_row` — not a re-confirm and not a repeated
press.**

The ruling below is unchanged and still right: a re-import followed by this
button is exactly the dangerous sequence, and the button cannot know whether one
happened. But the risk sits in **anything that changes which rows a block claims
to produce while rows are already stored against the old numbering**, not in
pressing promote twice. The A34 fix's own implementer said as much — "the
duplication bites when the re-run differs from the original, which is the only
reason to re-run at all" — and this document under-weighted it.

**Ruling: the per-file promote button covers blocks in state `confirmed` only.
Its count and its action must be the same set — narrow the action, not widen the
count.** Re-promoting an already-`promoted` block stays available as a
**single-block** action on the review screen, which already renders that block's
`deleted` and `retained` counts. That is the difference that matters: a per-block
re-promotion shows what it will keep and what it will replace, so a lead consents
to a known outcome; the per-file button hides it behind one number.

This preserves the real workflow — a lead who edits a sheet can still update its
rows — while removing the path where one click silently duplicates money nobody
was shown.

**Both of plan 11's lying numbers were found by running against the real
database, and neither was findable by any test in this repo.** The other:
`promoteBlock` refuses an unconfirmed block whole, so the button read
`אישור וקידום 0 שורות` on exactly the blocks the review screen exists to review —
and then wrote 24 rows. A button that promises nothing and writes 24 is the
platform's first rule inverted twice over.

### A35 — A repo-wide test hazard: spy call history does not accumulate here

Plan 11's missing-key test could not fail, for two independent reasons, and the
second is general: **vitest clears spy call history between tests in this
repo's configuration.** Any test that reads accumulated `mock.calls` from work
done in an *earlier* test is asserting against an empty array and passes
vacuously. (The first reason was narrower: React dedupes its key warning per
owner component.) Rebuilt in its own file with a positive control and
mutation-verified. **Audit for this pattern when a test asserts on a spy it did
not itself exercise.**

### A36 — "מוכן לקידום" is claimed without checking the one thing that would refuse it

Found in a browser, on live data, on a screen that had never been opened.

`/imports` shows `קופת קאמפ 23'-24'.xlsx` as **מוכן לקידום**, 10 of 10 tables
approved. **All eight of that file's sheets have `season_id IS NULL`** (verified
in SQL). Promoting it would refuse every budget and ticket row with `no-season` —
the largest single refusal category in the real data, 96 of 234, 41%.

`uploadStatusLabel` (`src/lib/import/uploads.ts:68-81`) decides the word from
`confirmedCount === blockCount` and nothing else. Confirmation is a statement
about tables; a season is a statement about sheets. **The label answers the first
question and is read as answering the second.**

This is A15's shape at the file level: a status claiming readiness for an action
that would refuse everything. The platform's rule is that what the system cannot
resolve becomes a **visible decision**, not a silent one — and an undecided season
is the decision, sitting one screen away, while the file says it is ready.

**The fix is not to relabel this file "refused".** The camp lead has deliberately
left ברן 23/24 unlabelled, so those 96 refusals are expected and permanent for
now; a red status would be just as wrong in the other direction. The status must
say what is actually true — that this file is waiting on a season decision before
promotion can write anything — and it must be derived from the sheets' season
state rather than assumed from the table count.

Note the existing tests in `uploads.test.ts` **pin the current behaviour**, so
they must be changed deliberately, not worked around.

**Third defect this browser pass has found that no test could.** The others: the
sign-in logo broken by the auth guard matching `public/`, and the per-file
promote re-promoting already-promoted blocks (A34).

### A37 — The 96 `no-season` refusals are being retired, not fixed

The camp lead chose to **retire (bookmark) the eight ברן 23/24 sheets** rather
than invent a flat rate and camp size for two closed years. Inventing those
figures would change what the dues and per-head numbers say about those years,
which is the platform's first rule applied to history rather than to a name.

Landing on `main` as `drizzle/0008` (two nullable columns, `sheets.retired_at`
and `sheets.retired_by`). **This branch stops at `0007`, so a migration generated
here before that merge must be `0009`.**

Consequences for plan 05 and anything downstream:

- `sheetsNeedingSeason` and `collisionGroups` exclude retired sheets; their blocks
  drop out of `coverage`. The rail loses 96 items it could never resolve.
- **A15's instruction not to calibrate copy against pre-correction numbers now has
  a second edge.** `no-season` is 41% of all refusals today and is about to be
  near-zero. Copy, empty states and any "most common refusal" phrasing must read
  correctly at both ends, or derive the superlative instead of naming it.
- `worklist` gains `BlockState = 'retired'`, deliberately, so a lead can see what
  they retired and undo it. **The register needs a quiet place for retired blocks,
  not silence** — a retirement that disappears is a decision made invisible.
- `SkippedBlock.code` gains `'sheet-retired'` beside `'already-promoted'`.

**The design decision is the part worth keeping, and it is not the obvious one: a
retired sheet's blocks are skipped, not refused.** A whole-block refusal
*releases* that block's rows — the sweep runs with an empty produced set and
deletes whatever the block wrote before — so retirement-as-refusal would have
silently destroyed money rows already derived from those sheets. Their test
promotes a block, retires its sheet, promotes again, and asserts the rows survive.

Generalise it: **before making any state turn a block into a refusal, ask what
the sweep does with the rows that block already wrote.** This is the same shape as
A34 — there, rows something references are *retained* rather than deleted, so
re-promotion duplicates; here, rows are *released* rather than retained, so a
refusal deletes. Both are the deletion path answering a question the caller did
not know it was asking.

Also landing: ברן 25's dancefloor total becomes the workbook's own figure
**93,370** (89,060 plus six real expenses the seed never captured, with a VAT row
deleted as junk). Any screen showing that total changes.

### A38 — Two gaps that could not close additively, and one is a silent failure

All eight reported kit gaps are closed (`9dcbbd3`, `3905cf3`, `8640b8a`,
`4841a85`, `b93cacf`, `1bcd5ca`, `6526434`, `e1186c4`), strictly additively, each
with a guarantee snapshot taken against the pre-change implementation. Two things
underneath them could not be, and were reported rather than forced.

**1. `ConfirmDialog.action` cannot accept this codebase's own Server Actions.**
It is typed `(formData: FormData) => void | Promise<void>`; every action here
returns `ActionResult`, so `unlinkAliasAction.bind(null, id)` fails with TS2322.
Widening it changes an existing prop's type, which was forbidden while a lane was
building against the kit. **Every server-rendered dialog therefore needs an inline
`'use server'` wrapper** — the pattern at `src/app/signin/page.tsx:36`. Fix the
type deliberately, when no lane is mid-flight.

**2. A refusal returned by a bound Server Action is silent, and that is the
platform's first rule broken.** A plain `<form action>` has nowhere to put an
`ActionResult`. On the alias-unlink dialog every clickable path returns
`{ ok: true }` because the screen withholds the control for the last-alias case —
but a hand-typed `?unlink=` carrying a foreign alias id **fails with no feedback
at all.** Not an English message on a Hebrew screen; *no* message.

**Ruling: a server-rendered dialog may not swallow a refusal.** Until the kit has
somewhere to put one, a screen that renders a `ConfirmDialog` against a Server
Action must either (a) prove every reachable path returns `ok`, and say in a
comment which guard makes that true, or (b) redirect back with the refusal in the
URL for the page to render — the mechanism `/signin` already uses. **Option (a) is
a claim about the screen's guards, so it expires the moment a new entry point is
added; prefer (b) for anything a URL can reach directly.**

This is the same shape as everything else in this document: the failure is not a
wrong answer, it is the absence of one, and nothing goes red.

**A note on the tsc red this lane reported:** it saw `src/lib/members/link.test.ts`
fail on a `splitAlias` export that was in fact present — it had read a peer lane
between that test and its implementation. Correctly diagnosed as a moving
referent rather than filed as a defect. The 15 current `tsc` errors are the inbox
lane mid-RED (`Cannot find module './items'`) and will clear.

### A34a — The mirror rule, and why the per-file button is already safe

A peer landing the dancefloor table re-points four `tasks.budget_line_id`
references from the seeded rows onto the promoted ones — it must, or the
references dangle. **That makes those four promoted rows referenced rows**, so
block `fa78b9be` becomes eligible for A34's hazard by construction.

**CORRECTED 2026-09-19 — `186,740` was wrong, and so was the framing.** A plain
re-promotion of that block does not double it: `staleRows` skips rows the run
itself produces, so nothing is retained and the upsert refreshes each row in
place. Measured on a rolled-back probe, a plain re-promotion re-creates only the
junk row — **`93,370 → 98,920`**. Doubling requires the produced row set to stop
matching what is stored; forcing that gave `retained: 1` and
**`93,370 → 140,220`**, not `186,740`. See A34's correction: the trigger is a
re-detection or a re-import that shifts a `source_row`, not a repeated press.

**Verified that this branch's per-file promote cannot do that**, end to end rather
than by assurance:

1. `promoteUpload` filters `state === 'confirmed'` (A34).
2. `blockState` returns `'promoted'` whenever `promotedRows > 0`, and
   `'confirmed'` only otherwise (`register.ts:87-88`).
3. `promotedRows` is a real `count(*)` over the four provenance tables keyed on
   `source_block_id` — rows that exist, never rows a dry run predicts.

So `confirmed` ⟺ **the block owns zero rows**, and the button already skips every
block that owns any. That is the same guarantee as `promoteAllGated`'s explicit
row count, arrived at through the state rather than through a second check — and
the dialog already names what it is skipping and points at the per-block path.

**The mirror rule, which belongs beside A37's:**

> Before making any state turn a block into a **refusal**, ask what the sweep
> does with the rows that block already wrote.
> Before making any path **re-promote** a block, ask whether anything references
> its rows.

**And the sharpening that makes both necessary: the sweep's two failure modes are
selected by whether anything points at the row, and nothing in the caller's
request says which it will get.** Released → a refusal deletes. Retained → a
re-promotion duplicates. A caller asking "promote this block" is unknowingly also
asking "and do you happen to be referenced?" — a question it has no way to ask
and no reason to know it is asking.

### A39 — Plan 04's outcomes, and three things it surfaced

Tasks 3-8 complete (`2e7f8df`, `d1eb34b`, `72e9151`, `d357867`, `1fb38c6`,
`1717639`). **Tasks 1 and 2 were confirmed already done and were not rebuilt** —
`coverage.ts` carries I1's capping rule and `summary.ts` carries I6's
`UnpaidMember` with all seven fields. Both rulings held in practice, which is the
first time they have been tested by a lane that could have duplicated them.

**Task 9 needs rewriting before anyone runs it.** Its plan text predicts
`openDecisions(db, seasonId, limit)`; **I2 rules the register exports
`loadInboxItems(db, seasonId)` and `openDecisionCount(items)`**, and I2 wins. The
task is one file of wiring, so the rewrite is small — but a faithful implementer
would write against the plan and find nothing to import.

**Three findings worth carrying:**

1. **`StatTile` has no `warning` slot.** The plan's sample composes one; the
   shipped kit does not have it, so the lane composed the warning into
   `derivation` instead. R3 is still satisfied (a sentence plus a glyph), but it
   is a real kit gap, recorded not patched.
2. **`EmptyState` owns its own copy, so a screen cannot supply a bespoke
   all-clear sentence.** `אין מה להכריע`, `כל המשימות מאוישות` and `כולם שילמו`
   do not appear anywhere — all three render the kit's `הכול מטופל`. Since
   `all-clear` carries no season, each panel head now carries the season as a
   scope chip instead. This is C10 working as designed, and three plans have now
   written copy the kit will not use.
3. **`src/lib/work/labels.ts` is a fourth task-kind label map** (two in
   `tasks/rows.ts`, one local in `members/[id]`). The plan asked for it as the
   library home and the file says so. **Ruling: it is the library home and the
   other three collapse into it — but not now.** Consolidating touches three
   lanes' files; plan 12's sweep is where it belongs.

**Also: the page-title net caught a fresh regression within the hour.**
`src/app/(admin)/inbox/page.tsx` shipped `title: 'לטיפול · קופת שליף'`,
duplicating the suffix the root template appends — the same bug two members pages
carried for the whole redesign. The original net asked whether a page *exports* a
title and could not see it; the widened net names the offending file. That is the
difference between asserting presence and asserting correctness, and it is now
load-bearing rather than theoretical.

### A40 — `npm ci` cannot install a working test runner

`package-lock.json` contains **two** rolldown entries, `rolldown` and
`@rolldown/pluginutils`, both resolved. It contains **none of the fifteen
platform bindings** — no `@rolldown/binding-darwin-arm64` and no sibling. So a
clean `npm ci` installs no native binding and **vitest cannot start at all**.
It is invisible on this box because an older `npm install` left
`node_modules/@rolldown/binding-darwin-arm64` behind. `lightningcss` reportedly
has the same gap.

Confirmed by reading the lockfile, **not by running `npm ci`** — doing that would
wipe `node_modules` out from under running lanes.

**Not fixed here, deliberately.** Regenerating the lockfile moves roughly 40
versions, including vitest 5.0.0→5.0.1, vite 8.2.2→8.3.0 and rolldown→1.2.9. That
is a dependency change under R1 and it is the camp lead's call, not a side effect
of a UI wave. **Schedule it after Phase 4**, and note it gets more pressing the
moment CI runs a build rather than only a test.

The failure mode to recognise: on a fresh clone it will not look like a
dependency problem. It will look like vitest being broken.

### A41 — Plan 04 is complete, and I2's cost is now visible on the landing page

Task 9 landed (`e5f2e1d`): 51 tests, four mutations all caught — panel href losing
the season, a row action pointed at the wrong route, `.filter(blocking)` dropped
from the preview, and `total` counted from the six rows drawn rather than from
the register.

**How it handled an unreachable state is worth copying.** `InboxPreview` could
render an empty list when `total > 0` and `items` is empty. Wiring does not make
that reachable — `previewOf` derives both numbers from one `loadInboxItems` call,
so `total > 0` implies at least one row by construction. Rather than delete a
guard it could not reach, it made **the invariant** testable: the mutation that
would make the state reachable is a `total` counting notices as decisions, and
that mutation is now red. The guard stays, and the reasoning lives in the
component and its test rather than only in a report.

**The cost I2 implies is now real and should be measured before it is defended.**
The home performs the register's entire read per request — block states,
collisions, seasonless sheets, arithmetic flags, unnamed debts, unlinked names, a
name suggestion per name, and a copy diff per collision. That is exactly what I2
instructs (one `loadInboxItems` per request, derive the rest, no third query) and
it runs **no** promoter dry run, which was the hazard I2 was written against. But
it is now by far the heaviest read on the first screen a lead opens, and "it is
what the ruling says" is not the same as "it is fast enough". Measure it against
the live database before wave 5 closes; if it needs a cheaper path, that is a new
ruling, not a quiet exception to I2.

**Also in flight: plan 12 has made `Table`'s `card` slot required.** Its own
comment gives the reason — "a missing `card` is a compile error, not a storm with
one hand free" — which is this project's enforcement-by-subtraction principle
applied to the phone layout: a column that forgot how it reflows cannot compile.
It is a deliberate breaking change to the kit, correct for the last plan in the
wave when no other lane depends on the old shape, and it leaves 55 errors across
nine call sites until that task finishes. **A tree with 55 type errors mid-task
is expected here and is not a defect** — but it is also the state that would be
left behind if the lane died, so it is worth knowing it is recoverable with
`git checkout -- src/components/ui/table.*`.
