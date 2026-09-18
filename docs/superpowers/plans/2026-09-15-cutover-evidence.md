# Cutover evidence — what the promoter would write, and what no block re-creates

Taken against a clone of the live `shliff` database, before anything is
deleted. Produced by `scripts/dry-run-promote.ts`; the run's full output is
committed beside this file as `2026-09-15-cutover-evidence-run.txt`, so every
number here can be checked without re-deriving it.

- **First run:** 2026-09-17, before `parseDate` was fixed.
- **Second revision:** 2026-09-17, re-run on `5e10740`
  (`fix(coerce): read the ISO timestamp a real workbook date actually stores`),
  which was found *by* the first run. The whole `ledger_entries` section
  changed; everything else was unchanged and is marked where it matters.
- **This revision:** 2026-09-18, re-run after
  `fix(promote): a fractional ticket count is refused, not rounded to zero`,
  which was found by defect 10 below. **Only the `ticket_rounds` section and
  the refusal totals changed**, and the diff against the previous transcript is
  exactly four facts: `ticket_rounds` would-write 5 → **4**, its
  writes-matching-no-seeded-row 5 → **4**, total refusals 234 → **235**, and a
  new `out-of-range` bucket holding one row. Every enumerated
  `ledger_entries` and `budget_lines` id, every count, and `deleted: 0` are
  byte-identical to the previous run — the ids are stable because the clone is
  taken from live, where the blocks live.

The cutover's one real failure mode is deleting a seeded fact that no workbook
block re-creates, and no test can see it: tests run on a fresh `createTestDb()`
where the seed and the promoter never coexist. This document is the diff taken
against the live data instead.

**Read "What Task 13 may delete" last and act only on it.**

---

## How this was produced

```bash
# 1. Clone. Never the live database. `create database … template shliff` fails
#    with "source database is being accessed by other users" whenever a dev
#    server holds a connection, so dump-and-restore is the recipe that works
#    without stopping anything. pg_dump on live is read-only.
docker exec shliff-pg psql -U shliff -d postgres \
  -c "drop database if exists shliff_evidence;" \
  -c "create database shliff_evidence;"
docker exec shliff-pg sh -c \
  'pg_dump -U shliff shliff | psql -q -U shliff shliff_evidence'

# 2. Migrate the CLONE only. 0000-0001 were applied to shliff by
#    `drizzle-kit migrate` and 0002-0004 by `drizzle-kit push`, so the journal
#    the clone inherits knows only the first two; the three pushed ones are
#    recorded in the clone's journal by file sha256 so `migrate` proceeds.
#    As of this revision that means 0005 (sheets.season_id / authoritative),
#    0006 (obligations.opened_on nullable) and 0007 (the block mapping's
#    budget category) — live is still at 0001 in its journal and 0004 on disk.
docker exec shliff-pg psql -U shliff -d shliff_evidence -c "insert into \
  drizzle.__drizzle_migrations (hash, created_at) values \
  ('e3c398d7988db5d3c4f314c61569e6289f48d9bbc334c9d38c7edf4cc6bd8850', 1789017138982), \
  ('abc04f2160d5810e995135f095800214b537a128265350ac0f341c7ff3f6f64b', 1789169288307), \
  ('fe626b5a233baddfabc8a4b989cfa096dd7d4ce8451454df493eb57dcc67ef45', 1789184064527);"
DATABASE_URL=postgres://shliff:<pw>@localhost:5433/shliff_evidence \
  ./node_modules/.bin/drizzle-kit migrate

# 3. The evidence run.
DATABASE_URL=postgres://shliff:<pw>@localhost:5433/shliff_evidence \
  npx tsx scripts/dry-run-promote.ts
```

Skipping step 2 does not produce a wrong report — it produces no report at all:
`setSheetSeason` fails with `column "season_id" of relation "sheets" does not
exist` on the first sheet, because the clone inherits live's schema and live is
three migrations behind.

### The guard is an allowlist, and it was attacked before it was trusted

`scripts/scratch-guard.ts` resolves the database name from exactly the sources
postgres.js honours — `?database=` (last value of a repeated key), then the raw
URL path, then `PGDATABASE`, then the user name — and refuses unless it is
exactly `shliff_evidence`. A blacklist on "is the path `shliff`?" has two holes
that both land on live:

| URL | path says | postgres.js opens |
| --- | --- | --- |
| `postgres://shliff:pw@localhost:5433` | nothing | `shliff` — it falls through to the **user name**, which is `shliff` |
| `…/shliff_evidence?database=shliff` | `shliff_evidence` | `shliff` — the query parameter lands in `options.connection` and `StartupMessage` builds `Object.assign({ user, database, … }, options.connection)` |

Both, plus `…/shliff`, `…/shliff/` and `…/shliff?sslmode=require`, were run
against the real URLs and all five were refused before `@/db` was imported.

**Correction, 2026-09-18.** This section used to say the guard read `?db=` as
well, and the guard did. That was false about postgres.js and it was a live
bypass, not a conservative extra: `index.js`'s
`database: o.database || o.db || …` reads the **options object**, while a query
key goes to `options.connection`, and `StartupMessage` merges that over
`{ user, database, client_encoding }` — so only a key spelled `database` can
change the startup packet. Measured against the installed package,
`…/shliff?db=shliff_cutover` resolves to `database: 'shliff'` with
`connection.db: 'shliff_cutover'`: the guard resolved `shliff_cutover` and
ALLOWED a URL that opens live. A second, smaller untruth in the same function:
it percent-decoded the path, while `parseUrl` returns `pathname` raw and
decodes only username and password, so `sh%6Ciff_cutover` really is a database
called `sh%6Ciff_cutover`. Both are fixed; `?db=` is now asserted INERT in both
directions and the bypass URL above is a regression test.

`src/test/scratch-guard.test.ts` covers the resolution and the allowlist (37
tests). Six deliberate mutations failed tests: allowlist→blacklist, dropping
the `?database=` override, dropping the empty-name refusal, dropping the
user-name fallback, reinstating the `?db=` branch (6 failures, including the
bypass regression) and reinstating the path decode (2 failures).

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
can exist. `information_schema` agrees: 0 columns named `season_id` or
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
The cost is visible below: 96 of the 235 refusals are `no-season`.

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

---

## Headline

92 rows would be written, 235 refused, 0 deleted, 0 retained, against 63
seeded rows in the four target tables.

| table | would write | seeded | re-created | NOT re-created | writes matching no seeded row |
| --- | --- | --- | --- | --- | --- |
| `ledger_entries` | 24 | 19 | **18** | 1 | 6 |
| `budget_lines` | 64 | 28 | **27** | 1 | 36 |
| `ticket_rounds` | 4 | 3 | **0** | 3 | 4 |
| `obligations` | 0 | 13 | **0** | 13 | 0 |

**"Re-created" means `(season, label, amount-to-the-agora)` all agree.** A
label match alone is not enough: `הובלה` is a ברן 26 camp line of 9,000 *and*
a ברן 25 dancefloor line of 4,000, and a replacement holding a different number
is not a replacement. The run reports a separate, loud bucket for rows that
match on season and label but not amount. **In this run that bucket is empty
in all four tables** — every one of the 45 matches agrees to the agora.

Two arithmetics on "not re-created", both true, counted differently:

- **18 by the per-table arithmetic** (1 + 1 + 3 + 13) — rows with no
  season+label+amount match.
- **16 in the "must stay" bucket** below — because two of those 18
  (`קיזוז מול תקציב גיפטינג יוני` and `30 מ׳ לייקרה + 50 מ׳ בד זול`) *are*
  re-created, at the same amount, under the workbook's longer label. They are
  decisions, not losses.

---

## The four questions, answered

### 1. Do the twelve ברן 25 reimbursements come from an `obligations` block or a `budget_lines` block?

**Neither, in the sense the spec meant — and the spec's assumption is the
closer one.** They live in columns H, I and J of `תקציב קאמפ ברן 25` in
`קופת קאמפ 25’.xlsx`, inside block `254bef9f`, which is a **`budget_lines`**
block spanning A1:J32. They are not a block of their own and no `obligations`
block anywhere in the corpus contains them.

Rows 3–14 of that block each hold a budget line in columns A–D *and* a
reimbursement in columns H–J:

```
r3:  שירותים נסורת | 3 | 125 | 1375 | כן | מזומן | 17591 | אורי שולם | 300  | שווארמה הקמות
r13: הובלה         | משאית הלוך חזור | 4000 | 4000 | כן | מזומן | · | יובי שולם | 580 | גרילנדות ומנורות
```

The block's column map is `item=c1 quantity=c2 unit_cost=c3 total=c4`, and
`headerRunEnd` stops the map at the leading contiguous header run — so columns
7–10 are never read by anything. **The twelve reimbursements are invisible to
the promoter.** The same columns hold `חריגים` (the five ברן 25 dues
exceptions) and `רגילים 38`, equally unread.

To promote them a lead would have to confirm a *separate* block over H3:J14 as
`obligations` with a manual `description`/`amount`/`party` map. `detectBlocks`
did not carve one out, so there is nothing to confirm today.

### 2. Which seeded rows would the promoter re-create?

45 of 63: 18 `ledger_entries` and 27 `budget_lines`. None in `ticket_rounds`
or `obligations`.

### 3. Which seeded rows would it not re-create, and are those the expected adjudications?

The expected adjudications all hold — `funding_targets` ×8, the three opening
balances and the four offset settlements are correctly un-promotable, because
`funding_targets` and `obligation_settlements` are not target tables at all and
`account_balances` refuses with its own Hebrew message.

But they are not the whole story. **16 rows must stay for reasons that are
defects, not judgements**: 13 obligations and 3 ticket rounds, all of them real
data sitting in columns or blocks that no column map reaches.

### 4. Which refusals are expected, and which reveal something needing re-picking?

The first run's headline — that `parseDate` could not read the ISO timestamp
`raw_grid` stores, so **every** ledger row refused `no-date` and zero
`ledger_entries` could ever be promoted — has been **fixed and merged**
(`5e10740`). This revision is re-derived against that fix: `no-date` is now
**0 refusals**, down from 24, and 24 ledger rows are written.

What remains is catalogued in the refusal table below. The largest genuinely
actionable groups are `no-amount` (73, mostly mapping defects) and `no-season`
(96, the unlabelled 23-24 workbook).

---

## Per-table evidence

### ledger_entries — *re-derived against the parser fix*

| | count |
| --- | --- |
| would write | **24** |
| seeded (`source_block_id IS NULL`) | 19 |
| re-created (season + label + amount) | **18** |
| amount mismatches | 0 |
| NOT re-created | 1 |
| would write, matching no seeded row | 6 |

Written from three blocks: `6f1a7fc4` (`סיכום כללי`, 2026) 12 rows with **zero
refusals**; `ac5a9d6e` (`סיכום כללי`, 25’) 7 rows with 1 refusal
(`carry-forward`); `b4385d44` (`Shliff day2day spending`) 5 rows with 27
refusals (all `negative-amount`).

**18 of the 19 seeded rows are re-created exactly** — same season, same date,
same direction, same amount. The 19th is a seed truncation, not a loss:

| seeded | amount | the workbook says |
| --- | --- | --- |
| `cb5c56de` `קיזוז מול תקציב גיפטינג יוני` | 5,000.00, ברן 26, in 2026-07-01 | `קיזוז מול תקציב גיפטינג יוניברן`, same amount, same date, `6f1a7fc4` r4 |

The other 5 "matching no seeded row" writes are genuinely new facts from the
unlabelled 23-24 ledger, all with `season = none`:
`קופת קאמפ שנת 23׳` 30,400 (2023-11-01), `מסיבה של עומרי נקודה` 3,800,
`החזר ארט` 1,034, `רווח נקי מסיבה 08.08/24` 34,469,
`רווח נקי קלוז פרינדס` 13,710.

### budget_lines — unchanged by the parser fix

| | count |
| --- | --- |
| would write | **64** |
| seeded | 28 |
| re-created (season + label + amount) | **27** |
| amount mismatches | 0 |
| NOT re-created | 1 |
| would write, matching no seeded row | 36 |

| block | sheet | rows written |
| --- | --- | --- |
| `66ad3b61` | תקציב קאמפ ברן 26 (2026) | 26 |
| `254bef9f` | תקציב קאמפ ברן 25 (25’) | 27 |
| `fa78b9be` | תקציב רחבה ברן 25 (25’), re-picked | 11 |

**23 of the 24 seeded ברן 26 `camp` lines are re-created exactly**, every
amount agreeing to the agora — including `מקרר + מקפיא` at 0.00 and
`תקציב הפתעות דק׳ 90` at 5,852.30. The 24th is the second seed truncation:
`35bddd9c` `30 מ׳ לייקרה + 50 מ׳ בד זול` (ברן 26, 1,000.00) is the workbook's
`30 מ׳ לייקרה+ 50 מ׳ בד זול גידור מחנה ונגרר רחבה` at `66ad3b61` r26, same
1,000.

The 27th re-created row is the dancefloor set, and **it comes back with the
wrong category**:

| seeded | id | re-created by | promoted category |
| --- | --- | --- | --- |
| מייצג 41,300 | `59a66ac1` | `fa78b9be` r3 | `camp` |
| חשמל 12,950 | `15aecf85` | `fa78b9be` r4 | `camp` |
| הגברה + תאורה 30,810 | `8aed0b22` | `fa78b9be` r5 | `camp` |
| הובלה 4,000 | `2f8b932f` | `fa78b9be` r6 **and** `254bef9f` r13 | `camp` |

`budgetRow` writes `category: 'camp'` unconditionally; no column map can change
it. All four are referenced by `tasks.budget_line_id` (4 tasks, no foreign key
— migration 0003), and the W5 sweep cannot see those references because the
seeded rows have no `source_block_id`.

`הובלה` ברן 25 is genuinely ambiguous: two different blocks each produce a
ברן 25 line labelled `הובלה` for 4,000 (the dancefloor deliverable and the
camp budget's own transport line). A lead has to say whether that is one fact
or two.

The 36 writes matching no seeded row break down as:

| kind | count | detail |
| --- | --- | --- |
| genuinely new ברן 25 camp budget lines (`254bef9f`) | 26 | the seed never held `תקציב קאמפ ברן 25` at all |
| genuinely new dancefloor expenses (`fa78b9be` r7–r12) | 6 | שידאפו 1,440, בדים 570, פנסי שטיפה 800, שתייה קלה 140, אלכוהול אומנים 950, גיפטינג אומנים 410 |
| the ברן 26 **camp** lycra line (`66ad3b61` r26) | 1 | re-creates seeded `35bddd9c` under a longer label; a ברן 26 camp line, *not* a dancefloor one |
| **false positives** | 3 | see below |

| row | label | amount | what it actually is |
| --- | --- | --- | --- |
| `66ad3b61` r31 | תקציב מחנה | 42,000 | the season's dues × head-count, from a neighbouring sub-table |
| `66ad3b61` r32 | יעד גיוס | 22,375.30 | the fundraising target, same sub-table |
| `fa78b9be` r20 | צפי להחזרי מע״מ | 5,550 | the head of a VAT-reclaim sub-table |

### ticket_rounds — *re-derived against the fractional-quantity fix*

| | count | was |
| --- | --- | --- |
| would write | **4** | 5 |
| seeded | 3 | 3 |
| re-created | **0** | 0 |
| NOT re-created | 3 | 3 |

**Expected, and structural.** The three seeded rounds
(`acbcb4ca` `כרטיסים עד כה` 60,000, `2c9a1d61` `סבב ג׳` 33,000,
`c5f4fe18` `סבב ד׳` 78,000) come from columns G–J rows 30–32 of
`תקציב קאמפ ברן 26` — inside a `budget_lines` block whose map stops at column
4. Exactly like the reimbursements: real data in a sub-table no block covers.

The 4 written rounds come from `SuperNature 3.10` F1:I12, a different
projection entirely (מוקדמות 7,000, ראשון 18,000, שני 38,500, אחרון 75,625 —
139,125 total). All four reconcile exactly: 50×140, 100×180, 175×220, 275×275.

**A fifth round used to be written, and it was fabricated.** `84d315a5` r11 was

```
אסף | 0.3333333333 | שליף | 0.6666666667
```

— a row of the profit-split table below the block's own `סה״כ`, which the
block's bottom bound overran. The promoter read a person's name as a round
label, `0.3333333333` as a quantity, and `0.6666666667` as a ₪0.67 total; the
quantity was then **silently rounded to 0** by a `Math.round` that ran before
`promote.ts`'s integer-range guard could ever see the fraction, so the guard's
own `Number.isInteger` check never met one. `isTotalRow`, `isBlankRow`,
`no-amount` and `no-label` all pass a row like that, and it sat in the ברן 26
season this cutover promotes.

`ticketRow` now refuses a present, non-integer quantity, and this run reports it
under `out-of-range`:

```
[קופת קאמפ 2026.xlsx / SuperNature 3.10] r11
  הערך 0.3333333333 בעמודת כמות אינו מספר שלם, וכמות כרטיסים חייבת להיות שלמה.
  בדקו אם השורה היא בכלל סבב כרטיסים
```

`ticketRow` also gained `budgetRow`'s arithmetic reconciliation (quantity ×
price against the stated total, flagged and never blocked), so a future
bound-overrun row whose numbers do not close carries a note instead of waiting
for someone to read every written line by hand, as happened here. It adds no
note to this run:
all four surviving rounds reconcile, and the run's note count is unchanged at 9.

### obligations — unchanged

| | count |
| --- | --- |
| would write | **0** |
| seeded | 13 |
| re-created | **0** |
| NOT re-created | 13 |

The brief expected Task 1's nullable `opened_on` to let obligations blocks
produce rows. **They still produce nothing, and the date is not the reason.**
There are only two `obligations` blocks in the corpus:

- `8ad9055b` — `סיכום כללי` G1:H16 in קופת קאמפ 2026, the `חוב יוסף` table.
  Headerless (`header_row` null), so `mapColumns` produced an empty map at
  import and `applyConfirmation` cannot improve it: re-picking the same
  archetype keeps the caller's map, and recomputing needs a header row it does
  not have. With no `amount` column every row refuses `no-amount` (12),
  `blank-row` (2) or `total-row` (2). The data is right there —
  `מזומן + שמן גנרטור 10,070`, `שולחן + מקרר 3,200`, `סה״כ חוב 15,240`,
  `קיזוזים` 4,410 / 2,780 / 1,140 / 6,000 — and a manual map of
  `description=c7 amount=c8` would read it.
- `821ae5b1` — `תקציב קאמפ ברן 26` A29:F39 in קופת קאמפ 25’. Refused
  `sheet-superseded`, correctly, and it is **not an obligations table at all**:
  it is the `יעד גיוס UniBurn` funding-target list the classifier mislabelled
  (confidence 0.42).

So all 13 seeded obligations stand un-replaced: `חוב יוסף` 15,240 and the
twelve ברן 25 reimbursements. `חוב יוסף` (`6ce85fe8`) additionally carries **4
`obligation_settlements`** that would cascade-delete with it.

A third seed truncation lives here and changes nothing, because nothing
promotes these rows: seeded `2dd7f2d0` `השלמות מקלחת סלון` is the workbook's
`השלמות מקלחת סלון וכו` (`254bef9f` r9, column J).

A reachability quirk worth knowing: the `unmapped-column` whole-block refusal
never fires for `8ad9055b`. `promoteWithin` checks for a missing
`block_mappings` *row*, and every block has one — `8ad9055b`'s just holds `[]`.
A lead therefore sees 16 per-row `no-amount` refusals instead of one clear
"this table has no column mapping".

---

## Refusals — all 235, grouped

| reason | count | was | verdict |
| --- | --- | --- | --- |
| `out-of-range` | **1** | 0 | **new, and the point of this revision.** `84d315a5` r11 — the `אסף` profit-split row, refused for a quantity of `0.3333333333`. See the `ticket_rounds` section. |
| `no-season` | 96 | 96 | **expected, and a decision waiting.** All four 23-24 ticket blocks (Gagarin 29, Collabo 30, Spring #2 24, Winter Rave 13). Resolves the moment ברן 23/24 exist as seasons. |
| `no-amount` | 73 | 73 | **mostly a mapping defect.** Breakdown below. |
| `negative-amount` | 27 | 27 | **expected.** All in `Shliff day2day spending`, which writes expenses as `-1170` in a column already headed `הוצאה`. A lead must decide once whether that sheet's sign is decoration. |
| `total-row` | 11 | 11 | **expected** — 10 of them; the 11th is cross-contamination, below. |
| `no-promoter` | 11 | 11 | **expected.** 4 `unknown` single-row remnants, 4 `event_lines` blocks, 2 `income_channels` blocks, and `account_balances` with its own Hebrew message. |
| `blank-row` | 7 | 7 | expected. |
| `no-label` | 5 | 5 | **a mapping defect**, all in `תקציב רחבה ברן 25` rows 21-25: the VAT-reclaim sub-table puts its amount in column 2 and its label in column 3, so `item=c1` reads blank. |
| `sheet-superseded` | 3 | 3 | **expected, the authority decision working.** `תקציב קאמפ ברן 25` (2026 copy) and both blocks of `תקציב קאמפ ברן 26` (25’ copy). |
| `carry-forward` | 1 | 1 | **expected.** `מעבר לקובץ חדש 44,647`, correctly refused as the previous book's closing balance. |
| `no-date` | **0** | 24 | **fixed** by `5e10740`. |

`no-amount` breakdown:

| block | count | rows | verdict |
| --- | --- | --- | --- |
| `a3dc3f57` תקציב רחבה ברן 25 F1:G35 (ledger) | 31 | 3-33 | **defect.** Header `פירוט \| מחיר`; `ledger` has no `מחיר` term, so only `description=c6` maps and nothing carries an amount. No archetype fixes it: `מחיר` maps to `unit_cost` under `budget_lines` and to nothing under `obligations`. 31 real dancefloor expenses (11,390.8 total) needing a manual map. |
| `8ad9055b` סיכום כללי G1:H16 (obligations) | 12 | — | **defect.** The headerless `חוב יוסף` table, above. |
| `f051cd61` Shliff Deco 24 (ledger) | 9 | 2-10 | **defect.** Header `הוצאות \| פירוט \| סכום` maps `outflow=c1`, but the amounts are in c3. Season-less anyway. |
| `66ad3b61` תקציב קאמפ ברן 26 | 8 | **23, 30, 33-38** | expected. r23 `פינויי חשל״ש` is a genuine line whose total cell is empty (the seed omits it too); r30 and r33-38 are sub-table rows with a blank column 4. r39 is a `total-row`, not a `no-amount`, and r27 is a `blank-row`. |
| `53b926b2` מסיבת חורשה (ledger) | 6 | 3-8 | **defect.** Two side-by-side `סכום \| תיאור` pairs; only `description=c2` maps. |
| `fa78b9be` תקציב רחבה ברן 25 A1:D26 | 4 | 14-17 | expected — the balance sub-table. |
| `84d315a5` SuperNature 3.10 | 3 | 8, 10, 12 | expected — rows below the real rounds. |

**`isTotalRow` reads the whole raw row, including unmapped columns.**
`254bef9f` r24 (`פינויי חשל״ש`) is refused `total-row` because column 8 of that
row holds the *exceptions* sub-table's `סה״כ` label. Harmless here — the row's
own total is blank and the seed omits it too — but any budget row that happens
to sit beside another table's total line is silently dropped.

**The 2026 copy of `תקציב קאמפ ברן 25` has a wrong header row.** Block
`17486faa` stored `header_row = 1` (the merged decorative title) instead of 2,
so its map reads `item=c1 total=c3 paid=c5 payment_method=c6` — `total` points
at `עלות ליחידה`, the unit cost. Had that copy been made authoritative it would
have written 27 budget lines with unit costs in the total column. It is
`sheet-superseded` here, so nothing comes of it.

---

## Sweep: deleted and retained

```
rows a committed run would delete: 0
retained rows: none
```

**Expected, and the reason this document exists.** The W5 sweep only touches
rows a block *owns* (`source_block_id = blockId`). Every seeded row has
`source_block_id IS NULL`, so the sweep cannot see them, cannot delete them and
cannot retain them. Nothing in the promotion path will ever clean up after the
seed — that is Task 13's job, by hand, and the whole risk sits there.

---

## What Task 13 may delete

### Do it in ONE transaction

The obvious order — promote, verify, then delete — leaves a window in which
live holds both copies of everything: about **64,000 ₪** of double-counted
ברן 26 budget plus 19 double-counted ledger movements. Nothing prevents it;
there is no unique constraint across `(season_id, label)` or
`(occurred_on, description)`, and the seeded rows have a null `source_block_id`
so the promoter's own `(source_block_id, source_row)` unique key does not see
them. Any read of a season total taken inside that window is simply wrong.

`promoteAll` already runs as one outer transaction with a savepoint per block,
and `promoteBlock` nests the same way, so passing an outer `tx` down is enough:

```ts
await db.transaction(async (tx) => {
  const bulk = await promoteAll(tx, { dryRun: false, recordedBy: admin.email });
  // assert every replacement below exists in tx, then delete the 41 rows.
  // Any assertion failure throws and the whole thing rolls back — no window,
  // and no half-cutover.
});
```

If the window is accepted instead, say so out loud and take the camp off the
money screens for its duration. Do not leave it implicit.

### Gate on the replacement row, never on a count

The count under `66ad3b61` will be **26**, not 23: 23 replacements, the lycra
line at r26, and the two false positives at r31 and r32. **There is no way to
refuse a single row.** `confirmBlock` takes only an archetype and a column map
(`src/app/(admin)/imports/[id]/actions.ts`); block bounds are not editable
anywhere, and the promoter has no per-row veto. So do not tell a lead to
"refuse them at confirm time" — they cannot. Instead:

- gate each delete on **its own** replacement, by `(source_block_id,
  source_row)` plus matching season, label and amount, exactly as tabulated
  below;
- after promoting, delete the rows in **"Junk this run would write"** below,
  explicitly, in the same transaction. They are junk this evidence identified,
  they are owned by the block, and a later re-confirmation that stops producing
  those rows would sweep them anyway.

### Junk this run would write — 2 rows, delete after promoting

These are **not test artifacts**. They are written for real the first time the
cutover runs without `dryRun`, and nothing in the promoter can refuse them:
`confirmBlock` takes an archetype and a column map, block bounds are not
editable anywhere, and there is no per-row veto (defect 3). They are listed here
as a table rather than only in prose above, because an implementer working from
the tables must not be able to miss them.

| table | `source_block_id` | `source_row` | label | amount | why it is junk | what to do |
| --- | --- | --- | --- | --- | --- | --- |
| `budget_lines` | `66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92` | 31 | תקציב מחנה | 42,000.00 | Not a budget line: the season's flat rate × head-count, read out of a neighbouring sub-table the block's bounds overran. Double-counts the whole ברן 26 camp budget as one line. | Delete in the cutover transaction, gated on `(block, row)` + season + label + amount read back inside it. |
| `budget_lines` | `66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92` | 32 | יעד גיוס | 22,375.30 | Not a budget line: the fundraising target, from the same sub-table. It belongs to `funding_targets`, which is not a promotion target table at all. | Same. |

**A third row was on this list and is now closed at the root.**
`ticket_rounds` `(84d315a5-6c69-4c5a-97e3-72108fc32f01, 11)` — the `אסף` row —
is refused by this revision's run and is no longer written, so **there is
nothing to delete for it**. Its raw quantity cell was `0.3333333333`, silently
reduced to a stored quantity of `0`: the silent rounding was part of the defect,
not incidental to it, which is why the fix refuses the fraction rather than
noting it. If a cutover was already run against an older build, check for the
row before assuming it is absent:

```sql
select id, label, quantity, total from ticket_rounds
 where source_block_id = '84d315a5-6c69-4c5a-97e3-72108fc32f01'
   and source_row = 11;
-- expect zero rows on any build at or after the fractional-quantity fix
```

One more written row is junk that this cutover does **not** delete:
`budget_lines` `(fa78b9be, 20)` `צפי להחזרי מע״מ` 5,550, the head of a
VAT-reclaim sub-table, which inflates ברן 25's camp budget. It is listed in the
false-positive table above but was never enumerated for deletion, and R31
forbids re-deriving the set at run time — add it to `JUNK` only once a reviewer
has checked the row the same way these two were checked.

### Safe to delete — 41 rows

Each is re-created at the same season, label and amount. The replacement's
`source_row` is given; its `source_block_id` is the block id in the heading.

**`ledger_entries` via `ac5a9d6e-8b52-40a9-bfea-a22771a2e4c6` (סיכום כללי, 25’) — 7**

| id | label | amount | source_row |
| --- | --- | --- | --- |
| `c182d162-6e94-4451-a0e3-7ce10f363ad4` | תרומה אבישי פרץ | 200.00 | 3 |
| `8cd11601-97cd-4cc7-a8f3-07b4bdb52701` | מכולה אוג 25-26 | 8850.00 | 4 |
| `d5b2fe0b-eef2-4aff-8b38-01400a3b0c79` | מקדמה במה ברן 25 | 20660.00 | 5 |
| `5b8fcdfb-3b79-435a-b335-f73afa9c9015` | רווח מסיבה נמל | 34646.55 | 6 |
| `a06c506b-e8e1-4f0a-8a52-ee1d1d7d353d` | חצי שני למייצג נטלי | 20660.00 | 7 |
| `4516c89d-17b1-4f52-9104-9594b0313510` | מברגה לקאמפ | 400.00 | 8 |
| `dca069ef-8f96-4976-97e8-a90f82b47b47` | מסיבת האלווין 30/10 | 15660.00 | 9 |

**`ledger_entries` via `6f1a7fc4-03ac-4ec3-abe4-0b5a863e133f` (סיכום כללי, 2026) — 11**

| id | label | amount | source_row |
| --- | --- | --- | --- |
| `5e6f8b16-7106-4198-888a-85836848c254` | חוב לירון סלע על ברן 25 | 14000.00 | 2 |
| `75bf60e3-cb82-4bb8-9747-de9dc0f19a5d` | עובדי הקמה יוניברן | 7350.00 | 3 |
| `9bb918be-3046-40b2-a8cc-b3ae149df304` | מקדמה מכולות ליולי עד נובמבר | 3000.00 | 5 |
| `48f5ad3b-2789-42c8-8f56-bc23f5b653bf` | רווח מסיבת פקאנים | 57000.00 | 6 |
| `c7a9382d-48a6-462f-8814-db88bd4efc54` | 3 כרטיסי אומנים ברן | 8820.00 | 7 |
| `dde50b70-9b56-4222-8515-1c6aa00868ea` | ציוד מטבח חדש | 4000.00 | 8 |
| `ea7cee37-01c1-4602-9ae3-375bc8d9dec6` | הובלות | 2000.00 | 9 |
| `a2b52cd8-a8a1-4b6c-98b3-26271a181719` | מקלחת | 1000.00 | 10 |
| `a2538fa9-3fe1-4305-959f-c88b8c28a823` | ציוד מכולה | 231.00 | 11 |
| `119514bb-7751-407c-8e82-a74d033e45a5` | פינויים נסורת - להחזיר לאורי | 1200.00 | 12 |
| `7d4fef73-4ed0-40dc-8bc3-d1c681e5c662` | מכולה עד דצמבר | 3670.00 | 13 |

**`budget_lines` via `66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92` (תקציב קאמפ ברן 26) — 23**

| id | label | amount | source_row |
| --- | --- | --- | --- |
| `54688d50-0dd3-4414-b2da-3167018e6b4d` | שירותים נסורת | 1625.00 | 3 |
| `09a6852f-c0e5-476c-8497-7fc107c458fd` | פינוי שירותים | 2250.00 | 4 |
| `b3760806-794c-409a-a349-8d4bd3325fed` | ציוד היגיינה | 100.00 | 5 |
| `811f57b5-f8fb-4797-a4cf-b84761421e7e` | מיכל מים לבנים + מתאם ברז | 3068.00 | 6 |
| `25485cd4-ff67-4467-b9b7-8629762dbc39` | מיכל מים אפורים | 472.00 | 7 |
| `5ed03ed9-946d-414d-9802-3bdebf1029a2` | מילוי מי שתייה | 2950.00 | 8 |
| `3ae4ad25-780e-49d9-8a6c-24aed2de388d` | פינוי מים אפורים | 2832.00 | 9 |
| `4c277c0c-b4bd-4c18-9941-9aefeb62268b` | מקלחות | 1500.00 | 10 |
| `ee5f3000-5d62-458a-8470-eb6240bff6f6` | ציוד משלים למקלחת | 500.00 | 11 |
| `8876f4ee-b01b-463a-878d-0e22f5ba0643` | חשמל לקאמפ | 7500.00 | 12 |
| `1667b8d5-858d-45f6-b7de-2927ac638e9b` | הובלה | 9000.00 | 13 |
| `fcf7da38-6107-450e-b73c-7065f1fdf2b7` | באלות | 300.00 | 14 |
| `b80c0207-6f83-4122-a962-29aef09e833c` | אוכל | 8000.00 | 15 |
| `898daf27-ff58-4163-9ce8-b393a5995ea9` | ציוד מטבח - כירת גז + מיחם | 930.00 | 16 |
| `b1b76b55-923b-4e47-a79b-50716df747cc` | מילוי גז | 200.00 | 17 |
| `e7ecd995-935a-4288-b15f-142c4516e2af` | מקרר + מקפיא | 0.00 | 18 |
| `c2df3f64-5541-4f80-9fcf-f8b680bd82bc` | קרח | 1140.00 | 19 |
| `f2b09343-cc19-4fe1-941c-27050d3118a2` | צילייה מחנה | 9156.00 | 20 |
| `0908ecd3-5e2a-4c55-98b9-a467d5745a6d` | גידור מחנה | 2800.00 | 21 |
| `f16ed0e7-fef6-42d7-8a9f-bbe17317f1be` | הובלה צילייה | 500.00 | 22 |
| `fdc0ac33-597a-4c7e-916f-645ee7c0f06c` | 100 ק"ג עצים + תוספת אחסנה | 500.00 | 24 |
| `98feeb0a-52e5-4364-978e-9e4df54e43e3` | גנרטור | 2200.00 | 25 |
| `a7d86aa1-a943-4dfc-974c-01fb763b3468` | תקציב הפתעות דק׳ 90 | 5852.30 | 28 |

### Delete only with a decision attached — 6 rows

**Two seed truncations.** The fact is re-created at the same amount; only the
label changes, to the workbook's longer wording. Deleting is correct if the
camp is happy for the label to lengthen.

| table | id | seeded label | workbook label | replacement |
| --- | --- | --- | --- | --- |
| `ledger_entries` | `cb5c56de-bf1e-4c6b-a0d3-761f3c7d07ca` | קיזוז מול תקציב גיפטינג יוני | קיזוז מול תקציב גיפטינג יוניברן | `6f1a7fc4` r4, 5,000.00 |
| `budget_lines` | `35bddd9c-9f2a-4196-9362-8e8fc0bf2015` | 30 מ׳ לייקרה + 50 מ׳ בד זול | 30 מ׳ לייקרה+ 50 מ׳ בד זול גידור מחנה ונגרר רחבה | `66ad3b61` r26, 1,000.00 |

**Four dancefloor budget lines.** Re-created at the right amount but with
`category = 'camp'` and a new id, so 4 `tasks.budget_line_id` references break
silently (no foreign key). Either fix `budgetRow`'s hard-coded category and
relink the tasks in the same transaction, or do not delete these.

| id | label | amount | replacement |
| --- | --- | --- | --- |
| `59a66ac1-cf51-4035-9a8f-5f442d90daa0` | מייצג | 41300.00 | `fa78b9be` r3 |
| `15aecf85-467f-428c-af0b-36c743057cf5` | חשמל | 12950.00 | `fa78b9be` r4 |
| `8aed0b22-a1c9-4626-ac73-e3d76292ef47` | הגברה + תאורה | 30810.00 | `fa78b9be` r5 |
| `2f8b932f-08d6-47cb-80d2-aca95d2b581f` | הובלה | 4000.00 | `fa78b9be` r6 **and** `254bef9f` r13 — decide whether those are one fact or two |

### Do NOT delete — 16 rows plus the adjudications

| table | rows | why |
| --- | --- | --- |
| `obligations` | **all 13** | `6ce85fe8` `חוב יוסף` 15,240 needs a manual column map on a headerless block; the other twelve are the ברן 25 reimbursements, in columns no block covers. Deleting `חוב יוסף` also cascade-deletes its **4 `obligation_settlements`**, including the 6,000 offset that settled five members' ברן 26 dues. |
| `ticket_rounds` | **all 3** | `acbcb4ca`, `2c9a1d61`, `c5f4fe18` — they live in an unmapped sub-table of a `budget_lines` block. |
| `funding_targets` ×8 | all | **expected adjudication.** Not one of the promoter's four target tables, and the workbook holds three different revisions of the list (135,000 / 135,375.30 / 160,000). Never deletable by this route. |
| `accounts` ×3 opening balances | all | **expected adjudication.** `account_balances` has no promoter by design: `יתרות חשבונות נקבעות ידנית ולא נקלטות מגיליון`. |
| `obligation_settlements` ×4 | all | **expected adjudication.** Nothing in the workbooks promotes a settlement; the `קיזוזים` rows are inside the unmapped `חוב יוסף` block. |

**Net: of 63 seeded rows across the four target tables, 41 are safely
replaceable, 6 need a decision, and 16 must stay.**

---

## Defects this run found (none fixed here — this task writes no product code)

1. ~~`parseDate` rejects the ISO timestamp `raw_grid` stores~~ — **fixed and
   merged as `5e10740`**, and this document re-derived against it. Kept on the
   list because the cause is worth remembering: every test wrote its dates by
   hand, in the one format the real pipeline never produces.
2. ~~**`budgetRow` hard-codes `category: 'camp'`**~~ — **the mechanism is in
   place.** `budgetRow` reads `ctx.budgetCategory`, `applyConfirmation` stores a
   lead's decision on the block's mapping (Task 15), and `confirmBlock` threads
   it through (the missing link, fixed 2026-09-18). Still open in practice: no
   screen renders the choice, so every block confirmed today is stamped `'camp'`
   by the default — including `תקציב רחבה ברן 25`, which is the dancefloor's.
   **The four dancefloor lines in "delete only with a decision" below are still
   not safe to delete** until that choice is made and the tasks relinked.
3. **No per-row veto and no editable block bounds.** `confirmBlock` offers an
   archetype, a column map and (now) a budget category, so a lead still cannot
   refuse `66ad3b61` r31/r32. Today they must be deleted after the fact — see
   "Junk this run would write". `84d315a5` r11 is no longer an instance: the
   promoter refuses it at the root, which is what a per-row veto would otherwise
   have been needed for.
4. **`isTotalRow` scans unmapped columns**, so a neighbouring sub-table's
   `סה״כ` cell silently drops a good row.
5. **`unmapped-column` is unreachable** when `block_mappings` holds an empty
   array rather than no row; the lead sees N per-row `no-amount` refusals
   instead of one actionable message.
6. **Header-row detection picked the merged title row** for block `17486faa`,
   producing a map whose `total` is the unit cost.
7. **`מחיר` is not an amount term** for `ledger`, `obligations` or
   `event_lines`, and maps to `unit_cost` for `budget_lines` — so the 31-row
   `תוספת הוצאות מייצג` table cannot be promoted under any archetype without a
   manual map.
8. **`detectBlocks` does not carve out side-by-side sub-tables.** The twelve
   reimbursements, the five `חריגים`, the three seeded ticket rounds and the
   eight funding targets all sit in columns of a `budget_lines` block that no
   column map reaches.
9. **The seed truncated three labels** relative to the workbook:
   `קיזוז מול תקציב גיפטינג יוני`, `30 מ׳ לייקרה + 50 מ׳ בד זול` and
   `השלמות מקלחת סלון`. Harmless, but it means label equality alone can never
   be the delete key.
10. **A block's bottom bound overruns its own `סה״כ` into an unrelated
    sub-table, and a row of that sub-table with numeric-looking cells in the
    mapped columns is promoted with zero refusals and no note.** This is the
    failure mode that produced the `אסף` ticket round, and it is the one the
    previous revision of this document flagged as a single bad row without
    naming the class. Three instances are already known — `84d315a5` r11,
    `66ad3b61` r31 and r32 — and they came from three different sub-tables
    (a profit split, a dues×head-count calculation, a fundraising target),
    which is what makes it a class rather than three accidents.

    Two things have changed since. *Refusal:* `ticketRow` refuses a non-integer
    quantity, so a percentage read as a count is now stopped at the promoter
    rather than rounded to 0 and written. *Detection:* `ticketRow` gained
    `budgetRow`'s reconciliation (quantity × price vs the stated total, flagged
    never blocked), so a sub-table row whose arithmetic does not close carries a
    note automatically — the asymmetry where `budgetRow` had that check and
    `ticketRow` returned `notes: []` unconditionally is why the `אסף` row was
    found by a human reading all 93 written lines rather than by the run.

    **Neither is a fix for the class.** A sub-table row whose numbers happen to
    close, and whose quantity happens to be whole, still promotes silently. The
    real remedies are editable block bounds or a per-row veto (defect 3), and
    `detectBlocks` learning to stop at a `סה״כ` row.
11. **`budget_lines` has no equivalent of the integer guard**, because its
    `quantity_num` is `numeric` and a fractional quantity there is legitimate
    (`0.5` of a unit). So the bound-overrun rows at `66ad3b61` r31 and r32 are
    not catchable the same way, and the arithmetic note is the only automatic
    signal available for them.

---

## Open questions for Wave 3

1. **ברן 26's `ticket_rounds` would hold two incommensurable things.** After the
   cutover: four promoted rows of one party's gate takings (`SuperNature 3.10`,
   139,125) beside the camp's three seeded projection rows (171,000), with
   nothing in the schema or the UI reconciling them. No money identity breaks
   today — nothing on `/money` renders tickets — but the register's coverage
   cell and any trace would present a party's takings as the camp's ticket plan,
   and `ticketTotalAgorot` already sums both. The spec question is **whether a
   party's ticket table is a `ticket_rounds` block at all**, or whether it
   belongs to an `event_income` archetype that does not exist yet. Not a bug to
   patch: recorded here so the decision is made deliberately rather than
   inherited.
2. **`הובלה` ברן 25 is one fact or two.** Two different blocks each produce a
   ברן 25 line labelled `הובלה` for 4,000 — the dancefloor deliverable
   (`fa78b9be` r6) and the camp budget's own transport line (`254bef9f` r13).
   A lead has to say. Until then `2f8b932f` is in the "decision attached"
   bucket, not the safe one.
