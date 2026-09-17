# Phones, and the Finishing Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four things a lead does standing up work on a phone — see
where the camp stands, look someone up, record a payment, staff a task — and
then close the redesign: every empty state, every result reported, every load
shaped like its content, every screen reachable by keyboard, every string
Hebrew, and no page reading a workbook off the disk while someone waits.

**Architecture:** One responsive shell, not a second one. The sidebar folds
at 1024px and disappears at 768px behind a five-item bottom tab bar; the
`Table` from the kit reflows into a card list by CSS on a single DOM, keeping
its table semantics; the `Drawer` from the kit re-anchors to the block-end
edge and becomes a sheet. Nothing in this plan branches on `window.innerWidth`
in JavaScript, because a Server Component does not know the viewport and a
client one that guesses produces a hydration mismatch. The finishing pass adds
four cross-cutting pieces — `EmptyState` coverage, a toaster with domain
undo, per-route skeletons, and a Hebrew error boundary — plus three static
nets that keep the rules from rotting: no unnamed control, no English in the
UI, no `node:fs` in a route module.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules,
Vitest + `@testing-library/react` under `/** @vitest-environment jsdom */`.
Commands are `npx vitest run <path>` and `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-09-17-ui-redesign-design.md` — B7 and
D11 for the phone half, E1–E6 for the finishing pass, with R1, R3, R6, R7, R8,
R9 and R11 binding throughout. A8 and A9 carry the density and focus numbers.

## Global Constraints

- **This plan runs last.** Plans 01–11 are merged to `main` before Task 1
  starts. Every file this plan modifies was created by one of them; if a file
  named below does not exist, stop and report which plan owes it rather than
  creating a second version of it.
- **R1 — no new dependencies.** No `@testing-library/jest-dom`, no
  `user-event`, no axe, no icon or component package. Assertions use
  `expect(el.getAttribute(…))`, `expect(el).toBeTruthy()` and
  `fireEvent` from `@testing-library/react`, exactly as
  `src/app/(admin)/nav.test.tsx` and `src/app/(admin)/members/add-member.test.tsx`
  already do. Accessible names are checked through
  `queryAllByRole(role, { name: '' })`, which uses the name computation
  already shipped inside `@testing-library/dom`.
- **R7 — every client component states why it is one** in a comment above the
  component, as `assign-control.tsx` and `member-fee-row.tsx` do.
- **R9 — no English reaches a Hebrew screen.** Task 9 is where that becomes
  total; until it lands, do not add a new `error.message` pass-through.
- **R12 — no flag, no parallel route tree.** Each task ships on `main`.
- **Hebrew RTL.** Logical properties only (A10); the one exception is a
  numeric table column, `text-align: right` with `tabular-nums`. Amounts go
  through the existing `formatILS` helper inside `<bdi>` with the symbol last
  (A11).
- **Media queries carry literal pixels.** `@media (max-width: var(--bp))` is
  not valid CSS. The two breakpoints are written as `1023.98px` and
  `767.98px` — the fractional value closes the gap a fractional viewport width
  opens — and every module that uses them repeats the comment block from
  Task 1 naming what each one means.
- **Before each commit:** the task's own vitest paths, then `npx tsc --noEmit`,
  then `npx eslint <touched files>`. Commit messages end with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`,
  written through `git commit -F - <<'MSG'`.

---

## File Structure

```
src/
  app/
    globals.css                              modify  the phone floor block (Task 3)
    (admin)/
      layout.tsx                             modify  skip link, <main id="main">, ToastProvider, BottomNav
      shell/                                 (plan 02 owns the sidebar; this plan adds these beside it)
        bottom-nav.tsx                       new     client — the five-item tab bar (B7)
        bottom-nav.module.css                new
        bottom-nav.test.tsx                  new
        nav-sheet.tsx                        new     client — the folded sidebar and "עוד"
        nav-sheet.test.tsx                   new
        shell.module.css                     modify  the two breakpoints
      loading.tsx                            new     one per data-bearing segment (Task 7)
      members/loading.tsx                    new
      members/[id]/loading.tsx               new
      fees/loading.tsx                       new
      tasks/loading.tsx                      new
      money/loading.tsx                      new
      money/ledger/loading.tsx               new
      money/debts/loading.tsx                new
      inbox/loading.tsx                      new
      imports/loading.tsx                    new
      imports/[id]/loading.tsx               new
      empty-states.test.tsx                  new     the E1 sweep (Task 5)
      a11y-sweep.test.tsx                    new     the E4 sweep (Task 8)
      copy-sweep.test.tsx                    new     the E5 sweep (Task 9)
      route-modules.test.ts                  new     the E6 net, plus viewport and scroll-x (Task 10)
      fees/actions.ts                        modify  recordPaymentAction returns the new id (Task 6)
      fees/pay-drawer.tsx                    modify  the phone sheet (Task 4)
      tasks/actions.ts                       modify  hebrewError (Task 9)
      members/actions.ts                     modify  hebrewError (Task 9)
  components/ui/
    table.tsx / table.module.css             modify  data-label, explicit roles, the card reflow (Task 2)
    table.test.tsx                           modify
    drawer.tsx / drawer.module.css           modify  the sheet anchor and the `phone` prop (Task 3)
    drawer.test.tsx                          modify
    empty-state.tsx                          modify  the five kinds, the season in the type (Task 5)
    empty-state.test.tsx                     modify
    toaster.tsx / toaster.module.css         new*    *or modify, if plan 03 shipped one (Task 6)
    toaster.test.tsx                         new*
    skeleton.tsx / skeleton.module.css       new     (Task 7)
    skeleton.test.tsx                        new
  lib/
    action-result.ts                         modify  ActionResult<T> (Task 6)
    errors/hebrew.ts                         new     the R9 boundary map (Task 9)
    errors/hebrew.test.ts                    new
  test/
    a11y.ts                                  new     focusable / unnamed-control helpers (Task 8)
```

## Dependencies

| Task | Depends on |
|---|---|
| 1 Breakpoints and the bottom bar | plan 02 (the shell), plan 03 (`Icon`) |
| 2 Table → card list | plan 03 (`Table`), Task 1 |
| 3 Drawer → sheet, touch floors | plan 03 (`Drawer`), Task 1 |
| 4 Recording a payment on a phone | plans 03, 06 (`/fees`), Tasks 2 and 3 |
| 5 Empty states (E1) | plan 03 (`EmptyState`), every screen plan |
| 6 Toasts and undo (E2) | plan 03; Task 5 for where a toast lands |
| 7 Skeletons (E3) | every screen plan |
| 8 Accessibility sweep (E4) | Tasks 1–7 |
| 9 Copy sweep (E5, R9) | Task 6 (the actions it edits) |
| 10 No disk reads (E6) | plan 04 (`/inbox` replacing `/data`) |

Tasks 1→2→3→4 are a chain. Tasks 5, 6, 7 are independent of each other and of
the chain. Tasks 8, 9, 10 are the closing nets and run after everything else.

---

### Task 1: The sidebar folds, and a phone gets a bottom bar

Below 1024px the 244px sidebar is more than a laptop lid has room for beside a
table, so it folds behind a menu button in the 52px top bar (B6) and opens as
an overlay. Below 768px there is no sidebar at all: the layout is one column
and five destinations sit at the bottom of the screen where a thumb reaches
them (B7).

**Ruling (binding):** the nav overlay is client state, not a URL param. R6
binds *record* drawers — panels holding data a lead might want to send to
someone else. A nav overlay holds no data and there is nothing to link to, so
`useState` is right and a `?nav=open` param would only pollute every shared
URL. The comment above the component says this.

**Ruling (binding):** no screen draws a status bar. The mock's artboards are
device frames with a clock and a battery painted on; those belong to the
phone, and an app that redraws them is lying about the time. The phone header
is the wordmark, search, and the signed-in avatar — nothing above it.

**Files:**
- Read first: `src/app/(admin)/layout.tsx` and whatever folder plan 02 put the
  sidebar in. The new files go beside the sidebar, whatever that folder is
  called; the paths below assume `src/app/(admin)/shell/`.
- Create: `src/app/(admin)/shell/bottom-nav.tsx`, `bottom-nav.module.css`,
  `bottom-nav.test.tsx`, `nav-sheet.tsx`, `nav-sheet.test.tsx`
- Modify: `src/app/(admin)/shell/shell.module.css`, `src/app/(admin)/layout.tsx`

**Interfaces:**

Consumes — from plan 02's shell, the destination list and the counts already
computed on the server for B2; from plan 03, `Icon`.

Produces:

```ts
// src/app/(admin)/shell/bottom-nav.tsx
export function BottomNav(props: { inboxCount: number }): React.ReactElement;

// src/app/(admin)/shell/nav-sheet.tsx
export function NavSheet(props: {
  /** What opens it: 'menu' is the folded sidebar (768–1023px), 'more' is the
   *  bottom bar's fifth item (below 768px). */
  variant: 'menu' | 'more';
  label: string;
  children: React.ReactNode;
}): React.ReactElement;
```

**Steps:**

- [ ] 1. Read `src/app/(admin)/layout.tsx` and the shell folder plan 02
  created, and write down the exact import path of the sidebar component and
  the name of its CSS module. Every path below uses those names.

- [ ] 2. Write the failing test file `src/app/(admin)/shell/bottom-nav.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/members' }));

import { BottomNav } from './bottom-nav';

describe('BottomNav', () => {
  it('offers the five destinations B7 names, in order', () => {
    render(<BottomNav inboxCount={12} />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/members', '/money', '/inbox']);
    expect(screen.getByRole('button', { name: 'עוד' })).toBeTruthy();
  });

  it('marks the section the reader is in, by path prefix', () => {
    render(<BottomNav inboxCount={0} />);
    expect(screen.getByRole('link', { name: 'אנשים' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'בית' }).getAttribute('aria-current')).toBeNull();
  });

  it('carries the open-decisions count inside the accessible name', () => {
    render(<BottomNav inboxCount={12} />);
    expect(screen.getByRole('link', { name: 'לטיפול, 12 פריטים' })).toBeTruthy();
  });

  it('shows no badge at all when the count would read zero', () => {
    render(<BottomNav inboxCount={0} />);
    expect(screen.getByRole('link', { name: 'לטיפול' })).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('draws no status bar: the bar holds five things and nothing else', () => {
    const { container } = render(<BottomNav inboxCount={3} />);
    expect(container.querySelector('nav')?.children.length).toBe(5);
  });
});
```

- [ ] 3. Run `npx vitest run 'src/app/(admin)/shell/bottom-nav.test.tsx'` and
  confirm it fails with `Failed to resolve import "./bottom-nav"`.

- [ ] 4. Write `src/app/(admin)/shell/bottom-nav.tsx`:

```tsx
'use client';

// A client component because B3's active marking reads the current path, and
// `usePathname` is a client hook. Nothing else here needs the client.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { NavSheet } from './nav-sheet';
import styles from './bottom-nav.module.css';

const TABS = [
  { href: '/', label: 'בית', icon: 'home' },
  { href: '/members', label: 'אנשים', icon: 'users' },
  { href: '/money', label: 'כספים', icon: 'wallet' },
  { href: '/inbox', label: 'לטיפול', icon: 'inbox' },
] as const;

/** B3: `/members/[id]` keeps אנשים marked, but `/` only matches itself. */
function isCurrent(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ inboxCount }: { inboxCount: number }) {
  const pathname = usePathname();

  return (
    <nav className={styles.bar} aria-label="ניווט ראשי">
      {TABS.map((tab) => {
        // B2: a count that would read zero is not shown, and it is not
        // announced either — hence the label, not just the badge, is gated.
        const counted = tab.href === '/inbox' && inboxCount > 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={styles.tab}
            aria-label={counted ? `${tab.label}, ${inboxCount} פריטים` : undefined}
            aria-current={isCurrent(pathname, tab.href) ? 'page' : undefined}
          >
            <span className={styles.glyph}>
              <Icon name={tab.icon} size={20} />
              {counted && <span className={styles.badge} aria-hidden="true"><bdi>{inboxCount}</bdi></span>}
            </span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
      <NavSheet variant="more" label="עוד">
        {/* plan 02's destination list, rendered as the sheet's body */}
      </NavSheet>
    </nav>
  );
}
```

- [ ] 5. Write `src/app/(admin)/shell/bottom-nav.module.css`, with every
  interactive box on the tap token so Task 3's floor governs it:

```css
.bar {
  display: flex;
  border-block-start: 1px solid var(--line);
  background: var(--panel);
  padding: 6px 4px 10px;
}
.tab {
  flex: 1;
  min-block-size: var(--tap);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--ink-3);
  font-size: 11.5px;
  text-decoration: none;
}
.tab[aria-current='page'] { color: var(--brand-text); font-weight: 600; }
.glyph { position: relative; display: inline-flex; }
.badge {
  position: absolute;
  inset-block-start: -5px;
  inset-inline-start: -9px;
  min-inline-size: 17px;
  block-size: 17px;
  padding-inline: 4px;
  border-radius: 999px;
  background: var(--brand);
  color: var(--brand-ink);
  font-size: 10.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] 6. Run `npx vitest run 'src/app/(admin)/shell/bottom-nav.test.tsx'` and
  confirm all five pass.

- [ ] 7. Write the failing test file `src/app/(admin)/shell/nav-sheet.test.tsx`
  — this is the only automated proof that the fold works, so it tests the
  behaviour rather than the pixels:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavSheet } from './nav-sheet';

function open() {
  render(
    <NavSheet variant="menu" label="תפריט">
      <a href="/fees">דמי קאמפ</a>
      <a href="/tasks">משימות</a>
    </NavSheet>,
  );
  const trigger = screen.getByRole('button', { name: 'תפריט' });
  fireEvent.click(trigger);
  return trigger;
}

describe('NavSheet', () => {
  it('is closed until the reader asks for it', () => {
    render(<NavSheet variant="menu" label="תפריט"><a href="/fees">דמי קאמפ</a></NavSheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus inside once it opens, so the keyboard is already there', () => {
    open();
    const panel = screen.getByRole('dialog', { name: 'תפריט' });
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('keeps Tab inside the panel while it is open', () => {
    open();
    const panel = screen.getByRole('dialog', { name: 'תפריט' });
    const links = screen.getAllByRole('link');
    links[links.length - 1].focus();
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(panel.querySelector('button'));
  });

  it('closes on esc and gives focus back to what opened it', () => {
    const trigger = open();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'תפריט' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
```

- [ ] 8. Run `npx vitest run 'src/app/(admin)/shell/nav-sheet.test.tsx'` and
  confirm it fails with `Failed to resolve import "./nav-sheet"`.

- [ ] 9. Write `src/app/(admin)/shell/nav-sheet.tsx`. The trap is a `keydown`
  handler on the panel — jsdom does not move focus on a synthetic Tab, so a
  trap implemented any other way would be untestable here and untested in a
  browser too:

```tsx
'use client';

// A client component because opening a panel, trapping focus in it and
// restoring focus on close are all interaction. R6 does not apply: this panel
// holds navigation, not data, so there is nothing to put in a URL.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import styles from './nav-sheet.module.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function NavSheet({
  variant, label, children,
}: {
  variant: 'menu' | 'more';
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { close(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (event.shiftKey && (at === first || !panelRef.current?.contains(at))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (at === last || !panelRef.current?.contains(at))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={variant === 'more' ? styles.tabTrigger : styles.menuTrigger}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" size={20} />
        {variant === 'more' && <span>{label}</span>}
      </button>
      {open && (
        <div className={styles.scrim} onClick={close}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={variant === 'more' ? styles.sheet : styles.panel}
            onKeyDown={onKeyDown}
            onClick={(event) => event.stopPropagation()}
          >
            {children}
            <button type="button" onClick={close}>סגירה</button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] 10. Run `npx vitest run 'src/app/(admin)/shell/nav-sheet.test.tsx'` and
  confirm all four pass.

- [ ] 11. Add the two breakpoints to `src/app/(admin)/shell/shell.module.css`,
  with the comment block every other module repeats:

```css
/* The two widths the shell changes at.
   1023.98px — a laptop lid beside a table: the 244px sidebar folds behind the
   top bar's menu button and opens as an overlay panel.
   767.98px  — a phone: there is no sidebar, the main panel loses its inset and
   its rounding, and the bottom tab bar takes over (B7).
   The fractional value closes the gap a fractional viewport width opens. */
@media (max-width: 1023.98px) {
  .sidebar { display: none; }
  .menuTrigger { display: inline-flex; }
}
@media (max-width: 767.98px) {
  .menuTrigger { display: none; }
  .panel { margin: 0; border: 0; border-radius: 0; }
  .bottomNav { display: flex; }
  .topBar { position: sticky; inset-block-start: 0; z-index: 2; }
}
@media (min-width: 768px) {
  .bottomNav { display: none; }
}
```

- [ ] 12. Modify `src/app/(admin)/layout.tsx` to render `<BottomNav>` after the
  main panel and to pass the open-decisions count the sidebar already computes
  for B2, so the two never disagree.

- [ ] 13. Run `npx vitest run 'src/app/(admin)'` and `npx tsc --noEmit`, and
  confirm both are clean.

- [ ] 14. Commit: `feat(shell): the sidebar folds, and a phone gets a bottom bar`.

---

### Task 2: A table becomes a card list rather than scrolling sideways

**Ruling (binding):** a table never scrolls sideways on a phone, and the phone
never sees fewer columns than the laptop. Below 768px the same `<table>`
reflows into a list of cards: every column keeps its cell, and the card role
only decides where in the card it lands. This is why `Column.card` has four
members and no `'hidden'` — the type system is what stops a column being
quietly dropped on the width where a lead is most likely to be standing in a
dust storm with one hand free.

**Ruling (binding):** the reflow is one DOM and pure CSS. Rendering a table
and a card list and hiding one would double every accessible name; branching
in JavaScript on the viewport would hydrate wrong. `display: block` on table
elements drops the implicit table roles in every engine, so `table.tsx`
reasserts them (`role="table"`, `rowgroup`, `row`, `columnheader`, `cell`) and
the header row is *visually* hidden — clipped, not `display: none` — so every
cell keeps its column header at every width, which is what E4 asks for.

**Files:**
- Read first: `src/components/ui/table.tsx` as plan 03 shipped it
- Modify: `src/components/ui/table.tsx`, `table.module.css`, `table.test.tsx`
- Modify: `src/app/globals.css` — remove `.scroll-x`

**Interfaces:**

Consumes — plan 03's `Table`.

Produces:

```ts
// src/components/ui/table.tsx
export interface Column<Row> {
  key: string;
  header: string;
  /** Where this column lands once the table has reflowed into a card.
   *  There is no 'hidden': a phone shows every column, rearranged. */
  card: 'title' | 'figure' | 'meta' | 'action';
  numeric?: boolean;
  render: (row: Row) => React.ReactNode;
}

export function Table<Row>(props: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  footer?: React.ReactNode;
}): React.ReactElement;
```

**Steps:**

- [ ] 1. Read `src/components/ui/table.tsx` and record the column descriptor
  plan 03 actually shipped. If it already carries a `card` field, the rest of
  this task adds only the `data-label`, the roles and the CSS; if it takes
  arbitrary `<tr>` children instead of a `columns` array, stop and report,
  because a card reflow cannot be derived from opaque children.

- [ ] 2. Add the failing tests to `src/components/ui/table.test.tsx`:

```tsx
const columns: Column<{ id: string; name: string; due: string; state: string }> = [
  { key: 'name', header: 'שם', card: 'title', render: (r) => r.name },
  { key: 'due', header: 'יתרה לתשלום', card: 'figure', numeric: true, render: (r) => r.due },
  { key: 'state', header: 'סוג', card: 'meta', render: (r) => r.state },
] as never;

const rows = [{ id: 'p1', name: 'איתי כהן', due: '1,200 ₪', state: 'רגיל' }];

describe('Table, once it has to fit a phone', () => {
  it('names the table, so E4 has something to find it by', () => {
    render(<Table caption="דמי קאמפ לברן 26" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole('table', { name: 'דמי קאמפ לברן 26' })).toBeTruthy();
  });

  it('gives every cell the name of its column, so a card can label it', () => {
    const { container } = render(<Table caption="דמי קאמפ" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const labels = Array.from(container.querySelectorAll('td')).map((td) => td.getAttribute('data-label'));
    expect(labels).toEqual(['שם', 'יתרה לתשלום', 'סוג']);
  });

  it('records where each cell lands in the card', () => {
    const { container } = render(<Table caption="דמי קאמפ" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const cards = Array.from(container.querySelectorAll('td')).map((td) => td.getAttribute('data-card'));
    expect(cards).toEqual(['title', 'figure', 'meta']);
  });

  it('reasserts the table roles a block layout would otherwise drop', () => {
    const { container } = render(<Table caption="דמי קאמפ" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(container.querySelector('table')?.getAttribute('role')).toBe('table');
    expect(container.querySelector('tbody')?.getAttribute('role')).toBe('rowgroup');
    expect(container.querySelector('tr')?.getAttribute('role')).toBe('row');
    expect(container.querySelector('td')?.getAttribute('role')).toBe('cell');
  });

  it('keeps the header row in the accessibility tree at every width', () => {
    render(<Table caption="דמי קאמפ" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['שם', 'יתרה לתשלום', 'סוג']);
    expect(headers[0].getAttribute('scope')).toBe('col');
  });
});
```

- [ ] 3. Run `npx vitest run src/components/ui/table.test.tsx` and confirm the
  four new assertions fail on `data-label`, `data-card` and the roles being
  `null`.

- [ ] 4. Modify `src/components/ui/table.tsx` so each cell carries its column's
  header and card role, and every table element carries its explicit role:

```tsx
<table role="table" className={styles.table}>
  <caption className={styles.caption}>{caption}</caption>
  <thead role="rowgroup" className={styles.head}>
    <tr role="row">
      {columns.map((column) => (
        <th key={column.key} role="columnheader" scope="col" className={column.numeric ? styles.numeric : undefined}>
          {column.header}
        </th>
      ))}
    </tr>
  </thead>
  <tbody role="rowgroup">
    {rows.map((row) => (
      <tr key={rowKey(row)} role="row">
        {columns.map((column) => (
          <td
            key={column.key}
            role="cell"
            data-label={column.header}
            data-card={column.card}
            className={column.numeric ? styles.numeric : undefined}
          >
            {column.render(row)}
          </td>
        ))}
      </tr>
    ))}
  </tbody>
</table>
```

- [ ] 5. Run `npx vitest run src/components/ui/table.test.tsx` and confirm
  every assertion passes.

- [ ] 6. Add the reflow to `src/components/ui/table.module.css`:

```css
/* 767.98px — a phone. The table stops being a grid and becomes a list of
   cards. The header row is clipped rather than removed, so every cell keeps
   its columnheader; the role attributes in table.tsx keep the table semantics
   that `display: block` drops. No column is hidden — they are rearranged. */
@media (max-width: 767.98px) {
  .table, .table tbody, .table tfoot { display: block; }
  .table thead {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .table tr {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 2px 12px;
    padding: 12px 14px;
    border-block-end: 1px solid var(--line);
  }
  .table td { display: block; block-size: auto; padding: 0; border: 0; }
  .table td[data-card='title']  { grid-column: 1; font-weight: 600; font-size: 15px; }
  .table td[data-card='figure'] { grid-column: 2; grid-row: 1; text-align: end; font-variant-numeric: tabular-nums; }
  .table td[data-card='meta']   { grid-column: 1 / -1; color: var(--ink-3); font-size: 12.5px; }
  .table td[data-card='meta']::before { content: attr(data-label) ': '; }
  .table td[data-card='action'] { grid-column: 2; min-block-size: var(--tap); min-inline-size: var(--tap); }
}
```

- [ ] 7. Prove the type rule holds: add a fifth column to the fixture in
  `table.test.tsx` with no `card` field, run `npx tsc --noEmit`, confirm it
  reports `Property 'card' is missing`, then delete that column.

- [ ] 8. Delete `.scroll-x` from `src/app/globals.css` and run
  `grep -rn "scroll-x" src` to confirm no screen still wraps a table in a
  sideways scroller. Any hit is a screen that has not been redesigned yet —
  report it rather than editing it.

- [ ] 9. Run `npx vitest run src/components/ui` and `npx tsc --noEmit`.

- [ ] 10. Commit: `feat(ui): a table on a phone becomes cards, not a sideways scroll`.

---

### Task 3: The drawer becomes a sheet, and nothing on a phone is smaller than a thumb

A drawer anchored to the inline-end edge is right on a laptop and wrong on a
phone, where it leaves a 40px strip of dead page beside a panel nobody can
reach past. Below 768px the same component anchors to the block-end edge
instead and becomes a sheet.

**Ruling (binding):** `svh`, not `vh`. On iOS `100vh` is the viewport with the
URL bar pretended away, so a sheet sized in `vh` puts its footer — the
confirm button — under the browser chrome. The sheet is `max-block-size:
92svh` and the shell is `min-block-size: 100dvh`.

**Ruling (binding):** the 16px input floor is the fix for iOS zooming on
focus, and a `viewport` export with `maximum-scale=1` or `user-scalable=no` is
not. Suppressing zoom would stop the one gesture a lead in bright sun actually
needs. Task 10 nets the repo for it.

**Files:**
- Modify: `src/components/ui/drawer.tsx`, `drawer.module.css`, `drawer.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

Consumes — plan 03's `Drawer`, still driven by R6's `?peek=<id>`.

Produces:

```ts
// src/components/ui/drawer.tsx
export function Drawer(props: {
  title: string;
  subtitle?: string;
  /** How it lands on a phone. 'sheet' rises from the bottom edge and stops at
   *  92svh; 'full' takes the whole screen, for a form with its own header and
   *  a sticky footer (D11's payment flow). Default 'sheet'. */
  phone?: 'sheet' | 'full';
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement;
```

**Steps:**

- [ ] 1. Add the failing tests to `src/components/ui/drawer.test.tsx`:

```tsx
it('records how it lands on a phone, so CSS can anchor it', () => {
  const { container } = render(
    <Drawer title="רישום תשלום" phone="full" footer={<button type="button">רישום</button>}>
      <p>איתי כהן</p>
    </Drawer>,
  );
  expect(container.querySelector('[role="dialog"]')?.getAttribute('data-phone')).toBe('full');
});

it('defaults to a sheet', () => {
  const { container } = render(<Drawer title="פרטי אדם"><p>איתי כהן</p></Drawer>);
  expect(container.querySelector('[role="dialog"]')?.getAttribute('data-phone')).toBe('sheet');
});

it('gives the sheet a close control with a name, not a bare handle', () => {
  render(<Drawer title="פרטי אדם"><p>איתי כהן</p></Drawer>);
  expect(screen.getByRole('button', { name: 'סגירה' })).toBeTruthy();
});
```

- [ ] 2. Run `npx vitest run src/components/ui/drawer.test.tsx` and confirm the
  three fail with `data-phone` being `null`.

- [ ] 3. Modify `src/components/ui/drawer.tsx` to accept `phone` and put it on
  the dialog as `data-phone={phone ?? 'sheet'}`, and to give the sheet's drag
  handle `aria-label="סגירה"` so it is a named control rather than decoration.

- [ ] 4. Run `npx vitest run src/components/ui/drawer.test.tsx` and confirm all
  pass.

- [ ] 5. Add the phone anchor to `src/components/ui/drawer.module.css`:

```css
/* 767.98px — a phone. The end-side panel re-anchors to the block-end edge.
   svh, not vh: on iOS `100vh` ignores the URL bar and would push the footer —
   the confirm button — underneath it. */
@media (max-width: 767.98px) {
  .panel {
    inset: auto 0 0 0;
    inline-size: 100%;
    max-block-size: 92svh;
    border-radius: 14px 14px 0 0;
    border-block-end: 0;
  }
  .panel[data-phone='full'] {
    inset: 0;
    max-block-size: 100dvh;
    border-radius: 0;
  }
  .panel[data-phone='full'] .footer {
    position: sticky;
    inset-block-end: 0;
    background: var(--panel);
    border-block-start: 1px solid var(--line);
    padding-block-end: max(16px, env(safe-area-inset-bottom));
  }
}
```

- [ ] 6. Append the phone floor block to `src/app/globals.css`. It is the only
  place the two numbers live:

```css
/* The phone floor (A8). 767.98px — a phone.
   --tap is the smallest box a thumb can hit; every interactive box in every
   module is sized with it rather than a literal 44.
   16px on a text input is not a style choice: below 16px, iOS Safari zooms the
   page on focus and never zooms back. The fix is the font size, never a
   viewport that forbids zooming. */
:root { --tap: 36px; }

@media (max-width: 767.98px) {
  :root { --tap: 44px; }

  button,
  a[role='button'],
  [role='tab'],
  summary {
    min-block-size: var(--tap);
    min-inline-size: var(--tap);
  }

  input,
  select,
  textarea {
    font-size: 16px;
    min-block-size: var(--tap);
  }
}
```

- [ ] 7. Write the static guard in `src/components/ui/drawer.test.tsx`. jsdom
  applies no CSS Module, so this is a guard on the declaration, not a proof of
  the rendering; the rendering is checked by hand under Definition of done:

```tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('keeps the phone floor in one place, on tokens rather than literals', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
  expect(css).toContain('--tap: 44px');
  expect(css).toMatch(/input,\s*\n\s*select,\s*\n\s*textarea\s*\{[^}]*font-size: 16px/);
});

it('sizes the drawer with the tap token, not a literal 44', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/components/ui/drawer.module.css'), 'utf8');
  expect(css).not.toMatch(/min-(block|inline)-size:\s*44px/);
});
```

- [ ] 8. Run `npx vitest run src/components/ui/drawer.test.tsx` and confirm
  both guards pass.

- [ ] 9. Commit: `feat(ui): the drawer becomes a sheet, and a phone target is a thumb wide`.

---

### Task 4: Recording a payment on a phone

D11 names four things that must work on a phone: the home, the roster, a
person, and recording a payment. The first three are the shell plus Task 2's
reflow, and they need no bespoke layout. Recording a payment does, because it
is a form a lead fills standing at a gate with one hand, and because the same
drawer on a laptop is a side panel.

**Ruling (binding):** these get a designed phone layout — `/` (D1),
`/members` (D3), `/members/[id]` (D4), and the payment drawer on `/fees` (D5),
which becomes a full-screen sheet. Everything else must only stay *readable*,
which this plan defines and Task 10 nets: no horizontal page scroll at 360px,
every table reflowed to cards, every drawer a sheet, every target on `--tap`,
nothing clipped. That covers `/fees`'s list, `/inbox`, `/money`,
`/money/ledger`, `/money/debts`, `/tasks`, `/imports`, `/imports/[id]` and
`/signin`.

**Ruling (binding):** staffing a task is the fourth thing a lead does standing
up, and D9's assign popover gets it through Task 3 rather than a layout of its
own: the popover is a `Drawer`, so on a phone it is already a sheet, at full
width, with `--tap` targets. `/tasks` keeps a readable list and gains a usable
interaction. That is the whole of what the brief asks for and none of a second
screen.

**Files:**
- Read first: `src/app/(admin)/fees/pay-drawer.tsx` as plan 06 shipped it
- Modify: `src/app/(admin)/fees/pay-drawer.tsx`, `fees.module.css`,
  `pay-drawer.test.tsx`

**Interfaces:**

Consumes — plan 06's payment drawer and `recordPaymentAction`; `Drawer` with
`phone="full"` from Task 3.

Produces — no new export. The drawer gains the amount shortcuts from the
`mobile-pay` artboard: מלא, חצי, סכום אחר.

**Steps:**

- [ ] 1. Read `src/app/(admin)/fees/pay-drawer.tsx` and record the props and
  the field names plan 06 gave it.

- [ ] 2. Add the failing tests to
  `src/app/(admin)/fees/pay-drawer.test.tsx`:

```tsx
it('opens full-screen on a phone, because a form is not a side panel', () => {
  const { container } = render(<PayDrawer row={row} seasonId="s1" accounts={accounts} />);
  expect(container.querySelector('[role="dialog"]')?.getAttribute('data-phone')).toBe('full');
});

it('offers the whole outstanding amount as one tap', () => {
  render(<PayDrawer row={row} seasonId="s1" accounts={accounts} />);
  fireEvent.click(screen.getByRole('button', { name: 'מלא 1,200' }));
  expect((screen.getByLabelText('סכום') as HTMLInputElement).value).toBe('1200');
});

it('offers half, because a lead collecting in a run takes what is offered', () => {
  render(<PayDrawer row={row} seasonId="s1" accounts={accounts} />);
  fireEvent.click(screen.getByRole('button', { name: 'חצי 600' }));
  expect((screen.getByLabelText('סכום') as HTMLInputElement).value).toBe('600');
});

it('says what happens to a payment recorded with no account', () => {
  render(<PayDrawer row={row} seasonId="s1" accounts={accounts} />);
  expect(screen.getByText('בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.')).toBeTruthy();
});

it('keeps the run going', () => {
  render(<PayDrawer row={row} seasonId="s1" accounts={accounts} />);
  expect(screen.getByRole('button', { name: 'שמירה ומעבר לחבר הבא' })).toBeTruthy();
});
```

- [ ] 3. Run `npx vitest run 'src/app/(admin)/fees/pay-drawer.test.tsx'` and
  confirm the five fail.

- [ ] 4. Modify `src/app/(admin)/fees/pay-drawer.tsx`: pass `phone="full"` to
  `Drawer`, add the three amount chips above the amount field computed from
  `row.outstandingAgorot` through `formatILS`, and put the account hint under
  the account picker verbatim as above.

- [ ] 5. Run `npx vitest run 'src/app/(admin)/fees/pay-drawer.test.tsx'` and
  confirm all five pass.

- [ ] 6. Add the sticky footer to `src/app/(admin)/fees/fees.module.css` under
  `@media (max-width: 767.98px)`: the primary button at `block-size: 50px` and
  `font-size: 16px`, "שמירה ומעבר לחבר הבא" beneath it at `var(--tap)`, and
  `padding-block-end: max(16px, env(safe-area-inset-bottom))`.

- [ ] 7. Run `npx vitest run 'src/app/(admin)/fees'` and `npx tsc --noEmit`.

- [ ] 8. Commit: `feat(fees): recording a payment works standing at the gate`.

---

### Task 5: Every list screen says what it means to be empty (E1)

An empty state is an invitation, and the five kinds are not interchangeable:
"nothing has ever been recorded" wants an import; "nothing for ברן 26" wants
the season switcher; "nothing matching this filter" wants the filter cleared;
"nothing you may see" is B9's access message and must never be a 404; and "all
clear" is the only one that celebrates.

**Ruling (binding):** the season's name is carried in the props type, not in a
sentence a caller assembles. `EmptyStateProps` is a union in which the
`this-season` member requires `seasonName`, so E1's "with the season named" is
enforced by `tsc` rather than by review.

**Ruling (binding, and the one documented deviation from E5):** today's
`/members` and `/tasks` say `אם חיפשתם שנה אחרת, בחרו אותה למעלה.` R5 moved
the season picker into the sidebar, so "למעלה" now points at nothing. The
sentence becomes `אם חיפשתם שנה אחרת, בחרו אותה בבורר השנה.` — location-free,
and true at every width. Everything else is reused verbatim. Task 9 records
this as the single deviation.

**Files:**
- Modify: `src/components/ui/empty-state.tsx`, `empty-state.test.tsx`
- Modify: the list screens' `page.tsx`, swapping their bare empty paragraph
  for `<EmptyState>` — `(admin)/page.tsx`, `inbox/page.tsx`,
  `members/page.tsx`, `fees/page.tsx`, `tasks/page.tsx`, `money/page.tsx`,
  `money/ledger/page.tsx`, `money/debts/page.tsx`, `imports/page.tsx`
- Create: `src/app/(admin)/empty-states.test.tsx`

**Interfaces:**

Produces:

```ts
// src/components/ui/empty-state.tsx
export type EmptyAction =
  | { label: string; href: string }
  | { label: string; onSelect: () => void };

export type EmptyStateProps =
  | {
      kind: 'nothing-yet' | 'no-match' | 'not-permitted' | 'all-clear';
      title: string;
      body?: React.ReactNode;
      action?: EmptyAction;
    }
  | {
      kind: 'this-season';
      /** E1: an empty season state names the season it is empty for. */
      seasonName: string;
      title: string;
      body?: React.ReactNode;
      action?: EmptyAction;
    };

export function EmptyState(props: EmptyStateProps): React.ReactElement;
```

**Steps:**

- [ ] 1. Add the failing tests to `src/components/ui/empty-state.test.tsx`:

```tsx
it('names the season it is empty for', () => {
  render(<EmptyState kind="this-season" seasonName="ברן 26" title="אין עדיין חברים רשומים" />);
  expect(screen.getByText(/ברן 26/)).toBeTruthy();
});

it('celebrates only the all-clear', () => {
  const clear = render(<EmptyState kind="all-clear" title="כל המשימות מאוישות." />);
  expect(clear.container.querySelector('[data-kind="all-clear"]')).toBeTruthy();
  cleanup();
  const none = render(<EmptyState kind="nothing-yet" title="עדיין אין אנשים." />);
  expect(none.container.querySelector('[data-kind="all-clear"]')).toBeNull();
});

it('offers at most one way out, and it is a real control', () => {
  render(
    <EmptyState kind="no-match" title="אין תוצאות לסינון הזה." action={{ label: 'ניקוי הסינון', href: '/members' }} />,
  );
  expect(screen.getByRole('link', { name: 'ניקוי הסינון' }).getAttribute('href')).toBe('/members');
});

it('is a status, not a heading nobody announced', () => {
  const { container } = render(<EmptyState kind="not-permitted" title="אין לכם הרשאה לראות את הרשימה הזו." />);
  expect(container.querySelector('[role="status"]')).toBeTruthy();
});
```

- [ ] 2. Run `npx vitest run src/components/ui/empty-state.test.tsx` and
  confirm the new assertions fail.

- [ ] 3. Modify `src/components/ui/empty-state.tsx` to the union type above,
  to render `role="status"` with `data-kind={props.kind}`, and to fold
  `seasonName` into the title as `{title} ל{seasonName}.`

- [ ] 4. Run `npx vitest run src/components/ui/empty-state.test.tsx` and
  confirm all pass.

- [ ] 5. Write the failing sweep `src/app/(admin)/empty-states.test.tsx`, one
  case per list screen, each mocking its query functions to return nothing —
  following `src/app/(admin)/money/page.test.tsx`'s `vi.hoisted` + `vi.mock`
  pattern and `render(await Page({ searchParams: Promise.resolve({}) }))`:

```tsx
it('a roster with no rows for this season names the season and points at the switcher', async () => {
  listSeasons.mockResolvedValue([SEASON]);
  listRoster.mockResolvedValue([]);
  render(await MembersPage({ searchParams: Promise.resolve({ season: 's1' }) }));
  expect(screen.getByRole('status').textContent).toContain('ברן 26');
  expect(screen.getByText('אם חיפשתם שנה אחרת, בחרו אותה בבורר השנה.')).toBeTruthy();
});

it('a camp with no seasons at all invites an import', async () => {
  listSeasons.mockResolvedValue([]);
  render(await MembersPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('link', { name: 'קבצים וייבוא' }).getAttribute('href')).toBe('/imports');
});

it('a filter that matches nothing offers to clear itself', async () => {
  listSeasons.mockResolvedValue([SEASON]);
  listRoster.mockResolvedValue([]);
  render(await MembersPage({ searchParams: Promise.resolve({ season: 's1', q: 'זזזז' }) }));
  expect(screen.getByRole('link', { name: 'ניקוי הסינון' })).toBeTruthy();
});

it('a fully staffed season celebrates, and says so in the words /tasks already used', async () => {
  listSeasons.mockResolvedValue([SEASON]);
  coverageFor.mockResolvedValue([]);
  render(await TasksPage({ searchParams: Promise.resolve({ season: 's1' }) }));
  expect(screen.getByText('כל המשימות מאוישות.')).toBeTruthy();
});

it('a viewer who may not see the list gets a message, not a 404 (B9)', async () => {
  requireAdmin.mockResolvedValue({ ok: false });
  render(await MembersPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText('אין לכם הרשאה לראות את הרשימה הזו.')).toBeTruthy();
});
```

- [ ] 6. Run `npx vitest run 'src/app/(admin)/empty-states.test.tsx'` and
  confirm every case fails.

- [ ] 7. Modify each list screen's `page.tsx` to render `<EmptyState>` with the
  right kind, replacing the bare paragraph. Change nothing else on those pages.

- [ ] 8. Run `npx vitest run 'src/app/(admin)'` and confirm the sweep and every
  screen plan's own tests are green.

- [ ] 9. Commit: `feat(ui): every empty list says which kind of empty it is`.

---

### Task 6: Every write says what it did, and takes it back where the domain can (E2)

**The toast contract** — plan 03 may already have shipped a `Toaster`. If it
did, extend it to this contract; if it did not, this is where it is born.

**Ruling (binding):** two live regions, both always mounted. A region inserted
into the DOM at the same moment as its message is announced unreliably, so the
provider renders an empty `<ol role="status" aria-live="polite">` for results
and an empty `<ol role="alert">` for failures from first paint, and a toast is
inserted into the matching one. A success dismisses after 6 seconds, a toast
carrying undo after 10 — a lead has to read it and reach it — and neither
dismisses while focus is inside it.

**Ruling (binding):** undo is the domain's own inverse, never a UI stack, and
**a confirmed destructive action gets no undo.** R8's confirmation already did
that job, and an undo that re-creates a deleted payment would mint a new id
and a new `source_row`, which is a lie about provenance under R11. So:

| Action | Undo | Why |
|---|---|---|
| `recordPaymentAction` | `deletePaymentAction(id)` | `recordPayment` already returns the new id; deleting it restores the exact prior state |
| `assignPersonAction` | `removeAssignmentAction(id)` | `removeAssignment` is the inverse and takes the assignment id |
| `setExceptionAction` | `clearExceptionAction` — **only when the row had no exception before** | `clearException` restores the flat rate; it cannot restore a *previous* exception's amount and reason, so the undo is offered only when there was nothing to restore |
| `linkNameAction` | `unlinkAliasAction(aliasId)` | `unlinkAlias` exists in `src/lib/members/link.ts`; R8 requires the action wrapper |
| `deletePaymentAction`, `removeAssignmentAction`, `setTaskStatusAction('cancelled')`, `mergePeopleAction`, promotion | none | confirmed under R8; `/members` already tells the reader `מיזוג של שני אנשים אינו הפיך` |

**Files:**
- Read first: `src/components/ui/` for an existing toaster
- Create or modify: `src/components/ui/toaster.tsx`, `toaster.module.css`,
  `toaster.test.tsx`
- Modify: `src/lib/action-result.ts`
- Modify: `src/app/(admin)/layout.tsx`, `fees/actions.ts`,
  `fees/pay-drawer.tsx`, `fees/member-fee-row.tsx`, `tasks/assign-control.tsx`,
  `members/unlinked-queue.tsx`

**Interfaces:**

Consumes:

```ts
// src/lib/action-result.ts — widened, additively
/** What every server action in the admin sections returns. `T` is what the
 *  caller needs back in order to undo the write. An action with no undo
 *  leaves it at `never` and returns a bare `{ ok: true }`, which is why
 *  `value` is optional: every existing call site still compiles. */
export type ActionResult<T = never> =
  | { ok: true; value?: T }
  | { ok: false; error: string };
```

Produces:

```ts
// src/components/ui/toaster.tsx
export interface Toast {
  /** Hebrew, past tense, naming what happened: 'נרשם תשלום של 1,200 ₪ לאיתי כהן'. */
  message: string;
  tone?: 'ok' | 'bad';
  undo?: { label: string; run: () => Promise<ActionResult> };
}

export function ToastProvider(props: { children: React.ReactNode }): React.ReactElement;
export function useToast(): { show: (toast: Toast) => void };
```

**Steps:**

- [ ] 1. Read `src/components/ui/` and record whether plan 03 shipped a
  toaster. If it did, note its exports; the steps below extend them rather
  than replace them.

- [ ] 2. Widen `src/lib/action-result.ts` to the generic above, then run
  `npx tsc --noEmit` and confirm it is clean — the optional `value` is what
  keeps every existing `return { ok: true }` compiling, and this step proves
  it before anything depends on it.

- [ ] 3. Write the failing test file `src/components/ui/toaster.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './toaster';

function Harness({ toast }: { toast: Parameters<ReturnType<typeof useToast>['show']>[0] }) {
  const { show } = useToast();
  return <button type="button" onClick={() => show(toast)}>שלח</button>;
}

function mount(toast: Parameters<ReturnType<typeof useToast>['show']>[0]) {
  render(<ToastProvider><Harness toast={toast} /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'שלח' }));
}

describe('the toaster', () => {
  it('keeps both live regions mounted from the start, so the first toast is announced', () => {
    const { container } = render(<ToastProvider><span /></ToastProvider>);
    expect(container.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('names what happened, in Hebrew and in the past tense', () => {
    mount({ message: 'נרשם תשלום של 1,200 ₪ לאיתי כהן' });
    expect(screen.getByText('נרשם תשלום של 1,200 ₪ לאיתי כהן')).toBeTruthy();
  });

  it('puts a failure in the assertive region, not the polite one', () => {
    const { container } = render(<ToastProvider><Harness toast={{ message: 'לא הצלחנו לשמור', tone: 'bad' }} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'שלח' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('לא הצלחנו לשמור');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('runs the domain inverse when undo is taken', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    mount({ message: 'נרשם תשלום', undo: { label: 'ביטול', run } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ביטול' })); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives a toast carrying undo longer to be read', () => {
    vi.useFakeTimers();
    mount({ message: 'נרשם תשלום', undo: { label: 'ביטול', run: async () => ({ ok: true }) } });
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(screen.queryByText('נרשם תשלום')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(screen.queryByText('נרשם תשלום')).toBeNull();
    vi.useRealTimers();
  });

  it('does not dismiss under a reader who is still in it', () => {
    vi.useFakeTimers();
    mount({ message: 'נרשם תשלום', undo: { label: 'ביטול', run: async () => ({ ok: true }) } });
    screen.getByRole('button', { name: 'ביטול' }).focus();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.queryByText('נרשם תשלום')).toBeTruthy();
    vi.useRealTimers();
  });
});
```

- [ ] 4. Run `npx vitest run src/components/ui/toaster.test.tsx` and confirm it
  fails on the missing module or, if plan 03 shipped one, on the two-region
  and focus-hold assertions.

- [ ] 5. Write `src/components/ui/toaster.tsx` to the contract: a context
  holding a list, both `<ol>`s rendered unconditionally, a `setTimeout` per
  toast cleared while `document.activeElement` is inside it, and the comment
  above the component saying it is a client component because a toast is a
  reaction to something the reader just did.

- [ ] 6. Run `npx vitest run src/components/ui/toaster.test.tsx` and confirm
  all six pass.

- [ ] 7. Mount `<ToastProvider>` in `src/app/(admin)/layout.tsx`, wrapping the
  main panel so every screen is inside it.

- [ ] 8. Modify `src/app/(admin)/fees/actions.ts` so `recordPaymentAction`
  returns `Promise<ActionResult<string>>` and, on success,
  `{ ok: true, value: paymentId }` from `recordPayment`'s own return.

- [ ] 9. Add the failing undo test to
  `src/app/(admin)/fees/member-fee-row.test.tsx`:

```tsx
it('offers to take a payment back, by deleting the row it just wrote', async () => {
  recordPaymentAction.mockResolvedValue({ ok: true, value: 'pay-9' });
  render(<ToastProvider><MemberFeeRow row={row} seasonId="s1" /></ToastProvider>);
  fireEvent.change(screen.getByLabelText('סכום התשלום'), { target: { value: '1200' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'רשום תשלום' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ביטול' })); });
  expect(deletePaymentAction).toHaveBeenCalledWith('pay-9');
});
```

- [ ] 10. Run `npx vitest run 'src/app/(admin)/fees/member-fee-row.test.tsx'`
  and confirm it fails because no toast is shown.

- [ ] 11. Modify `src/app/(admin)/fees/member-fee-row.tsx` and
  `fees/pay-drawer.tsx` to call `show()` on every successful write, with the
  undo for `recordPaymentAction` and for `setExceptionAction` when
  `row.kind !== 'exception'`.

- [ ] 12. Run `npx vitest run 'src/app/(admin)/fees'` and confirm green.

- [ ] 13. Verify `unlinkAliasAction` exists in
  `src/app/(admin)/members/actions.ts` — R8 requires it and plan 05 owes it.
  If it is missing, stop and report NEEDS_CONTEXT rather than adding a second
  wrapper around `unlinkAlias`.

- [ ] 14. Add the same toast-and-undo wiring to
  `src/app/(admin)/tasks/assign-control.tsx` (undo: `removeAssignmentAction`)
  and `src/app/(admin)/members/unlinked-queue.tsx` (undo:
  `unlinkAliasAction`), each with its own failing test first, run, then pass.

- [ ] 15. Run `npx vitest run 'src/app/(admin)'` and `npx tsc --noEmit`.

- [ ] 16. Commit: `feat(ui): every write reports itself, and takes itself back where it can`.

---

### Task 7: Loading looks like what is coming (E3)

**Ruling (binding):** what a skeleton must not do. No spinner over a whole
page, and no centred spinner at all — a spinner says "something is happening"
where a skeleton says "four tiles and eleven rows are happening", and the
second is the one that stops a lead re-clicking. Nothing that does not depend
on data is skeletonised: the sidebar, the top bar, the breadcrumbs and the
page title come from the layout and render at once, so the skeleton fills only
the panel's body. The skeleton's counts match the real content's, so nothing
jumps when the data lands. The shapes are `aria-hidden`; one visually hidden
`טוען…` inside a `role="status"` is the whole announcement, because eleven
announced grey rectangles are worse than silence. Under
`prefers-reduced-motion: reduce` the shimmer stops and a static block remains.

**Files:**
- Create: `src/components/ui/skeleton.tsx`, `skeleton.module.css`,
  `skeleton.test.tsx`
- Create: `loading.tsx` in each segment listed in File Structure
- Create: the `loading.tsx` coverage case inside
  `src/app/(admin)/route-modules.test.ts` (Task 10 owns the file; this task
  adds the first case and creates the file if Task 10 has not run yet)

**Interfaces:**

Produces:

```ts
// src/components/ui/skeleton.tsx
export function SkeletonPage(props: {
  /** Announced once, visually hidden: 'טוען את דמי הקאמפ…' */
  label: string;
  children: React.ReactNode;
}): React.ReactElement;

export function SkeletonTiles(props: { count: number }): React.ReactElement;
export function SkeletonTable(props: { rows: number; columns: number }): React.ReactElement;
export function SkeletonText(props: { lines: number }): React.ReactElement;
```

**Steps:**

- [ ] 1. Write the failing test file `src/components/ui/skeleton.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonPage, SkeletonTiles, SkeletonTable } from './skeleton';

describe('skeletons', () => {
  it('announces once, in Hebrew, and not once per shape', () => {
    render(<SkeletonPage label="טוען את דמי הקאמפ…"><SkeletonTable rows={11} columns={6} /></SkeletonPage>);
    expect(screen.getByRole('status').textContent).toBe('טוען את דמי הקאמפ…');
  });

  it('hides every shape from the accessibility tree', () => {
    const { container } = render(<SkeletonPage label="טוען…"><SkeletonTiles count={4} /></SkeletonPage>);
    const shapes = container.querySelectorAll('[data-skeleton]');
    expect(shapes.length).toBe(4);
    shapes.forEach((shape) => expect(shape.getAttribute('aria-hidden')).toBe('true'));
  });

  it('draws as many rows as are coming, so nothing jumps', () => {
    const { container } = render(<SkeletonTable rows={11} columns={6} />);
    expect(container.querySelectorAll('[data-skeleton="row"]').length).toBe(11);
  });

  it('has no spinner in it anywhere', () => {
    const { container } = render(<SkeletonPage label="טוען…"><SkeletonTiles count={4} /></SkeletonPage>);
    expect(container.querySelector('[class*="spinner"]')).toBeNull();
  });
});
```

- [ ] 2. Run `npx vitest run src/components/ui/skeleton.test.tsx` and confirm
  it fails with `Failed to resolve import "./skeleton"`.

- [ ] 3. Write `src/components/ui/skeleton.tsx` and `skeleton.module.css`,
  with the reduced-motion rule:

```css
.shape {
  border-radius: 8px;
  background: linear-gradient(90deg, var(--sunken) 0%, var(--hover) 50%, var(--sunken) 100%);
  background-size: 200% 100%;
  animation: sweep 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .shape { animation: none; background: var(--sunken); }
}
@keyframes sweep {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}
```

- [ ] 4. Run `npx vitest run src/components/ui/skeleton.test.tsx` and confirm
  all four pass.

- [ ] 5. Write the failing coverage net in
  `src/app/(admin)/route-modules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ADMIN = resolve(process.cwd(), 'src/app/(admin)');

function segmentsWithPages(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) segmentsWithPages(path, found);
    else if (entry.name === 'page.tsx') found.push(dir);
  }
  return found;
}

describe('E3: loading looks like what is coming', () => {
  it('gives every screen a skeleton of its own shape', () => {
    const missing = segmentsWithPages(ADMIN).filter((dir) => !existsSync(join(dir, 'loading.tsx')));
    expect(missing).toEqual([]);
  });
});
```

- [ ] 6. Run `npx vitest run 'src/app/(admin)/route-modules.test.ts'` and
  record the list of segments it names — that list is exactly the work of the
  next step.

- [ ] 7. Write one `loading.tsx` per segment the net named, each composing the
  primitives to the shape of that screen: `/` is four tiles plus three card
  lists, `/members` is a filter bar plus eleven table rows of six columns,
  `/fees` is four tiles plus a table, `/members/[id]` is a header plus five
  tiles plus a tab strip.

- [ ] 8. Run `npx vitest run 'src/app/(admin)/route-modules.test.ts'` and
  confirm `missing` is empty.

- [ ] 9. Run `npx tsc --noEmit`.

- [ ] 10. Commit: `feat(ui): a loading screen has the shape of the screen that is coming`.

---

### Task 8: The keyboard reaches everything, and everything has a name (E4)

Written as behaviour, not as a linter. Four things are asserted: that the
first Tab on every screen reaches the content instead of walking fifteen nav
links; that no control is anonymous; that no table is anonymous; and that the
drawer keeps focus and hands it back.

**Ruling (binding):** an accessible name is checked with
`queryAllByRole(role, { name: '' })`, which is empty when every element of
that role has a name. The name computation is the one already inside
`@testing-library/dom`, so nothing is installed and nothing is hand-rolled.

**Ruling (binding):** no positive `tabIndex` anywhere. Tab order follows the
DOM, the DOM follows the visual order, and a positive `tabIndex` is the only
way to break that silently — so it is netted statically rather than asserted
per screen.

**Files:**
- Create: `src/test/a11y.ts`, `src/app/(admin)/a11y-sweep.test.tsx`
- Modify: `src/app/(admin)/layout.tsx` — the skip link and `<main id="main">`

**Interfaces:**

Produces:

```ts
// src/test/a11y.ts
/** Every element that can take focus, in document order. */
export function focusableIn(container: HTMLElement): HTMLElement[];

/** Buttons, links, checkboxes and tabs inside `container` whose computed
 *  accessible name is empty. E4's icon-only-buttons rule is "this is []". */
export function unnamedControls(container: HTMLElement): HTMLElement[];
```

**Steps:**

- [ ] 1. Write the failing test file `src/app/(admin)/a11y-sweep.test.tsx`,
  starting with the skip link, which is what makes a keyboard path through the
  sidebar bearable:

```tsx
it('puts a way past the sidebar first, so Tab reaches the content in one press', async () => {
  const { container } = render(await AdminLayout({ children: <main id="main">תוכן</main> }));
  const first = focusableIn(container)[0];
  expect(first.getAttribute('href')).toBe('#main');
  expect(first.textContent).toBe('דילוג לתוכן');
});

it('gives the skip link somewhere to land', async () => {
  const { container } = render(await AdminLayout({ children: <main id="main">תוכן</main> }));
  const main = container.querySelector('#main');
  expect(main?.getAttribute('tabindex')).toBe('-1');
});
```

- [ ] 2. Run `npx vitest run 'src/app/(admin)/a11y-sweep.test.tsx'` and confirm
  it fails with `Failed to resolve import "@/test/a11y"`.

- [ ] 3. Write `src/test/a11y.ts`:

```ts
import { within } from '@testing-library/react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** `name: ''` is an exact match against the computed accessible name, so this
 *  returns exactly the controls that have none. The computation is the one
 *  `@testing-library/dom` already ships — R1 forbids adding another. */
export function unnamedControls(container: HTMLElement): HTMLElement[] {
  const scope = within(container);
  return [
    ...scope.queryAllByRole('button', { name: '' }),
    ...scope.queryAllByRole('link', { name: '' }),
    ...scope.queryAllByRole('checkbox', { name: '' }),
    ...scope.queryAllByRole('tab', { name: '' }),
  ];
}
```

- [ ] 4. Add the skip link and `<main id="main" tabIndex={-1}>` to
  `src/app/(admin)/layout.tsx`, with a CSS Module rule that keeps it clipped
  until `:focus-visible`.

- [ ] 5. Run `npx vitest run 'src/app/(admin)/a11y-sweep.test.tsx'` and confirm
  both pass.

- [ ] 6. Add the per-screen sweep to `a11y-sweep.test.tsx`, one case per
  redesigned screen, each mocking its queries as `money/page.test.tsx` does:

```tsx
it.each([
  ['בית', () => OverviewPage({ searchParams: Promise.resolve({}) })],
  ['לטיפול', () => InboxPage({ searchParams: Promise.resolve({}) })],
  ['אנשים', () => MembersPage({ searchParams: Promise.resolve({}) })],
  ['דמי קאמפ', () => FeesPage({ searchParams: Promise.resolve({}) })],
  ['משימות', () => TasksPage({ searchParams: Promise.resolve({}) })],
  ['כספים', () => MoneyPage({ searchParams: Promise.resolve({}) })],
  ['תנועות', () => LedgerPage({ searchParams: Promise.resolve({}) })],
  ['חובות', () => DebtsPage({ searchParams: Promise.resolve({}) })],
  ['קבצים וייבוא', () => ImportsPage({ searchParams: Promise.resolve({}) })],
])('%s has no anonymous control', async (_name, page) => {
  const { container } = render(await page());
  expect(unnamedControls(container).map((el) => el.outerHTML)).toEqual([]);
});

it.each([...])('%s names every table it draws', async (_name, page) => {
  const { container } = render(await page());
  expect(within(container).queryAllByRole('table', { name: '' })).toEqual([]);
});
```

- [ ] 7. Run `npx vitest run 'src/app/(admin)/a11y-sweep.test.tsx'` and record
  which screens fail and on which elements. Fix each by adding the
  `aria-label` or the `caption` that is missing — one commit-sized pass, no
  other change to those screens.

- [ ] 8. Add the positive-tabindex net to the same file:

```tsx
it('leaves tab order to the DOM', () => {
  const offenders: string[] = [];
  for (const file of tsxFilesUnder(resolve(process.cwd(), 'src'))) {
    const source = readFileSync(file, 'utf8');
    if (/tabIndex=\{[1-9]/.test(source)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
```

- [ ] 9. Add the drawer's trap and restore as a behaviour case, against the
  real `Drawer` and the real trigger — the same four assertions Task 1 made of
  `NavSheet`, now against the record drawer that R6 drives by URL: focus moves
  in, Tab wraps at the end, Shift+Tab wraps at the start, `esc` closes and
  returns focus to the row's peek button.

- [ ] 10. Run `npx vitest run 'src/app/(admin)/a11y-sweep.test.tsx'` and
  confirm the whole file is green.

- [ ] 11. Add the focus-visibility net: read every `*.module.css` under `src`
  plus `globals.css`, assert none contains `outline: none` or `outline: 0`,
  and assert `globals.css` contains
  `outline: 2px solid var(--focus)` under `:focus-visible` (A9).

- [ ] 12. Run `npx vitest run 'src/app/(admin)/a11y-sweep.test.tsx'` and
  `npx tsc --noEmit`.

- [ ] 13. Commit: `feat(a11y): the keyboard reaches everything, and everything has a name`.

---

### Task 9: No English reaches a Hebrew screen (E5, R9)

**The audit, as it stands today.** Four places let an English `Error.message`
through to the UI:

- `src/app/(admin)/fees/actions.ts:14` — `failed(error)`
- `src/app/(admin)/tasks/actions.ts:14` — `failed(error)`
- `src/app/(admin)/members/actions.ts:30` — inline, in `promoteNameAction`
- `src/lib/import/run-import.ts:58` — stores `error.message` on the import row,
  which `/imports` then renders

`src/lib` throws in English by design — `'an exception must carry a reason'`,
`'that person is not on this season roster'`, `'a shift may not end before it
starts'`, `` `unknown season ${seasonId}` `` — so every one of those sentences
can already reach a Hebrew screen today. R9 says the mapping happens at the
action boundary, which is also the only place it can happen without editing
files three other plans and four other sessions have been touching.

**Ruling (binding):** `hebrewError` maps by exact message for fixed strings
and by prefix for templated ones. An unmapped message renders the fallback and
is logged with `console.error`, never echoed. The fallback is
`לא הצלחנו לשמור את השינוי. נסו שוב, ואם זה חוזר — שלחו צילום מסך.`

**Ruling (binding):** the one deviation from E5's verbatim rule is Task 5's
`בחרו אותה בבורר השנה`, replacing `בחרו אותה למעלה` because R5 moved the
control the old sentence pointed at. It is recorded here and nowhere else.

**Files:**
- Create: `src/lib/errors/hebrew.ts`, `hebrew.test.ts`
- Modify: `src/app/(admin)/fees/actions.ts`, `tasks/actions.ts`,
  `members/actions.ts`, `src/lib/import/run-import.ts`
- Create: `src/app/(admin)/copy-sweep.test.tsx`

**Interfaces:**

Produces:

```ts
// src/lib/errors/hebrew.ts
/** Maps a thrown error to the Hebrew a lead reads. An unmapped message is
 *  logged and replaced — never echoed (R9). */
export function hebrewError(error: unknown): string;

export const GENERIC_FAILURE: string;
```

**Steps:**

- [ ] 1. Run `grep -rn "throw new Error(" src/lib | grep -v '\.test\.'` and
  copy the messages into a list. That list is the map's key set.

- [ ] 2. Write the failing test file `src/lib/errors/hebrew.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { hebrewError, GENERIC_FAILURE } from './hebrew';

/** Every English sentence src/lib can throw into a server action today. */
const LIB_MESSAGES = [
  'that person is not on this season roster',
  'an exception must carry a reason',
  'an exception must record who decided it',
  'an exception amount may not be negative',
  'no due for that person in that season — issue the flat dues first',
  'no due for that person in that season — nothing to clear',
  'a payment amount must be positive',
  'an offset must carry a note saying what it was set against',
  'an offset needs at least one due',
  'that person was merged into another — assign the survivor',
  'a task needs a title',
  'a shift needs a time window',
  'a shift may not end before it starts',
  'an event task must name its event',
  'a task needs at least one person',
  'unknown season 8c0a…',
  'unknown due 8c0a…',
  'unknown payment channel: wire',
  'unknown alias 8c0a…',
  'unknown person 8c0a…',
  'unknown block 8c0a…',
];

describe('hebrewError', () => {
  it.each(LIB_MESSAGES)('turns %s into Hebrew with no Latin left in it', (message) => {
    expect(hebrewError(new Error(message))).not.toMatch(/[A-Za-z]/);
  });

  it('never echoes a message nobody mapped', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = hebrewError(new Error('ECONNREFUSED 127.0.0.1:5432'));
    expect(result).toBe(GENERIC_FAILURE);
    expect(result).not.toContain('ECONNREFUSED');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('handles something that is not an Error at all', () => {
    expect(hebrewError('boom')).toBe(GENERIC_FAILURE);
    expect(hebrewError(undefined)).toBe(GENERIC_FAILURE);
  });
});
```

- [ ] 3. Run `npx vitest run src/lib/errors/hebrew.test.ts` and confirm it
  fails with `Failed to resolve import './hebrew'`.

- [ ] 4. Write `src/lib/errors/hebrew.ts`: a `Map` of exact messages, an array
  of `[prefix, hebrew]` pairs for the templated ones (`unknown season `,
  `unknown due `, `unknown payment channel: `, `unknown alias `,
  `unknown person `, `unknown block `), the fallback, and the `console.error`
  on a miss.

- [ ] 5. Run `npx vitest run src/lib/errors/hebrew.test.ts` and confirm all
  pass.

- [ ] 6. Replace the four pass-throughs: `failed(error)` in `fees/actions.ts`
  and `tasks/actions.ts` becomes `{ ok: false, error: hebrewError(error) }`;
  the inline one in `members/actions.ts` likewise; `run-import.ts` stores
  `hebrewError(error)` on the import row.

- [ ] 7. Write the failing static net in `src/app/(admin)/copy-sweep.test.tsx`:

```tsx
it('leaves no server action echoing an English error', () => {
  const offenders = actionFiles().filter((file) => {
    const source = readFileSync(file, 'utf8');
    return /error instanceof Error \? error\.message/.test(source) || /String\(error\)/.test(source);
  });
  expect(offenders).toEqual([]);
});
```

- [ ] 8. Run `npx vitest run 'src/app/(admin)/copy-sweep.test.tsx'` and confirm
  it passes now that step 6 has landed — then revert one `hebrewError(` back
  to `error.message`, re-run, confirm the net names that file, and restore it.
  A net that has never failed is not a net.

- [ ] 9. Add the rendered-text net to the same file, with the allow-list
  written out and reasoned:

```tsx
/** Latin that is allowed on a Hebrew screen, each with its reason.
 *  MOOP  — the Burning Man term the camp uses; /tasks already says it.
 *  CSV   — the file format on /members' export control.
 *  A1    — a spreadsheet cell reference under R11, rendered in mono. */
const ALLOWED = [/^MOOP$/, /^CSV$/, /^[A-Z]{1,3}\d+$/];

it.each(SCREENS)('%s is written in Hebrew', async (_name, page) => {
  const { container } = render(await page());
  const latin = (container.textContent ?? '')
    .split(/[\s,.:;·—()[\]!]+/)
    .filter((word) => /[A-Za-z]/.test(word))
    .filter((word) => !ALLOWED.some((allowed) => allowed.test(word)));
  expect(latin).toEqual([]);
});
```

- [ ] 10. Run `npx vitest run 'src/app/(admin)/copy-sweep.test.tsx'`, record
  every Latin word it finds, and fix each at its source. A word that belongs
  on the screen joins `ALLOWED` with a reason on its own line; a word that does
  not gets translated.

- [ ] 11. Add the verbatim-reuse net to the same file, asserting that the
  redesigned screens still carry the sentences the old ones earned:

```tsx
it.each([
  ['משימות', () => TasksPage({ searchParams: Promise.resolve({ season: 's1' }) }),
    'מה שלא יאויש עד פתיחת השער — כאן, לפני שמישהו מגלה את זה בשטח'],
  ['משימות', () => TasksPage({ searchParams: Promise.resolve({ season: 's1' }) }), 'כל המשימות מאוישות.'],
  ['אנשים', () => MembersPage({ searchParams: Promise.resolve({}) }),
    'מיזוג של שני אנשים אינו הפיך, ולכן ההחלטה כאן שלכם.'],
  ['דמי קאמפ', () => FeesPage({ searchParams: Promise.resolve({ season: 's1' }) }), 'צפי גבייה'],
  ['דמי קאמפ', () => FeesPage({ searchParams: Promise.resolve({ season: 's1' }) }), 'נגבה'],
  ['דמי קאמפ', () => FeesPage({ searchParams: Promise.resolve({ season: 's1' }) }), 'נותר'],
  ['כספים', () => MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }), 'חסר שם'],
])('%s keeps the words it already had', async (_name, page, sentence) => {
  render(await page());
  expect(screen.getByText(sentence)).toBeTruthy();
});
```

- [ ] 12. Run `npx vitest run 'src/app/(admin)/copy-sweep.test.tsx'` and
  confirm the whole file is green.

- [ ] 13. Run `npx vitest run src/lib/errors src/app` and `npx tsc --noEmit`.

- [ ] 14. Commit: `fix(copy): a Hebrew screen says nothing in English`.

---

### Task 10: No page reads a workbook off the disk while someone waits (E6)

`src/app/(admin)/data/page.tsx` opens every workbook in a directory with
`readFileSync` and parses it, on every request. D2 replaces that page with
`/inbox`, reading the register from the database. This task is the
confirmation that it is gone and the net that keeps it gone.

**Ruling (binding):** the net covers route modules and the components beside
them — every `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`,
`not-found.tsx`, `template.tsx`, `route.ts`, and every non-test `.ts`/`.tsx`
colocated with one — and asserts no import of `node:fs`, `node:fs/promises` or
`fs`, and no `process.cwd()` or `__dirname`. `src/lib/storage/index.ts` is out
of scope and stays as it is: it is the local blob driver behind an upload
action, reading a file the reader themselves just sent, not a page rendering.

**Ruling (binding):** if `src/app/(admin)/data/` still exists when this task
runs, stop and report that plan 04 has not landed. Do not delete another
plan's route.

**Files:**
- Modify: `src/app/(admin)/route-modules.test.ts` (created in Task 7)

**Interfaces:** none — this task produces tests only.

**Steps:**

- [ ] 1. Run `ls 'src/app/(admin)'` and confirm `data/` is gone. If it is
  there, stop and report.

- [ ] 2. Add the failing net to `src/app/(admin)/route-modules.test.ts`:

```ts
describe('E6: nothing reads the disk while someone waits', () => {
  it('keeps the filesystem out of every route module', () => {
    const offenders: string[] = [];
    for (const file of routeModules()) {
      const source = readFileSync(file, 'utf8');
      if (/from '(node:)?fs(\/promises)?'/.test(source)) offenders.push(`${file}: imports fs`);
      if (/process\.cwd\(\)/.test(source)) offenders.push(`${file}: process.cwd()`);
      if (/__dirname/.test(source)) offenders.push(`${file}: __dirname`);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] 3. Run `npx vitest run 'src/app/(admin)/route-modules.test.ts'` and
  confirm it passes — then temporarily add `import { readFileSync } from
  'node:fs';` to `src/app/(admin)/page.tsx`, re-run, confirm the net names that
  file, and remove the import.

- [ ] 4. Add the two phone nets to the same file, which are the static half of
  Task 3's and Task 4's rulings:

```ts
it('never forbids the reader from zooming', () => {
  const offenders = allSourceFiles().filter((file) => /user-scalable=no|maximum-scale/.test(readFileSync(file, 'utf8')));
  expect(offenders).toEqual([]);
});

it('leaves no table wrapped in a sideways scroller', () => {
  const offenders = allSourceFiles().filter((file) => /scroll-x/.test(readFileSync(file, 'utf8')));
  expect(offenders).toEqual([]);
});
```

- [ ] 5. Run `npx vitest run 'src/app/(admin)/route-modules.test.ts'` and
  confirm all four cases are green.

- [ ] 6. Run the whole suite once: `npx vitest run`, then `npx tsc --noEmit`.

- [ ] 7. Commit: `test(app): nothing reads the disk, forbids zoom, or scrolls sideways`.

---

## Definition of done for the redesign

The checks a reviewer runs across the whole set, once plan 12 has landed:

- [ ] `npx tsc --noEmit` is clean.
- [ ] `npx vitest run` is green, with no skipped file.
- [ ] `npx eslint` reports nothing.
- [ ] `npx next build` completes with no `middleware` deprecation warning and
  no page falling back to a static render it cannot honour.
- [ ] **Every route renders in both themes.** Walk `/`, `/inbox`, `/members`,
  `/members/[id]`, `/fees`, `/tasks`, `/money`, `/money/ledger`,
  `/money/debts`, `/imports`, `/imports/[id]`, `/signin` with
  `data-theme="light"` and again with `data-theme="dark"`, and confirm the
  first paint is already correct in each (A13) — no flash of the other theme.
- [ ] **Every route at four widths:** 360px, 390px, 768px and 1280px. No
  horizontal page scroll at 360px; no table scrolling sideways; every drawer a
  sheet below 768px; the bottom tab bar present below 768px and absent above
  it; the sidebar folded between 768 and 1023.
- [ ] **No control smaller than 44px below 768px**, measured in the browser's
  element inspector on the bottom tab bar, the table's action column, the
  payment chips and the drawer's close button.
- [ ] **No input under 16px below 768px** — focus each field on an iPhone or in
  responsive mode with an iOS user agent and confirm the page does not zoom.
- [ ] **The keyboard path through each screen:** Tab from the address bar
  reaches the skip link first; `↵` on it lands in `<main>`; Tab from there
  walks the page in the order it reads; every stop has a visible focus ring
  (A9); `⌘K` and `/` open the palette and `esc` closes it; opening a record
  drawer moves focus into it, Tab cycles inside it, and `esc` closes it and
  returns focus to the row that opened it.
- [ ] **Every write reports itself.** Record a payment, assign a person, set an
  exception and link a name; confirm each raises a toast naming what happened,
  that undo is offered on exactly those four, and that undo actually reverses
  the row in the database.
- [ ] **Every confirmed destructive action confirms** (R8), and none of them
  offers an undo.
- [ ] **No English anywhere.** Force a failure in each of the four actions —
  an exception with no reason, an offset with no note, a shift ending before it
  starts, an alias already linked — and confirm the message on screen is
  Hebrew.
- [ ] **The old token aliases from plan 01 are removed.** `--ground`,
  `--raised`, `--sand`, `--dust`, `--dust-dim` and `--flare` were kept as
  aliases so screens could land one at a time; every screen has now landed, so
  `grep -rn -- '--ground\|--raised\|--sand\|--dust\|--flare' src` must return
  nothing but the deletion commit. Delete them from `tokens.css` and run the
  suite again.
- [ ] **`.badge-warn` and the other globals the old screens leaned on are gone**
  from `globals.css`, which now holds the reset, the type face, the focus rule
  and the phone floor and nothing else.

## Self-review

- **Does the phone half actually cover the four standing-up jobs?** Seeing
  where the camp stands is `/` through the shell and Task 2's reflow; looking
  someone up is `/members` and `/members/[id]`, the same; recording a payment
  is Task 4; staffing a task is D9's assign popover arriving as a sheet through
  Task 3. Yes — and `/tasks` gets no bespoke layout, which is stated as a
  ruling rather than left as an omission.
- **Is the card reflow honest?** It is one DOM, no JavaScript, no duplicated
  accessible names, and it reasserts the roles `display: block` drops. Its
  weakness is that jsdom applies no CSS, so what is tested is the contract
  that makes the reflow possible — `data-label`, `data-card`, the roles, the
  clipped header — and not the reflow itself. That gap is named in Task 2 and
  closed by hand under Definition of done. No test in this plan claims more
  than it proves.
- **Are the static nets doing real work or decorating?** Each one is made to
  fail on purpose before it is trusted: Task 8 step 7 records real offenders,
  Task 9 step 8 reverts a mapping, Task 10 step 3 adds an `fs` import. A net
  that has never been red is not evidence.
- **Is the undo table defensible?** It refuses undo for anything R8 already
  confirmed, and it refuses undo for an exception that replaced another
  exception, because `clearException` restores the flat rate and not the
  previous amount and reason. Both refusals are the domain's limits showing
  through, not laziness — and saying so on screen is better than an undo that
  quietly does something else.
- **What is the biggest risk?** That plans 01–11 land with different component
  names than this plan assumes. Every task that touches another plan's file
  opens with a read step and a stop-and-report instruction, so the failure mode
  is a report, not a second `Table`.
- **What is deliberately not here?** Container queries, a service worker, an
  install prompt, offline collection, and a phone layout for `/inbox` — all
  out of D11's four, and the last of them is the one to revisit first if a lead
  starts triaging from a phone.
