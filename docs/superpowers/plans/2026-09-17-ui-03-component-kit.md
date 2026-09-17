# UI 03 — The Component Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fourteen files that every screen in the redesign is assembled from, so that no screen plan writes a table, a pill, a drawer or a button again — and so that the five page stylesheets that each carry their own copy of a button and an input can be deleted rather than re-styled.

**Architecture:** One flat directory, `src/components/ui/`. Each component is `<name>.tsx` + `<name>.module.css` + `<name>.test.tsx`, exports its props type, and reads only `src/app/tokens.css` and its own module. No component imports another's stylesheet. The kit holds no data, no queries and no server actions: every component takes what it renders as props, and every navigation it performs is an `href` the caller built. Only four files carry `'use client'` — `Drawer`, `ConfirmDialog`, `Popover` and `FilterBar`, which owns a `Popover` and a debounced search box. Every other component calls no hook, so the same module renders on the server when the page is a Server Component and inside the client tree when a page hands it state and callbacks. The four that do need the DOM hand-write their focus trap, their `esc` handling and their outside-click, because R1 forbids the headless UI library that would otherwise supply them.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, CSS Modules. Vitest + `@testing-library/react` under jsdom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-ui-redesign-design.md` — requirements **C1–C13**. C14 (`Icon`) belongs to plan 01 and is consumed here, not built here. The authored source for every stylesheet in this plan is the mock's `shared.css`; the two artboards that exercise it hardest are `people.html` (table, saved views, filter bar, bulk bar, pills, avatars) and `dues.html` (drawer, fields, meters, stat tiles).

## Global Constraints

Every task's requirements implicitly include all of these.

- **No new runtime dependencies (R1).** No component library, no CSS framework, no icon package, no focus-trap package, no `clsx`. If a step seems to need one, stop and report NEEDS_CONTEXT.
- **Server Components by default (R7).** A file gets `'use client'` only when it calls a hook or touches the DOM, and every such file opens with a comment naming the reason. Exactly four files in this plan carry the directive — `popover.tsx`, `filter-bar.tsx`, `drawer.tsx`, `confirm-dialog.tsx`. A directive on any other file is a defect. Taking a callback prop is not a reason for one: a component with no hooks renders inside whichever tree its caller is in.
- **Colours, spacing and radii come from tokens only.** No hex literal in any `.module.css` in this plan, with exactly one documented exception: `avatar.module.css`, whose six tints are that component's own palette and are not named by A2/A3. Structure is drawn with `1px solid var(--line)`; shadows appear only on the overlay components (A7).
- **Logical properties throughout (A10)** — `padding-inline`, `inset-inline-start`, `text-align: start`, `margin-inline-start`. Never `left`/`right`. The single exception is a numeric table column, which is physically `text-align: right` with `font-variant-numeric: tabular-nums`, and it carries a comment saying so.
- **Money is produced by `formatILS` from `@/lib/money` and rendered inside `<bdi>` with `₪` last (A11).** Never string-concatenate an amount. Never render a signed amount; direction is the column's job.
- **Focus is never removed (A9).** `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`. No `outline: none` without a replacement ring in the same rule.
- **Hebrew, RTL, and no English on screen (R9, E5).** Every string the user reads is Hebrew and lives in the component, not in the screen that calls it, wherever this plan says so. Latin, numeric and mixed-direction runs go in `<bdi>`.
- **Accessibility is asserted, not assumed (E4).** Icon-only buttons carry `aria-label`. Tables carry a caption. Overlays carry a role and an accessible name. Tests reach elements through `getByRole`, `getByLabelText` and Hebrew text — never through a class name, never through a `data-testid`.
- **Every component test opens with `/** @vitest-environment jsdom */`.** The project default is `node`; without the pragma the test file fails on `document`.
- **`@testing-library/user-event` is not installed.** Use `fireEvent` from `@testing-library/react`.
- **`@testing-library/jest-dom` is not installed.** There is no `toBeInTheDocument`, no `toHaveClass`, no `toHaveFocus`. Use `expect(x).toBeTruthy()`, `expect(el.getAttribute('aria-selected')).toBe('true')`, `expect(document.activeElement).toBe(el)`.
- **`vi.mock` factories referencing a top-level `const` throw a hoisting `ReferenceError`.** Use `vi.hoisted`, as `src/app/(admin)/tasks/assign-control.test.tsx` does.
- **Do not mock `next/link`.** `vitest.config.ts` inlines `/^next\//`, and `src/app/(admin)/nav.test.tsx` renders real `Link`s and finds them with `getByRole('link')`. Mock `next/navigation` only, and only where a router method is asserted.
- **Run tests with `npx vitest run <path>` and read the test COUNT.** Never trust the exit code: a loader failure still exits 0 with zero tests run. Do not pass `--reporter=basic`; it does not exist in vitest 5.
- **Typecheck with `npx tsc --noEmit`.** Never run `npm install`.
- **This plan touches exactly one file outside `src/components/`:** the single `import` line in `src/app/(admin)/money/page.tsx`, in Task 7. It creates no route, no server action and no query. The screens that consume this kit are plans 04 and later.
- **`git commit -m` in this zsh performs command substitution on backticked spans** and silently deletes them. Use `git commit -F - <<'MSG'`, ending with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Created** — all under `src/components/ui/`:

| file | responsibility | spec |
|---|---|---|
| `tokens.test.ts` | The kit's contract with plan 01: every token it consumes is defined, and the dark block redefines the ones A3 names. | A1–A3 |
| `cx.ts` (+ `cx.test.ts`) | Joins CSS-Module class names. Twelve characters of code, one file, instead of fourteen copies. | — |
| `button.tsx` (+ css, test) | `Button` and `ButtonLink`: default, primary, ghost, danger; md/sm; icon-only. | A7–A9 |
| `table.tsx` (+ css, test) | `Table`: sticky 36px header, 44/36px rows, numeric columns, group rows, a totals row, selection, a hover action slot, row tone. | C1 |
| `pill.tsx` (+ css, test) | `Pill`: seven tones, always a word, optionally a dot. | C4, R3 |
| `avatar.tsx` (+ css, test) | `Avatar` and `AvatarStack`: initials in six tints, three sizes, an empty dashed slot, overlap and cap. | C5 |
| `banner.tsx` (+ css, test) | `Banner`: neutral, info, warn, danger; an icon, a sentence, at most one action. | C9 |
| `empty-state.tsx` (+ css, test) | `EmptyState`: five kinds as a discriminated union, and the Hebrew copy for each. | C10, E1 |
| `stat-tile.tsx` (+ css, test) | `StatTile`: label, value, derivation, optional bar, optional link. Moves here out of `components/charts`. | C11 |
| `source-chip.tsx` (+ css, test) | `SourceChip` and `formatSourceRef`: a workbook cell in mono, or `נרשם ידנית`. | C12, R11 |
| `field.tsx` (+ css, test) | `Field`, `TextInput`, `MoneyInput`, `Select`, `Textarea`, `Segmented`, `Checkbox`. | C13 |
| `saved-views.tsx` (+ css, test) | `SavedViews`: a tab strip of named views with counts, plus a `+`. | C2 |
| `popover.tsx` (+ css, test) | `Popover`: a trigger and a panel, closed by outside click, `esc`, and a choice inside it. | C3's mechanism, reused by C8 |
| `filter-bar.tsx` (+ css, test) | `FilterBar`: debounced search, value chips, an add-filter chip, sort, columns, row count. | C3 |
| `drawer.tsx` (+ css, test) | `Drawer`: end-side panel, header with stepper/expand/close, scrolling body, footer. Driven by the URL. | C6, R6 |
| `drawer-url.ts` (+ test) | `PEEK_PARAM`, `ACT_PARAM`, `openPeekHref`, `closePeekHref`. The URL contract every screen shares. | R6 |
| `confirm-dialog.tsx` (+ css, test) | `ConfirmDialog`: a 400px modal naming the action and its consequence, the verb on the confirm button. | C7, R8 |
| `bulk-bar.tsx` (+ css, test) | `BulkBar`: the count, the actions, destructive ones behind `עוד`, a clear button. | C8 |

**Modified:**

| file | change |
|---|---|
| `src/app/(admin)/money/page.tsx` | One line: `@/components/charts/stat-tile` → `@/components/ui/stat-tile`. Nothing else. |
| `src/components/charts/charts.module.css` | Delete `.tile`, `.tileValue`, `.tileLabel`, `.tileDerivation`. |

**Deleted:**

| file | why |
|---|---|
| `src/components/charts/stat-tile.tsx` | C11 moves it into the kit. It has no test file today; the migration writes the one it never had. |

---

## Dependencies

**On plan 01 (the foundation).** Do not start Task 1 until plan 01 has merged. It delivers two things this plan cannot run without:

1. **`src/app/tokens.css`**, imported by `globals.css`, defining A2 on `:root` and A3 under both `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme='light'])` and `:root[data-theme='dark']`. This kit consumes exactly these twenty-nine tokens:

   `--canvas --panel --sunken --hover --selected --line --line-strong --ink --ink-2 --ink-3 --ink-4 --brand --brand-hover --brand-ink --brand-text --brand-soft --focus --ok --ok-soft --warn --warn-soft --warn-line --bad --bad-soft --info --info-soft --viz-track --shadow-pop --shadow-drawer`

   Task 1 Step 1 is a test that asserts all twenty-nine exist, so a drift in plan 01 fails here loudly rather than silently rendering a transparent panel.

2. **`src/components/ui/icon.tsx`**, exporting `Icon` and the `IconName` union. Spec C's preamble puts every kit component in `src/components/ui/`, which is narrower than R1's shorthand `src/components/icon.tsx`; take C's location. Every use in this plan is `<Icon name="x" size={14} />`, and `Icon` is `aria-hidden` unless labelled, so no test in this plan asserts an icon.

   If plan 01 landed `Icon` elsewhere, fix the import path and say so in the report rather than creating a second icon file.

**Button leads, though the spec does not number it.** The spec's C list names the composites and assumes the atoms. There is no `Button` in C1–C14, yet C1's `w0` action column, C7's confirm verb, C8's bulk actions, C9's banner action and C10's empty-state action each render one, and `fees.module.css`, `members.module.css`, `tasks.module.css`, `import-review.module.css` and `data.module.css` each carry their own copy of the same 34px control down to the same `:hover:not(:disabled) { border-color: var(--flare) }`. Five copies is the problem this plan exists to end, so `Button` is Task 1. **If plan 01 already shipped `src/components/ui/button.tsx`, Task 1 becomes a read-and-verify:** confirm its props match the table in Task 1's Interfaces, extend it if they do not, and move to Task 2.

**Task order is most-used-first**, so a screen plan that starts before this one finishes still has what it needs: Button, Table, Pill, Avatar, Banner, EmptyState, StatTile, SourceChip, Field, SavedViews, FilterBar, Drawer, ConfirmDialog, BulkBar. Numbered, that is Task 1 through Task 14 in that order. Within the plan, Task 11 (FilterBar) builds `Popover`, Task 13 (ConfirmDialog) uses Task 9's `Checkbox`, and Task 14 (BulkBar) reuses Task 11's `Popover`; those are the only dependencies between tasks other than every task's use of `Button` and `cx` from Task 1.

**Dependents.** Plans 04 and later — D1–D11. Each of them deletes the page CSS this plan's "Retires" notes name. Nothing in those plans may re-implement a component listed here.

---

### Task 1: One button, and the tokens it stands on

**Files:**
- Create: `src/components/ui/tokens.test.ts`
- Create: `src/components/ui/cx.ts`, `src/components/ui/cx.test.ts`
- Create: `src/components/ui/button.tsx`, `src/components/ui/button.module.css`, `src/components/ui/button.test.tsx`

**Interfaces:**
- Consumes: `src/app/tokens.css` (plan 01); `Icon`, `IconName` from `@/components/ui/icon` (plan 01, in callers only — `Button` itself renders `children`).
- Produces:

```ts
export function cx(...parts: Array<string | false | null | undefined>): string;

export type ButtonTone = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

type ButtonShared = {
  tone?: ButtonTone;                 // default 'default'
  size?: ButtonSize;                 // default 'md'
  /** Icon-only button: `children` is the icon, this is its accessible name (E4). */
  iconLabel?: string;
  children: ReactNode;
};

export type ButtonProps = ButtonShared & {
  type?: 'button' | 'submit';        // default 'button'
  disabled?: boolean;
  /** For a Server-Action form that dispatches on which button was pressed. */
  name?: string;
  value?: string;
  /** Only ever passed from inside a client tree. */
  onClick?: () => void;
};

export type ButtonLinkProps = ButtonShared & {
  href: string;
  /** Replaces the history entry instead of pushing one — the Drawer's close control. */
  replace?: boolean;
};

export function Button(props: ButtonProps): ReactElement;
export function ButtonLink(props: ButtonLinkProps): ReactElement;
```

**Retires:** `fees.module.css` `.exceptionForm button`, `.issueAll button`, `.paymentForm button`; `members.module.css` `.queueActions button`, `.addMember button`, `.addToSeason button`, `.mergeControl button`; `tasks.module.css` `.assign button`, `.newTask button`; `import-review.module.css` `.confirmButton` and the `button` rules inside `.form`; `data.module.css` `.toggle`, `.year`.

- [ ] **Step 1: Write the tokens contract test**

`src/components/ui/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The kit's contract with plan 01. Every token listed here is read by a
 * stylesheet in `src/components/ui/`. If plan 01 renames one, this fails here
 * rather than rendering a transparent panel on a white canvas.
 */
const KIT_TOKENS = [
  '--canvas', '--panel', '--sunken', '--hover', '--selected',
  '--line', '--line-strong',
  '--ink', '--ink-2', '--ink-3', '--ink-4',
  '--brand', '--brand-hover', '--brand-ink', '--brand-text', '--brand-soft',
  '--focus',
  '--ok', '--ok-soft', '--warn', '--warn-soft', '--warn-line',
  '--bad', '--bad-soft', '--info', '--info-soft',
  '--viz-track', '--shadow-pop', '--shadow-drawer',
];

/** A3 names these as differing in dark; the rest carry over from A2. */
const DARK_TOKENS = [
  '--canvas', '--panel', '--sunken', '--hover', '--selected',
  '--line', '--line-strong', '--ink', '--ink-2', '--ink-3', '--ink-4',
  '--brand-text', '--brand-soft', '--focus',
  '--ok', '--ok-soft', '--warn', '--warn-soft', '--warn-line',
  '--bad', '--bad-soft', '--info', '--info-soft', '--viz-track',
];

describe('tokens.css', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/tokens.css'), 'utf8');

  it.each(KIT_TOKENS)('defines %s', (token) => {
    expect(css.includes(`${token}:`)).toBe(true);
  });

  it('redefines the dark palette under the attribute selector', () => {
    const at = css.indexOf("[data-theme='dark']");
    expect(at).toBeGreaterThan(-1);
    const dark = css.slice(at);
    for (const token of DARK_TOKENS) {
      expect(dark.includes(`${token}:`), `${token} is not redefined in dark`).toBe(true);
    }
  });

  it('redefines the dark palette under the OS preference too', () => {
    expect(css.includes('prefers-color-scheme: dark')).toBe(true);
    expect(css.includes(":root:not([data-theme='light'])")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/tokens.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../src/app/tokens.css'` if plan 01 has not merged. **If that is the failure, stop and report BLOCKED-ON-PLAN-01.** If plan 01 has merged and a named token is missing, report which one; do not add it from here.

- [ ] **Step 3: Write `cx` and its test**

`src/components/ui/cx.ts`:

```ts
/**
 * Joins CSS-Module class names. `styles.btn` is always a string; the variants
 * are conditional. One file so that fourteen components do not each grow their
 * own copy — and not a dependency, because R1 forbids one for twelve characters.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
```

`src/components/ui/cx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('joins the truthy parts with a single space', () => {
    expect(cx('btn', 'primary')).toBe('btn primary');
  });

  it('drops false, null and undefined so a variant can be conditional', () => {
    expect(cx('btn', false, null, undefined, 'sm')).toBe('btn sm');
  });

  it('returns an empty string when nothing survives', () => {
    expect(cx(false, undefined)).toBe('');
  });
});
```

- [ ] **Step 4: Write the button test**

`src/components/ui/button.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, ButtonLink } from './button';

describe('Button', () => {
  it('is a button with its Hebrew label', () => {
    render(<Button>רישום תשלום</Button>);
    expect(screen.getByRole('button', { name: 'רישום תשלום' })).toBeTruthy();
  });

  it('defaults to type="button" so it cannot submit a form by accident', () => {
    render(<Button>ביטול</Button>);
    expect(screen.getByRole('button', { name: 'ביטול' }).getAttribute('type')).toBe('button');
  });

  it('submits when asked to, and carries its name and value for a Server Action', () => {
    render(<Button type="submit" name="intent" value="promote">אישור וקידום</Button>);
    const button = screen.getByRole('button', { name: 'אישור וקידום' }) as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.name).toBe('intent');
    expect(button.value).toBe('promote');
  });

  it('names an icon-only button for assistive technology', () => {
    render(<Button iconLabel="סגירה"><svg aria-hidden="true" /></Button>);
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeTruthy();
  });

  it('does not fire while disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>מחיקה</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link as a link, not as a button', () => {
    render(<ButtonLink href="/imports">העלאת קובץ</ButtonLink>);
    const link = screen.getByRole('link', { name: 'העלאת קובץ' });
    expect(link.getAttribute('href')).toBe('/imports');
    expect(screen.queryByRole('button', { name: 'העלאת קובץ' })).toBeNull();
  });
});
```

- [ ] **Step 5: Run it and verify it fails**

Run: `npx vitest run src/components/ui/button.test.tsx`
Expected: FAIL — `Failed to resolve import "./button"`. Test count 0 for that file.

- [ ] **Step 6: Write the component**

`src/components/ui/button.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { cx } from './cx';
import styles from './button.module.css';

export type ButtonTone = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

type ButtonShared = {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Icon-only: `children` is the icon and this is the button's name (E4). */
  iconLabel?: string;
  children: ReactNode;
};

export type ButtonProps = ButtonShared & {
  type?: 'button' | 'submit';
  disabled?: boolean;
  name?: string;
  value?: string;
  onClick?: () => void;
};

export type ButtonLinkProps = ButtonShared & { href: string; replace?: boolean };

function classes(tone: ButtonTone, size: ButtonSize, iconLabel: string | undefined): string {
  return cx(
    styles.btn,
    tone !== 'default' && styles[tone],
    size === 'sm' && styles.sm,
    iconLabel !== undefined && styles.icon,
  );
}

export function Button({
  tone = 'default', size = 'md', iconLabel, children,
  type = 'button', disabled, name, value, onClick,
}: ButtonProps): ReactElement {
  return (
    <button
      className={classes(tone, size, iconLabel)}
      type={type}
      disabled={disabled}
      name={name}
      value={value}
      onClick={onClick}
      aria-label={iconLabel}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  tone = 'default', size = 'md', iconLabel, children, href, replace,
}: ButtonLinkProps): ReactElement {
  return (
    <Link
      className={classes(tone, size, iconLabel)}
      href={href}
      replace={replace}
      aria-label={iconLabel}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 7: Write the stylesheet**

`src/components/ui/button.module.css`:

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  block-size: 34px; padding-inline: 12px;
  border: 1px solid var(--line-strong); border-radius: 8px;
  background: var(--panel); color: var(--ink);
  font: inherit; font-size: 13.5px; font-weight: 500;
  white-space: nowrap; cursor: pointer; text-decoration: none;
}
.btn:hover { background: var(--hover); }
.btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.primary { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); font-weight: 600; }
.primary:hover { background: var(--brand-hover); }

.ghost { border-color: transparent; background: transparent; color: var(--ink-2); }
.ghost:hover { background: var(--sunken); color: var(--ink); }

.danger { color: var(--bad); }

.sm { block-size: 28px; padding-inline: 9px; font-size: 12.5px; border-radius: 7px; }

.icon { inline-size: 34px; padding-inline: 0; }
.sm.icon { inline-size: 28px; }

.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn:disabled:hover { background: var(--panel); }
.ghost:disabled:hover { background: transparent; }

/* Phone targets are at least 44px (A8). */
@media (pointer: coarse) {
  .btn { block-size: 44px; padding-inline: 16px; }
  .sm { block-size: 44px; }
  .icon { inline-size: 44px; }
  .sm.icon { inline-size: 44px; }
}
```

- [ ] **Step 8: Run all three and verify they pass**

Run: `npx vitest run src/components/ui/tokens.test.ts src/components/ui/cx.test.ts src/components/ui/button.test.tsx`
Expected: PASS — 3 files, 40 tests: 29 parametrised token cases plus the two dark-palette cases, 3 for `cx`, 6 for `Button`. Read the COUNT; a run that reports fewer than three files did not load them all.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 10: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): one button, and the tokens the kit stands on

Five page stylesheets each carried their own 34px control down to the same
hover rule. This is the one they all become. `tokens.test.ts` pins the
twenty-nine tokens the kit reads so a rename in the foundation fails loudly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: The Table every list in the app is made of

**Files:**
- Create: `src/components/ui/table.tsx`, `src/components/ui/table.module.css`, `src/components/ui/table.test.tsx`

**Ruling (binding) — what the Table does not do, and why.**

1. **No client-side sorting.** `TableColumn` has no `sortable`, and `Table` has no `onSort`. Sorting is a URL concern: C3's sort chip writes `?sort=`, the page's query orders the rows, and the server returns them ordered. A table that re-sorted in the browser would sort only the rows it was handed, and would then disagree with the totals row and the row count, both of which the page computes over the whole filtered set on the server.
2. **No virtualisation.** The largest real list is 38 people; the import grid is already truncated by the review screen. A virtualised body breaks the browser's own find, breaks a printed page, and defeats the sticky `tfoot`. R1 forbids the dependency that would do it well, and a hand-rolled one would be the largest untested surface in the kit.
3. **No column hiding, resizing or reordering.** C3's column control writes a URL param; the page passes a different `columns` array. `Table` renders exactly what it is given.
4. **No pagination and no row expansion.** A row that needs more opens the Drawer (R6).
5. **No `'use client'`.** `Table` calls no hook and owns no state. Handlers arrive as props, so the same module renders on the server for `/money`'s read-only tables and inside the client tree for `/members`'s selectable roster.

**Interfaces:**
- Consumes: `cx` (Task 1); `Icon` (plan 01) in callers only.
- Produces:

```ts
export type ColumnAlign = 'start' | 'end';
export type RowTone = 'default' | 'warn' | 'bad';

export type TableColumn<Row> = {
  /** Stable key; also the cell's React key. */
  key: string;
  /** Header content. `''` for the action column. */
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** A10's documented exception: physical right alignment + tabular numerals. */
  numeric?: boolean;
  /** Where non-numeric content sits. Default 'start'. Ignored when `numeric`. */
  align?: ColumnAlign;
  /** `inline-size: 1%` — shrinks to its content (checkbox, action slot). */
  w0?: boolean;
  /** The header's name for assistive technology when `header` renders empty. */
  srHeader?: string;
};

export type TableRowModel<Row> = {
  id: string;
  data: Row;
  /** Row-level tone: a flagged budget line is `warn`, a refused import row is `bad`. */
  tone?: RowTone;
  /**
   * A group heading. Table emits a group `<tr>` above this row whenever the
   * value differs from the previous row's — D7's month headers, D9's kinds.
   * Rows arrive already ordered; Table never re-groups them.
   */
  group?: string;
};

export type TableSelection = {
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  /** `בחירת רוני אדלר`, built by the caller from the row it knows. */
  rowCheckboxLabel: (rowId: string) => string;
  /** `בחירת כל השורות`. */
  allCheckboxLabel: string;
};

export type TableTotalsCell = {
  key: string;
  content: ReactNode;
  colSpan?: number;
  numeric?: boolean;
};

export type TableProps<Row> = {
  /** The table's accessible name (E4). Visually hidden unless `captionVisible`. */
  caption: string;
  captionVisible?: boolean;
  columns: ReadonlyArray<TableColumn<Row>>;
  rows: ReadonlyArray<TableRowModel<Row>>;
  /** Prepends a `w0` checkbox column and tones selected rows. */
  selection?: TableSelection;
  /** Appends a `w0` cell revealed on row hover, focus-within and selection. */
  rowActions?: (row: Row) => ReactNode;
  /** A `<tfoot>` of cells in visual order; they may span. */
  totals?: ReadonlyArray<TableTotalsCell>;
  /** Rendered instead of the body when `rows` is empty — usually an `<EmptyState>`. */
  empty?: ReactNode;
  /** A8: 44px comfortable, 36px compact. Default 'comfortable'. */
  density?: 'comfortable' | 'compact';
};

export function Table<Row>(props: TableProps<Row>): ReactElement;
```

**Retires:** `import-review.module.css` `.tableWrap` and its `th`/`td` rules and `.moreRows`; `data.module.css` `.tableWrap`, `.grid`, `.num`, `.bufferCell`, `.bufferBar`, `.flat`; and the bare `table`/`th`/`td` block in `src/app/globals.css`, which can only go once the last screen plan lands — record that debt, do not delete it here.

- [ ] **Step 1: Write the failing test**

`src/components/ui/table.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { Table } from './table';
import type { TableColumn, TableRowModel } from './table';

type Person = { name: string; state: string; balance: string };

const columns: ReadonlyArray<TableColumn<Person>> = [
  { key: 'name', header: 'שם', cell: (p) => p.name },
  { key: 'state', header: 'דמי קאמפ', cell: (p) => p.state },
  { key: 'balance', header: 'יתרה', cell: (p) => <bdi>{p.balance}</bdi>, numeric: true },
];

const rows: ReadonlyArray<TableRowModel<Person>> = [
  { id: 'a', data: { name: 'רוני אדלר', state: 'שולם', balance: '—' } },
  { id: 'b', data: { name: 'איתי כהן', state: 'טרם שילם', balance: '1,200 ₪' }, tone: 'bad' },
];

describe('Table', () => {
  it('is named for assistive technology by its caption', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'רשימת אנשים' })).toBeTruthy();
  });

  it('renders one row per model, in the order it was handed them', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const body = screen.getAllByRole('rowgroup')[1];
    const names = within(body).getAllByRole('row').map((r) => r.textContent ?? '');
    expect(names[0]).toContain('רוני אדלר');
    expect(names[1]).toContain('איתי כהן');
  });

  it('marks a numeric column so place values line up (A10)', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const header = screen.getByRole('columnheader', { name: 'יתרה' });
    expect(header.className).toContain('numeric');
  });

  it('carries a row tone so a danger row reads as one without relying on colour', () => {
    render(<Table caption="רשימת אנשים" columns={columns} rows={rows} />);
    const body = screen.getAllByRole('rowgroup')[1];
    const [, second] = within(body).getAllByRole('row');
    expect(second.getAttribute('data-tone')).toBe('bad');
  });

  it('emits a group heading row whenever the group changes, and only then', () => {
    const grouped: ReadonlyArray<TableRowModel<Person>> = [
      { id: 'a', data: rows[0].data, group: 'ספטמבר 2026' },
      { id: 'b', data: rows[1].data, group: 'ספטמבר 2026' },
      { id: 'c', data: { name: 'נועה לוי', state: 'שולם', balance: '—' }, group: 'אוגוסט 2026' },
    ];
    render(<Table caption="תנועות" columns={columns} rows={grouped} />);
    expect(screen.getAllByRole('rowheader', { name: 'ספטמבר 2026' })).toHaveLength(1);
    expect(screen.getAllByRole('rowheader', { name: 'אוגוסט 2026' })).toHaveLength(1);
  });

  it('renders a totals row that may span columns', () => {
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        totals={[
          { key: 'label', content: <><bdi>35</bdi> אנשים</>, colSpan: 2 },
          { key: 'sum', content: <bdi>12,200 ₪</bdi>, numeric: true },
        ]}
      />,
    );
    const foot = screen.getAllByRole('rowgroup')[2];
    expect(within(foot).getByText('12,200 ₪')).toBeTruthy();
  });

  it('adds a checkbox column when selection is offered and toggles one row', () => {
    const onToggleRow = vi.fn();
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        selection={{
          selectedIds: new Set(['b']),
          onToggleRow,
          onToggleAll: vi.fn(),
          rowCheckboxLabel: (id) => (id === 'a' ? 'בחירת רוני אדלר' : 'בחירת איתי כהן'),
          allCheckboxLabel: 'בחירת כל השורות',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'בחירת רוני אדלר' }));
    expect(onToggleRow).toHaveBeenCalledWith('a');
    expect(
      (screen.getByRole('checkbox', { name: 'בחירת איתי כהן' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('puts the header checkbox in the mixed state when some but not all are selected', () => {
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        selection={{
          selectedIds: new Set(['b']),
          onToggleRow: vi.fn(),
          onToggleAll: vi.fn(),
          rowCheckboxLabel: () => 'בחירה',
          allCheckboxLabel: 'בחירת כל השורות',
        }}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'בחירת כל השורות' }).getAttribute('aria-checked'),
    ).toBe('mixed');
  });

  it('renders the hover action slot inside the row', () => {
    render(
      <Table
        caption="רשימת אנשים"
        columns={columns}
        rows={rows}
        rowActions={(p) => <button type="button">{`אפשרויות ל${p.name}`}</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'אפשרויות לרוני אדלר' })).toBeTruthy();
  });

  it('shows the empty node instead of a body when there are no rows', () => {
    render(
      <Table caption="רשימת אנשים" columns={columns} rows={[]} empty={<p>אין תוצאות לסינון הזה</p>} />,
    );
    expect(screen.getByText('אין תוצאות לסינון הזה')).toBeTruthy();
    expect(screen.queryByText('רוני אדלר')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/table.test.tsx`
Expected: FAIL — `Failed to resolve import "./table"`, 0 tests run in that file.

- [ ] **Step 3: Write the component**

`src/components/ui/table.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';
import styles from './table.module.css';

export type ColumnAlign = 'start' | 'end';
export type RowTone = 'default' | 'warn' | 'bad';

export type TableColumn<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
  align?: ColumnAlign;
  w0?: boolean;
  srHeader?: string;
};

export type TableRowModel<Row> = {
  id: string;
  data: Row;
  tone?: RowTone;
  group?: string;
};

export type TableSelection = {
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  rowCheckboxLabel: (rowId: string) => string;
  allCheckboxLabel: string;
};

export type TableTotalsCell = {
  key: string;
  content: ReactNode;
  colSpan?: number;
  numeric?: boolean;
};

export type TableProps<Row> = {
  caption: string;
  captionVisible?: boolean;
  columns: ReadonlyArray<TableColumn<Row>>;
  rows: ReadonlyArray<TableRowModel<Row>>;
  selection?: TableSelection;
  rowActions?: (row: Row) => ReactNode;
  totals?: ReadonlyArray<TableTotalsCell>;
  empty?: ReactNode;
  density?: 'comfortable' | 'compact';
};

function cellClass<Row>(column: TableColumn<Row>): string {
  return cx(
    column.numeric && styles.numeric,
    column.align === 'end' && !column.numeric && styles.end,
    column.w0 && styles.w0,
  );
}

export function Table<Row>({
  caption, captionVisible, columns, rows, selection, rowActions, totals, empty,
  density = 'comfortable',
}: TableProps<Row>): ReactElement {
  const span = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);
  const selectedCount = selection
    ? rows.filter((row) => selection.selectedIds.has(row.id)).length
    : 0;
  const allChecked = selection !== undefined && rows.length > 0 && selectedCount === rows.length;
  const someChecked = selectedCount > 0 && !allChecked;

  let lastGroup: string | undefined;

  return (
    <div className={cx(styles.wrap, density === 'compact' && styles.compact)}>
      <table className={styles.table}>
        <caption className={captionVisible ? styles.caption : styles.srOnly}>{caption}</caption>
        <thead>
          <tr>
            {selection ? (
              <th scope="col" className={styles.w0}>
                <input
                  type="checkbox"
                  className={styles.check}
                  aria-label={selection.allCheckboxLabel}
                  aria-checked={someChecked ? 'mixed' : allChecked}
                  checked={allChecked}
                  onChange={selection.onToggleAll}
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.srHeader !== undefined
                  ? <span className={styles.srOnly}>{column.srHeader}</span>
                  : column.header}
              </th>
            ))}
            {rowActions ? <th scope="col" className={styles.w0} /> : null}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={span} className={styles.emptyCell}>{empty}</td>
            </tr>
          ) : (
            rows.flatMap((row) => {
              const nodes: ReactElement[] = [];
              if (row.group !== undefined && row.group !== lastGroup) {
                lastGroup = row.group;
                nodes.push(
                  <tr key={`group-${row.id}`} className={styles.groupRow}>
                    <th scope="rowgroup" colSpan={span}>{row.group}</th>
                  </tr>,
                );
              }
              const selected = selection?.selectedIds.has(row.id) ?? false;
              nodes.push(
                <tr
                  key={row.id}
                  data-tone={row.tone ?? 'default'}
                  className={cx(selected && styles.selected)}
                >
                  {selection ? (
                    <td className={styles.w0}>
                      <input
                        type="checkbox"
                        className={styles.check}
                        aria-label={selection.rowCheckboxLabel(row.id)}
                        checked={selected}
                        onChange={() => selection.onToggleRow(row.id)}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column)}>
                      {column.cell(row.data)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className={cx(styles.w0, styles.actions)}>{rowActions(row.data)}</td>
                  ) : null}
                </tr>,
              );
              return nodes;
            })
          )}
        </tbody>

        {totals ? (
          <tfoot>
            <tr>
              {totals.map((cell) => (
                <td
                  key={cell.key}
                  colSpan={cell.colSpan}
                  className={cx(cell.numeric && styles.numeric)}
                >
                  {cell.content}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/table.module.css`:

```css
.wrap {
  --row: 44px;
  border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel); overflow: auto; min-block-size: 0;
}
.compact { --row: 36px; }

.table { inline-size: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; }

.caption {
  text-align: start; padding: 12px 12px 8px;
  font-size: 13px; font-weight: 600; color: var(--ink);
}
.srOnly {
  position: absolute; inline-size: 1px; block-size: 1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}

.table th {
  block-size: 36px; padding-inline: 12px; text-align: start;
  font-weight: 500; font-size: 12.5px; color: var(--ink-3);
  background: var(--sunken); border-block-end: 1px solid var(--line);
  white-space: nowrap; position: sticky; inset-block-start: 0; z-index: 1;
}
.table td {
  block-size: var(--row); padding-inline: 12px;
  border-block-end: 1px solid var(--line);
  white-space: nowrap; vertical-align: middle;
}
.table tbody tr:last-child td { border-block-end: 0; }
.table tbody tr:hover td { background: var(--hover); }

.selected td { background: var(--selected); }
.table tbody tr[data-tone='warn'] td { background: var(--warn-soft); }
.table tbody tr[data-tone='bad'] td { background: var(--bad-soft); }

/*
 * A10's one documented exception: a numeric column is physically right-aligned
 * so that place values line up under each other in an RTL table.
 */
.numeric { text-align: right; font-variant-numeric: tabular-nums; }
.end { text-align: end; }
.w0 { inline-size: 1%; }

.groupRow th {
  block-size: 32px; background: var(--canvas); position: static;
  font-size: 12.5px; color: var(--ink-3); font-weight: 500;
}

.actions { text-align: end; }
.actions > * { opacity: 0; display: inline-flex; gap: 4px; }
.table tbody tr:hover .actions > *,
.table tbody tr:focus-within .actions > *,
.selected .actions > * { opacity: 1; }

.table tfoot td {
  background: var(--sunken); font-weight: 600;
  border-block-start: 1px solid var(--line); border-block-end: 0;
  position: sticky; inset-block-end: 0;
}

.emptyCell { block-size: auto; padding-block: 8px; text-align: center; white-space: normal; }

.check {
  inline-size: 16px; block-size: 16px; accent-color: var(--brand);
  margin: 0; cursor: pointer;
}
.check:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/table.test.tsx`
Expected: PASS — 1 file, 10 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. `Table<Row>` must infer `Row` from `rows`; if `tsc` reports `unknown` in a `cell` callback, the generic is wrong — fix `Table`, not the test.

- [ ] **Step 7: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): one table for the roster, the fees, the ledger, the debts and the grid

Columns carry alignment and a numeric flag, rows carry a tone and a group, and
the totals row spans. It sorts nothing and virtualises nothing: sort is a URL
param the server honours, and a virtualised body would disagree with the totals
row the page computed over the whole filtered set.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: A state is a word before it is a colour

**Files:**
- Create: `src/components/ui/pill.tsx`, `src/components/ui/pill.module.css`, `src/components/ui/pill.test.tsx`

**Ruling (binding):** R3 says every state pill carries a word, never colour alone. `PillProps.children` is therefore typed `string`, not `ReactNode`, and the component throws outside production when the string is blank — checked with `isBlank` from `@/lib/text/normalize`, because `.trim()` leaves the directional marks an RTL browser injects on copy-paste. A pill that is only a dot is a defect, and the cheapest place to catch it is the first render in development.

**Interfaces:**
- Consumes: `cx` (Task 1); `isBlank` from `@/lib/text/normalize`.
- Produces:

```ts
export type PillTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'outline';

export type PillProps = {
  tone?: PillTone;      // default 'neutral'
  /** The status dot. Decorative — the word is what carries the meaning. */
  dot?: boolean;
  /** The word. Always present; blank throws in development (R3). */
  children: string;
};

export function Pill(props: PillProps): ReactElement;
```

**Retires:** `import-review.module.css` `.badge`, `.badgeOk`, `.badgeWarn`.

- [ ] **Step 1: Write the failing test**

`src/components/ui/pill.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './pill';

describe('Pill', () => {
  it('renders the word', () => {
    render(<Pill tone="bad" dot>טרם שילם</Pill>);
    expect(screen.getByText('טרם שילם')).toBeTruthy();
  });

  it('hides the dot from assistive technology, because the word is the meaning', () => {
    const { container } = render(<Pill tone="ok" dot>שולם</Pill>);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeTruthy();
    expect(dot?.textContent).toBe('');
  });

  it('refuses a pill with no word (R3)', () => {
    expect(() => render(<Pill tone="warn">{'  '}</Pill>)).toThrow(/מילה/);
  });

  it('carries its tone as a class so the seven variants are distinguishable', () => {
    const { container } = render(<Pill tone="info">לידיעה</Pill>);
    expect(container.firstElementChild?.className).toContain('info');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/pill.test.tsx`
Expected: FAIL — `Failed to resolve import "./pill"`.

- [ ] **Step 3: Write the component**

`src/components/ui/pill.tsx`:

```tsx
import type { ReactElement } from 'react';
import { isBlank } from '@/lib/text/normalize';
import { cx } from './cx';
import styles from './pill.module.css';

export type PillTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'outline';

export type PillProps = {
  tone?: PillTone;
  dot?: boolean;
  children: string;
};

export function Pill({ tone = 'neutral', dot, children }: PillProps): ReactElement {
  /**
   * R3: the accent never carries meaning a colour-blind reader needs, so a
   * state is a word first. A dot on its own is not a state.
   */
  if (process.env.NODE_ENV !== 'production' && isBlank(children)) {
    throw new Error('Pill: כל תגית מצב חייבת לשאת מילה, לא רק צבע');
  }

  return (
    <span className={cx(styles.pill, styles[tone])}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/pill.module.css`:

```css
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  block-size: 22px; padding-inline: 8px; border-radius: 999px;
  font-size: 12px; font-weight: 500; white-space: nowrap;
  background: var(--sunken); color: var(--ink-2);
}
.dot { inline-size: 6px; block-size: 6px; border-radius: 50%; background: currentColor; }

.neutral { background: var(--sunken); color: var(--ink-2); }
.ok { background: var(--ok-soft); color: var(--ok); }
.warn { background: var(--warn-soft); color: var(--warn); }
.bad { background: var(--bad-soft); color: var(--bad); }
.info { background: var(--info-soft); color: var(--info); }
.brand { background: var(--brand-soft); color: var(--brand-text); }
.outline { background: transparent; color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-strong); }
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/pill.test.tsx`
Expected: PASS — 1 file, 4 tests. React logs the thrown error to `stderr` during the third test; that is expected, not a failure.

- [ ] **Step 6: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): a state pill carries a word, and refuses to exist without one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Initials, six tints, and the empty slot that is a call to action

**Files:**
- Create: `src/components/ui/avatar.tsx`, `src/components/ui/avatar.module.css`, `src/components/ui/avatar.test.tsx`

**Ruling (binding):**

1. **The tint is derived from the name, never random and never stored.** `tintIndex(name)` sums the code points of the normalised name modulo six. The same person is the same colour on every render, on the server and in the browser, without a column. Hydration mismatch is the failure this prevents, so the function must be pure and must not read the clock or `Math.random`.
2. **Initials are the first letter of each of the first two whitespace-separated words**, or the first letter alone for a one-word name. Hebrew has no case, so no `toUpperCase`.
3. **The avatar is decorative by default.** In every list it sits beside the name it belongs to, and announcing `רא` before `רוני אדלר` is noise. `decorative` defaults to `true` (`aria-hidden`); a stack, where there is no adjacent name, passes `decorative={false}` and gets `role="img"` with the person's name.
4. **The six tints are hex literals in `avatar.module.css`.** They are this component's own palette; A2 and A3 do not name them, and promoting them to `tokens.css` would put twelve values in the global sheet that only one component reads. This is the plan's single documented exception to the no-hex rule.

**Interfaces:**
- Consumes: `cx` (Task 1); `normalizeHebrew` from `@/lib/text/normalize`.
- Produces:

```ts
export type AvatarSize = 'sm' | 'md' | 'lg';   // 22px / 26px / 56px

export type AvatarProps =
  | { name: string; size?: AvatarSize; decorative?: boolean; empty?: never; label?: never }
  | { empty: true; size?: AvatarSize; label: string; name?: never; decorative?: never };

export type StackPerson = { id: string; name: string };

export type AvatarStackProps = {
  people: readonly StackPerson[];
  /** Avatars shown before the `+N` cap. Default 4. */
  max?: number;
  size?: AvatarSize;          // default 'sm'
  /** D9's clickable gaps: `5/8` renders three dashed slots. */
  emptySlots?: number;
  /** Where an empty slot leads — the assign popover's URL for slot `index`. */
  emptySlotHref?: (index: number) => string;
  /** The accessible name of the whole group: `משובצים למשמרת שער`. */
  label: string;
};

export function tintIndex(name: string): number;         // 0..5
export function initials(name: string): string;
export function Avatar(props: AvatarProps): ReactElement;
export function AvatarStack(props: AvatarStackProps): ReactElement;
```

**Retires:** `tasks.module.css` `.assignees` and `.assignees li`, which render assignees as a bare comma list today; D9 replaces them with a stack and its empty slots.

- [ ] **Step 1: Write the failing test**

`src/components/ui/avatar.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AvatarStack, initials, tintIndex } from './avatar';

describe('initials', () => {
  it('takes one letter from each of the first two words', () => {
    expect(initials('רוני אדלר')).toBe('רא');
    expect(initials('מאיה בת שבע פרץ')).toBe('מב');
  });

  it('takes one letter from a one-word name', () => {
    expect(initials('נועה')).toBe('נ');
  });
});

describe('tintIndex', () => {
  it('is stable for the same name, so the server and the browser agree', () => {
    expect(tintIndex('רוני אדלר')).toBe(tintIndex('רוני אדלר'));
  });

  it('stays inside the six tints', () => {
    for (const name of ['רוני אדלר', 'איתי כהן', 'נועה לוי', 'מאיה פרץ', 'Ofek', 'ש']) {
      expect(tintIndex(name)).toBeGreaterThanOrEqual(0);
      expect(tintIndex(name)).toBeLessThan(6);
    }
  });
});

describe('Avatar', () => {
  it('is decorative beside a name it sits next to', () => {
    const { container } = render(<Avatar name="רוני אדלר" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names itself when it stands alone', () => {
    render(<Avatar name="רוני אדלר" decorative={false} />);
    expect(screen.getByRole('img', { name: 'רוני אדלר' })).toBeTruthy();
  });

  it('renders an empty dashed slot with its own label', () => {
    render(<Avatar empty label="משבצת פנויה" />);
    expect(screen.getByRole('img', { name: 'משבצת פנויה' })).toBeTruthy();
  });
});

describe('AvatarStack', () => {
  const people = [
    { id: '1', name: 'רוני אדלר' },
    { id: '2', name: 'איתי כהן' },
    { id: '3', name: 'נועה לוי' },
    { id: '4', name: 'מאיה פרץ' },
    { id: '5', name: 'יואב שפירא' },
    { id: '6', name: 'שירה מזרחי' },
  ];

  it('names the group and caps the overflow', () => {
    render(<AvatarStack people={people} max={4} label="משובצים למשמרת שער" />);
    expect(screen.getByRole('group', { name: 'משובצים למשמרת שער' })).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('shows every person when there is no overflow', () => {
    render(<AvatarStack people={people.slice(0, 3)} max={4} label="משובצים" />);
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.getByRole('img', { name: 'נועה לוי' })).toBeTruthy();
  });

  it('turns each empty slot into a link when one is offered', () => {
    render(
      <AvatarStack
        people={people.slice(0, 2)}
        emptySlots={2}
        emptySlotHref={(i) => `/tasks?assign=gate&slot=${i}`}
        label="משובצים למשמרת שער"
      />,
    );
    const links = screen.getAllByRole('link', { name: 'שיבוץ לתפקיד פנוי' });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/tasks?assign=gate&slot=0');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/avatar.test.tsx`
Expected: FAIL — `Failed to resolve import "./avatar"`.

- [ ] **Step 3: Write the component**

`src/components/ui/avatar.tsx`:

```tsx
import type { ReactElement } from 'react';
import Link from 'next/link';
import { normalizeHebrew } from '@/lib/text/normalize';
import { cx } from './cx';
import styles from './avatar.module.css';

export type AvatarSize = 'sm' | 'md' | 'lg';

export type AvatarProps =
  | { name: string; size?: AvatarSize; decorative?: boolean; empty?: never; label?: never }
  | { empty: true; size?: AvatarSize; label: string; name?: never; decorative?: never };

export type StackPerson = { id: string; name: string };

export type AvatarStackProps = {
  people: readonly StackPerson[];
  max?: number;
  size?: AvatarSize;
  emptySlots?: number;
  emptySlotHref?: (index: number) => string;
  label: string;
};

/** Hebrew has no case, so there is nothing to upper-case. */
export function initials(name: string): string {
  const words = normalizeHebrew(name).split(' ').filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return [...words[0]][0] ?? '';
  return `${[...words[0]][0] ?? ''}${[...words[1]][0] ?? ''}`;
}

/**
 * Pure and deterministic: the same person is the same colour on the server and
 * in the browser, so hydration matches, and no column has to store a colour.
 */
export function tintIndex(name: string): number {
  const normalized = normalizeHebrew(name);
  let sum = 0;
  for (const character of normalized) sum += character.codePointAt(0) ?? 0;
  return sum % 6;
}

export function Avatar(props: AvatarProps): ReactElement {
  const size = props.size ?? 'md';

  if (props.empty) {
    return (
      <span
        className={cx(styles.avatar, styles[size], styles.empty)}
        role="img"
        aria-label={props.label}
      />
    );
  }

  const decorative = props.decorative ?? true;
  return (
    <span
      className={cx(styles.avatar, styles[size], styles[`tint${tintIndex(props.name)}`])}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : props.name}
    >
      {initials(props.name)}
    </span>
  );
}

export function AvatarStack({
  people, max = 4, size = 'sm', emptySlots = 0, emptySlotHref, label,
}: AvatarStackProps): ReactElement {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <span className={styles.stack} role="group" aria-label={label}>
      {shown.map((person) => (
        <Avatar key={person.id} name={person.name} size={size} decorative={false} />
      ))}
      {overflow > 0 ? (
        <span className={cx(styles.avatar, styles[size], styles.overflow)} role="img" aria-label={`ועוד ${overflow}`}>
          {`+${overflow}`}
        </span>
      ) : null}
      {Array.from({ length: emptySlots }, (_, index) =>
        emptySlotHref ? (
          <Link key={`slot-${index}`} href={emptySlotHref(index)} className={styles.slotLink} aria-label="שיבוץ לתפקיד פנוי">
            <Avatar empty size={size} label="" />
          </Link>
        ) : (
          <Avatar key={`slot-${index}`} empty size={size} label="תפקיד פנוי" />
        ),
      )}
    </span>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/avatar.module.css`:

```css
/*
 * The six tints are hex literals on purpose: they are this component's own
 * palette, A2 and A3 do not name them, and no other stylesheet reads them.
 * This is the kit's one documented exception to tokens-only colour.
 */
.avatar {
  inline-size: 26px; block-size: 26px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; user-select: none;
}
.sm { inline-size: 22px; block-size: 22px; font-size: 10px; }
.md { inline-size: 26px; block-size: 26px; font-size: 11px; }
.lg { inline-size: 56px; block-size: 56px; font-size: 20px; }

.tint0 { background: #F3D9C4; color: #6B3413; }
.tint1 { background: #D7E6F7; color: #1D4477; }
.tint2 { background: #D5EEDF; color: #1B5A38; }
.tint3 { background: #EADCF5; color: #542C7A; }
.tint4 { background: #F6E3B4; color: #6A4A00; }
.tint5 { background: #F5D5DA; color: #7A2433; }

.empty { background: transparent; border: 1.5px dashed var(--line-strong); color: var(--ink-4); }
.overflow { background: var(--sunken); color: var(--ink-2); }

:root[data-theme='dark'] .avatar { filter: saturate(0.9) brightness(0.9); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .avatar { filter: saturate(0.9) brightness(0.9); }
}

.stack { display: inline-flex; }
.stack > * { box-shadow: 0 0 0 2px var(--panel); border-radius: 50%; }
.stack > * + * { margin-inline-start: -6px; }
.slotLink { display: inline-flex; }
.slotLink:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 50%; }
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/avatar.test.tsx`
Expected: PASS — 1 file, 10 tests.

- [ ] **Step 6: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): initials in a colour derived from the name, and a gap you can click

The tint is a pure function of the name, so the server and the browser agree
and no column stores a colour. An unfilled slot in a stack is a link, because
an empty slot on a task is an invitation rather than a report.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: A banner is one sentence and at most one way out

**Files:**
- Create: `src/components/ui/banner.tsx`, `src/components/ui/banner.module.css`, `src/components/ui/banner.test.tsx`

**Ruling (binding):**

1. **At most one action, enforced by the type.** `action` is a single optional object, not an array. Three banners with two buttons each is how the current `/data` page reads; C9 says one sentence, one action.
2. **The action is always an `href`.** A banner that needs to write belongs in a `Drawer` or a `ConfirmDialog`. Keeping the action a link keeps `Banner` free of `'use client'` and lets every banner survive a refresh.
3. **No live region by default.** A banner present on first paint must not be announced assertively; `role="status"` is added only when `live` is set, for a banner a Server Action rendered in response to something the lead just did.

**Interfaces:**
- Consumes: `cx` (Task 1); `Icon`, `IconName` (plan 01); `ButtonLink` (Task 1).
- Produces:

```ts
export type BannerTone = 'neutral' | 'info' | 'warn' | 'danger';

export type BannerProps = {
  tone?: BannerTone;                   // default 'neutral'
  /** The lead clause, rendered at weight 600. */
  headline: ReactNode;
  /** The rest of the sentence. */
  detail?: ReactNode;
  /** C9: at most one. A link, never a form. */
  action?: { label: string; href: string };
  /** Overrides the tone's default icon. */
  icon?: IconName;
  /** `role="status"` for a banner that appears in response to an action (E2). */
  live?: boolean;
};

export function Banner(props: BannerProps): ReactElement;
```

**Retires:** `import-review.module.css` `.errorNote`, `.confirmedNote`; `data.module.css` `.flag`, `.flagTitle`, `.flagBody`, `.why`; `members.module.css` `.mergeRefusal`.

- [ ] **Step 1: Write the failing test**

`src/components/ui/banner.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banner } from './banner';

describe('Banner', () => {
  it('reads as one sentence: headline then detail', () => {
    render(
      <Banner
        tone="info"
        headline="3 שמות מהקבצים עדיין לא שויכו לאף אחד."
        detail="המערכת לא מנחשת מי הם — מיזוג של שני אנשים אינו הפיך."
      />,
    );
    expect(screen.getByText('3 שמות מהקבצים עדיין לא שויכו לאף אחד.')).toBeTruthy();
    expect(screen.getByText(/מיזוג של שני אנשים אינו הפיך/)).toBeTruthy();
  });

  it('offers its single action as a link', () => {
    render(<Banner tone="warn" headline="יש כסף שלא שויך" action={{ label: 'לשיוך', href: '/inbox' }} />);
    expect(screen.getByRole('link', { name: 'לשיוך' }).getAttribute('href')).toBe('/inbox');
  });

  it('is not a live region on first paint', () => {
    render(<Banner headline="ייבוא לא כותב כלום עד שתאשרו." />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('becomes a status region when it reports what just happened', () => {
    render(<Banner tone="danger" live headline="הקידום סורב" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/banner.test.tsx`
Expected: FAIL — `Failed to resolve import "./banner"`.

- [ ] **Step 3: Write the component**

`src/components/ui/banner.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { ButtonLink } from './button';
import { cx } from './cx';
import styles from './banner.module.css';

export type BannerTone = 'neutral' | 'info' | 'warn' | 'danger';

export type BannerProps = {
  tone?: BannerTone;
  headline: ReactNode;
  detail?: ReactNode;
  action?: { label: string; href: string };
  icon?: IconName;
  live?: boolean;
};

const TONE_ICON: Record<BannerTone, IconName> = {
  neutral: 'info',
  info: 'info',
  warn: 'alert',
  danger: 'alert',
};

export function Banner({
  tone = 'neutral', headline, detail, action, icon, live,
}: BannerProps): ReactElement {
  return (
    <div className={cx(styles.banner, styles[tone])} role={live ? 'status' : undefined}>
      <span className={styles.icon}>
        <Icon name={icon ?? TONE_ICON[tone]} size={16} />
      </span>
      <span className={styles.text}>
        <b className={styles.headline}>{headline}</b>
        {detail ? <> {detail}</> : null}
      </span>
      {action ? (
        <ButtonLink size="sm" href={action.href}>{action.label}</ButtonLink>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/banner.module.css`:

```css
.banner {
  display: flex; align-items: center; gap: 12px;
  padding-block: 10px; padding-inline: 14px; border-radius: 10px;
  border: 1px solid transparent; color: var(--ink); font-size: 13.5px;
}
.icon { display: inline-flex; flex-shrink: 0; }
.text { flex: 1; min-inline-size: 0; }
.headline { font-weight: 600; }

.neutral { background: var(--sunken); }
.neutral .icon { color: var(--ink-3); }

.info { background: var(--info-soft); }
.info .icon { color: var(--info); }

.warn { background: var(--warn-soft); border-color: var(--warn-line); }
.warn .icon { color: var(--warn); }

.danger { background: var(--bad-soft); }
.danger .icon { color: var(--bad); }

@media (max-width: 768px) {
  .banner { flex-wrap: wrap; }
  .text { flex-basis: 100%; }
}
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/banner.test.tsx`
Expected: PASS — 1 file, 4 tests. If `Icon` rejects the name `alert`, read plan 01's `IconName` union and use its nearest member rather than adding a path here.

- [ ] **Step 6: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): a banner is one sentence and at most one way out

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Five empty states, and the Hebrew for each

**Files:**
- Create: `src/components/ui/empty-state.tsx`, `src/components/ui/empty-state.module.css`, `src/components/ui/empty-state.test.tsx`

**Ruling (binding) — the kit owns the wording.** C10 and E1 say every list screen implements all five, and the parent spec says an empty state is an invitation. If each screen wrote its own sentence there would be eleven dialects of "nothing here". So the kit owns the **title verbatim** and **builds the body from the kind's own template**; a screen passes at most a plural noun phrase and a season name, never a sentence. Screens may add an action, and nothing else.

The five kinds, with their exact copy:

| kind | title | body | icon | who uses it |
|---|---|---|---|---|
| `nothing-yet` | `אין כאן כלום עדיין` | `כאן יופיעו {noun}. עדיין לא נוספו.` | `inbox`, ink-4 | a table before the first import (D1, D10) |
| `nothing-this-season` | `אין כאן כלום לשנה הזו` | `אין {noun} ב{seasonName}. בשנים אחרות ייתכן שיש.` | `calendar`, ink-4 | every season-scoped list (R5, D5, D7, D9) |
| `no-matches` | `אין תוצאות לסינון הזה` | with `filterSummary`: `נסו להסיר את הסינון ״{filterSummary}״.` — without it: `נסו להסיר סינון או לשנות את החיפוש.` | `filter`, ink-4 | every filtered list (D3, D5, D7, D8) |
| `not-permitted` | `אין לך גישה לתוכן הזה` | `החלק הזה פתוח למנהלי הקאמפ בלבד. אם זו טעות, פנו למי שנתן לכם את הגישה.` | `lock`, ink-4 | B9's signed-in non-admin, instead of a 404 |
| `all-clear` | `הכול מטופל` | `לא נשאר כלום לטפל בו כאן.` | `check`, **ok** | D2's inbox — the only kind that celebrates |

`all-clear` takes no noun on purpose: `אין X שממתינים` forces the caller to agree gender with a noun the kit cannot see, and a wrong agreement is worse than a plainer sentence. `nothing-yet` and `nothing-this-season` take a plural noun only, which `אין` and `יופיעו` govern identically in both genders.

**Interfaces:**
- Consumes: `cx` (Task 1); `Icon` (plan 01); `ButtonLink` (Task 1).
- Produces:

```ts
export type EmptyStateAction = { label: string; href: string };

export type EmptyStateProps =
  | { kind: 'nothing-yet'; noun: string; action?: EmptyStateAction }
  | { kind: 'nothing-this-season'; noun: string; seasonName: string; action?: EmptyStateAction }
  | { kind: 'no-matches'; filterSummary?: string; action?: EmptyStateAction }
  | { kind: 'not-permitted' }
  | { kind: 'all-clear' };

export const EMPTY_TITLES: Readonly<Record<EmptyStateProps['kind'], string>>;
export function emptyStateBody(props: EmptyStateProps): string;
export function EmptyState(props: EmptyStateProps): ReactElement;
```

**Retires:** `import-review.module.css` `.empty`; `data.module.css` `.empty`. Both are a grey sentence with no invitation and no kind.

- [ ] **Step 1: Write the failing test**

`src/components/ui/empty-state.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState, EMPTY_TITLES, emptyStateBody } from './empty-state';

describe('emptyStateBody', () => {
  it('writes the sentence for each kind so no screen invents its own', () => {
    expect(emptyStateBody({ kind: 'nothing-yet', noun: 'תשלומים' }))
      .toBe('כאן יופיעו תשלומים. עדיין לא נוספו.');
    expect(emptyStateBody({ kind: 'nothing-this-season', noun: 'תנועות', seasonName: 'ברן 26' }))
      .toBe('אין תנועות בברן 26. בשנים אחרות ייתכן שיש.');
    expect(emptyStateBody({ kind: 'no-matches', filterSummary: 'טרם שילמו' }))
      .toBe('נסו להסיר את הסינון ״טרם שילמו״.');
    expect(emptyStateBody({ kind: 'no-matches' }))
      .toBe('נסו להסיר סינון או לשנות את החיפוש.');
    expect(emptyStateBody({ kind: 'not-permitted' }))
      .toBe('החלק הזה פתוח למנהלי הקאמפ בלבד. אם זו טעות, פנו למי שנתן לכם את הגישה.');
    expect(emptyStateBody({ kind: 'all-clear' }))
      .toBe('לא נשאר כלום לטפל בו כאן.');
  });
});

describe('EmptyState', () => {
  it('has exactly five kinds', () => {
    expect(Object.keys(EMPTY_TITLES)).toHaveLength(5);
  });

  it('renders the title as a heading and the body beneath it', () => {
    render(<EmptyState kind="nothing-yet" noun="קבצים" />);
    expect(screen.getByRole('heading', { name: 'אין כאן כלום עדיין' })).toBeTruthy();
    expect(screen.getByText('כאן יופיעו קבצים. עדיין לא נוספו.')).toBeTruthy();
  });

  it('names the season it is empty for', () => {
    render(<EmptyState kind="nothing-this-season" noun="תשלומים" seasonName="ברן 26" />);
    expect(screen.getByText('אין תשלומים בברן 26. בשנים אחרות ייתכן שיש.')).toBeTruthy();
  });

  it('invites an action when the screen offers one', () => {
    render(
      <EmptyState kind="nothing-yet" noun="קבצים" action={{ label: 'העלאת קובץ', href: '/imports' }} />,
    );
    expect(screen.getByRole('link', { name: 'העלאת קובץ' }).getAttribute('href')).toBe('/imports');
  });

  it('celebrates only in all-clear', () => {
    const { container: clear } = render(<EmptyState kind="all-clear" />);
    expect(clear.firstElementChild?.className).toContain('celebrate');
    const { container: filtered } = render(<EmptyState kind="no-matches" />);
    expect(filtered.firstElementChild?.className).not.toContain('celebrate');
  });

  it('offers no action at all when the reader may not see the content', () => {
    render(<EmptyState kind="not-permitted" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('heading', { name: 'אין לך גישה לתוכן הזה' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/empty-state.test.tsx`
Expected: FAIL — `Failed to resolve import "./empty-state"`.

- [ ] **Step 3: Write the component**

`src/components/ui/empty-state.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { ButtonLink } from './button';
import { cx } from './cx';
import styles from './empty-state.module.css';

export type EmptyStateAction = { label: string; href: string };

export type EmptyStateProps =
  | { kind: 'nothing-yet'; noun: string; action?: EmptyStateAction }
  | { kind: 'nothing-this-season'; noun: string; seasonName: string; action?: EmptyStateAction }
  | { kind: 'no-matches'; filterSummary?: string; action?: EmptyStateAction }
  | { kind: 'not-permitted' }
  | { kind: 'all-clear' };

export const EMPTY_TITLES: Readonly<Record<EmptyStateProps['kind'], string>> = {
  'nothing-yet': 'אין כאן כלום עדיין',
  'nothing-this-season': 'אין כאן כלום לשנה הזו',
  'no-matches': 'אין תוצאות לסינון הזה',
  'not-permitted': 'אין לך גישה לתוכן הזה',
  'all-clear': 'הכול מטופל',
};

const KIND_ICON: Readonly<Record<EmptyStateProps['kind'], IconName>> = {
  'nothing-yet': 'inbox',
  'nothing-this-season': 'calendar',
  'no-matches': 'filter',
  'not-permitted': 'lock',
  'all-clear': 'check',
};

/**
 * The kit writes the sentence. A screen supplies a plural noun and a season
 * name at most, so that eleven lists do not grow eleven dialects of "nothing
 * here" — and so that the wording can be changed in one place.
 */
export function emptyStateBody(props: EmptyStateProps): string {
  switch (props.kind) {
    case 'nothing-yet':
      return `כאן יופיעו ${props.noun}. עדיין לא נוספו.`;
    case 'nothing-this-season':
      return `אין ${props.noun} ב${props.seasonName}. בשנים אחרות ייתכן שיש.`;
    case 'no-matches':
      return props.filterSummary === undefined
        ? 'נסו להסיר סינון או לשנות את החיפוש.'
        : `נסו להסיר את הסינון ״${props.filterSummary}״.`;
    case 'not-permitted':
      return 'החלק הזה פתוח למנהלי הקאמפ בלבד. אם זו טעות, פנו למי שנתן לכם את הגישה.';
    case 'all-clear':
      return 'לא נשאר כלום לטפל בו כאן.';
  }
}

export function EmptyState(props: EmptyStateProps): ReactElement {
  const action = 'action' in props ? props.action : undefined;
  return (
    <div className={cx(styles.empty, props.kind === 'all-clear' && styles.celebrate)}>
      <span className={styles.icon}><Icon name={KIND_ICON[props.kind]} size={20} /></span>
      <h3 className={styles.title}>{EMPTY_TITLES[props.kind]}</h3>
      <p className={styles.body}>{emptyStateBody(props)}</p>
      {action ? (
        <ButtonLink tone="primary" size="sm" href={action.href}>{action.label}</ButtonLink>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/empty-state.module.css`:

```css
.empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 6px; padding-block: 24px; padding-inline: 16px; color: var(--ink);
}
.icon { display: inline-flex; color: var(--ink-4); }
.title { font-size: 14.5px; font-weight: 600; margin: 0; }
.body { font-size: 12.5px; color: var(--ink-3); margin: 0; max-inline-size: 46ch; }
.empty > a { margin-block-start: 4px; }

.celebrate .icon { color: var(--ok); }
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/empty-state.test.tsx`
Expected: PASS — 1 file, 7 tests.

- [ ] **Step 6: Typecheck the union**

Run: `npx tsc --noEmit`
Expected: no output. `emptyStateBody` must be exhaustive without a `default` branch — if `tsc` reports a missing return, a kind is unhandled.

- [ ] **Step 7: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): five empty states, and the Hebrew for each lives in one place

Screens pass a plural noun and a season name. They do not write the sentence,
so eleven lists cannot grow eleven dialects of "nothing here".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 7: StatTile moves out of the chart folder and gains a bar and a link

**Files:**
- Create: `src/components/ui/stat-tile.tsx`, `src/components/ui/stat-tile.module.css`, `src/components/ui/stat-tile.test.tsx`
- Delete: `src/components/charts/stat-tile.tsx`
- Modify: `src/components/charts/charts.module.css` (drop `.tile`, `.tileValue`, `.tileLabel`, `.tileDerivation`)
- Modify: `src/app/(admin)/money/page.tsx` — **the import line only**

**How the migration goes, exactly.**

- **The file that exists today** is `src/components/charts/stat-tile.tsx`, 21 lines, props `{ label: string; valueAgorot: number; derivation?: string }`, rendering three `<div>`s from `charts.module.css`.
- **It has no test file.** `src/components/charts/` holds `bar-list.test.tsx`, `geometry.test.ts`, `meter.test.tsx` and `stacked-bar.test.tsx` and no `stat-tile.test.tsx`. So there is no test to move: this task writes the test the component never had, at `src/components/ui/stat-tile.test.tsx`. Confirm this in Step 1 with `ls src/components/charts` before deleting anything; if a test has appeared since this plan was written, move it and merge its cases rather than replacing them.
- **Its only importer** is `src/app/(admin)/money/page.tsx`: one `import` and four call sites (`יתרה בכל החשבונות`, `נכנס בשנה הזו`, `יצא בשנה הזו`, `אנחנו חייבים`). `/money` belongs to D6 and is not redesigned here, so this task changes the import path and nothing else. The four call sites must compile and render unchanged.
- **What keeps working:** all four tiles keep their label, keep `formatILS(valueAgorot)` with `₪` last inside a `<bdi>`, and keep their derivation line. The prop type stays assignable: `valueAgorot` remains one arm of the new value union, so none of the four call sites is edited.
- **What changes on screen:** the figure loses `var(--font-display)` (Frank Ruhl Libre), which A5 reduces to the wordmark and the sign-in page, and becomes Heebo 600 at 26px per A6. No test asserts a font family, so no test changes; say so in the report.
- **`charts.module.css` keeps `.viz` and every chart class.** `bar-list.tsx`, `meter.tsx` and `stacked-bar.tsx` read `.row`, `.label`, `.value`, `.track`, `.mark1..3`, `.legend`, `.legendLabel`, `.swatch` and `.tableView`, and none of them reads a `.tile*` class. Verify with a grep in Step 6 before deleting.

**Interfaces:**
- Consumes: `formatILS` from `@/lib/money`; `cx` (Task 1).
- Produces:

```ts
export type StatTileBarSegment = {
  id: string;
  /** 0–100, clamped. The unfilled remainder is the track (A4). */
  percent: number;
  kind: 'dues' | 'fund' | 'reserve' | 'partial';
};

export type StatTileBar = {
  segments: readonly StatTileBarSegment[];
  /** The bar's accessible name — it is `role="img"`, as `Meter` already is. */
  label: string;
};

type StatTileValue =
  | { valueAgorot: number; value?: never }
  | { value: ReactNode; valueAgorot?: never };

export type StatTileProps = StatTileValue & {
  label: string;
  /** Wave 1's rule: no number is unexplained. */
  derivation?: ReactNode;
  bar?: StatTileBar;
  /** D1: every figure links to the page that can change it. */
  href?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';   // default 'default'
};

export function StatTile(props: StatTileProps): ReactElement;
```

**Retires:** `charts.module.css` `.tile`, `.tileValue`, `.tileLabel`, `.tileDerivation`; `fees.module.css` `.summary` (the `<dl>` of four figures above the fees table); `import-review.module.css` `.summary`; `data.module.css` `.spine`, `.spineItem`, `.spineLabel`, `.spineValue`, `.spineArrow`.

- [ ] **Step 1: Confirm what is being moved**

Run: `ls src/components/charts && grep -rn "charts/stat-tile\|StatTile" src`
Expected: `stat-tile.tsx` present with no `stat-tile.test.tsx`; exactly five hits for `StatTile`, all of them in `src/app/(admin)/money/page.tsx` plus the definition. If the counts differ, update the plan's claim in the report before continuing.

- [ ] **Step 2: Write the failing test**

`src/components/ui/stat-tile.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTile } from './stat-tile';

describe('StatTile', () => {
  it('renders money through formatILS with the symbol last', () => {
    render(<StatTile label="נגבה" valueAgorot={2430000} />);
    expect(screen.getByText('24,300 ₪')).toBeTruthy();
  });

  it('keeps the derivation line, so no number is unexplained', () => {
    render(
      <StatTile
        label="צפי גבייה"
        valueAgorot={3650000}
        derivation="28 בתעריף רגיל · 5 חריגים"
      />,
    );
    expect(screen.getByText('28 בתעריף רגיל · 5 חריגים')).toBeTruthy();
  });

  it('renders a non-money figure as it was given', () => {
    render(<StatTile label="כיסוי משימות" value={<bdi>5/8</bdi>} />);
    expect(screen.getByText('5/8')).toBeTruthy();
  });

  it('names its bar for assistive technology', () => {
    render(
      <StatTile
        label="נגבה"
        valueAgorot={2430000}
        bar={{ label: '67% מהצפי', segments: [{ id: 'paid', percent: 62, kind: 'dues' }] }}
      />,
    );
    expect(screen.getByRole('img', { name: '67% מהצפי' })).toBeTruthy();
  });

  it('links the whole tile onward when the figure has a page that can change it', () => {
    render(<StatTile label="חובות פתוחים" valueAgorot={1400000} href="/money/debts" />);
    expect(screen.getByRole('link', { name: /חובות פתוחים/ }).getAttribute('href'))
      .toBe('/money/debts');
  });

  it('is not a link when there is nowhere to go', () => {
    render(<StatTile label="יצא בשנה הזו" valueAgorot={500000} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npx vitest run src/components/ui/stat-tile.test.tsx`
Expected: FAIL — `Failed to resolve import "./stat-tile"`.

- [ ] **Step 4: Write the component**

`src/components/ui/stat-tile.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { formatILS } from '@/lib/money';
import { cx } from './cx';
import styles from './stat-tile.module.css';

export type StatTileBarSegment = {
  id: string;
  percent: number;
  kind: 'dues' | 'fund' | 'reserve' | 'partial';
};

export type StatTileBar = {
  segments: readonly StatTileBarSegment[];
  label: string;
};

type StatTileValue =
  | { valueAgorot: number; value?: never }
  | { value: ReactNode; valueAgorot?: never };

export type StatTileProps = StatTileValue & {
  label: string;
  derivation?: ReactNode;
  bar?: StatTileBar;
  href?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
};

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

export function StatTile({
  label, valueAgorot, value, derivation, bar, href, tone = 'default',
}: StatTileProps): ReactElement {
  const body = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={cx(styles.value, tone !== 'default' && styles[tone])}>
        {valueAgorot === undefined ? value : <bdi>{`${formatILS(valueAgorot)} ₪`}</bdi>}
      </span>
      {bar ? (
        <span className={styles.bar} role="img" aria-label={bar.label}>
          {bar.segments.map((segment) => (
            <i
              key={segment.id}
              className={styles[segment.kind]}
              style={{ inlineSize: `${clampPercent(segment.percent)}%` }}
            />
          ))}
        </span>
      ) : null}
      {derivation ? <span className={styles.derivation}>{derivation}</span> : null}
    </>
  );

  return href === undefined
    ? <div className={styles.tile}>{body}</div>
    : <Link className={cx(styles.tile, styles.linked)} href={href}>{body}</Link>;
}
```

- [ ] **Step 5: Write the stylesheet**

`src/components/ui/stat-tile.module.css`:

```css
.tile {
  display: flex; flex-direction: column; gap: 4px;
  padding-block: 14px; padding-inline: 16px;
  border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel); color: var(--ink); text-decoration: none;
}
.linked:hover { border-color: var(--line-strong); background: var(--hover); }
.linked:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.label { font-size: 12.5px; color: var(--ink-3); display: flex; align-items: center; gap: 6px; }
.value {
  font-size: 26px; font-weight: 600; line-height: 1.2; letter-spacing: -0.3px;
  font-variant-numeric: tabular-nums;
}
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.bad { color: var(--bad); }

.derivation { font-size: 12.5px; color: var(--ink-3); }

.bar {
  block-size: 6px; border-radius: 999px; background: var(--viz-track);
  overflow: hidden; display: flex; gap: 2px; margin-block: 4px 2px;
}
.bar > i { display: block; block-size: 100%; }
.dues { background: var(--viz-dues); }
.fund { background: var(--viz-fund); }
.reserve { background: var(--viz-reserve); }
.partial { background: var(--warn-line); }
```

`--viz-dues`, `--viz-fund` and `--viz-reserve` are A4's chart palette. If plan 01 kept them scoped to `.viz` rather than `:root`, add the three to `tokens.test.ts`'s `KIT_TOKENS` and report the change; do not redeclare them here.

- [ ] **Step 6: Verify nothing else reads the tile classes, then delete them**

Run: `grep -rn "tileValue\|tileLabel\|tileDerivation\|styles.tile" src`
Expected: hits only in the file about to be deleted. Then delete `.tile`, `.tileValue`, `.tileLabel` and `.tileDerivation` from `src/components/charts/charts.module.css`, and delete `src/components/charts/stat-tile.tsx`.

- [ ] **Step 7: Repoint the one importer**

In `src/app/(admin)/money/page.tsx`, change

```ts
import { StatTile } from '@/components/charts/stat-tile';
```

to

```ts
import { StatTile } from '@/components/ui/stat-tile';
```

Change nothing else in that file. `/money` belongs to D6.

- [ ] **Step 8: Run the new test and the whole charts and money surface**

Run: `npx vitest run src/components/ui/stat-tile.test.tsx src/components/charts`
Expected: PASS — 5 files, 6 new tests plus the existing chart tests, all green. Read the COUNT.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. The four `/money` call sites pass `valueAgorot` and must satisfy the new value union without an edit; if they do not, the union is wrong, not the page.

- [ ] **Step 10: Commit**

```
git add -A src/components src/app && git commit -F - <<'MSG'
feat(ui): StatTile moves into the kit and gains a bar and a link

It had no test of its own in components/charts; this is the one it never had.
The four tiles on /money keep their labels, their formatILS amounts and their
derivation lines, and only their typeface changes, because A5 reduces Frank
Ruhl Libre to the wordmark and the sign-in page.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 8: Every number says where it came from

**Files:**
- Create: `src/components/ui/source-chip.tsx`, `src/components/ui/source-chip.module.css`, `src/components/ui/source-chip.test.tsx`

**Ruling (binding):** `SourceChip` takes an already-resolved `SourceRef`. Turning a row's `source_block_id` and `source_row` into `תנועות קופה!A14` needs the block's sheet name and its column letter, which is a query, and R11 is explicit that this is a *display* of stored columns and not a new one. The query function that resolves a block reference into a sheet name and an A1 address belongs to the screen plans that need it (D6–D8, D10). The kit renders what it is handed and nothing more.

The chip is a link when the caller knows where the block lives and a plain span otherwise; a chip for a block that has since been deleted must still render its text, because the figure is still explained by a cell that once existed.

**Interfaces:**
- Consumes: `cx` (Task 1).
- Produces:

```ts
export type SourceRef =
  | { kind: 'workbook'; sheet: string; cell: string; blockHref?: string }
  | { kind: 'manual' };

export type SourceChipProps = { source: SourceRef };

/** `תנועות קופה!A14` or `נרשם ידנית` — one string, so a table and a drawer agree. */
export function formatSourceRef(source: SourceRef): string;
export function SourceChip(props: SourceChipProps): ReactElement;
```

**Retires:** nothing, because no screen shows provenance today — R11 and C12 are new. It replaces the range text in `import-review.module.css` `.range` and the block label in `data.module.css` `.blockLabel` when D10 lands.

- [ ] **Step 1: Write the failing test**

`src/components/ui/source-chip.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceChip, formatSourceRef } from './source-chip';

describe('formatSourceRef', () => {
  it('writes a workbook reference as sheet!cell', () => {
    expect(formatSourceRef({ kind: 'workbook', sheet: 'תנועות קופה', cell: 'A14' }))
      .toBe('תנועות קופה!A14');
  });

  it('says so in Hebrew when a lead typed the number', () => {
    expect(formatSourceRef({ kind: 'manual' })).toBe('נרשם ידנית');
  });
});

describe('SourceChip', () => {
  it('shows the cell and names it as a source', () => {
    render(<SourceChip source={{ kind: 'workbook', sheet: 'תנועות קופה', cell: 'A14' }} />);
    expect(screen.getByText('תנועות קופה!A14')).toBeTruthy();
    expect(screen.getByLabelText('מקור: תנועות קופה!A14')).toBeTruthy();
  });

  it('links to the block when the caller knows where it lives', () => {
    render(
      <SourceChip
        source={{ kind: 'workbook', sheet: 'תנועות קופה', cell: 'A14', blockHref: '/imports/7#b3' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'מקור: תנועות קופה!A14' }).getAttribute('href'))
      .toBe('/imports/7#b3');
  });

  it('is not a link when there is no block to open', () => {
    render(<SourceChip source={{ kind: 'manual' }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('נרשם ידנית')).toBeTruthy();
  });

  it('renders a workbook reference left-to-right and a manual note right-to-left', () => {
    const { container: workbook } = render(
      <SourceChip source={{ kind: 'workbook', sheet: 'קופה 25', cell: 'D31' }} />,
    );
    expect(workbook.firstElementChild?.className).not.toContain('manual');
    const { container: manual } = render(<SourceChip source={{ kind: 'manual' }} />);
    expect(manual.firstElementChild?.className).toContain('manual');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/source-chip.test.tsx`
Expected: FAIL — `Failed to resolve import "./source-chip"`.

- [ ] **Step 3: Write the component**

`src/components/ui/source-chip.tsx`:

```tsx
import type { ReactElement } from 'react';
import Link from 'next/link';
import { cx } from './cx';
import styles from './source-chip.module.css';

export type SourceRef =
  | { kind: 'workbook'; sheet: string; cell: string; blockHref?: string }
  | { kind: 'manual' };

export type SourceChipProps = { source: SourceRef };

export function formatSourceRef(source: SourceRef): string {
  return source.kind === 'manual' ? 'נרשם ידנית' : `${source.sheet}!${source.cell}`;
}

export function SourceChip({ source }: SourceChipProps): ReactElement {
  const text = formatSourceRef(source);
  const label = `מקור: ${text}`;
  const className = cx(styles.chip, source.kind === 'manual' && styles.manual);
  const body = source.kind === 'manual' ? text : <bdi>{text}</bdi>;

  if (source.kind === 'workbook' && source.blockHref !== undefined) {
    return (
      <Link className={cx(className, styles.linked)} href={source.blockHref} aria-label={label}>
        {body}
      </Link>
    );
  }

  return <span className={className} aria-label={label}>{body}</span>;
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/source-chip.module.css`:

```css
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  block-size: 22px; padding-inline: 7px; border-radius: 6px;
  font-size: 11.5px; color: var(--ink-3); background: var(--sunken);
  white-space: nowrap; text-decoration: none;
  direction: ltr;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
/* A5: a spreadsheet cell reference is mono; a Hebrew note is not. */
.manual { direction: rtl; font-family: inherit; }

.linked:hover { color: var(--brand-text); background: var(--brand-soft); }
.linked:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/source-chip.test.tsx`
Expected: PASS — 1 file, 6 tests.

- [ ] **Step 6: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): a figure shows the cell it came from, or says it was typed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 9: One label, one control, one hint, one error

**Files:**
- Create: `src/components/ui/field.tsx`, `src/components/ui/field.module.css`, `src/components/ui/field.test.tsx`

**Ruling (binding):**

1. **One file for the family.** `Field` and its six controls ship from `field.tsx` with one stylesheet and one test, because a `Field` without its controls is an empty box and a control outside a `Field` has no label. This is the kit's one multi-export component file; everything else is one component per file.
2. **`Segmented` is a radio group, not a row of `aria-pressed` buttons.** The mock draws buttons, but D5's payment-method picker sits inside a `<form action={serverAction}>` and has to submit its value with no JavaScript at all. A radio group does that, gets `aria-checked` for free, and gets arrow-key navigation from the browser. The buttons keep their look and lose their mechanism.
3. **`Checkbox` reaches its mixed state through `aria-checked="mixed"`, never through a ref.** Setting `input.indeterminate` needs an effect, and an effect would make every form in the app a client tree. `aria-checked="mixed"` is valid tri-state and is what `Table`'s header checkbox already asserts.
4. **An error is announced and a hint is described.** The control carries `aria-describedby` pointing at the hint, `aria-invalid` when there is an error, and `aria-errormessage` pointing at it. The error paragraph is `role="alert"`, because it appears after the lead did something.
5. **No control in this file carries `'use client'`.** Each takes `defaultValue` for the uncontrolled Server-Action case and `value`+`onChange` for the controlled client case.

**Interfaces:**
- Consumes: `cx` (Task 1); `Icon`, `IconName` (plan 01).
- Produces:

```ts
export type FieldProps = {
  /** The control's `id`. `Field` derives the hint's and the error's ids from it. */
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** A group of controls (Segmented, a set of checkboxes) labels itself with a
      `<span>` and `aria-labelledby`; a single control uses a real `<label for>`. */
  as?: 'label' | 'group';       // default 'label'
  required?: boolean;
  children: ReactNode;
};

type ControlShared = {
  id: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** `Field` passes these down; callers do not set them by hand. */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-errormessage'?: string;
};

export type TextInputProps = ControlShared & {
  value?: string; defaultValue?: string; placeholder?: string;
  onChange?: (value: string) => void;
  /** A leading icon inside the box. */
  icon?: IconName;
};

/** LTR box, physically right-aligned, tabular numerals, `₪` as a trailing adornment. */
export type MoneyInputProps = ControlShared & {
  value?: string; defaultValue?: string; onChange?: (value: string) => void;
};

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = ControlShared & {
  options: readonly SelectOption[];
  value?: string; defaultValue?: string;
  onChange?: (value: string) => void;
  /** The empty option's Hebrew text, e.g. `ללא קופה`. Omitted means no empty option. */
  emptyLabel?: string;
};

export type TextareaProps = ControlShared & {
  value?: string; defaultValue?: string; placeholder?: string; rows?: number;
  onChange?: (value: string) => void;
};

export type SegmentedOption = { value: string; label: string; icon?: IconName };
export type SegmentedProps = Omit<ControlShared, 'required'> & {
  /** The radio group's shared `name` — it is what a Server Action reads. */
  name: string;
  /** Matches the `Field`'s `id`, so `aria-labelledby` lines up. */
  id: string;
  options: readonly SegmentedOption[];
  value?: string; defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
};

export type CheckboxProps = {
  id: string;
  name?: string;
  label: string;
  checked?: boolean; defaultChecked?: boolean;
  /** The header "select all" third state (`aria-checked="mixed"`). */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
};

export function Field(props: FieldProps): ReactElement;
export function TextInput(props: TextInputProps): ReactElement;
export function MoneyInput(props: MoneyInputProps): ReactElement;
export function Select(props: SelectProps): ReactElement;
export function Textarea(props: TextareaProps): ReactElement;
export function Segmented(props: SegmentedProps): ReactElement;
export function Checkbox(props: CheckboxProps): ReactElement;
```

**Retires:** `fees.module.css` `.exceptionForm` label/input rules and `.paymentForm` label/input/select rules; `members.module.css` `.addMember` label/input/select, `.addToSeason` label/select, `.mergeField`; `tasks.module.css` `.assign label`, `.assign select`, `.newTask` label/input/select; `import-review.module.css` `.formLabel`, `.select`; `data.module.css` `.search`.

- [ ] **Step 1: Write the failing test**

`src/components/ui/field.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field, TextInput, MoneyInput, Select, Textarea, Segmented, Checkbox } from './field';

describe('Field', () => {
  it('ties the label to the control', () => {
    render(
      <Field id="amount" label="סכום">
        <MoneyInput id="amount" name="amount" defaultValue="1200" />
      </Field>,
    );
    expect(screen.getByLabelText('סכום')).toBeTruthy();
  });

  it('describes the control with its hint', () => {
    render(
      <Field id="account" label="לאיזו קופה הכסף נכנס" hint="בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.">
        <Select id="account" options={[{ value: 'cash', label: 'קופת מזומן' }]} />
      </Field>,
    );
    const control = screen.getByLabelText('לאיזו קופה הכסף נכנס');
    const describedBy = control.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent)
      .toBe('בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.');
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <Field id="reason" label="סיבה" error="חריג מחייב סיבה">
        <TextInput id="reason" />
      </Field>,
    );
    expect(screen.getByLabelText('סיבה').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('חריג מחייב סיבה');
  });

  it('labels a group of controls without a for/id pair', () => {
    render(
      <Field id="method" label="אמצעי תשלום" as="group">
        <Segmented
          id="method"
          name="method"
          defaultValue="cash"
          options={[{ value: 'cash', label: 'מזומן' }, { value: 'bit', label: 'ביט' }]}
        />
      </Field>,
    );
    expect(screen.getByRole('radiogroup', { name: 'אמצעי תשלום' })).toBeTruthy();
  });
});

describe('controls', () => {
  it('MoneyInput is left-to-right with tabular numerals and a shekel adornment', () => {
    render(
      <Field id="amount" label="סכום">
        <MoneyInput id="amount" defaultValue="1200" />
      </Field>,
    );
    expect((screen.getByLabelText('סכום') as HTMLInputElement).value).toBe('1200');
    expect(screen.getByText('₪')).toBeTruthy();
  });

  it('Select offers an explicit Hebrew empty option when one is named', () => {
    render(
      <Field id="account" label="קופה">
        <Select id="account" emptyLabel="ללא קופה" options={[{ value: 'cash', label: 'קופת מזומן' }]} />
      </Field>,
    );
    expect(screen.getByRole('option', { name: 'ללא קופה' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'קופת מזומן' })).toBeTruthy();
  });

  it('Textarea reports what was typed', () => {
    const onChange = vi.fn();
    render(
      <Field id="note" label="הערה">
        <Textarea id="note" onChange={onChange} value="" />
      </Field>,
    );
    fireEvent.change(screen.getByLabelText('הערה'), { target: { value: 'קוזז מול חוב' } });
    expect(onChange).toHaveBeenCalledWith('קוזז מול חוב');
  });

  it('Segmented is radios, so a Server Action form submits without JavaScript', () => {
    render(
      <Field id="method" label="אמצעי תשלום" as="group">
        <Segmented
          id="method"
          name="method"
          defaultValue="cash"
          options={[
            { value: 'cash', label: 'מזומן' },
            { value: 'bit', label: 'ביט' },
            { value: 'offset', label: 'קיזוז' },
          ]}
        />
      </Field>,
    );
    const cash = screen.getByRole('radio', { name: 'מזומן' }) as HTMLInputElement;
    expect(cash.checked).toBe(true);
    expect(cash.name).toBe('method');
    fireEvent.click(screen.getByRole('radio', { name: 'קיזוז' }));
    expect((screen.getByRole('radio', { name: 'קיזוז' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Checkbox reports its own label and its mixed state', () => {
    render(<Checkbox id="all" label="בחירת כל השורות" indeterminate checked={false} />);
    const box = screen.getByRole('checkbox', { name: 'בחירת כל השורות' });
    expect(box.getAttribute('aria-checked')).toBe('mixed');
  });

  it('Checkbox reports a change', () => {
    const onChange = vi.fn();
    render(<Checkbox id="ack" label="אני מבין שהמיזוג אינו הפיך" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'אני מבין שהמיזוג אינו הפיך' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/field.test.tsx`
Expected: FAIL — `Failed to resolve import "./field"`.

- [ ] **Step 3: Write the components**

`src/components/ui/field.tsx`:

**Ruling on the wiring:** `Field` owns the hint and the error, so `Field` is what knows their ids — and it injects them into its single child with `cloneElement`. The screen writes `<Field error="…"><TextInput id="…" /></Field>` and nothing else; it never repeats the error on the control. Each control declares the three ARIA keys on `ControlShared` and forwards them untouched, which is why `ControlShared` carries them in the Interfaces block above.

```tsx
import {
  Children, cloneElement, isValidElement,
  type ReactElement, type ReactNode,
} from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { cx } from './cx';
import styles from './field.module.css';

export type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  as?: 'label' | 'group';
  required?: boolean;
  children: ReactNode;
};

type ControlShared = {
  id: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** Injected by `Field`. A caller never sets these by hand. */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-errormessage'?: string;
};

function ariaOf(props: ControlShared) {
  return {
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': props['aria-invalid'],
    'aria-errormessage': props['aria-errormessage'],
  } as const;
}

export function hintId(id: string): string { return `${id}-hint`; }
export function errorId(id: string): string { return `${id}-error`; }
export function labelId(id: string): string { return `${id}-label`; }

export function Field({
  id, label, hint, error, as = 'label', required, children,
}: FieldProps): ReactElement {
  const described = [
    hint !== undefined ? hintId(id) : null,
    error !== undefined ? errorId(id) : null,
  ].filter((part): part is string => part !== null).join(' ');

  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<Record<string, unknown>>, {
        'aria-describedby': described === '' ? undefined : described,
        'aria-invalid': error !== undefined ? true : undefined,
        'aria-errormessage': error !== undefined ? errorId(id) : undefined,
      })
    : child;

  return (
    <div className={styles.field}>
      {as === 'label' ? (
        <label className={styles.label} htmlFor={id}>
          {label}{required ? <span className={styles.required} aria-hidden="true"> *</span> : null}
        </label>
      ) : (
        <span className={styles.label} id={labelId(id)}>
          {label}{required ? <span className={styles.required} aria-hidden="true"> *</span> : null}
        </span>
      )}

      <div className={styles.control}>{control}</div>

      {hint !== undefined ? <span className={styles.hint} id={hintId(id)}>{hint}</span> : null}
      {error !== undefined ? (
        <p className={styles.error} id={errorId(id)} role="alert">{error}</p>
      ) : null}
    </div>
  );
}
```

The rest of the file:

```tsx
export type TextInputProps = ControlShared & {
  value?: string; defaultValue?: string; placeholder?: string;
  onChange?: (value: string) => void; icon?: IconName;
};

export function TextInput({ icon, onChange, ...props }: TextInputProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue, placeholder } = props;
  return (
    <span className={styles.box}>
      {icon ? <span className={styles.boxIcon}><Icon name={icon} size={15} /></span> : null}
      <input
        className={styles.input}
        type="text" id={id} name={name} disabled={disabled} required={required}
        value={value} defaultValue={defaultValue} placeholder={placeholder}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        {...ariaOf(props)}
      />
    </span>
  );
}

export type MoneyInputProps = ControlShared & {
  value?: string; defaultValue?: string; onChange?: (value: string) => void;
};

export function MoneyInput({ onChange, ...props }: MoneyInputProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue } = props;
  return (
    <span className={cx(styles.box, styles.money)}>
      <input
        className={cx(styles.input, styles.moneyInput)}
        type="text" inputMode="decimal"
        id={id} name={name} disabled={disabled} required={required}
        value={value} defaultValue={defaultValue}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        {...ariaOf(props)}
      />
      <span className={styles.adornment}>₪</span>
    </span>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = ControlShared & {
  options: readonly SelectOption[];
  value?: string; defaultValue?: string;
  onChange?: (value: string) => void;
  emptyLabel?: string;
};

export function Select({ options, emptyLabel, onChange, ...props }: SelectProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue } = props;
  return (
    <span className={styles.box}>
      <select
        className={styles.input}
        id={id} name={name} disabled={disabled} required={required}
        value={value} defaultValue={defaultValue}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        {...ariaOf(props)}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export type TextareaProps = ControlShared & {
  value?: string; defaultValue?: string; placeholder?: string; rows?: number;
  onChange?: (value: string) => void;
};

export function Textarea({ onChange, rows = 2, ...props }: TextareaProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue, placeholder } = props;
  return (
    <textarea
      className={cx(styles.box, styles.textarea)}
      id={id} name={name} disabled={disabled} required={required} rows={rows}
      value={value} defaultValue={defaultValue} placeholder={placeholder}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      {...ariaOf(props)}
    />
  );
}

export type SegmentedOption = { value: string; label: string; icon?: IconName };
export type SegmentedProps = Omit<ControlShared, 'required'> & {
  name: string;
  id: string;
  options: readonly SegmentedOption[];
  value?: string; defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
};

/**
 * Radios, not `aria-pressed` buttons: D5's payment-method picker sits inside a
 * Server Action form and has to submit its value with no JavaScript at all.
 */
export function Segmented({
  name, id, options, value, defaultValue, onChange, disabled, ...rest
}: SegmentedProps): ReactElement {
  return (
    <span
      className={styles.segmented}
      role="radiogroup"
      aria-labelledby={labelId(id)}
      {...ariaOf({ id, ...rest })}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.segment}>
          <input
            className={styles.segmentInput}
            type="radio" name={name} value={option.value} disabled={disabled}
            checked={value === undefined ? undefined : value === option.value}
            defaultChecked={value === undefined ? defaultValue === option.value : undefined}
            onChange={onChange ? () => onChange(option.value) : undefined}
          />
          <span className={styles.segmentFace}>
            {option.icon ? <Icon name={option.icon} size={14} /> : null}
            {option.label}
          </span>
        </label>
      ))}
    </span>
  );
}

export type CheckboxProps = {
  id: string;
  name?: string;
  label: string;
  checked?: boolean; defaultChecked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
};

export function Checkbox({
  id, name, label, checked, defaultChecked, indeterminate, onChange, disabled,
}: CheckboxProps): ReactElement {
  return (
    <label className={styles.checkbox} htmlFor={id}>
      <input
        className={styles.checkboxInput}
        type="checkbox" id={id} name={name} disabled={disabled}
        checked={checked} defaultChecked={defaultChecked}
        aria-checked={indeterminate === true ? 'mixed' : undefined}
        onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
      />
      <span className={styles.checkboxLabel}>{label}</span>
    </label>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/field.module.css`:

```css
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 13px; font-weight: 500; color: var(--ink-2); }
.required { color: var(--bad); }
.control { display: flex; }
.control > * { flex: 1; min-inline-size: 0; }
.hint { font-size: 12px; color: var(--ink-3); }
.error { font-size: 12px; color: var(--bad); margin: 0; }

.box {
  block-size: 36px; inline-size: 100%;
  display: flex; align-items: center; gap: 8px; padding-inline: 10px;
  border: 1px solid var(--line-strong); border-radius: 8px;
  background: var(--panel); color: var(--ink);
}
.box:focus-within { border-color: var(--focus); box-shadow: 0 0 0 3px var(--brand-soft); }
.boxIcon { display: inline-flex; color: var(--ink-3); }

.input {
  flex: 1; min-inline-size: 0; border: 0; background: none; color: inherit;
  font: inherit; padding: 0; outline: none;
}
.input::placeholder { color: var(--ink-4); }

/* A11: an amount is read left to right with the symbol last. */
.money { direction: ltr; }
.moneyInput { text-align: right; font-variant-numeric: tabular-nums; }
.adornment { color: var(--ink-3); }

.textarea {
  block-size: auto; min-block-size: 64px; padding-block: 8px; resize: none;
  display: block; font: inherit;
}

.segmented {
  display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px;
  border-radius: 9px; background: var(--sunken);
}
.segment { display: inline-flex; }
.segmentInput { position: absolute; opacity: 0; pointer-events: none; }
.segmentFace {
  display: inline-flex; align-items: center; gap: 6px;
  block-size: 28px; padding-inline: 10px; border-radius: 7px;
  color: var(--ink-2); font-size: 13px; cursor: pointer;
}
.segmentInput:checked + .segmentFace {
  background: var(--panel); color: var(--ink); font-weight: 600;
  box-shadow: 0 0 0 1px var(--line);
}
.segmentInput:focus-visible + .segmentFace { outline: 2px solid var(--focus); outline-offset: 2px; }
.segmentInput:disabled + .segmentFace { opacity: 0.45; cursor: not-allowed; }

.checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.checkboxInput { inline-size: 16px; block-size: 16px; accent-color: var(--brand); margin: 0; }
.checkboxInput:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.checkboxLabel { font-size: 13.5px; color: var(--ink); }

/* A8: a phone input is at least 16px so iOS does not zoom on focus. */
@media (pointer: coarse) {
  .box { block-size: 44px; font-size: 16px; }
  .input { font-size: 16px; }
  .segmentFace { block-size: 38px; }
}
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/field.test.tsx`
Expected: PASS — 1 file, 10 tests. If `getByLabelText('סכום')` fails on `MoneyInput`, the `<label for>` and the `<input id>` disagree — fix the control, not the test.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): one label, one control, one hint, one error

The segmented control is a radio group rather than a row of pressed buttons,
because the payment-method picker sits inside a Server Action form and must
submit its value with no JavaScript at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 10: A saved view is a URL with a name and a count

**Files:**
- Create: `src/components/ui/saved-views.tsx`, `src/components/ui/saved-views.module.css`, `src/components/ui/saved-views.test.tsx`

**Ruling (binding):** every view is a link, never a button. A view is a set of filters, and R6's reasoning about drawers applies to lists too: a view a lead can send to someone else is worth more than a tab that only exists in one browser tab. The strip is a `role="tablist"` of `role="tab"` anchors with `aria-selected` on the current one, which is exactly what C2 asks for and what the mock draws.

A count of `0` **is** shown. B2's "a count that would always read `0` is not shown at all" is about the sidebar, where a permanent zero is noise; on a saved-view strip `טרם שילמו 0` is the best news on the page.

**Interfaces:**
- Consumes: `cx` (Task 1); `Icon` (plan 01).
- Produces:

```ts
export type SavedView = {
  id: string;
  label: string;
  /** Rendered in a `<bdi>`. `undefined` means the screen cannot count it cheaply. */
  count?: number;
  href: string;
};

export type SavedViewsProps = {
  /** The strip's accessible name, e.g. `תצוגות שמורות`. */
  label: string;
  views: readonly SavedView[];
  currentId: string;
  /** The `+`. Omitted while a screen has no way to save one. */
  newHref?: string;
  newLabel?: string;            // default 'תצוגה שמורה חדשה'
};

export function SavedViews(props: SavedViewsProps): ReactElement;
```

**Retires:** nothing today; no screen has a saved-view strip. `fees.module.css` `.seasons` and `tasks.module.css` `.seasons` look like this but are the per-page season pickers R5 deletes, and they belong to plan 02's shell, not here.

- [ ] **Step 1: Write the failing test**

`src/components/ui/saved-views.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SavedViews } from './saved-views';

const views = [
  { id: 'all', label: 'כולם', count: 38, href: '/members' },
  { id: 'season', label: 'ברן 26', count: 35, href: '/members?view=season' },
  { id: 'unpaid', label: 'טרם שילמו', count: 0, href: '/members?view=unpaid' },
];

describe('SavedViews', () => {
  it('is a named tab strip of links', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="season" />);
    expect(screen.getByRole('tablist', { name: 'תצוגות שמורות' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks exactly one view as selected', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="season" />);
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('ברן 26');
  });

  it('keeps each view addressable, so a lead can send one', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="all" />);
    expect(screen.getByRole('tab', { name: /טרם שילמו/ }).getAttribute('href'))
      .toBe('/members?view=unpaid');
  });

  it('shows a zero count, because zero unpaid is the best news on the page', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="all" />);
    expect(screen.getByRole('tab', { name: /טרם שילמו/ }).textContent).toContain('0');
  });

  it('offers a way to save a new view when the screen has one', () => {
    render(
      <SavedViews label="תצוגות שמורות" views={views} currentId="all" newHref="/members?view=new" />,
    );
    expect(screen.getByRole('link', { name: 'תצוגה שמורה חדשה' }).getAttribute('href'))
      .toBe('/members?view=new');
  });

  it('offers nothing to save when the screen has no way to', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="all" />);
    expect(screen.queryByRole('link', { name: 'תצוגה שמורה חדשה' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/saved-views.test.tsx`
Expected: FAIL — `Failed to resolve import "./saved-views"`.

- [ ] **Step 3: Write the component**

`src/components/ui/saved-views.tsx`:

```tsx
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { cx } from './cx';
import styles from './saved-views.module.css';

export type SavedView = {
  id: string;
  label: string;
  count?: number;
  href: string;
};

export type SavedViewsProps = {
  label: string;
  views: readonly SavedView[];
  currentId: string;
  newHref?: string;
  newLabel?: string;
};

export function SavedViews({
  label, views, currentId, newHref, newLabel = 'תצוגה שמורה חדשה',
}: SavedViewsProps): ReactElement {
  return (
    <div className={styles.strip} role="tablist" aria-label={label}>
      {views.map((view) => {
        const current = view.id === currentId;
        return (
          <Link
            key={view.id}
            className={cx(styles.tab, current && styles.current)}
            href={view.href}
            role="tab"
            aria-selected={current}
          >
            {view.label}
            {view.count === undefined ? null : (
              <span className={styles.count}><bdi>{view.count}</bdi></span>
            )}
          </Link>
        );
      })}
      {newHref === undefined ? null : (
        <Link className={styles.add} href={newHref} aria-label={newLabel}>
          <Icon name="plus" size={14} />
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/saved-views.module.css`:

```css
.strip {
  display: flex; gap: 2px; border-block-end: 1px solid var(--line);
  overflow-x: auto; scrollbar-width: none;
}
.strip::-webkit-scrollbar { display: none; }

.tab {
  display: inline-flex; align-items: center; gap: 6px;
  block-size: 38px; padding-inline: 10px; margin-block-end: -1px;
  color: var(--ink-3); font-weight: 500; white-space: nowrap; text-decoration: none;
  border-block-end: 2px solid transparent;
}
.tab:hover { color: var(--ink); }
.tab:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.current { color: var(--ink); border-block-end-color: var(--brand); font-weight: 600; }

.count {
  font-size: 12px; font-weight: 500; color: var(--ink-3);
  background: var(--sunken); border-radius: 999px;
  padding-inline: 7px; line-height: 18px;
}

.add {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 34px; block-size: 38px; color: var(--ink-3); margin-block-end: -1px;
}
.add:hover { color: var(--ink); }
.add:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/saved-views.test.tsx`
Expected: PASS — 1 file, 6 tests.

- [ ] **Step 6: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): a saved view is a link with a name and a count

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 11: The filter bar, and the popover it is built on

**Files:**
- Create: `src/components/ui/popover.tsx`, `src/components/ui/popover.module.css`, `src/components/ui/popover.test.tsx`
- Create: `src/components/ui/filter-bar.tsx`, `src/components/ui/filter-bar.module.css`, `src/components/ui/filter-bar.test.tsx`

**Rulings (binding):**

1. **Every filter is a URL, and every chip is a link** — except the search box, which types. A filter that only exists in component state cannot be shared, cannot survive a refresh, and cannot be read by the server query that produces the row count and the totals row.
2. **The search box is debounced into `router.replace`, not `push`.** Typing eight characters must not leave eight entries in the browser's history. 250ms, one timer, cleared on every keystroke and on unmount.
3. **`Popover` owns the outside-click and the `esc`, once.** R1 rules out the library, so this is the kit's one hand-written disclosure, used by C3's add-filter chip and reused by C8's `עוד`. It listens for `pointerdown` on `document` only while open, closes on `esc` with `stopPropagation` so an enclosing `Drawer` does not also close, closes when a link or a button inside the panel is activated, and returns focus to the trigger.
4. **`Popover` styles its own trigger.** A `triggerClassName` prop would let a caller reach into another component's styles, which the kit's first rule forbids; `triggerTone` picks among the looks the kit already owns.
5. **The row count is a number the server computed over the whole filtered set**, not `rows.length`. `FilterBar` takes it as a prop and never derives it.

**Interfaces:**
- Consumes: `cx` (Task 1); `Icon`, `IconName` (plan 01); `Button` (Task 1) inside `Popover`'s trigger.
- Produces:

```ts
// popover.tsx — 'use client'
export type PopoverTriggerTone = 'chip' | 'chip-dashed' | 'ghost' | 'bulk';

export type PopoverProps = {
  /** Unique within the page; the panel's `id` and the trigger's `aria-controls`. */
  id: string;
  /** The trigger's accessible name. */
  label: string;
  /** What the trigger shows. Omitted means the label is shown. */
  triggerContent?: ReactNode;
  triggerTone?: PopoverTriggerTone;   // default 'chip'
  /** Which edge the panel lines up with. Default 'start'. */
  align?: 'start' | 'end';
  children: ReactNode;
};

export function Popover(props: PopoverProps): ReactElement;

// filter-bar.tsx — 'use client'
export type FilterOption = { id: string; label: string; href: string; current?: boolean };

export type FilterChip = {
  id: string;
  /** `שנה` */
  label: string;
  /** `ברן 26` — always shown, per C3: a chip carries its value. */
  value: string;
  /** The same list without this filter. Absent for a filter that cannot be removed. */
  clearHref?: string;
  /** The values this filter can take. Absent means the chip is a label only. */
  options?: readonly FilterOption[];
};

export type ColumnToggle = { id: string; label: string; href: string; shown: boolean };

export type FilterBarProps = {
  /** The search param this bar writes. Default 'q'. */
  searchParam?: string;
  searchValue: string;
  /** The box's accessible name, e.g. `חיפוש אנשים`. */
  searchLabel: string;
  searchPlaceholder: string;
  chips: readonly FilterChip[];
  addFilter?: { options: readonly FilterOption[] };
  sort?: { value: string; options: readonly FilterOption[] };
  columns?: readonly ColumnToggle[];
  /** Counted on the server over the whole filtered set, never `rows.length`. */
  rowCount: number;
};

export function FilterBar(props: FilterBarProps): ReactElement;
```

**Retires:** `data.module.css` `.controls`, `.search`, `.toggle`, `.years`, `.year`.

- [ ] **Step 1: Write the Popover test**

`src/components/ui/popover.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Popover } from './popover';

function renderPopover() {
  return render(
    <div>
      <button type="button">מחוץ לפופאובר</button>
      <Popover id="add-filter" label="סינון">
        <a href="/members?view=unpaid">טרם שילמו</a>
      </Popover>
    </div>,
  );
}

describe('Popover', () => {
  it('starts closed and says so', () => {
    renderPopover();
    expect(screen.getByRole('button', { name: 'סינון' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
  });

  it('opens on the trigger and points at its panel', () => {
    renderPopover();
    const trigger = screen.getByRole('button', { name: 'סינון' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panelId = trigger.getAttribute('aria-controls') ?? '';
    expect(document.getElementById(panelId)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'טרם שילמו' })).toBeTruthy();
  });

  it('closes on a pointerdown outside it', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'סינון' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'מחוץ לפופאובר' }));
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
  });

  it('stays open on a pointerdown inside it', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'סינון' }));
    fireEvent.pointerDown(screen.getByRole('link', { name: 'טרם שילמו' }));
    expect(screen.getByRole('link', { name: 'טרם שילמו' })).toBeTruthy();
  });

  it('closes on esc and gives focus back to the trigger', () => {
    renderPopover();
    const trigger = screen.getByRole('button', { name: 'סינון' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('link', { name: 'טרם שילמו' }), { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when a choice inside it is made', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'סינון' }));
    fireEvent.click(screen.getByRole('link', { name: 'טרם שילמו' }));
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/popover.test.tsx`
Expected: FAIL — `Failed to resolve import "./popover"`.

- [ ] **Step 3: Write Popover**

`src/components/ui/popover.tsx`:

```tsx
'use client';
/**
 * Client component: a disclosure that closes on an outside pointerdown, on
 * `esc`, and on a choice made inside it needs `document` listeners and a ref
 * to the trigger it restores focus to. R1 forbids the headless-UI dependency
 * that would supply this, so the kit owns one copy and C3 and C8 share it.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './popover.module.css';

export type PopoverTriggerTone = 'chip' | 'chip-dashed' | 'ghost' | 'bulk';

export type PopoverProps = {
  id: string;
  label: string;
  triggerContent?: ReactNode;
  triggerTone?: PopoverTriggerTone;
  align?: 'start' | 'end';
  children: ReactNode;
};

const TONE_CLASS: Record<PopoverTriggerTone, string> = {
  chip: 'chip',
  'chip-dashed': 'chipDashed',
  ghost: 'ghost',
  bulk: 'bulk',
};

export function Popover({
  id, label, triggerContent, triggerTone = 'chip', align = 'start', children,
}: PopoverProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) === true) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <span
      className={styles.root}
      ref={rootRef}
      onKeyDown={(event) => {
        // `Escape` is not a letter, so R10's event.code rule does not bite here.
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();   // an enclosing Drawer must not also close
        event.preventDefault();
        close();
      }}
    >
      {/*
        `aria-label` is set unconditionally, so the trigger's accessible name is
        exactly `label` whether it shows an icon, a chip face, or the label
        itself. A name assembled from mixed content is a name no test can match.
      */}
      <button
        type="button"
        ref={triggerRef}
        className={cx(styles.trigger, styles[TONE_CLASS[triggerTone]])}
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-haspopup="menu"
        onClick={() => { setOpen((was) => !was); }}
      >
        {triggerContent ?? label}
      </button>

      {open ? (
        <span
          className={cx(styles.panel, align === 'end' && styles.alignEnd)}
          id={`${id}-panel`}
          role="menu"
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('a, button') !== null) close();
          }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 4: Write Popover's stylesheet**

`src/components/ui/popover.module.css`:

```css
.root { position: relative; display: inline-flex; }

.trigger {
  display: inline-flex; align-items: center; gap: 6px;
  block-size: 28px; padding-inline: 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel);
  color: var(--ink-2); font: inherit; font-size: 12.5px; cursor: pointer;
}
.trigger:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.chip:hover { border-color: var(--line-strong); }
.chipDashed { border-style: dashed; color: var(--ink-3); }
.ghost { border-color: transparent; background: transparent; }
.ghost:hover { background: var(--sunken); color: var(--ink); }
.bulk { border-color: transparent; background: transparent; color: inherit; block-size: 28px; }
.bulk:hover { background: rgb(255 255 255 / 10%); }

.panel {
  position: absolute; inset-block-start: calc(100% + 6px); inset-inline-start: 0;
  z-index: 40; min-inline-size: 200px; padding-block: 6px;
  background: var(--panel); border-radius: 12px; box-shadow: var(--shadow-pop);
  display: flex; flex-direction: column; text-align: start;
}
.alignEnd { inset-inline-start: auto; inset-inline-end: 0; }
```

- [ ] **Step 5: Run Popover's test and verify it passes**

Run: `npx vitest run src/components/ui/popover.test.tsx`
Expected: PASS — 1 file, 6 tests.

- [ ] **Step 6: Write the FilterBar test**

`src/components/ui/filter-bar.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/members',
  useSearchParams: () => new URLSearchParams('season=s-9f2&view=season'),
}));

import { FilterBar } from './filter-bar';

const base = {
  searchValue: '',
  searchLabel: 'חיפוש אנשים',
  searchPlaceholder: 'חיפוש לפי שם או כינוי',
  chips: [
    { id: 'season', label: 'שנה', value: 'ברן 26', clearHref: '/members' },
    { id: 'state', label: 'מצב תשלום', value: 'הכול',
      options: [{ id: 'unpaid', label: 'טרם שילמו', href: '/members?state=unpaid' }] },
  ],
  rowCount: 35,
};

describe('FilterBar', () => {
  beforeEach(() => { replace.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('names its search box and shows the placeholder', () => {
    render(<FilterBar {...base} />);
    const box = screen.getByLabelText('חיפוש אנשים');
    expect(box.getAttribute('placeholder')).toBe('חיפוש לפי שם או כינוי');
  });

  it('writes the search into the URL once, after the typing stops', () => {
    render(<FilterBar {...base} />);
    const box = screen.getByLabelText('חיפוש אנשים');
    fireEvent.change(box, { target: { value: 'רו' } });
    fireEvent.change(box, { target: { value: 'רונ' } });
    fireEvent.change(box, { target: { value: 'רוני' } });
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(replace).toHaveBeenCalledTimes(1);
    const [href] = replace.mock.calls[0] as [string];
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe('/members');
    expect(url.searchParams.get('q')).toBe('רוני');
    expect(url.searchParams.get('season')).toBe('s-9f2');
  });

  it('drops an emptied search from the URL rather than writing q=', () => {
    render(<FilterBar {...base} searchValue="רוני" />);
    fireEvent.change(screen.getByLabelText('חיפוש אנשים'), { target: { value: '' } });
    vi.advanceTimersByTime(250);
    const [href] = replace.mock.calls[0] as [string];
    expect(new URL(href, 'https://example.test').searchParams.has('q')).toBe(false);
  });

  it('shows each chip with its value, per C3', () => {
    render(<FilterBar {...base} />);
    expect(screen.getByText('ברן 26')).toBeTruthy();
    expect(screen.getByText('הכול')).toBeTruthy();
  });

  it('offers a link that removes a filter', () => {
    render(<FilterBar {...base} />);
    expect(screen.getByRole('link', { name: 'הסרת הסינון שנה' }).getAttribute('href'))
      .toBe('/members');
  });

  it('offers a dashed add-filter chip when there is something to add', () => {
    render(
      <FilterBar {...base} addFilter={{ options: [{ id: 'role', label: 'תפקיד', href: '/members?role=lead' }] }} />,
    );
    expect(screen.getByRole('button', { name: 'סינון' })).toBeTruthy();
  });

  it('reports the row count the server counted', () => {
    render(<FilterBar {...base} rowCount={35} />);
    expect(screen.getByText(/35/).textContent).toContain('שורות');
  });
});
```

- [ ] **Step 7: Run it and verify it fails**

Run: `npx vitest run src/components/ui/filter-bar.test.tsx`
Expected: FAIL — `Failed to resolve import "./filter-bar"`.

- [ ] **Step 8: Write FilterBar**

`src/components/ui/filter-bar.tsx`:

```tsx
'use client';
/**
 * Client component: the search box holds what is being typed and writes it to
 * the URL on a 250ms debounce, so eight keystrokes leave one history entry
 * rather than eight. Everything else in the bar is a link.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Popover } from './popover';
import { cx } from './cx';
import styles from './filter-bar.module.css';

export type FilterOption = { id: string; label: string; href: string; current?: boolean };

export type FilterChip = {
  id: string;
  label: string;
  value: string;
  clearHref?: string;
  options?: readonly FilterOption[];
};

export type ColumnToggle = { id: string; label: string; href: string; shown: boolean };

export type FilterBarProps = {
  searchParam?: string;
  searchValue: string;
  searchLabel: string;
  searchPlaceholder: string;
  chips: readonly FilterChip[];
  addFilter?: { options: readonly FilterOption[] };
  sort?: { value: string; options: readonly FilterOption[] };
  columns?: readonly ColumnToggle[];
  rowCount: number;
};

const DEBOUNCE_MS = 250;

export function FilterBar({
  searchParam = 'q', searchValue, searchLabel, searchPlaceholder,
  chips, addFilter, sort, columns, rowCount,
}: FilterBarProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [typed, setTyped] = useState(searchValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  function onType(next: string) {
    setTyped(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const search = new URLSearchParams();
      for (const [key, value] of params) if (key !== searchParam) search.append(key, value);
      if (next !== '') search.set(searchParam, next);
      const query = search.toString();
      router.replace(query === '' ? pathname : `${pathname}?${query}`);
    }, DEBOUNCE_MS);
  }

  return (
    <div className={styles.bar}>
      <span className={styles.search}>
        <Icon name="search" size={15} />
        <input
          className={styles.searchInput}
          type="search"
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={typed}
          onChange={(event) => { onType(event.target.value); }}
        />
      </span>

      {chips.map((chip) => {
        const face = (
          <>
            {chip.label}: <b className={styles.chipValue}>{chip.value}</b>
          </>
        );
        return (
          <span className={styles.chipGroup} key={chip.id}>
            {chip.options === undefined ? (
              <span className={cx(styles.chip, styles.chipOn)}>{face}</span>
            ) : (
              <Popover id={`filter-${chip.id}`} label={`${chip.label}: ${chip.value}`} triggerContent={face}>
                {chip.options.map((option) => (
                  <Link key={option.id} className={styles.menuItem} href={option.href} role="menuitem">
                    {option.label}
                  </Link>
                ))}
              </Popover>
            )}
            {chip.clearHref === undefined ? null : (
              <Link
                className={styles.clear}
                href={chip.clearHref}
                aria-label={`הסרת הסינון ${chip.label}`}
              >
                <Icon name="x" size={12} />
              </Link>
            )}
          </span>
        );
      })}

      {addFilter === undefined ? null : (
        <Popover
          id="add-filter"
          label="סינון"
          triggerTone="chip-dashed"
          triggerContent={<><Icon name="plus" size={13} /> סינון</>}
        >
          {addFilter.options.map((option) => (
            <Link key={option.id} className={styles.menuItem} href={option.href} role="menuitem">
              {option.label}
            </Link>
          ))}
        </Popover>
      )}

      {sort === undefined ? null : (
        <Popover
          id="sort"
          label={`מיון: ${sort.value}`}
          triggerContent={<><Icon name="sort" size={13} /> מיון: <b className={styles.chipValue}>{sort.value}</b></>}
        >
          {sort.options.map((option) => (
            <Link key={option.id} className={styles.menuItem} href={option.href} role="menuitem">
              {option.label}
            </Link>
          ))}
        </Popover>
      )}

      {columns === undefined ? null : (
        <Popover
          id="columns"
          label="עמודות"
          triggerTone="ghost"
          align="end"
          triggerContent={<Icon name="columns" size={15} />}
        >
          {columns.map((column) => (
            <Link key={column.id} className={styles.menuItem} href={column.href} role="menuitem">
              {column.shown ? <Icon name="check" size={13} /> : <span className={styles.checkGap} />}
              {column.label}
            </Link>
          ))}
        </Popover>
      )}

      <span className={styles.count}><bdi>{rowCount}</bdi> שורות</span>
    </div>
  );
}
```

- [ ] **Step 9: Write FilterBar's stylesheet**

`src/components/ui/filter-bar.module.css`:

```css
.bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.search {
  display: flex; align-items: center; gap: 8px;
  block-size: 32px; inline-size: 240px; padding-inline: 10px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--panel); color: var(--ink-3);
}
.search:focus-within { border-color: var(--focus); box-shadow: 0 0 0 3px var(--brand-soft); }
.searchInput {
  flex: 1; min-inline-size: 0; border: 0; background: none; color: var(--ink);
  font: inherit; font-size: 13.5px; padding: 0; outline: none;
}
.searchInput::placeholder { color: var(--ink-3); }

.chipGroup { display: inline-flex; align-items: center; gap: 2px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  block-size: 28px; padding-inline: 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel);
  color: var(--ink-2); font-size: 12.5px;
}
.chipOn { background: var(--brand-soft); border-color: var(--brand-soft); color: var(--brand-text); }
.chipValue { color: var(--ink); font-weight: 600; }

.clear {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 20px; block-size: 20px; border-radius: 999px; color: var(--ink-3);
}
.clear:hover { background: var(--sunken); color: var(--ink); }
.clear:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.menuItem {
  display: flex; align-items: center; gap: 10px;
  block-size: 36px; padding-inline: 12px; color: var(--ink);
  font-size: 13.5px; text-decoration: none; white-space: nowrap;
}
.menuItem:hover { background: var(--sunken); }
.menuItem:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.checkGap { inline-size: 13px; }

.count { margin-inline-start: auto; font-size: 13px; color: var(--ink-3); }

@media (max-width: 768px) {
  .search { inline-size: 100%; block-size: 44px; }
  .searchInput { font-size: 16px; }
  .count { margin-inline-start: 0; }
}
```

- [ ] **Step 10: Run both and verify they pass**

Run: `npx vitest run src/components/ui/popover.test.tsx src/components/ui/filter-bar.test.tsx`
Expected: PASS — 2 files, 13 tests. If the chip's `Popover` trigger name collides with the add-filter trigger in `getByRole`, the chip's label is wrong: a chip trigger is named `מצב תשלום: הכול`, the add-filter trigger is named `סינון`.

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 12: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): a filter is a URL, and the one popover the kit owns

Search debounces into replace rather than push, so eight keystrokes leave one
history entry. The row count is the server's count over the whole filtered set,
never the length of the page of rows the table happens to hold.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 12: The Drawer, and the URL contract every screen shares

**Files:**
- Create: `src/components/ui/drawer-url.ts`, `src/components/ui/drawer-url.test.ts`
- Create: `src/components/ui/drawer.tsx`, `src/components/ui/drawer.module.css`, `src/components/ui/drawer.test.tsx`

**The URL contract (binding). Every screen plan reads this section and nothing else about drawers.**

1. **The search param is `peek`, and its value is the record's id.** `?peek=<id>` on any list route opens that route's record drawer. This is R6 verbatim and it is the only name; no screen invents `?open=`, `?selected=` or `?drawer=`.
2. **A second param, `act`, selects the drawer's *mode* when a screen has more than one.** `/fees` has "record a payment" and "set an exception" for the same person, so it opens `?peek=<personId>&act=pay` and `?peek=<personId>&act=exception`. A screen with one drawer omits `act` entirely. Both names are exported as `PEEK_PARAM` and `ACT_PARAM` so that no screen spells them by hand.
3. **A page opens a drawer by rendering a link**, not by calling the router: the roster's eye button is `<ButtonLink href={openPeekHref(pathname, params, person.id)}>`. That makes the drawer reachable with the keyboard, openable in a new tab, and copyable from the context menu, and it costs no client component.
4. **A page reads the drawer from `searchParams` in its Server Component**, loads the one record, and renders `<Drawer>`. The drawer's contents are therefore server-rendered, survive a refresh, and are linkable, which is the whole of R6.
5. **Closing preserves everything else in the URL.** `closePeekHref` removes `peek` and `act` and keeps every other param — `season` above all (R5), plus the saved view, the filters, the search and the sort. Closing a drawer must never drop the lead back into an unfiltered list.
6. **Opening pushes; closing replaces.** History then reads `[…, list]` → push → `[…, list, list+peek]` → replace → `[…, list, list]`. Back leaves the list rather than reopening the drawer, and no dead Back press is created, because the `replace` overwrites the entry the `push` added.
7. **`esc` and the close button route to the same place.** The close button is a `<Link replace href={closeHref}>`, so it works with JavaScript disabled; `esc` calls `router.replace(closeHref)`. `Escape` is not a letter, so R10's `event.code` rule does not apply. The handler calls `stopPropagation`, so a `ConfirmDialog` or a `Popover` opened over the drawer swallows its own `esc` first and only the innermost overlay closes.
8. **Focus is trapped while open and restored on close.** On mount the drawer records `document.activeElement` and moves focus to its own heading, which carries `tabIndex={-1}` — so a screen reader announces *what* opened rather than reading out "close button". `Tab` and `Shift+Tab` wrap at the ends of the drawer's tabbable set. On unmount focus returns to the recorded element if it is still connected, otherwise to `document.body`.
9. **The record stepper is navigation, not state.** `previousHref` and `nextHref` are built by the page with `openPeekHref` over the ids it already has in order, so `שמירה ומעבר לבא` in D5 is one navigation and a refresh lands on the same record. At the ends the button renders disabled rather than disappearing, so the header does not reflow as a lead steps through nine people.

**Interfaces:**
- Consumes: `cx` (Task 1); `Button`, `ButtonLink` (Task 1); `Icon` (plan 01).
- Produces:

```ts
// drawer-url.ts — no 'use client'; pure functions, usable on the server
export const PEEK_PARAM = 'peek';
export const ACT_PARAM = 'act';

/** Both `URLSearchParams` and Next's `ReadonlyURLSearchParams` satisfy this. */
export type ReadableParams = Iterable<readonly [string, string]>;

export function openPeekHref(
  pathname: string, current: ReadableParams, id: string, act?: string,
): string;

export function closePeekHref(pathname: string, current: ReadableParams): string;

// drawer.tsx — 'use client'
export type DrawerStepper = {
  /** 1-based, for `1 מתוך 9`. */
  position: number;
  total: number;
  /** `null` at the ends: the button renders disabled, never absent. */
  previousHref: string | null;
  nextHref: string | null;
};

export type DrawerProps = {
  title: string;
  subtitle?: ReactNode;
  /** Rendered before the title — an `Avatar` on a person drawer. */
  lead?: ReactNode;
  stepper?: DrawerStepper;
  /** The record's full-page home, when it has one. */
  expandHref?: string;
  /** Where the close button and `esc` both go. Built with `closePeekHref`. */
  closeHref: string;
  /** 460 by default; 500 for a drawer that holds a grid. */
  width?: 460 | 500;
  footer?: ReactNode;
  children: ReactNode;
};

export function Drawer(props: DrawerProps): ReactElement;
```

**Retires:** `fees.module.css` `.rowControls`, `.paymentForm`, `.paymentsList`, `.exceptionForm` — the one cell called **שינוי** that holds an exception form, a four-field payment form and a payment list at once becomes D5's drawer; `members.module.css` `.mergeControl`, `.mergeField` — D4 moves merge into a side-by-side drawer.

- [ ] **Step 1: Write the URL contract test**

`src/components/ui/drawer-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PEEK_PARAM, ACT_PARAM, openPeekHref, closePeekHref } from './drawer-url';

const list = () => new URLSearchParams('season=s-9f2&view=unpaid&sort=balance');

describe('the drawer URL contract', () => {
  it('names the params R6 specifies', () => {
    expect(PEEK_PARAM).toBe('peek');
    expect(ACT_PARAM).toBe('act');
  });

  it('opens a record without disturbing the list it was opened from', () => {
    const href = openPeekHref('/members', list(), 'p-17');
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe('/members');
    expect(url.searchParams.get('peek')).toBe('p-17');
    expect(url.searchParams.get('season')).toBe('s-9f2');
    expect(url.searchParams.get('view')).toBe('unpaid');
    expect(url.searchParams.get('sort')).toBe('balance');
  });

  it('carries the mode when a screen has more than one drawer', () => {
    const url = new URL(openPeekHref('/fees', list(), 'p-17', 'pay'), 'https://example.test');
    expect(url.searchParams.get('act')).toBe('pay');
  });

  it('replaces a drawer rather than stacking two', () => {
    const first = openPeekHref('/fees', list(), 'p-17', 'pay');
    const second = openPeekHref('/fees', new URL(first, 'https://example.test').searchParams, 'p-18');
    const url = new URL(second, 'https://example.test');
    expect(url.searchParams.getAll('peek')).toEqual(['p-18']);
    expect(url.searchParams.has('act')).toBe(false);
  });

  it('closes by dropping both params and keeping everything else', () => {
    const open = openPeekHref('/fees', list(), 'p-17', 'pay');
    const closed = closePeekHref('/fees', new URL(open, 'https://example.test').searchParams);
    const url = new URL(closed, 'https://example.test');
    expect(url.searchParams.has('peek')).toBe(false);
    expect(url.searchParams.has('act')).toBe(false);
    expect(url.searchParams.get('season')).toBe('s-9f2');
    expect(url.searchParams.get('view')).toBe('unpaid');
  });

  it('closes to a bare path when nothing else was in the URL', () => {
    expect(closePeekHref('/inbox', new URLSearchParams('peek=b-4'))).toBe('/inbox');
  });

  it('round-trips a Hebrew search term', () => {
    const href = openPeekHref('/members', new URLSearchParams('q=רוני'), 'p-17');
    expect(new URL(href, 'https://example.test').searchParams.get('q')).toBe('רוני');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/drawer-url.test.ts`
Expected: FAIL — `Failed to resolve import "./drawer-url"`.

- [ ] **Step 3: Write the URL module**

`src/components/ui/drawer-url.ts`:

```ts
/**
 * R6: a drawer is a URL. These are the only two param names the app uses for
 * one, and they live here so that no screen spells them by hand.
 *
 * Pure functions with no React and no `next/navigation`, so a Server Component
 * building a link and a client component handling `esc` call the same code.
 */
export const PEEK_PARAM = 'peek';
export const ACT_PARAM = 'act';

/** Both `URLSearchParams` and Next's `ReadonlyURLSearchParams` satisfy this. */
export type ReadableParams = Iterable<readonly [string, string]>;

function build(
  pathname: string,
  current: ReadableParams,
  mutate: (next: URLSearchParams) => void,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of current) {
    if (key === PEEK_PARAM || key === ACT_PARAM) continue;
    next.append(key, value);
  }
  mutate(next);
  const query = next.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

/** Opening a second record replaces the first; drawers never stack. */
export function openPeekHref(
  pathname: string, current: ReadableParams, id: string, act?: string,
): string {
  return build(pathname, current, (next) => {
    next.set(PEEK_PARAM, id);
    if (act !== undefined) next.set(ACT_PARAM, act);
  });
}

/**
 * Everything else survives — `season` above all (R5), plus the saved view, the
 * filters, the search and the sort. Closing a drawer never drops the lead back
 * into an unfiltered list.
 */
export function closePeekHref(pathname: string, current: ReadableParams): string {
  return build(pathname, current, () => {});
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run src/components/ui/drawer-url.test.ts`
Expected: PASS — 1 file, 7 tests.

- [ ] **Step 5: Write the Drawer test, including focus restoration**

`src/components/ui/drawer.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

import { Drawer } from './drawer';

const CLOSE = '/fees?season=s-9f2&view=unpaid';

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">תצוגה מהירה</button>
      {open ? (
        <Drawer title="רישום תשלום — איתי כהן" subtitle="תעריף רגיל · נותר 1,200 ₪" closeHref={CLOSE}>
          <label htmlFor="amount">סכום</label>
          <input id="amount" />
          <button type="button">הגדרת חריג</button>
        </Drawer>
      ) : null}
    </>
  );
}

describe('Drawer', () => {
  beforeEach(() => { replace.mockClear(); });

  it('is a modal dialog named by its title', () => {
    render(<Harness open />);
    const dialog = screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('moves focus into itself, onto what opened rather than onto the close button', () => {
    render(<Harness open />);
    const dialog = screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe('רישום תשלום — איתי כהן');
  });

  it('returns focus to whatever opened it', () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'תצוגה מהירה' });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    rerender(<Harness open />);
    expect(
      screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' }).contains(document.activeElement),
    ).toBe(true);

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Harness open />);
    const exception = screen.getByRole('button', { name: 'הגדרת חריג' });
    exception.focus();
    fireEvent.keyDown(exception, { key: 'Tab' });
    const first = screen.getByRole('link', { name: 'סגירה' });
    expect(document.activeElement).toBe(first);
  });

  it('closes on esc by routing to the same place the close button goes', () => {
    render(<Harness open />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' }), { key: 'Escape' });
    expect(replace).toHaveBeenCalledWith(CLOSE);
  });

  it('closes with a link, so it works without JavaScript', () => {
    render(<Harness open />);
    expect(screen.getByRole('link', { name: 'סגירה' }).getAttribute('href')).toBe(CLOSE);
  });

  it('steps between records by navigating, and disables the ends', () => {
    render(
      <Drawer
        title="איתי כהן"
        closeHref={CLOSE}
        stepper={{ position: 1, total: 9, previousHref: null, nextHref: '/fees?peek=p-18' }}
      >
        <p>תוכן</p>
      </Drawer>,
    );
    expect(screen.getByText('1 מתוך 9')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'הבא' }).getAttribute('href')).toBe('/fees?peek=p-18');
    expect((screen.getByRole('button', { name: 'הקודם' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the record its full page when it has one', () => {
    render(
      <Drawer title="איתי כהן" closeHref={CLOSE} expandHref="/members/p-17">
        <p>תוכן</p>
      </Drawer>,
    );
    expect(screen.getByRole('link', { name: 'פתיחה בעמוד מלא' }).getAttribute('href'))
      .toBe('/members/p-17');
  });
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npx vitest run src/components/ui/drawer.test.tsx`
Expected: FAIL — `Failed to resolve import "./drawer"`.

- [ ] **Step 7: Write the Drawer**

`src/components/ui/drawer.tsx`:

```tsx
'use client';
/**
 * Client component: trapping Tab inside the panel, closing on `esc`, and
 * giving focus back to whatever opened it are all DOM lifecycle. R1 rules out
 * the headless-UI dependency that would supply them, so this is hand-written
 * and the test above is what keeps it honest.
 *
 * Everything the drawer *shows* is still server-rendered: the page reads
 * `?peek=` in its Server Component, loads the record, and passes it as
 * `children`. This file holds behaviour, never data.
 */
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Button, ButtonLink } from './button';
import { cx } from './cx';
import styles from './drawer.module.css';

export type DrawerStepper = {
  position: number;
  total: number;
  previousHref: string | null;
  nextHref: string | null;
};

export type DrawerProps = {
  title: string;
  subtitle?: ReactNode;
  lead?: ReactNode;
  stepper?: DrawerStepper;
  expandHref?: string;
  closeHref: string;
  width?: 460 | 500;
  footer?: ReactNode;
  children: ReactNode;
};

const TABBABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

function tabbableIn(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)]
    .filter((element) => element.closest('[hidden]') === null);
}

export function Drawer({
  title, subtitle, lead, stepper, expandHref, closeHref, width = 460, footer, children,
}: DrawerProps): ReactElement {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    headingRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else document.body.focus();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      // Only the innermost overlay closes: a ConfirmDialog or a Popover over
      // this drawer stops the event before it reaches here.
      event.stopPropagation();
      event.preventDefault();
      router.replace(closeHref);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = tabbableIn(panelRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === headingRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div
        className={styles.scrim}
        aria-hidden="true"
        onClick={() => { router.replace(closeHref); }}
      />
      <aside
        className={cx(styles.drawer, width === 500 && styles.wide)}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className={styles.head}>
          {lead}
          <div className={styles.titles}>
            <h2 className={styles.title} id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
            {subtitle === undefined ? null : <span className={styles.subtitle}>{subtitle}</span>}
          </div>

          <div className={styles.headActions}>
            {stepper === undefined ? null : (
              <>
                <span className={styles.position}>
                  <bdi>{stepper.position}</bdi> מתוך <bdi>{stepper.total}</bdi>
                </span>
                {stepper.previousHref === null
                  ? <Button tone="ghost" size="sm" iconLabel="הקודם" disabled><Icon name="up" size={15} /></Button>
                  : <ButtonLink tone="ghost" size="sm" iconLabel="הקודם" href={stepper.previousHref}><Icon name="up" size={15} /></ButtonLink>}
                {stepper.nextHref === null
                  ? <Button tone="ghost" size="sm" iconLabel="הבא" disabled><Icon name="down" size={15} /></Button>
                  : <ButtonLink tone="ghost" size="sm" iconLabel="הבא" href={stepper.nextHref}><Icon name="down" size={15} /></ButtonLink>}
              </>
            )}
            {expandHref === undefined ? null : (
              <ButtonLink tone="ghost" size="sm" iconLabel="פתיחה בעמוד מלא" href={expandHref}>
                <Icon name="expand" size={15} />
              </ButtonLink>
            )}
            <ButtonLink tone="ghost" size="sm" iconLabel="סגירה" href={closeHref} replace>
              <Icon name="x" size={15} />
            </ButtonLink>
          </div>
        </header>

        <div className={styles.body}>{children}</div>

        {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
      </aside>
    </>
  );
}
```

The `Tab`-wrap test expects the close link to be the first tabbable element, so the stepper and the expand link must render **before** the close link in the DOM, which the markup above does. If the test finds the position text instead, the `<span>` gained a `tabindex`; it must not have one.

- [ ] **Step 8: Write the stylesheet**

`src/components/ui/drawer.module.css`:

```css
.scrim { position: absolute; inset: 0; z-index: 20; background: rgb(28 25 23 / 18%); }
:root[data-theme='dark'] .scrim { background: rgb(0 0 0 / 50%); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .scrim { background: rgb(0 0 0 / 50%); }
}

.drawer {
  position: absolute; inset-block: 8px; inset-inline-end: 8px; z-index: 30;
  inline-size: 460px; max-inline-size: calc(100% - 16px);
  background: var(--panel); border-radius: 14px; box-shadow: var(--shadow-drawer);
  display: flex; flex-direction: column; overflow: hidden;
}
.wide { inline-size: 500px; }

.head {
  display: flex; align-items: center; gap: 10px;
  padding-block: 14px; padding-inline: 18px; border-block-end: 1px solid var(--line);
}
.titles { min-inline-size: 0; }
.title { font-size: 16px; font-weight: 600; margin: 0; }
.title:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
.subtitle { font-size: 12.5px; color: var(--ink-3); display: block; }

.headActions { margin-inline-start: auto; display: flex; align-items: center; gap: 4px; }
.position { font-size: 12.5px; color: var(--ink-3); white-space: nowrap; margin-inline-end: 4px; }

.body {
  flex: 1; min-block-size: 0; overflow-y: auto;
  padding: 18px; display: flex; flex-direction: column; gap: 16px;
}

.foot {
  display: flex; align-items: center; gap: 8px;
  padding-block: 12px; padding-inline: 18px;
  border-block-start: 1px solid var(--line); background: var(--sunken);
}

/* B7/D11: on a phone the drawer is the screen. */
@media (max-width: 768px) {
  .drawer {
    inset: 0; inline-size: 100%; max-inline-size: 100%; border-radius: 0;
  }
}
```

- [ ] **Step 9: Run it and verify it passes**

Run: `npx vitest run src/components/ui/drawer.test.tsx`
Expected: PASS — 1 file, 8 tests. `document.body.focus()` in the cleanup is a no-op in jsdom unless `body` is focusable; that branch is not asserted and must not throw.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. If `React.KeyboardEvent` is unresolved, add `import type { KeyboardEvent } from 'react'` and use the bare name rather than importing the `React` namespace.

- [ ] **Step 11: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): a drawer is a URL, and it gives focus back to what opened it

peek names the record and act names the mode; closing keeps the season, the
saved view, the filters and the sort, so a lead never lands back in an
unfiltered list. Opening pushes and closing replaces, so Back leaves the list
rather than reopening the panel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 13: Nothing irreversible happens in one click

**Files:**
- Create: `src/components/ui/confirm-dialog.tsx`, `src/components/ui/confirm-dialog.module.css`, `src/components/ui/confirm-dialog.test.tsx`

**Rulings (binding):**

1. **The confirm button carries the verb, never `אישור`.** R8 says the confirmation names what will happen; a button reading `אישור` names nothing. The component throws outside production when `confirmLabel` is one of `אישור`, `אוקיי`, `אוקי`, `כן`, `המשך`, `ביצוע` — the cheapest possible enforcement, and the test asserts it.
2. **Focus opens on *cancel*.** A dialog that opens with the destructive button focused turns `↵` into the thing R8 exists to prevent.
3. **`esc` cancels and stops propagating**, so a dialog opened over a `Drawer` closes itself and leaves the drawer open.
4. **The confirm side is a `<form>`,** so the caller passes a bound Server Action and the dialog needs no client action plumbing. `onConfirm` exists for the client-state cases; exactly one of the two is given.
5. **Merge keeps its checkbox (R8).** `acknowledge` renders a `Checkbox` from Task 9 and holds the confirm button disabled until it is checked; `children` is where merge's preview of what moves goes.

**Interfaces:**
- Consumes: `cx` (Task 1); `Button` (Task 1); `Checkbox` (Task 9).
- Produces:

```ts
export type ConfirmDialogProps = {
  /** `מחיקת תשלום` */
  title: string;
  /** One sentence naming the record and the consequence. */
  consequence: ReactNode;
  /** The verb itself — `מחיקת התשלום`, `ביטול המשימה`, `הסרת השיוך`. Never `אישור`. */
  confirmLabel: string;
  cancelLabel?: string;                 // default 'ביטול'
  tone?: 'danger' | 'default';          // default 'danger'
  onCancel: () => void;
  /** A bound Server Action. Exactly one of `action` and `onConfirm` is given. */
  action?: (formData: FormData) => void | Promise<void>;
  onConfirm?: () => void;
  /** Merge's preview of what moves, and anything else that must be read first. */
  children?: ReactNode;
  /** R8's acknowledgement checkbox, for the irreversible cases. */
  acknowledge?: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void };
};

export function ConfirmDialog(props: ConfirmDialogProps): ReactElement;
```

**Retires:** `members.module.css` `.mergeConfirm`, `.mergeRefusal`; `tasks.module.css` `.taskStatusControls`, whose cancel button fires on one click today.

- [ ] **Step 1: Write the failing test**

`src/components/ui/confirm-dialog.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  it('is an alert dialog named by its title and described by its consequence', () => {
    render(
      <ConfirmDialog
        title="מחיקת תשלום"
        consequence="התשלום של איתי כהן על סך 1,200 ₪ יימחק, והיתרה שלו תחזור ל־1,200 ₪."
        confirmLabel="מחיקת התשלום"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'מחיקת תשלום' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent)
      .toContain('היתרה שלו תחזור');
  });

  it('puts the verb on the confirm button and never the word אישור', () => {
    render(
      <ConfirmDialog title="ביטול משימה" consequence="המשימה תבוטל וכל השיבוצים יוסרו."
        confirmLabel="ביטול המשימה" cancelLabel="חזרה" onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'ביטול המשימה' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'אישור' })).toBeNull();
  });

  it('refuses a confirm button that names nothing (R8)', () => {
    expect(() =>
      render(
        <ConfirmDialog title="מחיקה" consequence="לא ניתן לשחזר." confirmLabel="אישור"
          onCancel={vi.fn()} onConfirm={vi.fn()} />,
      ),
    ).toThrow(/פועל/);
  });

  it('opens with focus on cancel, so Enter does not destroy anything', () => {
    render(
      <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ביטול' }));
  });

  it('cancels on esc without disturbing an enclosing drawer', () => {
    const onCancel = vi.fn();
    const drawerWouldClose = vi.fn();
    render(
      <div onKeyDown={drawerWouldClose}>
        <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
          onCancel={onCancel} onConfirm={vi.fn()} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('alertdialog', { name: 'מחיקת תשלום' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(drawerWouldClose).not.toHaveBeenCalled();
  });

  it('holds the verb disabled until the acknowledgement is checked', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        title="מיזוג שני אנשים"
        consequence="2 כינויים, 3 תשלומים ומשימה אחת יעברו לרוני אדלר. המיזוג אינו הפיך."
        confirmLabel="מיזוג האנשים"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        acknowledge={{ id: 'ack', label: 'אני מבין שהמיזוג אינו הפיך', checked: false, onChange }}
      />,
    );
    expect((screen.getByRole('button', { name: 'מיזוג האנשים' }) as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'אני מבין שהמיזוג אינו הפיך' }));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <ConfirmDialog
        title="מיזוג שני אנשים"
        consequence="2 כינויים, 3 תשלומים ומשימה אחת יעברו לרוני אדלר. המיזוג אינו הפיך."
        confirmLabel="מיזוג האנשים"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        acknowledge={{ id: 'ack', label: 'אני מבין שהמיזוג אינו הפיך', checked: true, onChange }}
      />,
    );
    expect((screen.getByRole('button', { name: 'מיזוג האנשים' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('shows the preview of what will move', () => {
    render(
      <ConfirmDialog title="מיזוג שני אנשים" consequence="המיזוג אינו הפיך."
        confirmLabel="מיזוג האנשים" onCancel={vi.fn()} onConfirm={vi.fn()}>
        <p>3 תשלומים · 2 כינויים · משימה אחת</p>
      </ConfirmDialog>,
    );
    expect(screen.getByText('3 תשלומים · 2 כינויים · משימה אחת')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/confirm-dialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./confirm-dialog"`.

- [ ] **Step 3: Write the component**

`src/components/ui/confirm-dialog.tsx`:

```tsx
'use client';
/**
 * Client component: it opens with focus on cancel, closes on `esc` without
 * disturbing an enclosing Drawer, and holds a verb disabled behind an
 * acknowledgement. All three are DOM lifecycle.
 */
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from './button';
import { Checkbox } from './field';
import { cx } from './cx';
import styles from './confirm-dialog.module.css';

export type ConfirmDialogProps = {
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onCancel: () => void;
  action?: (formData: FormData) => void | Promise<void>;
  onConfirm?: () => void;
  children?: ReactNode;
  acknowledge?: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void };
};

/** R8: the confirmation names what will happen. These name nothing. */
const EMPTY_VERBS = new Set(['אישור', 'אוקיי', 'אוקי', 'כן', 'המשך', 'ביצוע']);

export function ConfirmDialog({
  title, consequence, confirmLabel, cancelLabel = 'ביטול', tone = 'danger',
  onCancel, action, onConfirm, children, acknowledge,
}: ConfirmDialogProps): ReactElement {
  if (process.env.NODE_ENV !== 'production' && EMPTY_VERBS.has(confirmLabel.trim())) {
    throw new Error(`ConfirmDialog: כפתור האישור חייב לשאת את הפועל עצמו, לא ״${confirmLabel}״`);
  }

  const titleId = useId();
  const bodyId = useId();
  /** A wrapper, because `Button` does not forward a ref and does not need to. */
  const cancelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    cancelRef.current?.querySelector('button')?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const blocked = acknowledge !== undefined && !acknowledge.checked;

  const confirmButton = (
    <Button
      tone={tone === 'danger' ? 'primary' : 'default'}
      type={action === undefined ? 'button' : 'submit'}
      disabled={blocked}
      onClick={action === undefined ? onConfirm : undefined}
    >
      {confirmLabel}
    </Button>
  );

  return (
    <>
      <div className={styles.scrim} aria-hidden="true" onClick={onCancel} />
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();   // the drawer beneath stays open
          event.preventDefault();
          onCancel();
        }}
      >
        <h2 className={styles.title} id={titleId}>{title}</h2>
        <p className={cx(styles.consequence, tone === 'danger' && styles.danger)} id={bodyId}>
          {consequence}
        </p>
        {children === undefined ? null : <div className={styles.preview}>{children}</div>}
        {acknowledge === undefined ? null : (
          <Checkbox
            id={acknowledge.id}
            label={acknowledge.label}
            checked={acknowledge.checked}
            onChange={acknowledge.onChange}
          />
        )}
        <div className={styles.actions}>
          <div ref={cancelRef}>
            <Button tone="ghost" onClick={onCancel}>{cancelLabel}</Button>
          </div>
          {action === undefined
            ? confirmButton
            : <form action={action}>{confirmButton}</form>}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/confirm-dialog.module.css`:

```css
.scrim { position: absolute; inset: 0; z-index: 50; background: rgb(28 25 23 / 24%); }
:root[data-theme='dark'] .scrim { background: rgb(0 0 0 / 60%); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .scrim { background: rgb(0 0 0 / 60%); }
}

.dialog {
  position: absolute; z-index: 60;
  inset-block-start: 50%; inset-inline-start: 50%; transform: translate(50%, -50%);
  inline-size: 400px; max-inline-size: calc(100% - 32px);
  padding: 20px; border-radius: 14px;
  background: var(--panel); box-shadow: var(--shadow-pop);
  display: flex; flex-direction: column; gap: 12px;
}

.title { font-size: 16px; font-weight: 600; margin: 0; }
.consequence { font-size: 13.5px; color: var(--ink-2); margin: 0; }
.danger { color: var(--ink); }

.preview {
  padding: 12px; border-radius: 10px; background: var(--sunken);
  font-size: 13px; color: var(--ink-2);
}

.actions { display: flex; gap: 8px; justify-content: flex-end; margin-block-start: 4px; }
.actions form { display: contents; }

@media (max-width: 768px) {
  .dialog { inline-size: calc(100% - 32px); }
}
```

`transform: translate(50%, -50%)` is correct for RTL, where `inset-inline-start: 50%` resolves to the right edge. If the dialog lands off-screen in a left-to-right story, the fix is `inset-inline-start: 50%` plus an `:dir(ltr)` override, not a physical `left`.

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/confirm-dialog.test.tsx`
Expected: PASS — 1 file, 7 tests. React logs the thrown error during the third test; that is expected.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): nothing irreversible happens in one click

The confirm button carries the verb and refuses to read "אישור". Focus opens on
cancel, so Enter cannot destroy a payment. Esc stops propagating, so a dialog
over a drawer closes itself and leaves the drawer standing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 14: The bar that appears when something is selected

**Files:**
- Create: `src/components/ui/bulk-bar.tsx`, `src/components/ui/bulk-bar.module.css`, `src/components/ui/bulk-bar.test.tsx`

**Rulings (binding):**

1. **At zero the component renders `null`.** No screen writes `{count > 0 && <BulkBar …/>}`; the bar knows when it has nothing to say.
2. **Destructive actions live behind `עוד` and never on the bar** (C8, R8). `actions` and `moreActions` are separate props so that a screen cannot put a delete beside an export by accident. The `עוד` menu is `Popover` from Task 11 with `triggerTone="bulk"`.
3. **The count is announced.** `aria-live="polite"` on the count alone — not on the whole bar, which would re-announce every action label each time the selection changes.
4. **The Hebrew agrees with the number.** `selectionLabel(1)` is `נבחר אחד`; `selectionLabel(n)` is `n נבחרו`. Exported and tested, so no screen writes `1 נבחרו`.

**Interfaces:**
- Consumes: `cx` (Task 1); `Button` (Task 1); `Popover` (Task 11); `Icon` (plan 01).
- Produces:

```ts
export type BulkAction = {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
};

export type BulkBarProps = {
  count: number;
  /** The region's accessible name, e.g. `פעולות על הנבחרים`. */
  label: string;
  actions: readonly BulkAction[];
  /** C8/R8: destructive actions, behind `עוד`. */
  moreActions?: readonly BulkAction[];
  onClear: () => void;
};

export function selectionLabel(count: number): string;
export function BulkBar(props: BulkBarProps): ReactElement | null;
```

**Retires:** nothing today; no screen has selection. D3, D7 and D10 each delete their own one-row-at-a-time action columns in favour of it.

- [ ] **Step 1: Write the failing test**

`src/components/ui/bulk-bar.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkBar, selectionLabel } from './bulk-bar';

const actions = [
  { id: 'season', label: 'שיוך לשנה', onSelect: vi.fn() },
  { id: 'export', label: 'ייצוא', onSelect: vi.fn() },
];

describe('selectionLabel', () => {
  it('agrees with the number', () => {
    expect(selectionLabel(1)).toBe('נבחר אחד');
    expect(selectionLabel(2)).toBe('2 נבחרו');
    expect(selectionLabel(35)).toBe('35 נבחרו');
  });
});

describe('BulkBar', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = render(
      <BulkBar count={0} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('names itself and announces the count politely', () => {
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'פעולות על הנבחרים' });
    expect(region).toBeTruthy();
    const live = screen.getByText(/נבחרו/);
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('offers each action', () => {
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'שיוך לשנה' }));
    expect(actions[0].onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the destructive ones behind עוד', () => {
    const remove = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[{ id: 'remove', label: 'הסרה מהשנה', onSelect: remove }]}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'הסרה מהשנה' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('offers a way out of the selection', () => {
    const onClear = vi.fn();
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הבחירה' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/ui/bulk-bar.test.tsx`
Expected: FAIL — `Failed to resolve import "./bulk-bar"`.

- [ ] **Step 3: Write the component**

`src/components/ui/bulk-bar.tsx`:

```tsx
/**
 * No `'use client'`: the bar calls no hook and holds no state. Every action is
 * a callback into the selection state the list owns, so the bar is only ever
 * rendered from inside that list's client tree — the same arrangement as
 * `Table` with a `selection` prop.
 */
import type { ReactElement } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { Button } from './button';
import { Popover } from './popover';
import styles from './bulk-bar.module.css';

export type BulkAction = {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
};

export type BulkBarProps = {
  count: number;
  label: string;
  actions: readonly BulkAction[];
  moreActions?: readonly BulkAction[];
  onClear: () => void;
};

export function selectionLabel(count: number): string {
  return count === 1 ? 'נבחר אחד' : `${count} נבחרו`;
}

export function BulkBar({
  count, label, actions, moreActions, onClear,
}: BulkBarProps): ReactElement | null {
  if (count <= 0) return null;

  return (
    <div className={styles.bar} role="region" aria-label={label}>
      <span className={styles.count} aria-live="polite">{selectionLabel(count)}</span>

      {actions.map((action) => (
        <Button key={action.id} size="sm" disabled={action.disabled} onClick={action.onSelect}>
          {action.icon ? <Icon name={action.icon} size={14} /> : null}
          {action.label}
        </Button>
      ))}

      {moreActions === undefined || moreActions.length === 0 ? null : (
        <Popover id="bulk-more" label="עוד" triggerTone="bulk" align="end">
          {moreActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={styles.menuItem}
              role="menuitem"
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.icon ? <Icon name={action.icon} size={14} /> : null}
              {action.label}
            </button>
          ))}
        </Popover>
      )}

      <Button size="sm" iconLabel="ביטול הבחירה" onClick={onClear}>
        <Icon name="x" size={14} />
      </Button>
    </div>
  );
}
```

`selectionLabel` renders the digits without a `<bdi>` on purpose: the whole string is one Hebrew phrase whose only Latin-direction run is the number itself, and a bare digit run in an RTL paragraph already resolves correctly. A screen that needs the number emphasised wraps it itself.

- [ ] **Step 4: Write the stylesheet**

`src/components/ui/bulk-bar.module.css`:

```css
.bar {
  position: absolute; z-index: 15;
  inset-block-end: 20px; inset-inline-start: 50%; transform: translateX(50%);
  display: flex; align-items: center; gap: 6px;
  padding-block: 6px; padding-inline: 10px 6px; border-radius: 12px;
  background: var(--ink); color: var(--canvas);
  box-shadow: 0 12px 32px rgb(28 25 23 / 28%);
}
.count {
  padding-inline: 0 10px; font-weight: 600; font-variant-numeric: tabular-nums;
  border-inline-end: 1px solid rgb(255 255 255 / 18%); margin-inline-end: 4px;
}
.bar button { background: transparent; border-color: transparent; color: inherit; }
.bar button:hover { background: rgb(255 255 255 / 10%); }

.menuItem {
  display: flex; align-items: center; gap: 10px;
  block-size: 36px; padding-inline: 12px; border: 0; background: none;
  color: var(--ink); font: inherit; font-size: 13.5px; text-align: start;
  white-space: nowrap; cursor: pointer;
}
.menuItem:hover { background: var(--sunken); }
.menuItem:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.menuItem:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 768px) {
  .bar { inset-inline: 8px; transform: none; overflow-x: auto; }
}
```

`.bar button` styles `Button`'s element rather than `Button`'s module, which is the one place the kit's "no component reaches into another's styles" rule needs an exception: the bar is a dark surface and the buttons on it must invert. Keep it to these two rules; if it grows, `Button` gains an `inverted` tone instead.

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run src/components/ui/bulk-bar.test.tsx`
Expected: PASS — 1 file, 6 tests.

- [ ] **Step 6: Run the whole kit**

Run: `npx vitest run src/components/ui`
Expected: PASS — 18 files. Read the COUNT and record it in the report; a file that did not load is a silent zero.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/ui`
Expected: no output from either.

- [ ] **Step 8: Run the full suite once**

Run: `npx vitest run`
Expected: PASS. The only pre-existing files this plan touched are `src/app/(admin)/money/page.tsx` (one import) and `src/components/charts/charts.module.css` (four deleted classes); a failure anywhere else is unrelated and belongs in the report, not in a fix.

- [ ] **Step 9: Commit**

```
git add src/components/ui && git commit -F - <<'MSG'
feat(ui): the bar that appears when something is selected

It renders nothing at zero, announces its count politely, and keeps the
destructive actions behind עוד so an export and a delete are never neighbours.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-review

Run this before declaring the plan done, and report each answer.

### Spec coverage

Every requirement in spec section C except C14, which belongs to plan 01:

| req | component | task | test that proves it |
|---|---|---|---|
| C1 | `Table` | 2 | sticky 36px header, 44/36px rows, `w0` action column, `tfoot` totals, group rows, numeric columns (10 cases) |
| C2 | `SavedViews` | 10 | tablist, counts, one `aria-selected`, the `+` |
| C3 | `FilterBar` | 11 | debounced search, chips with values, dashed add-filter, sort, columns, row count |
| C4 | `Pill` | 3 | seven tones, the word, the decorative dot, the blank refusal |
| C5 | `Avatar`, `AvatarStack` | 4 | initials, six tints, three sizes, empty dashed variant, overlap and cap |
| C6 | `Drawer` | 12 | end-side panel, header with stepper/expand/close, scrolling body, footer, URL-driven, `esc`, focus trap, focus restore |
| C7 | `ConfirmDialog` | 13 | 400px, the action and its consequence, the verb on confirm |
| C8 | `BulkBar` | 14 | count, actions, destructive behind `עוד`, clear |
| C9 | `Banner` | 5 | four tones, icon, sentence, at most one action |
| C10 | `EmptyState` | 6 | five kinds as a union, the Hebrew for each, celebrate only on `all-clear` |
| C11 | `StatTile` | 7 | label, value, derivation, bar, link — and the migration out of `components/charts` |
| C12 | `SourceChip` | 8 | mono cell reference, `נרשם ידנית`, link to the block |
| C13 | `Field` and its controls | 9 | label, control, hint, error; input, select, textarea, segmented, checkbox |

Cross-cutting rulings each component must be re-checked against, one by one:

- **R1** — `git diff main -- package.json package-lock.json` is empty.
- **R3** — every tone in `Pill`, `Banner` and `StatTile` is accompanied by a word or a label; `Pill` throws without one.
- **R4** — the only place `--brand` is a background is `Button`'s `.primary`, and its colour is `--brand-ink`.
- **R6** — `grep -rn "peek" src/components/ui` shows `drawer-url.ts` and its test only; no other file spells the param.
- **R7** — `grep -rln "use client" src/components/ui` lists exactly four files: `popover.tsx`, `filter-bar.tsx`, `drawer.tsx`, `confirm-dialog.tsx`. Each opens with a comment naming the reason. Every other file is absent from that list, `bulk-bar.tsx` included — it takes callbacks but calls no hook, so it renders inside its list's client tree without a directive of its own.
- **R8** — `ConfirmDialog` refuses a nameless verb and opens focus on cancel.
- **R9/E5** — `grep -rnE "[A-Za-z]{4,}" src/components/ui --include="*.tsx"` returns only identifiers, attribute names and `IBM Plex Mono`; no English sentence reaches a screen.
- **R10** — the only key handlers in the kit read `Escape` and `Tab`, neither of which is a letter, so no `event.key` comparison in this plan is layout-dependent.
- **A9** — `grep -rn "outline" src/components/ui/*.module.css` shows a `:focus-visible` rule wherever an element is focusable and no bare `outline: none` without a replacement ring.
- **A10** — `grep -rnE "(^|[^-])(left|right):" src/components/ui/*.module.css` returns only `table.module.css`'s `.numeric { text-align: right }` and `field.module.css`'s `.moneyInput { text-align: right }`, each with its comment.
- **A11** — every amount in the kit goes through `formatILS` and sits in a `<bdi>`: `StatTile` only, since no other component formats money.
- **E4** — every icon-only control in the kit carries `iconLabel` or `aria-label`; every overlay has a role and an accessible name; `Table` has a caption.

### Placeholder scan

Run and confirm each is empty:

- `grep -rn "TODO\|FIXME\|XXX\|placeholder\|Lorem\|\.\.\." src/components/ui --include="*.tsx" --include="*.ts" --include="*.css"` — the only `...` should be spread syntax and the only "placeholder" should be the `placeholder` prop on `TextInput` and `Textarea`.
- `grep -rn "any\b" src/components/ui` — no `any`. `Table` is generic in `Row`; `EmptyState` is a discriminated union; `ConfirmDialog`'s `action` takes `FormData`.
- `grep -rn "#[0-9a-fA-F]\{3,8\}" src/components/ui/*.module.css` — hits only in `avatar.module.css`, and exactly twelve of them.
- `grep -rn "styles\." src/components/ui --include="*.tsx"` — every `styles.x` resolves to a class defined in that component's own module, and no file imports another component's `.module.css`.
- Every component file exports its props type, and no test imports an internal helper that the file does not export.

### Type consistency

- `npx tsc --noEmit` is clean, run last, not per-task.
- The prop types in each task's **Interfaces** block match the shipped file exactly. Diff them; a plan whose interfaces drifted from the code is worse than no plan, because the screen plans were written against it.
- `StatTile`'s value union accepts all four `/money` call sites unchanged. Confirm with `npx tsc --noEmit` and by reading `src/app/(admin)/money/page.tsx` — it must differ from `main` by exactly one line.
- `ReadableParams` accepts both `URLSearchParams` and `ReadonlyURLSearchParams`. Confirm by using `useSearchParams()`'s return value directly in a scratch type check, or by the fact that `filter-bar.tsx` iterates `params` with no cast.
- `IconName` is imported, never re-declared. `grep -rn "IconName" src/components/ui` shows imports from `@/components/ui/icon` and no local union.
- No component in the kit imports from `@/db`, `@/lib/auth`, or any `'use server'` module. `grep -rn "@/db\|use server\|requireAdmin" src/components/ui` is empty.

### Report

State, in the handoff: the final `npx vitest run src/components/ui` file and test COUNT; whether `Button` and `Icon` came from plan 01 or from Task 1; the line `src/app/(admin)/money/page.tsx` now reads; and, for each of the five page stylesheets named in the **Retires** notes, the list of classes a later screen plan may now delete. Those lists are what plans 04 and later delete instead of duplicating.
