# Cutover evidence — what the promoter would write, and what no block re-creates

Taken 2026-09-17 against a clone of the live `shliff` database, before anything
is deleted. Produced by `scripts/dry-run-promote.ts`.

The cutover's one real failure mode is deleting a seeded fact that no workbook
block re-creates, and no test can see it: tests run on a fresh `createTestDb()`
where the seed and the promoter never coexist. This document is the diff taken
against the live data instead.

**Read the "What Task 13 may delete" section last and act only on it.** The
short answer is that it may delete far less than the plan assumed.

---

## How this was produced

```bash
# 1. Clone. Never the live database.
docker exec shliff-pg psql -U shliff -d postgres \
  -c "drop database if exists shliff_evidence;" \
  -c "create database shliff_evidence template shliff;"

# 2. Migrate the CLONE only. 0000-0001 were applied by `drizzle-kit migrate`
#    and 0002-0004 by `drizzle-kit push`, so the journal knows only the first
#    two; the three pushed ones are recorded in the clone's journal by hash so
#    that `migrate` proceeds to 0005 (sheets.season_id / authoritative) and
#    0006 (obligations.opened_on nullable).
DATABASE_URL=postgres://shliff:<pw>@localhost:5433/shliff_evidence \
  ./node_modules/.bin/drizzle-kit migrate

# 3. The evidence run.
DATABASE_URL=postgres://shliff:<pw>@localhost:5433/shliff_evidence \
  npx tsx scripts/dry-run-promote.ts
```

The script refuses to start when `DATABASE_URL` names the database `shliff` —
a thrown error before `@/db` is even imported, not a comment. Every promotion
inside it runs with `dryRun: true`.

### The live database is untouched

```
$ docker exec shliff-pg psql -U shliff -d shliff \
    -c "select count(*) from ledger_entries where source_block_id is not null;"
 0
   budget_lines  → 0        ticket_rounds → 0        obligations → 0
   blocks: 29, confirmed: 0        layout_signatures: 0
```

The brief's second check cannot be run as written against live:

```
$ docker exec shliff-pg psql -U shliff -d shliff \
    -c "select count(*) from sheets where season_id is not null or authoritative is not null;"
ERROR:  column "season_id" does not exist
```

**That error is the proof.** Migrations 0005 and 0006 have never been applied
to `shliff`; the columns a label would live in do not exist there, so no label
can exist either. `information_schema` agrees: 0 columns named `season_id` or
`authoritative` on `sheets`.

---

## The judgement this evidence assumes

Everything below depends on three hand-made decisions. They are in the script
as `SEASON_BY_SHEET`, `AUTHORITY_BY_SHEET` and `REPICKS`, each with its
reasoning; change them and the numbers change.

### Seasons — 11 of 19 sheets labelled, 8 deliberately not

| workbook | sheet | season |
| --- | --- | --- |
| קופת קאמפ 2026 | סיכום כללי | ברן 26 |
| קופת קאמפ 2026 | תקציב קאמפ ברן 26 | ברן 26 |
| קופת קאמפ 2026 | תקציב קאמפ ברן 25 | ברן 25 |
| קופת קאמפ 2026 | SuperNature 18.7 | ברן 26 |
| קופת קאמפ 2026 | SuperNature 3.10 | ברן 26 |
| קופת קאמפ 25’ | סיכום כללי | ברן 25 |
| קופת קאמפ 25’ | תקציב קאמפ ברן 26 | ברן 26 |
| קופת קאמפ 25’ | House of trance 270925 | ברן 25 |
| קופת קאמפ 25’ | Halloween Underground 311025 | ברן 25 |
| קופת קאמפ 25’ | תקציב רחבה ברן 25 | ברן 25 |
| קופת קאמפ 25’ | תקציב קאמפ ברן 25 | ברן 25 |
| קופת קאמפ 23'-24' | **all eight sheets** | **UNSET** |

The two `סיכום כללי` sheets carry different years' movements (2026-06…08 and
2025-05…10), so they are two sheets that share a name, not two copies of one.
The event sheets are placed by their own net figures matching a dated ledger
row (`House of trance` 34,646.55 → 2025-09-27; `Halloween` 15,660 → 2025-10-30).

**Finding — the eight ברן 23/24 sheets cannot be labelled at all.** Their
seasons are ברן 23 and ברן 24, and `seasons` holds only ברן 25 and ברן 26: the
seed refuses to create a season whose flat rate no workbook records. A lead
must either create those two seasons (deciding what their dues were, which no
sheet says) or accept that a third of the workbook corpus stays unlabelled.
The cost is visible below: 96 of the 258 refusals are `no-season`.

### Authority — two contested groups

| sheet | authoritative copy | why |
| --- | --- | --- |
| תקציב קאמפ ברן 26 | קופת קאמפ 2026 | its figures are the ones the camp acted on and the ones the seed used (מילוי מי שתייה 5 × 590, מקרר 0, הובלה 9,000). The 25’ copy is an earlier revision (4 × 590, מקרר 1,000) |
| תקציב קאמפ ברן 25 | קופת קאמפ 25’ | complete: totals 59,587 including the 5,954 `תקציב הפתעות` line the 2026 copy leaves blank (53,633), and it is the only copy carrying the exceptions and reimbursement columns |

`סיכום כללי` needs no authority decision once the two copies hold different
seasons — `conflicts()` stops treating them as rivals.

### Archetype re-picks — exactly one

`תקציב רחבה ברן 25` A1:D26 (`fa78b9be`), `event_lines` → **`budget_lines`**.
It is the dancefloor's budget: `תיאור | סכום | אחראי` over מייצג 41,300,
חשמל 12,950, הגברה + תאורה 30,810, הובלה 4,000 — precisely the four
`dancefloor` lines the seed wrote. `event_lines` has no promoter at all.

**The recomputed column map is right, and the category is wrong.**
`applyConfirmation` recomputed `item=c1 total=c2` from the block's stored
header row 2 — correct; `אחראי` is left unmapped, which is right, because
`budget_lines` has no owner column. But `budgetRow` hard-codes
`category: 'camp'`, so all four dancefloor lines come back categorised `camp`.
See the budget_lines table below.

---

## The four questions, answered

### 1. Do the twelve ברן 25 reimbursements come from an `obligations` block or a `budget_lines` block?

**Neither, in the sense the spec meant — and the spec's assumption is the
closer one.** They live in columns H, I and J of
`תקציב קאמפ ברן 25` in `קופת קאמפ 25’.xlsx`, inside block `254bef9f`, which is
a **`budget_lines`** block spanning A1:J32. They are not a block of their own
and no `obligations` block anywhere in the corpus contains them.

Rows 3–14 of that block each hold a budget line in columns A–D *and* a
reimbursement in columns H–J:

```
r3:  שירותים נסורת | 3 | 125 | 1375 | כן | מזומן | 17591 | אורי שולם | 300  | שווארמה הקמות
r13: הובלה         | משאית הלוך חזור | 4000 | 4000 | כן | מזומן | · | יובי שולם | 580 | גרילנדות ומנורות
```

The block's column map is `item=c1 quantity=c2 unit_cost=c3 total=c4`, and
`headerRunEnd` stops the map at the leading contiguous header run — so columns
7–10 are never read by anything. **The twelve reimbursements are invisible to
the promoter.** They are also where `חריגים` (the five ברן 25 dues exceptions)
and `רגילים 38` live, equally unread.

To promote them a lead would have to confirm a *separate* block over H3:J14 as
`obligations` with a manual `description`/`amount`/`party` map. `detectBlocks`
did not carve one out, so there is nothing to confirm today.

### 2. Which seeded rows would the promoter re-create?

27 of 63 seeded rows, all in `budget_lines`. Zero in `ledger_entries`, zero in
`ticket_rounds`, zero in `obligations`.

### 3. Which seeded rows would it not re-create, and are those the expected adjudications?

**No.** The expected adjudications (`funding_targets` ×8, the three opening
balances, the offset settlements) all hold — but they are not the interesting
part. 36 seeded rows in the four target tables would not be re-created, and
**almost all of that is a defect, not an adjudication**: see question 4.

### 4. Which refusals are expected, and which reveal something that needs fixing?

The headline defect, which nothing in the plan anticipated:

> **`parseDate` cannot read the text `rawGrid` stores for a real Excel date
> cell, so every ledger row in every workbook is refused `no-date`. Zero
> `ledger_entries` can be promoted, ever.**

`toText` in `src/lib/xlsx/extract.ts` stringifies a Date cell with
`value.toISOString()` → `2026-06-01T00:00:00.000Z`. `sliceGrid` stores that
text in `blocks.raw_grid`. `blockRows` hands that text to `ledgerRow`, which
calls `parseDate` — and `parseDate` accepts a `Date` object, `YYYY-MM-DD`, or
`D/M/YYYY`, and nothing else. The full ISO timestamp falls through to
`{ ok: false }`:

```
[קופת קאמפ 2026.xlsx / סיכום כללי] r6  תאריך לא קריא: 2026-07-18T00:00:00.000Z
    cells: 2026-07-18T00:00:00.000Z | · | 57000 | רווח מסיבת פקאנים | ·
```

No test catches it because every test in `ledger.test.ts` and
`promote.test.ts` supplies its date cells as `'2025-10-30'` or `'20/05/2025'`
— hand-written forms that a real workbook only produces when the cell is text.
This is exactly the class of failure this task exists to surface: the seed and
the promoter had never met real data in the same database.

Details of every refusal group are in the next-but-one section.

---

## Per-table evidence

Row counts throughout: **would write** = rows the dry run reports as `written`;
**seeded** = rows currently present with `source_block_id IS NULL`. Matching is
on `(season, label)`, never label alone — `הובלה` is a ברן 26 camp line of
9,000 *and* a ברן 25 dancefloor line of 4,000.

### ledger_entries

| | count |
| --- | --- |
| would write | **0** |
| seeded (`source_block_id IS NULL`) | 19 |
| seeded the promoter would re-create | **0** |
| seeded no block re-creates | **19** |
| would write, matching no seeded row | 0 |

All 19 seeded ledger rows survive with nothing to replace them, and **not one
of them is an adjudication**. Every one has a workbook source; all of them are
refused `no-date` by the defect above.

Cross-checked, description for description, against the refused rows' own
evidence cells:

- 18 of the 19 seeded rows appear verbatim among the 24 `no-date` refusals.
- The 19th, `קיזוז מול תקציב גיפטינג יוני`, is the workbook's
  `קיזוז מול תקציב גיפטינג יוניברן` — **the seed truncated the label**. Same
  row, same 5,000, same date.
- 5 further `no-date` refusals are new facts from the unlabelled 23-24 ledger
  (`קופת קאמפ שנת 23׳` 30,400, `מסיבה של עומרי נקודה` 3,800, `החזר ארט` 1,034,
  `רווח נקי מסיבה 08.08/24` 34,469, `רווח נקי קלוז פרינדס` 13,710).

**Projection, if the date defect is fixed** (derived from the refused rows'
cells, not observed): `סיכום כללי` in קופת קאמפ 2026 writes 12 rows = all of
`LEDGER_26`; `סיכום כללי` in קופת קאמפ 25’ writes 7 rows = all of `LEDGER_25`;
`Shliff day2day spending` writes those 5 new season-less rows. The remaining 27
day2day rows stay refused `negative-amount` regardless.

### budget_lines

| | count |
| --- | --- |
| would write | **64** |
| seeded | 28 |
| seeded the promoter would re-create | **27** |
| seeded no block re-creates | **1** |
| would write, matching no seeded row | 36 |

The 64 come from three blocks:

| block | sheet | rows written |
| --- | --- | --- |
| `66ad3b61` | תקציב קאמפ ברן 26 (2026) | 26 |
| `254bef9f` | תקציב קאמפ ברן 25 (25’) | 27 |
| `fa78b9be` | תקציב רחבה ברן 25 (25’), re-picked | 11 |

**23 of the 24 seeded ברן 26 `camp` lines are re-created exactly.** Every one
matches its seeded row's amount to the agora, including `מקרר + מקפיא` at 0.00
and `תקציב הפתעות דק׳ 90` at 5,852.30. The 27th re-created row is the
dancefloor `הובלה`, below.

**The one "not re-created" is a label mismatch, not a missing fact.** Seeded
`30 מ׳ לייקרה + 50 מ׳ בד זול` (ברן 26, 1,000.00) is the workbook's
`30 מ׳ לייקרה+ 50 מ׳ בד זול גידור מחנה ונגרר רחבה` at r26, amount 1,000 — the
seed shortened the label. The fact is re-created; the string is not.

**The four dancefloor lines come back with the wrong category.**

| seeded | season | category | re-created by | promoted category |
| --- | --- | --- | --- | --- |
| מייצג 41,300 | ברן 25 | `dancefloor` | תקציב רחבה ברן 25 r3 | `camp` |
| חשמל 12,950 | ברן 25 | `dancefloor` | תקציב רחבה ברן 25 r4 | `camp` |
| הגברה + תאורה 30,810 | ברן 25 | `dancefloor` | תקציב רחבה ברן 25 r5 | `camp` |
| הובלה 4,000 | ברן 25 | `dancefloor` | תקציב רחבה ברן 25 r6 **and** תקציב קאמפ ברן 25 r13 | `camp` |

`budgetRow` writes `category: 'camp'` unconditionally; nothing in a column map
can change it. All four are also referenced by `tasks.budget_line_id` (4 tasks,
no foreign key — migration 0003), and those references are invisible to the W5
sweep because the seeded rows have no `source_block_id`.

`הובלה` ברן 25 is genuinely ambiguous: two different blocks each produce a
ברן 25 line labelled `הובלה` for 4,000 (the dancefloor deliverable and the
camp budget's own transport line). A lead has to say whether those are one fact
or two.

**Three of the 36 new rows are false positives** that a lead should refuse at
confirm time rather than let through:

| row | label | amount | what it actually is |
| --- | --- | --- | --- |
| תקציב קאמפ ברן 26 r31 | תקציב מחנה | 42,000 | the season's dues × head-count, from a neighbouring sub-table |
| תקציב קאמפ ברן 26 r32 | יעד גיוס | 22,375.30 | the fundraising target, same sub-table |
| תקציב רחבה ברן 25 r20 | צפי להחזרי מע״מ | 5,550 | the head of a VAT-reclaim sub-table |

The other 33 are real: 26 ברן 25 camp budget lines the seed never held at all
(`תקציב קאמפ ברן 25` is not seeded), and 7 further dancefloor expenses
(שידאפו 1,440, בדים 570, פנסי שטיפה 800, שתייה קלה 140, אלכוהול אומנים 950,
גיפטינג אומנים 410, plus the long-label lycra line).

### ticket_rounds

| | count |
| --- | --- |
| would write | **5** |
| seeded | 3 |
| seeded the promoter would re-create | **0** |
| seeded no block re-creates | **3** |
| would write, matching no seeded row | 5 |

**Expected, and structural.** The three seeded rounds
(`כרטיסים עד כה` 60,000, `סבב ג׳` 33,000, `סבב ד׳` 78,000) come from columns
G–J rows 30–32 of `תקציב קאמפ ברן 26` — inside a `budget_lines` block whose
map stops at column 4. Exactly like the reimbursements: real data in a
sub-table that no block covers.

The 5 written rounds come from `SuperNature 3.10` F1:I12, which is a different
projection entirely (מוקדמות/ראשון/שני/אחרון, 139,125 total). One of the five
is junk: r11 `אסף` with total 0.6666666667 and quantity 0 — a profit-split
percentage row that the `total=c9` mapping reads as money.

### obligations

| | count |
| --- | --- |
| would write | **0** |
| seeded | 13 |
| seeded the promoter would re-create | **0** |
| seeded no block re-creates | **13** |
| would write, matching no seeded row | 0 |

The brief expected that Task 1's nullable `opened_on` would let obligations
blocks produce rows where they used to refuse wholesale. **They still produce
nothing, and the date is not the reason.** There are only two `obligations`
blocks in the whole corpus:

- `8ad9055b` — `סיכום כללי` G1:H16 in קופת קאמפ 2026, the `חוב יוסף` table.
  Headerless (`header_row` null), so `mapColumns` produced an empty map at
  import and `applyConfirmation` cannot improve it: re-picking the same
  archetype keeps the caller's map, and recomputing needs a header row it does
  not have. With no `amount` column every row refuses `no-amount` (12) or
  `blank-row` (2) or `total-row` (2). The data is right there —
  `מזומן + שמן גנרטור 10,070`, `שולחן + מקרר 3,200`, `סה״כ חוב 15,240`,
  `קיזוזים` 4,410 / 2,780 / 1,140 / 6,000 — and a manual map of
  `description=c7 amount=c8` would read it.
- `821ae5b1` — `תקציב קאמפ ברן 26` A29:F39 in קופת קאמפ 25’. Refused
  `sheet-superseded`, and correctly so; it is also **not an obligations table
  at all**, it is the `יעד גיוס UniBurn` funding-target list the classifier
  mislabelled (confidence 0.42).

So all 13 seeded obligations stand un-replaced: `חוב יוסף` 15,240 and the
twelve ברן 25 reimbursements. `חוב יוסף` additionally carries **4
`obligation_settlements`** that would cascade-delete with it.

Note a reachability quirk worth knowing: the `unmapped-column` whole-block
refusal never fires for `8ad9055b`. `promoteWithin` checks for a missing
`block_mappings` *row*, and every block has one — `8ad9055b`'s just holds `[]`.
A lead therefore sees 16 per-row `no-amount` refusals instead of one clear "this
table has no column mapping", which is much harder to act on.

---

## Refusals — all 258, grouped

| reason | count | verdict |
| --- | --- | --- |
| `no-season` | 96 | **expected, and a decision waiting.** All four 23-24 ticket blocks (Gagarin 29, Collabo 30, Spring #2 24, Winter Rave 13). Resolves the moment ברן 23/24 exist as seasons. |
| `no-amount` | 73 | **mostly a mapping defect.** See breakdown below. |
| `negative-amount` | 27 | **expected.** All in `Shliff day2day spending`, which writes expenses as `-1170` in a column already headed `הוצאה`. The promoter refuses rather than guess the sign's meaning. A lead must decide once whether this sheet's convention is "sign is decoration". |
| `no-date` | 24 | **DEFECT.** The ISO-timestamp bug. All ledger rows in all three workbooks. |
| `total-row` | 11 | **expected** — 10 of them. The 11th is cross-contamination: see below. |
| `no-promoter` | 11 | **expected.** 4 `unknown` single-row remnants, 4 `event_lines` blocks, 2 `income_channels` blocks, and `account_balances` with its own Hebrew message. |
| `blank-row` | 7 | expected. |
| `no-label` | 5 | **a mapping defect**, all in `תקציב רחבה ברן 25` rows 21-25: the VAT-reclaim sub-table puts its amount in column 2 and its label in column 3, so `item=c1` reads blank. |
| `sheet-superseded` | 3 | **expected, and the authority decision working.** `תקציב קאמפ ברן 25` (2026 copy) and both blocks of `תקציב קאמפ ברן 26` (25’ copy). |
| `carry-forward` | 1 | **expected.** `מעבר לקובץ חדש 44,647`, correctly refused as the previous book's closing balance. |

`no-amount` breakdown:

| block | count | verdict |
| --- | --- | --- |
| תקציב רחבה ברן 25 F1:G35 (`a3dc3f57`, ledger) | 31 | **defect.** Its header is `פירוט \| מחיר`; `ledger`'s vocabulary has no `מחיר`, so only `description=c6` maps and nothing carries an amount. No archetype fixes it: `מחיר` maps to `unit_cost` under `budget_lines` and to nothing under `obligations`. This is 31 real dancefloor expenses (11,390.8 total) that need a manual column map. |
| סיכום כללי G1:H16 (`8ad9055b`, obligations) | 12 | **defect.** The headerless `חוב יוסף` table — see above. |
| Shliff Deco 24 (`f051cd61`, ledger) | 9 | **defect.** Header `הוצאות \| פירוט \| סכום` maps `outflow=c1`, but the amounts are in c3. Season-less anyway. |
| תקציב קאמפ ברן 26 (`66ad3b61`) | 8 | expected — sub-table rows 30, 33-39 with a blank column 4. |
| מסיבת חורשה (`53b926b2`, ledger) | 6 | **defect.** Two side-by-side `סכום \| תיאור` pairs; only `description=c2` maps. |
| תקציב רחבה ברן 25 A1:D26 (`fa78b9be`) | 4 | expected — the balance sub-table at rows 14-17. |
| SuperNature 3.10 (`84d315a5`) | 3 | expected — rows 8, 10, 12 below the real rounds. |

**`isTotalRow` reads the whole raw row, including unmapped columns.**
`תקציב קאמפ ברן 25` r24 (`פינויי חשל״ש`) is refused `total-row` because column
8 of that row holds the *exceptions* sub-table's `סה״כ` label. Harmless here —
the row's own total is blank and the seed omits it too — but it means any
budget row that happens to sit beside another table's total line is silently
dropped.

**The 2026 copy of `תקציב קאמפ ברן 25` has a wrong header row.** Block
`17486faa` stored `header_row = 1` (the merged decorative title) instead of 2,
so its map reads `item=c1 total=c3 paid=c5 payment_method=c6` — `total` points
at `עלות ליחידה`, the unit cost. Had that copy been made authoritative it would
have written 27 budget lines with unit costs in the total column. It is
`sheet-superseded` here, so nothing comes of it, but the same defect will bite
any block whose header run starts on a merged title.

---

## Sweep: deleted and retained

```
rows a committed run would delete: 0
retained rows: none
```

**Expected, and the reason this document exists.** The W5 sweep only ever
touches rows a block *owns* (`source_block_id = blockId`). Every seeded row has
`source_block_id IS NULL`, so the sweep cannot see them, cannot delete them and
cannot retain them. Nothing in the promotion path will ever clean up after the
seed — that is Task 13's job, by hand, and the whole risk sits there.

---

## What Task 13 may delete

**Safe to delete — the promoter re-creates the same fact, same season, same
amount: 23 `budget_lines` rows.** The ברן 26 `camp` lines, re-created by
`תקציב קאמפ ברן 26` r3-r28. Delete only after a real (non-dry) promotion has
actually written their replacements, and confirm 26 rows with
`source_block_id = '66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92'` exist first.

**Delete only with a decision attached — 5 `budget_lines` rows:**

- `35bddd9c` `30 מ׳ לייקרה + 50 מ׳ בד זול` (ברן 26, 1,000). Re-created under
  the workbook's longer label. Deleting is correct; know that the label changes.
- The three dancefloor lines `מייצג`, `חשמל`, `הגברה + תאורה` and the
  dancefloor `הובלה`. Their replacements arrive with `category = 'camp'` and
  a different id, so **4 `tasks.budget_line_id` references break silently**
  (no foreign key). Either fix `budgetRow`'s hard-coded category and relink the
  tasks first, or do not delete these.

**Do NOT delete — nothing re-creates them:**

| table | rows | why |
| --- | --- | --- |
| `ledger_entries` | **all 19** | blocked by the `parseDate` ISO defect. Revisit after it is fixed; the evidence says 19 of 19 have a workbook source. |
| `obligations` | **all 13** | `חוב יוסף` needs a manual column map on a headerless block; the twelve reimbursements sit in columns no block covers. Deleting `חוב יוסף` also cascade-deletes its **4 `obligation_settlements`**, including the 6,000 offset that settled five members' ברן 26 dues. |
| `ticket_rounds` | **all 3** | they live in an unmapped sub-table of a `budget_lines` block. |
| `funding_targets` ×8 | all | **expected adjudication.** `funding_targets` is not one of the promoter's four target tables at all, and the workbook holds three different revisions of the list (135,000 / 135,375.30 / 160,000). Never deletable by this route. |
| `accounts` ×3 opening balances | all | **expected adjudication.** `account_balances` has no promoter by design: `יתרות חשבונות נקבעות ידנית ולא נקלטות מגיליון`. |
| `obligation_settlements` ×4 | all | **expected adjudication.** Nothing in the workbooks promotes a settlement; the `קיזוזים` rows are inside the unmapped `חוב יוסף` block. |

Net: of 63 seeded rows across the four target tables, **23 are safely
replaceable today, 5 need a decision, and 35 must stay.**

---

## Defects this run found (none fixed here — this task writes no product code)

1. **`parseDate` rejects the ISO timestamp `rawGrid` stores for real date
   cells.** Blocks every ledger promotion in the corpus. `extract.ts`'s
   `toText` writes `value.toISOString()`; `date.ts` accepts only `YYYY-MM-DD`
   or `D/M/YYYY`. No test feeds the real shape.
2. **`budgetRow` hard-codes `category: 'camp'`**, so the dancefloor budget
   cannot be promoted as dancefloor.
3. **`isTotalRow` scans unmapped columns**, so a neighbouring sub-table's
   `סה״כ` cell silently drops a good row.
4. **`unmapped-column` is unreachable** when `block_mappings` holds an empty
   array rather than no row; the lead sees N per-row `no-amount` refusals
   instead of one actionable message.
5. **Header-row detection picked the merged title row** for block `17486faa`,
   producing a map whose `total` is the unit cost.
6. **`מחיר` is not an amount term** for `ledger`, `obligations` or
   `event_lines`, and maps to `unit_cost` for `budget_lines` — so the 31-row
   `תוספת הוצאות מייצג` table cannot be promoted under any archetype without a
   manual map.
7. **`detectBlocks` does not carve out side-by-side sub-tables.** The twelve
   reimbursements, the five `חריגים`, the three seeded ticket rounds and the
   eight funding targets all sit in columns of a `budget_lines` block that no
   column map reaches.
