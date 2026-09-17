# Promotion Blockers and Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Runs alongside Wave 2 (`2026-09-15-block-promotion-wave-2.md`) in parallel lanes, each in its own git worktree.

**Goal:** Remove the two defects that stop real workbook data from promoting, and close the access and deployment findings Phase 1 routed to a plan that was never written.

**Why now:** A 2026-09-17 audit, with each finding checked against the code, found:
- **Every real `obligations` row is refused.** The promoter requires a `date` column. The obligations vocabulary in `src/lib/classify/map-columns.ts` has no `date` field, and neither real obligations block (`קופת קאמפ 2026.xlsx` › `סיכום כללי` G1:H16, `קופת קאמפ 25’.xlsx` › `תקציב קאמפ ברן 26` A29:F39) has a date column.
- **Re-picking a block's archetype keeps the old archetype's column map.** `block-card.tsx` re-sends it and `applyConfirmation` stores it, so the new archetype's promoter refuses every row. Wave 2 Task 14 plans exactly this re-pick for `תקציב רחבה ברן 25`.
- **Access gaps.**
  - `/data` and `/upload` never call `requireAdmin`, and the middleware checks only for a session.
  - The matcher's exclusions match by prefix only (M15).
  - `middleware` is a deprecated convention in Next 16.
- **Real data can leak into deployments.**
  - The seed action imports `@/test/fixtures`, which reads `docs/reference-data` at runtime, so real names and debts are traced into the deployed function (M14).
  - The private blob read uses a bare `fetch` (M16).
  - `scripts/create-admin.ts` takes the password in argv.

**Spec:** `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md` (reqs 29–31: admin-only access, the guard as the enforcement point), `docs/superpowers/specs/2026-09-15-block-promotion-and-data-view-design.md` (W3, W8, W11, W16).

**Global Constraints:** identical to Wave 2's, copied with the parallel-lane rules into `.superpowers/sdd/2026-09-15-block-promotion-wave-2/global-constraints.md`. Every task's requirements include that file.

## Lanes and file ownership

| Lane | Tasks | Owns |
|---|---|---|
| B — import blockers | 1, then 2 | `src/db/schema/money.ts`, `drizzle/0006_*`, `drizzle/meta/*`, `src/lib/import/promote/obligations.ts`(+test), `src/lib/classify/map-columns.ts`(+test), `src/lib/money/obligations.ts`(+test), `src/lib/import/confirm.ts`(+test), `src/app/(admin)/imports/[id]/*` |
| C — hardening | 3, then 4 | `src/middleware.ts`→`src/proxy.ts`(+test), `src/lib/auth/**`, `src/app/(admin)/data/page.tsx` (guard only), `src/app/(admin)/upload/**`, a new guard-net test, `next.config.ts`, `src/lib/storage/**`, `src/lib/import/seed.ts`(+test), `src/test/fixtures.ts`, `scripts/create-admin.ts`, `.env.example`, `README.md` |

Lane A (Wave 2 Task 7 fix round) owns `src/lib/import/promote/promote.ts`, `promote.test.ts`, `types.ts`. Lane D (Wave 2 Task 10) owns `src/lib/money/trace.ts`(+test). No file is shared between lanes.

---

### Task 1: A debt with no date in the workbook is stored as having no date

**Files:**
- Modify: `src/db/schema/money.ts` (`obligations.openedOn`)
- Create: `drizzle/0006_*.sql` via `./node_modules/.bin/drizzle-kit generate` (safe: writes SQL only), plus its `drizzle/meta` snapshot and journal entry
- Modify: `src/lib/money/obligations.ts` (`NewObligation.openedOn`, `listObligations` ordering)
- Modify: `src/lib/import/promote/obligations.ts` (+ `obligations.test.ts`)
- Modify: `src/lib/classify/map-columns.ts` (+ `map-columns.test.ts`)

**Ruling (binding):** `obligations.opened_on` becomes **nullable with no default**. The promoter's current comment argues "store what the schema can represent truthfully, refuse what it cannot", and that argument points to widening the schema. As it stands, both real obligations blocks refuse every row, and the seed's `2025-01-01` for the twelve reimbursements is exactly the fabricated date the promoter was written to refuse. A null `opened_on` says "the workbook does not say when", and that is true. Dropping NOT NULL relaxes a constraint without destroying data, so it is compatible with the additive-migrations rule. Dropping the default means that leaving the field out no longer stamps today's date.

**Behaviour:**
1. Schema: `openedOn: timestamp('opened_on', { withTimezone: true })`, with no `.notNull()` and no `.defaultNow()`. Generate the migration and read the SQL. It must contain only `ALTER COLUMN "opened_on" DROP NOT NULL` and `DROP DEFAULT` statements. Anything else means stop and report.
2. `NewObligation.openedOn: Date | null`. It stays a required key, so callers must say "no date" explicitly. `createObligation` passes it through. The seed already passes explicit dates, so leave `camp-seed.ts` alone; Wave 2 Task 13 owns it.
3. `listObligations` orders by `openedOn` ascending with **nulls last**, stated explicitly in the query rather than relying on Postgres defaults.
4. `obligationRow`:
   - **Blank date cell** (`isBlank`), or no `date` mapping at all: `ok: true` with `openedOn: null` and the note `בגיליון אין תאריך לחוב הזה`.
   - **Non-blank date cell that `parseDate` cannot read unambiguously:** still refused as `no-date`, with the raw text in the message. A wrong date is still a fabricated fact.
   - Rewrite the comment block above the date logic to state this rule. The current comment claims `opened_on` is `notNull`, which is no longer true.
5. `FIELD_TERMS.obligations` gains `date: ['תאריך']`, so an obligations block that does have a date column maps it.

**Tests (write first, watch them fail):**
- A blank date promotes with a null `openedOn` and carries the note.
- An unparseable date such as `01/052024` still refuses with `no-date`.
- `createObligation` with `openedOn: null` round-trips a null.
- `listObligations` puts a dateless obligation after dated ones.
- `mapColumns` maps a `תאריך` header on an `obligations` block to `date`.
- Existing obligation tests stay green, unchanged except where they asserted the old refusal of a blank date.

**Mutations to run and report:**
1. Restore `.notNull()`: the null round-trip test must fail.
2. Treat an unparseable date as blank: the `01/052024` test must fail.
3. Remove the explicit nulls-last: the ordering test must fail. If it survives because Postgres defaults to nulls-last for ASC anyway, say so; the explicit form is still required for intent.

**Verify:** `rtk proxy ./node_modules/.bin/vitest run src/lib/import/promote/obligations.test.ts src/lib/money/obligations.test.ts src/lib/classify/map-columns.test.ts src/db`, then tsc, then eslint on touched files, then the full suite once.

**Commit:** `feat(money): a debt the workbook gives no date is stored with no date`, via `git commit -F - <<'MSG'` ending in `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 2: Re-picking a block's archetype re-maps its columns

**Files:**
- Modify: `src/lib/import/confirm.ts` (+ `confirm.test.ts`; find the existing test file for `applyConfirmation` first)
- Read, and modify only if needed: `src/app/(admin)/imports/[id]/block-card.tsx`, `actions.ts`, and their tests

**Ruling (binding):** the server is where this rule holds, so the UI need not change. When `applyConfirmation` receives an `archetype` different from the block's stored archetype, the `columnMap` it was handed belongs to the old archetype and is discarded. The mapping is recomputed with `mapColumns` for the new archetype from the block's own `rawGrid` and bounds. The recomputed map is what gets stored in `block_mappings` **and** in the layout signature. When the archetype is unchanged, the passed `columnMap` is used as today.

**Before writing code:** read `src/lib/import/run-import.ts` to see how the initial mapping is computed at import time (grid shape, `CellRange`, header row, and the `left` offset), and reuse that path. Blocks store `rawGrid` as text, while `mapColumns` takes a `SheetGrid`. If a conversion is needed, find whether one already exists before writing one. If the re-map would need the original workbook rather than `rawGrid`, stop and report NEEDS_CONTEXT.

**Tests (write first):**
- A block stored as `ledger` with a ledger map, confirmed as `budget_lines`, ends with a stored mapping whose fields are budget fields (`item`/`total` for a grid with `סוג הוצאה` / `עלות כוללת` headers), and none of `date`/`outflow`/`inflow`.
- The layout signature stored for that fingerprint carries the recomputed map.
- Confirming with an unchanged archetype stores the passed map verbatim, including an admin's edit.
- End to end through the promoter: `promoteBlock` from `@/lib/import/promote/promote` on a re-picked block writes budget lines rather than refusing every row. Build the fixture as `promote.test.ts` does. Only import `promoteBlock`; never edit that file.

**Mutations:** (1) always use the passed map, and the re-pick test must fail; (2) always recompute, and the unchanged-archetype test must fail.

**Commit:** `fix(import): a block re-picked as another archetype gets that archetype's columns`.

---

### Task 3: Admin-only means admin-only, at every page and at the gate

**Files:**
- Modify: `src/app/(admin)/data/page.tsx`: add the guard only. Its rewrite belongs to the UI refactor.
- Modify: `src/app/(admin)/upload/page.tsx`
- Rename: `src/middleware.ts` → `src/proxy.ts`, and `src/middleware.test.ts` → `src/proxy.test.ts`
- Create: `src/app/admin-guard.test.ts`, a static net
- Read first: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` and `middleware.md`

**Rulings (binding):**
1. **Page guards.** `/data` and `/upload` call `requireAdmin()` first and `notFound()` on failure, exactly as `src/app/(admin)/money/page.tsx` does.
2. **Static guard net.** A test walks every `page.tsx` and `route.ts` under `src/app/(admin)`, every `actions.ts` there, and `src/app/api/**/route.ts` except the NextAuth handler. It asserts that each file's source calls `requireAdmin(`. It must fail today on `data/page.tsx` and `upload/page.tsx`; record that RED. This is spec req 31's "guard lint rule", done as a test.
3. **Rename `middleware` to `proxy`** the way Next 16.3.4's `proxy.md` documents it: file name, export name, and config. Keep the NextAuth edge/full config split as it is; collapsing it is out of scope. The existing test that pins the config's identity moves with the file and keeps its meaning. The build warning `The "middleware" file convention is deprecated` must be gone.
4. **Anchor the matcher's exclusions to whole path segments (M15).** `/signin`, `/signin/…`, `/api/auth/…`, `/_next/static/…`, `/_next/image…` and `/favicon.ico` stay excluded. `/signin-x`, `/signinfoo`, `/api/authz` and `/favicon.icox` must be gated. Test this against the exported matcher. If Next ships a documented matcher-testing helper (check `proxy.md` for `unstable_doesProxyMatch` or similar), use it. Otherwise compile the pattern the way the docs describe and test it; say in the report which you used.
5. **Leave role logic in the gate as it is.** `isAuthorized` stays "signed in". Pages and actions enforce admin through `requireAdmin`, and the static net makes that total. Changing the gate to require admin would send a signed-in viewer into a sign-in redirect loop. Record this in the report.

**Mutations:** (1) remove the guard from `upload/page.tsx`, and the static net must fail; (2) revert the matcher to prefix form, and the `/signin-x` test must fail.

**Verify:** targeted tests, tsc, and eslint. Then `rtk proxy ./node_modules/.bin/next build`. It may fail in a worktree because `node_modules` is a symlink; if so, say so in the report rather than working around it, and the controller will build after merging.

**Commit:** `fix(auth): every admin page is guarded, and the gate matches whole segments` (the rename may be a separate commit: `refactor(auth): middleware becomes proxy, per Next 16`).

---

### Task 4: The real workbooks stay out of the running app

**Files:**
- Modify: `src/lib/import/seed.ts` (+ test)
- Modify: `src/test/fixtures.ts`
- Create: `src/lib/import/reference-workbooks.ts`
- Modify: `src/app/(admin)/upload/actions.ts`, `upload/page.tsx`, `upload/seed-button.tsx`
- Modify: `next.config.ts`
- Modify: `src/lib/storage/index.ts` (+ test)
- Modify: `scripts/create-admin.ts`, `.env.example`, `README.md`
- Read first: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` (`outputFileTracingExcludes`), and `@vercel/blob`'s typings under `node_modules/@vercel/blob` for how v2 reads a **private** blob

**Rulings (binding):**
1. **Production code never imports from `src/test/`.**
   - Move the reference-workbook list and reader into `src/lib/import/reference-workbooks.ts`. `src/test/fixtures.ts` re-exports from it, so existing tests are untouched.
   - Add to the static net from Task 3, or as a sibling test in the same spirit: no non-test file under `src/` imports `@/test/`.
2. **Seeding the reference workbooks is a development tool.**
   - The server action refuses in production (`process.env.NODE_ENV === 'production'`) with a Hebrew message.
   - The upload page does not render that button in production.
   - The camp-baseline seed button (`seedCampBaseline`) is unchanged; it reads no files.
3. **Keep `docs/reference-data/**` out of every traced function** with `outputFileTracingExcludes` in `next.config.ts`, as Next 16.3.4 documents it.
   - Also silence the "Dynamic filesystem access causes tracing of the whole project" warning from `src/lib/storage/index.ts`, using the documented mechanism for that warning (check the docs and the warning text itself).
   - Known consequence, accepted: `/data` still reads the workbooks off disk, so in a production build it would find no files. `/data`'s rewrite to a database-only page is owned by the UI refactor (W16). Shipping the camp's names and debts is the worse failure.
4. **M16: the blob driver reads a private blob the authenticated way `@vercel/blob` v2 provides,** not with a bare `fetch` of `head().url`. A non-OK response throws with the key and status. Unit-test with `vi.mock('@vercel/blob')` (use `vi.hoisted`). Also add the missing test that `put` is called with `access: 'private'`.
5. **`create-admin` reads the password from the `ADMIN_PASSWORD` environment variable,** never argv. Usage becomes `ADMIN_PASSWORD=… npx tsx scripts/create-admin.ts <email>`, and it refuses with a usage message when the variable is unset. Document it in `README.md` and `.env.example`. There is no test file for scripts; say so in the report.

**Verify:** targeted tests, tsc and eslint. Then `rtk proxy ./node_modules/.bin/next build`, with the same worktree caveat as Task 3. If the build runs, confirm that no `.nft.json` under `.next` lists a `docs/reference-data` path (`rtk proxy grep -rl reference-data .next --include='*.nft.json'` must print nothing) and that the tracing warning is gone.

**Mutations:** (1) re-add `import … from '@/test/fixtures'` to `seed.ts`, and the static net must fail; (2) replace the authenticated read with a bare `fetch`, and the blob test must fail.

**Commit:** `fix(deploy): the camp's real workbooks never reach a deployed function`.

---

## Self-Review

- **Task 1:** the obligations ruling reverses a comment committed in `1348c9a`. It reverses it on that comment's own principle, applied to a schema fact it had taken as fixed.
- **Task 2:** the rule lives in the server rather than the client component, so the UI refactor cannot lose it.
- **Tasks 3–4:** close I9 (pages), M14, M15, M16, the `proxy` rename and the argv password. They deliberately do not rewrite `/data`.
