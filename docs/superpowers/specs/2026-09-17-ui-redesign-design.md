# Shliff Platform — Phase 4: The UI Redesign

Parent specs: `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md`,
`docs/superpowers/specs/2026-09-09-camp-members-fees-design.md`,
`docs/superpowers/specs/2026-09-12-camp-money-and-data-design.md`,
`docs/superpowers/specs/2026-09-15-block-promotion-and-data-view-design.md`.

Mock (13 artboards, clickable): https://claude.ai/artifact/EssRZT3aDPRqMfiWad9tKe

## Intro

### The problem

Every page the platform has works, and none of them feels like a tool. The
nav is seven equal pills with no hierarchy, no search, no user, and no
sign-out. Each page re-implements its own season picker, in its own style,
and `/members` has none at all. The one cell called **שינוי** on `/fees`
holds an exception form, a four-field payment form, and a payment list, all
at once. Removing a payment or cancelling a task takes one click and no
confirmation. Server errors written in English reach a Hebrew screen. Not
one figure anywhere links to the cell it came from, even though five money
tables have carried `source_block_id` since Wave 1. The whole thing is pure
black with a single orange, which reads as a developer's tool rather than
the camp's register.

None of that is a data problem. The domain beneath it is in better shape
than the surface: refusals are modelled, provenance is stored, the identity
closes, the money is honest. What is missing is a surface that lets three to
five volunteers act on it without being taught.

### What was studied

Six parallel reviews, September 2026: modern CRMs (Attio, Folk, Twenty,
HubSpot, Pipedrive); membership and dues tools (Wild Apricot, Planning
Center, Spond, TeamSnap, Bloomerang, and Burnbase, which is a
Burning-Man-camp tool); small-organisation finance (Mercury, Open
Collective, Actual, Monarch, Xero, Splitwise); import review, triage queues
and volunteer staffing (Flatfile, OneSchema, Linear Triage, the QuickBooks
bank feed, Planning Center Services); Hebrew RTL practice and Hebrew
typography measured from the font files; and a full inventory of this
codebase's screens, actions and refusal states.

Three findings decided the direction. Not one of the studied CRMs defaults
to a dark theme. Every one of them replaced "a page per thing" with "a list
you can save views of, and a drawer you can open without leaving it". And
every tool that handles uncertain data — Xero's bank feed, Linear's triage,
Flatfile's review step — gives that uncertainty its own destination with a
count on it, rather than sprinkling banners across the app.

### What this spec is

It is the surface, and only the surface. No table changes, no promoter
changes, no new domain rules. Where a screen needs a figure the library
cannot produce yet, this spec names the query function to add and says what
it must return; it never moves a rule out of `src/lib`.

## Rulings (binding)

- **R1 — No new runtime dependencies.** No component library, no CSS
  framework, no icon package, no chart package. The repo already ships
  hand-written SVG charts and CSS Modules, and a redesign is not the moment
  to take on a component library's RTL story. Icons become a local
  `src/components/icon.tsx` with hand-copied stroke paths.
- **R2 — Light is the default theme; dark is preserved as a choice.**
  Today's `--sand #f2ede6` on near-black survives as the dark theme. Half
  the usage is a laptop in daylight and a phone in the desert.
- **R3 — The accent never carries meaning that a colour-blind reader needs.**
  Orange is brand and primary action. Warning is gold, not orange, because a
  brand-orange warning stops being a warning. Every state pill carries a
  word, never colour alone.
- **R4 — Text on orange is near-black, never white.** White on `#EB7837`
  is 2.89:1 and fails. `#1C1917` on `#EB7837` is 6.06:1, and it is what the
  logo already does.
- **R5 — The season is one global control.** It lives in the sidebar, it is
  carried in the URL as `?season=<uuid>`, and every season-scoped page reads
  it from there. Per-page season pickers are deleted. Camp-wide data
  (accounts, people, nameless obligations) says so on screen rather than
  pretending to belong to a season.
- **R6 — A drawer is a URL.** Peek panels and record drawers are driven by a
  search param (`?peek=<id>`), so they render on the server, survive a
  refresh, and can be linked to. No client-only modal state holds data a
  lead might want to send to someone else.
- **R7 — Server Components and Server Actions stay.** Client components are
  added only where interaction demands them, and each one states in a
  comment why it is a client component.
- **R8 — Every destructive or irreversible action confirms.** Deleting a
  payment, removing an assignment, cancelling a task, unlinking an alias and
  merging two people all pass through a confirmation that names what will
  happen. Merge keeps its checkbox and gains a preview of what moves.
- **R9 — No English reaches a Hebrew screen.** Server-action failures map to
  Hebrew messages at the action boundary. A message with no mapping renders
  the generic Hebrew fallback and is logged, never echoed raw.
- **R10 — Keyboard shortcuts are bound to `event.code`, not `event.key`.**
  With a Hebrew layout `event.key` for `K` is `ל`. Single-letter shortcuts
  are avoided in favour of digits and `⌘K`/`/`.
- **R11 — Every number keeps its provenance.** A figure that came from a
  workbook shows its cell (`תנועות קופה!A14`); one typed by a lead shows
  `נרשם ידנית`. This is a display of `source_block_id`/`source_row`, not a
  new column.
- **R12 — The redesign lands screen by screen behind no flag.** Each plan
  ships a complete screen, with its tests, on `main`. There is no parallel
  "new UI" route tree.

## Requirements

### A. Foundation

- **A1.** One token file, `src/app/tokens.css`, imported by `globals.css`,
  defining the light palette on `:root` and the dark palette under both
  `@media (prefers-color-scheme: dark)` guarded by
  `:root:not([data-theme='light'])` and `:root[data-theme='dark']`.
- **A2.** Light palette, exact values: canvas `#F6F4F1`, panel `#FFFFFF`,
  sunken `#F3F0EC`, hover `#F8F6F3`, selected `#FDF1E8`, line `#E9E4DE`,
  line-strong `#D8D1C9`, ink `#1C1917`, ink-2 `#57534E`, ink-3 `#6B645E`,
  ink-4 `#A8A29E`, brand `#EB7837`, brand-hover `#E06A28`, brand-ink
  `#1C1917`, brand-text `#B04E17`, brand-soft `#FDF1E8`, focus `#C8570F`,
  ok `#1A7F4B` on `#E7F5EC`, warn `#8A5A00` on `#FDF3D7` with line
  `#F1D9A0`, bad `#B42318` on `#FDECEA`, info `#2458C6` on `#EAF1FD`.
- **A3.** Dark palette, exact values: canvas `#0E0D0C`, panel `#171513`,
  sunken `#1D1A17`, hover `#1F1C19`, selected `#2A1D14`, line `#2B2724`,
  line-strong `#3A3531`, ink `#F2EDE6`, ink-2 `#C9C1B8`, ink-3 `#A39B93`,
  ink-4 `#6F6861`, brand-text `#F59A5E`, brand-soft `#2A1D14`, focus
  `#F08A4B`, ok `#5CC98E` on `#12261B`, warn `#F0C05A` on `#2A2112`, bad
  `#F2877C` on `#2C1614`, info `#7FA8F5` on `#141E33`.
- **A4.** The chart palette is unchanged and stays scoped to `.viz`:
  `#d95926` dues, `#3987e5` fundraising, `#199e70` reserve. The rule that
  the accent may never colour a chart mark stands; the track becomes
  `#EEEAE5` in light.
- **A5.** Heebo stays the UI face, weights 400/500/600/700; it carries
  tabular numerals by default. Frank Ruhl Libre is reduced to the wordmark
  and the sign-in page. Spreadsheet cell references render in IBM Plex Mono.
- **A6.** Type scale, Hebrew-corrected (+1px and +2px leading over a Latin
  scale): 11.5 label, 12.5 meta, 13 dense secondary, 14/20 table cell,
  14.5/22 body, 16 section lead, 22/30 page title 600, 26–38 display
  figures 600.
- **A7.** Spacing is the 4px scale (4 8 12 16 24 32 48 64). Radii: 6–8px
  controls, 10–14px cards and panels, 999px pills. Structure is drawn with
  1px borders; shadows are reserved for overlays.
- **A8.** Density: table header 36px, data row 44px comfortable and 36px
  compact, controls 34–36px, phone targets ≥44px, phone inputs ≥16px.
- **A9.** Focus is `outline: 2px solid var(--focus); outline-offset: 2px` on
  `:focus-visible`, never removed.
- **A10.** CSS uses logical properties throughout — `padding-inline`,
  `inset-inline-start`, `text-align: start`. The single documented exception
  is a numeric table column, which is physically `text-align: right` with
  `font-variant-numeric: tabular-nums` so place values line up.
- **A11.** Money is produced by one helper and never by string concatenation,
  so the minus sign cannot migrate across the number in bidi. Amounts render
  inside `<bdi>` with the symbol last (`1,200 ₪`). Direction is carried by
  the column the amount sits in, never by a sign.
- **A12.** Dates render `DD/MM/YY` or `DD/MM/YYYY` with slashes in tables —
  what Excel and the banks show — and `7 בספט׳ 2026` in prose. Times are
  24-hour `HH:mm`. Calendars start on Sunday.
- **A13.** The theme choice is stored in a cookie readable on the server, so
  the first paint is already correct; the toggle writes it and updates
  `data-theme` on `<html>`. With no cookie, the OS preference wins.

### B. The shell

- **B1.** The nav becomes a 244px sidebar on the start (right) side, holding,
  top to bottom: the logo and wordmark; the season switcher; search; the
  primary group (בית, לטיפול); הקאמפ (אנשים, דמי קאמפ, משימות); כספים
  (סקירה כספית, תנועות, תקציב, חובות); נתונים (קבצים וייבוא); and a footer
  with settings, the signed-in user, and the theme toggle.
- **B2.** Nav items carry counts where a count is actionable: לטיפול carries
  the number of open decisions, אנשים the roster size, משימות the number of
  understaffed tasks. A count that would always read `0` is not shown at all.
- **B3.** The active item is matched by path prefix, so `/members/[id]` and
  `/imports/[id]` keep their section marked.
- **B4.** The season switcher shows the current season, opens a list of
  seasons with their state, and offers "שנה חדשה". Choosing a season
  rewrites `?season=` on the current route.
- **B5.** `⌘K` (and `/`) opens a command palette over the page: people,
  movements, budget lines, files, and actions (רישום תשלום, הוספת אדם,
  העלאת קובץ), with `↑↓`, `↵` and `esc` hinted in its footer.
- **B6.** The main panel is a bordered, rounded surface inset from the
  canvas, with a 52px top bar carrying breadcrumbs, the season chip, and the
  page's global actions.
- **B7.** Below 1024px the sidebar collapses behind a menu button; below
  768px the layout is a single column with a five-item bottom tab bar
  (בית, אנשים, כספים, לטיפול, עוד) and 44px targets.
- **B8.** Each page sets its own `<title>`; today every page is
  "פלטפורמת שליף".
- **B9.** The signed-in user and a sign-out control exist in the shell. A
  signed-in non-admin sees an access message, not a 404.
- **B10.** `/signin` is designed: the wordmark, the mark, the two fields,
  one button, and Hebrew error text.

### C. The component kit

Each component lives in `src/components/ui/` with its own CSS Module and its
own test. No component reaches into another's styles.

- **C1. `Table`** — header 36px, rows 44px, hover, selected, zebra-free,
  sticky header, a `w0` action column, an optional `tfoot` totals row, and
  group rows. Numeric columns follow A10.
- **C2. `SavedViews`** — a tab strip of named views with counts, the current
  one marked `aria-selected`, plus a `+`.
- **C3. `FilterBar`** — a search field, filter chips carrying their value,
  a dashed "add filter" chip, a sort chip, a column control, and a row count.
- **C4. `Pill`** — neutral, ok, warn, bad, info, brand, outline; always with
  a word, optionally a dot.
- **C5. `Avatar`** — initials in one of six tints, three sizes, an empty
  dashed variant, and a `Stack` that overlaps and caps.
- **C6. `Drawer`** — an end-side overlay panel, 460–500px, with a header
  (title, subtitle, record stepper, expand, close), a scrolling body and a
  footer of actions. Driven by R6's URL param; `esc` closes; focus is
  trapped while open and restored on close.
- **C7. `ConfirmDialog`** — a 400px modal for R8, naming the action and its
  consequence, with the destructive verb on the confirm button.
- **C8. `BulkBar`** — a floating bar shown on selection: the count, the
  actions, destructive ones behind "עוד", and a clear button.
- **C9. `Banner`** — neutral, info, warn, danger; an icon, a sentence, and
  at most one action.
- **C10. `EmptyState`** — five distinct kinds, per the parent spec's rule
  that an empty state is an invitation: nothing yet; nothing for this
  season; nothing matching this filter; nothing you may see; and "all
  clear", which is the only one that celebrates.
- **C11. `StatTile`** — label, value, derivation line, optional bar, and an
  optional link; it keeps Wave 1's rule that no number is unexplained.
- **C12. `SourceChip`** — a workbook cell reference in mono, or
  `נרשם ידנית`; links to the block it came from.
- **C13. `Field`** — label, control, hint, error; inputs, selects,
  textareas, a segmented control, and a checkbox.
- **C14. `Icon`** — one component, a named record of stroke paths, 14/15/16/20px,
  `stroke-width` 1.75, `aria-hidden` unless labelled. Directional icons
  (arrows, chevrons) mirror in RTL; checkmarks, clocks and media do not.

### D. The screens

Each screen's mock artboard is the reference for layout; this spec carries
the behaviour the artboard cannot show.

- **D1. בית (`/`).** Four actionable figures (dues collected, cash across
  accounts, open debts, task coverage), each linking to the page that can
  change it; the לטיפול preview with the first six decisions and their
  actions; understaffed tasks with coverage; who has not paid, by name. No
  charts, no figure a lead cannot act on. Its empty state leads into import.
- **D2. לטיפול (`/inbox`).** The unresolved register, and the home of R22
  from the Wave 2 spec. Tabs: ממתין להחלטה, לידיעה, טופלו. A rail of items
  grouped by kind (unlinked names, sheets without a season, duplicate
  copies, unconfirmed blocks, nameless debts, refused rows, arithmetic
  flags) beside one open item. Each item shows the workbook evidence with
  its cell highlighted, the suggestions with the reasons behind them, and
  confidence as a word — חזקה, אפשרית, חלשה — never a percentage. Actions
  are numbered 1–5. Bulk promotion sits here and stays disabled while any
  blocking decision is open. It replaces today's `/data`, which must stop
  reading workbooks from disk.
- **D3. אנשים (`/members`).** A saved-view list (כולם, the season's roster,
  טרם שילמו, חדשים השנה, ראשי צוות, לא חזרו השנה) with search, filters,
  selection with a bulk bar, a totals row, and a peek drawer. The seasons
  column shows participation across years at a glance. The unlinked-names
  queue moves to D2 and leaves a banner behind.
- **D4. דף אדם (`/members/[id]`).** Header with name, role, aliases and
  contact; five highlight tiles; tabs for סקירה, תשלומים, משימות, חובות,
  כינויים ומקורות, היסטוריה; a side panel of attributes, the aliases with
  the cell each came from, and a change log. Merge moves here as a
  side-by-side comparison with a preview of what will move, per R8.
- **D5. דמי קאמפ (`/fees`).** The one-sentence lead, four rollup tiles that
  double as filters, saved views by payment state, and a table whose row
  carries its own verb. Recording a payment happens in a drawer that
  includes the account picker the model has always had and the UI has never
  offered, and that offers "שמירה ומעבר לבא" because collection happens in
  runs. Setting an exception is a separate action that requires an amount
  and a reason, and says why the reason is required.
- **D6. כספים (`/money`).** Wave 1's seven bands, reordered into: the
  sentence; five tiles; where the money is, as account cards with the
  personal-account warning beside them; debts in both directions; the budget
  with planned, actual and remaining, its rationale column and its
  arithmetic flags; and the five most recent movements. Every figure links
  onward and every row shows its source.
- **D7. תנועות (`/money/ledger`).** נכנס and יצא as separate columns, a
  counterpart column, month group headers, a filter-aware summary strip, a
  running balance that appears only when the view is one account in date
  order, saved views, and the unattributed-money banner with its fix.
- **D8. חובות (`/money/debts`).** Both directions, never a signed number;
  settlement in cash or by קיזוז in a drawer that states that an offset
  moves no cash; a dateless debt shown as dateless and sorted last; and
  nameless debts that cannot be settled, cannot be dismissed, and carry
  their source cell.
- **D9. משימות (`/tasks`).** Grouped by kind, coverage as `5/8` with avatar
  stacks and clickable empty slots, gaps first, dates relative to the gate,
  and an assign popover that shows how loaded each person already is.
  Closing or cancelling a task confirms.
- **D10. קבצים וייבוא (`/imports`, `/imports/[id]`).** A file list with
  status and results, and a review screen: a four-step stepper, a rail of
  sheets and their blocks, and one block open with its type, its column
  mapping (samples, a confidence word, "לא לייבא"), and its grid with
  refused rows shown in place with the Hebrew reason. The promote button
  carries its count: "אישור וקידום 52 שורות".
- **D11. Mobile.** The home, the roster, a person, and recording a payment
  work on a phone. The rest degrade to readable lists.

### E. Cross-cutting

- **E1.** Every list screen implements all five empty states from C10.
- **E2.** Every action that writes shows its result: a toast naming what
  happened, with undo where the domain allows it.
- **E3.** Loading states are skeletons of the same shape as the content,
  never a spinner over a whole page.
- **E4.** Tab order follows the visual order; every interactive element is
  reachable; icon-only buttons carry `aria-label`; tables carry captions or
  labelled regions.
- **E5.** Hebrew copy is reused verbatim from the existing screens wherever
  it exists — the glossary in the parent specs stands.
- **E6.** No page reads files from disk at request time.

## Out of scope

Member self-service and roles beyond admin; reminders and instalment plans;
cross-year analytics; two-sided events (Wave 3); writing money rows the
model supports but no screen offers yet (accounts, transfers, seasons,
events) beyond what D5–D8 name; any change to the promoter, the classifier
or the schema.

## Order

The foundation and the shell come first and everything else depends on
them. After that the screens are independent of each other, and the two
that unblock the most work are לטיפול (D2), which the Wave 2 register needs,
and דמי קאמפ (D5), which is the screen the camp uses weekly.
