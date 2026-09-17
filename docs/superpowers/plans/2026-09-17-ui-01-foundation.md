# UI Redesign 01 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the light palette, the type and density scales, the fonts, the theme switch, the two formatting helpers and the icon set into the repo, so every later screen plan has somewhere to read a colour, a size, an amount, a date and a glyph from.

**Architecture:** One `src/app/tokens.css` declares the light palette on `:root` and the dark palette twice — once under `@media (prefers-color-scheme: dark)` guarded so an explicit light choice wins, once under `[data-theme='dark']` — and `globals.css` shrinks to element defaults that read those tokens. The six pre-redesign token names stay in the same file as aliases pointing at the new ones, so every CSS Module written before today keeps working, in the new palette, without being touched. The theme choice is a cookie the root layout reads into a `data-theme` attribute on `<html>`, so the first paint is already correct and no flash is possible.

**Tech Stack:** Next.js 16 (App Router, React 19 Server Components), TypeScript, CSS Modules, `next/font/google`, Vitest + @testing-library/react. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-ui-redesign-design.md` (A1–A13, C14)

## Global Constraints

Every task's requirements implicitly include all of these.

- **R1 — No new runtime dependencies.** No component library, no CSS framework, no icon package, no chart package. Icons are a local `src/components/icon.tsx` with hand-copied stroke paths. **No screen plan in this set may add a dependency either.**
- **R2 — Light is the default theme; dark is preserved as a choice.** Today's `--sand #f2ede6` on near-black survives as the dark theme.
- **R3 — The accent never carries meaning that a colour-blind reader needs.** Orange is brand and primary action. Warning is gold, not orange. Every state pill carries a word, never colour alone.
- **R4 — Text on orange is near-black, never white.** White on `#EB7837` is 2.89:1 and fails. `#1C1917` on `#EB7837` is 6.06:1, and it is what the logo already does.
- **R7 — Server Components and Server Actions stay.** Client components are added only where interaction demands them, and each one states in a comment why it is a client component.
- **R9 — No English reaches a Hebrew screen.**
- **R12 — The redesign lands screen by screen behind no flag.** Each plan ships on `main`. There is no parallel "new UI" route tree.
- **The old token names stay as aliases until the last screen plan lands.** `--ground`, `--raised`, `--sand`, `--dust`, `--dust-dim` and `--flare` are declared in `tokens.css` as `var()` references to the new tokens. This is the single thing that makes the redesign landable screen by screen: on the day this plan lands, nine untouched CSS Modules render in the new palette. A screen plan deletes the alias *uses* in the CSS Module it rewrites; the last screen plan deletes the alias block itself. **No new CSS may use an alias name.**
- **The four pre-redesign global classes stay too.** `.card`, `.muted`, `.badge-warn` and `.scroll-x` are used by seven screens' JSX. They stay in `globals.css`, re-pointed at the new tokens, on the same terms as the aliases.
- **A9 — Focus is `outline: 2px solid var(--focus); outline-offset: 2px` on `:focus-visible`, never removed.**
- **A10 — CSS uses logical properties throughout** — `padding-inline`, `inset-inline-start`, `text-align: start`. The single documented exception is a numeric table column, which is physically `text-align: right` with `font-variant-numeric: tabular-nums` so place values line up. That exception ships as the global `.num` class and nowhere else.
- **Hebrew RTL throughout.** All UI copy in Hebrew, reused verbatim from the existing screens and from the mock wherever it exists (E5). Latin, numeric and mixed-direction runs go in `<bdi>`.
- **Money is integer agorot in JS.** `src/lib/money.ts` is the only converter. Never do float arithmetic on money.
- **Tests assert behaviour through roles and Hebrew text, never CSS class names.** A CSS Module's hashed class name is not a behaviour. An ARIA role, an accessible name, an element name and a `data-` attribute are.
- **Component tests open with the docblock `/** @vitest-environment jsdom */`.** The default environment is `node`.
- **`@testing-library/user-event` is not installed.** Use `fireEvent`.
- **`vi.mock` factories referencing a plain top-level `const` throw a hoisting `ReferenceError`.** Use `vi.hoisted`.
- **Never run `npm install`.** Run tests with `npx vitest run <path>` and types with `npx tsc --noEmit`. Never trust an exit code — read the test COUNT and treat a missing count as a failed run.
- **`git commit -m` in this zsh performs command substitution on backticked spans** and silently deletes them. Use `git commit -F -` with a quoted heredoc.
- **`src/lib/money.ts` and `src/lib/money/` both exist.** `@/lib/money` resolves to the file. Never create `src/lib/money/index.ts`.

---

## File Structure

**Created:**

| file | responsibility |
|---|---|
| `src/app/tokens.css` | Every colour, type step, space step, radius and density height, in light and dark. Nothing else. |
| `src/app/tokens.test.ts` | Pins A2 and A3 value by value, and pins the two dark blocks to each other. |
| `src/components/icon.tsx` | The `Icon` component and the named record of stroke paths (C14). |
| `src/components/icon.module.css` | The one rule that mirrors a directional icon under RTL. |
| `src/components/icon.test.tsx` | Icon behaviour: the right glyph, the accessibility tree, mirroring. |
| `src/lib/theme.ts` | The cookie name, the `Theme` type and the parser. Pure — imports nothing. |
| `src/lib/theme.test.ts` | The parser refuses anything that is not `light` or `dark`. |
| `src/components/theme-toggle.tsx` | The client button that writes the cookie and flips `data-theme` (A13). |
| `src/components/theme-toggle.module.css` | The toggle's own styles, including which of the two glyphs each theme shows. |
| `src/components/theme-toggle.test.tsx` | Clicking flips the attribute and writes the cookie, from a cookie and from the OS preference. |
| `src/lib/dates.ts` | `DD/MM/YY`, `DD/MM/YYYY`, the prose form and `HH:mm`, all in the camp's timezone (A12). |
| `src/lib/dates.test.ts` | Pins the four forms and proves the timezone is pinned, not the runner's. |
| `src/components/format.tsx` | `Money` and `DateText`: the two `<bdi>` wrappers that put a figure on screen. |
| `src/components/format.test.tsx` | The isolate exists and carries the whole formatted string. |

**Modified:**

| file | change |
|---|---|
| `src/app/globals.css` | Shrinks to element defaults that read tokens; imports `tokens.css`; keeps the four legacy global classes. |
| `src/app/layout.tsx` | Heebo 400/500/600/700, IBM Plex Mono added, Frank Ruhl Libre kept for the wordmark; reads the theme cookie into `data-theme`. |
| `src/app/layout.test.tsx` | Awaits the now-async layout; adds the font-weight and `data-theme` cases. |
| `src/app/(admin)/layout.tsx` | Renders `<ThemeToggle />`, so the theme is switchable the day this plan lands. Plan 02 moves it into the sidebar footer. |
| `src/components/charts/charts.module.css` | The track colour becomes a token; the tile figure leaves Frank Ruhl Libre; the derivation line becomes readable (A4, A5). |
| `src/lib/money.ts` | Adds `formatShekels`, the one place an amount gets its symbol. |
| `src/lib/money.test.ts` | Adds the symbol-last and negative-sign cases. Every existing case stays. |

---

## Dependencies

**Plans that must land first:** none. This is the first plan in the set. Plan 02 (the shell) and every screen plan depend on it and must not start until it is on `main`.

**What the in-flight lanes are touching.** `git log --oneline -15` at the time of writing shows four sessions committing in parallel: Wave 2 promotion (`src/lib/import/promote/**`), the promotion-blockers lane B (`src/db/schema/money.ts`, `drizzle/**`, `src/lib/money/obligations.ts`, `src/lib/classify/map-columns.ts`, `src/lib/import/confirm.ts`, `src/app/(admin)/imports/[id]/**`), the hardening lane C (`src/proxy.ts`, `src/lib/auth/**`, `src/app/(admin)/data/page.tsx`, `src/app/(admin)/upload/**`, `next.config.ts`, `src/lib/storage/**`, `src/test/fixtures.ts`), and lane D (`src/lib/money/trace.ts`).

Not one file in this plan's File Structure appears in those lists. Two near-collisions are worth naming so nobody widens the blast radius:

- **`src/lib/money.ts` is not `src/lib/money/obligations.ts`.** Lane B is editing the directory; this plan edits the file beside it. Do not touch anything under `src/lib/money/`.
- **`src/app/(admin)/imports/[id]/import-review.module.css` reads `var(--sand)`, `var(--dust)` and `var(--font-display)`.** Lane B owns that whole directory. This plan must not open it. The alias block is precisely what keeps it rendering while lane B finishes — which is the argument for the aliases in one sentence.

**Files this plan hands on:** `src/app/(admin)/layout.tsx` and `src/components/theme-toggle.tsx` pass to Plan 02, which moves the toggle into the sidebar footer and deletes the temporary row wrapper. `src/components/icon.tsx` ships its full set here and is **not** edited again by any screen plan — an icon record that every lane appends to is a merge conflict with a schedule.

---

### Task 1: One token file, a light default, and the old names kept as aliases

**Files:**
- Create: `src/app/tokens.css`
- Modify: `src/app/globals.css`
- Test: `src/app/tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing. `tokens.css` is the bottom of the stack.
- Produces: the custom properties listed in A2, A3, A6, A7, A8 on `:root`; the same palette under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }` and under `:root[data-theme='dark']`; the density switch `:root[data-density='compact'] { --row: 36px }`; and the six aliases `--ground`, `--raised`, `--sand`, `--dust`, `--dust-dim`, `--flare`.

- [ ] **Step 1: Write the failing test**

`src/app/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tokens = () => readFileSync(join(process.cwd(), 'src/app/tokens.css'), 'utf8');
const globals = () => readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/**
 * The body of the first rule whose selector text starts at `selector`.
 *
 * Pass the selector with its opening brace wherever the same text also
 * appears in a comment — `.viz {` rather than `.viz` — or this finds the
 * comment and then the next brace after it, which is somebody else's rule.
 */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let index = open;
  for (; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return css.slice(open + 1, index);
}

/**
 * `--line` must not match `--line-strong`: the pattern requires whitespace or
 * the colon straight after the name, and `-strong` is neither.
 */
function tokenValue(body: string, name: string): string | null {
  const match = body.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

function declaredNames(body: string): string[] {
  return [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort();
}

// A2, verbatim.
const LIGHT: Array<[string, string]> = [
  ['canvas', '#F6F4F1'], ['panel', '#FFFFFF'], ['sunken', '#F3F0EC'],
  ['hover', '#F8F6F3'], ['selected', '#FDF1E8'], ['line', '#E9E4DE'],
  ['line-strong', '#D8D1C9'], ['ink', '#1C1917'], ['ink-2', '#57534E'],
  ['ink-3', '#6B645E'], ['ink-4', '#A8A29E'], ['brand', '#EB7837'],
  ['brand-hover', '#E06A28'], ['brand-ink', '#1C1917'], ['brand-text', '#B04E17'],
  ['brand-soft', '#FDF1E8'], ['focus', '#C8570F'], ['ok', '#1A7F4B'],
  ['ok-soft', '#E7F5EC'], ['warn', '#8A5A00'], ['warn-soft', '#FDF3D7'],
  ['warn-line', '#F1D9A0'], ['bad', '#B42318'], ['bad-soft', '#FDECEA'],
  ['info', '#2458C6'], ['info-soft', '#EAF1FD'], ['viz-track', '#EEEAE5'],
];

// A3, verbatim.
const DARK: Array<[string, string]> = [
  ['canvas', '#0E0D0C'], ['panel', '#171513'], ['sunken', '#1D1A17'],
  ['hover', '#1F1C19'], ['selected', '#2A1D14'], ['line', '#2B2724'],
  ['line-strong', '#3A3531'], ['ink', '#F2EDE6'], ['ink-2', '#C9C1B8'],
  ['ink-3', '#A39B93'], ['ink-4', '#6F6861'], ['brand-text', '#F59A5E'],
  ['brand-soft', '#2A1D14'], ['focus', '#F08A4B'], ['ok', '#5CC98E'],
  ['ok-soft', '#12261B'], ['warn', '#F0C05A'], ['warn-soft', '#2A2112'],
  ['bad', '#F2877C'], ['bad-soft', '#2C1614'], ['info', '#7FA8F5'],
  ['info-soft', '#141E33'], ['viz-track', '#2B2724'],
];

describe('tokens.css', () => {
  it('declares the light palette on :root, exactly as the spec lists it', () => {
    const root = block(tokens(), ':root {');
    for (const [name, value] of LIGHT) {
      expect(`--${name}: ${tokenValue(root, name)}`).toBe(`--${name}: ${value}`);
    }
  });

  it('declares the dark palette under the OS preference and under the attribute', () => {
    const css = tokens();
    const byPreference = block(css, ":root:not([data-theme='light'])");
    const byAttribute = block(css, ":root[data-theme='dark']");
    for (const [name, value] of DARK) {
      expect(`preference --${name}: ${tokenValue(byPreference, name)}`)
        .toBe(`preference --${name}: ${value}`);
      expect(`attribute --${name}: ${tokenValue(byAttribute, name)}`)
        .toBe(`attribute --${name}: ${value}`);
    }
  });

  /**
   * Plain CSS cannot share one declaration block between a media query and a
   * bare selector, so the dark palette is written twice. This is the guard
   * against the second copy drifting from the first.
   */
  it('gives the two dark blocks the same tokens', () => {
    const css = tokens();
    expect(declaredNames(block(css, ":root:not([data-theme='light'])")))
      .toEqual(declaredNames(block(css, ":root[data-theme='dark']")));
  });

  it('guards the OS preference so an explicit light choice wins', () => {
    const css = tokens();
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    const guarded = css.indexOf(":root:not([data-theme='light'])");
    const media = css.indexOf('@media (prefers-color-scheme: dark)');
    expect(media).toBeGreaterThanOrEqual(0);
    expect(guarded).toBeGreaterThan(media);
  });

  it('lets native controls and scrollbars follow the theme', () => {
    const css = tokens();
    expect(block(css, ':root {')).toContain('color-scheme: light');
    expect(block(css, ":root[data-theme='dark']")).toContain('color-scheme: dark');
  });

  it('carries the type, space, radius and density scales', () => {
    const root = block(tokens(), ':root {');
    expect(tokenValue(root, 'text-label')).toBe('11.5px');
    expect(tokenValue(root, 'text-cell')).toBe('14px');
    expect(tokenValue(root, 'leading-cell')).toBe('20px');
    expect(tokenValue(root, 'text-body')).toBe('14.5px');
    expect(tokenValue(root, 'leading-body')).toBe('22px');
    expect(tokenValue(root, 'text-title')).toBe('22px');
    expect(tokenValue(root, 'space-1')).toBe('4px');
    expect(tokenValue(root, 'space-8')).toBe('64px');
    expect(tokenValue(root, 'radius-control')).toBe('8px');
    expect(tokenValue(root, 'radius-pill')).toBe('999px');
    expect(tokenValue(root, 'row-head')).toBe('36px');
    expect(tokenValue(root, 'row')).toBe('44px');
    expect(tokenValue(root, 'tap-min')).toBe('44px');
  });

  it('switches the row height in compact density', () => {
    expect(tokenValue(block(tokens(), ":root[data-density='compact']"), 'row'))
      .toBe('36px');
  });

  /**
   * The nine CSS Modules written before the redesign read these six names.
   * They are kept, pointing at the new tokens, so the redesign can land one
   * screen at a time. `--flare` maps to `--brand-text` and not to `--brand`:
   * it is read as text in thirty-odd places, and #EB7837 on white is 2.89:1.
   */
  it('keeps the pre-redesign names as aliases onto the new tokens', () => {
    const root = block(tokens(), ':root {');
    expect(tokenValue(root, 'ground')).toBe('var(--canvas)');
    expect(tokenValue(root, 'raised')).toBe('var(--panel)');
    expect(tokenValue(root, 'sand')).toBe('var(--ink)');
    expect(tokenValue(root, 'dust')).toBe('var(--ink-3)');
    expect(tokenValue(root, 'dust-dim')).toBe('var(--ink-4)');
    expect(tokenValue(root, 'flare')).toBe('var(--brand-text)');
  });
});

describe('globals.css', () => {
  it('imports the token file before anything else', () => {
    expect(globals()).toMatch(/^(?:\s|\/\*[\s\S]*?\*\/)*@import\s+['"]\.\/tokens\.css['"]/);
  });

  it('declares no colour of its own', () => {
    expect(globals()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('never removes the focus ring', () => {
    const css = globals();
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline: 2px solid var(--focus)');
    expect(css).toContain('outline-offset: 2px');
    expect(css).not.toContain('outline: none');
    expect(css).not.toContain('outline: 0');
  });

  /**
   * A10's single documented exception, and the only place a physical
   * direction is allowed to beat a logical one.
   */
  it('ships the numeric-column exception as one class', () => {
    const css = globals();
    expect(block(css, '.num {')).toContain('text-align: right');
    expect(block(css, '.num {')).toContain('font-variant-numeric: tabular-nums');
    expect(css).not.toContain('text-align: left');
  });

  it('keeps the four pre-redesign global classes the screens still use', () => {
    const css = globals();
    for (const name of ['.card', '.muted', '.badge-warn', '.scroll-x']) {
      expect(css).toContain(name);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/tokens.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../src/app/tokens.css'` on every case in the first describe, and failures in the second describe because `globals.css` still declares `#000000` and has no `@import`.

- [ ] **Step 3: Write the token file**

`src/app/tokens.css`:

```css
/**
 * The one place a colour, a type step, a space step, a radius or a row height
 * is named. Nothing else belongs here, and no CSS Module may declare a colour
 * of its own.
 *
 * Light is the default and dark is a choice (R2). The dark palette is written
 * twice because plain CSS cannot share one declaration block between a media
 * query and a bare selector: once under the OS preference, guarded by
 * `:not([data-theme='light'])` so that someone who chose light on a dark
 * laptop gets light, and once under `[data-theme='dark']` for someone who
 * chose dark on a light laptop. `src/app/tokens.test.ts` pins the two copies
 * to each other.
 *
 * The orange is brand and primary action, never state (R3). `--brand` is a
 * fill and takes `--brand-ink` on top of it, never white (R4: #1C1917 on
 * #EB7837 is 6.06:1; white is 2.89:1 and fails). `--brand-text` is the orange
 * that may be read as text (5.32:1 on white) and `--focus` the orange that may
 * be drawn as a ring (4.35:1).
 */

:root {
  color-scheme: light;

  /* ── Surfaces (A2) ────────────────────────────────────────────── */
  --canvas: #F6F4F1;
  --panel: #FFFFFF;
  --sunken: #F3F0EC;
  --hover: #F8F6F3;
  --selected: #FDF1E8;
  --line: #E9E4DE;
  --line-strong: #D8D1C9;

  /* ── Text (A2) ────────────────────────────────────────────────── */
  --ink: #1C1917;
  --ink-2: #57534E;
  --ink-3: #6B645E;
  --ink-4: #A8A29E;

  /* ── Brand (A2, R3, R4) ───────────────────────────────────────── */
  --brand: #EB7837;
  --brand-hover: #E06A28;
  --brand-ink: #1C1917;
  --brand-text: #B04E17;
  --brand-soft: #FDF1E8;
  --focus: #C8570F;

  /* ── States (A2, R3): every one of these is paired with a word ── */
  --ok: #1A7F4B;
  --ok-soft: #E7F5EC;
  --warn: #8A5A00;
  --warn-soft: #FDF3D7;
  --warn-line: #F1D9A0;
  --bad: #B42318;
  --bad-soft: #FDECEA;
  --info: #2458C6;
  --info-soft: #EAF1FD;

  /* ── Chart track (A4) ─────────────────────────────────────────────
     The three series colours are not here. They stay scoped to `.viz` in
     charts.module.css so that no page stylesheet can reach them and no mark
     can accidentally be painted in the accent. Only the unfilled track
     follows the theme. */
  --viz-track: #EEEAE5;

  /* ── Shadow (A7): overlays only. Structure is drawn with 1px borders. ── */
  --shadow-pop: 0 1px 2px rgba(28, 25, 23, .06), 0 8px 24px rgba(28, 25, 23, .12);
  --shadow-drawer: 0 0 0 1px rgba(28, 25, 23, .06), 0 16px 48px rgba(28, 25, 23, .18);

  /* ── Type (A6): Hebrew-corrected, +1px size and +2px leading over a
     Latin scale — which is why a table cell is 14/20 and not 13/18. ── */
  --text-label: 11.5px;
  --text-meta: 12.5px;
  --text-dense: 13px;
  --text-cell: 14px;
  --leading-cell: 20px;
  --text-body: 14.5px;
  --leading-body: 22px;
  --text-lead: 16px;
  --text-title: 22px;
  --leading-title: 30px;
  --text-display: 26px;
  --text-display-lg: 38px;

  /* ── Space (A7): the 4px scale, and nothing between its steps. ── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  /* ── Radii (A7) ───────────────────────────────────────────────── */
  --radius-sm: 6px;
  --radius-control: 8px;
  --radius-card: 12px;
  --radius-panel: 14px;
  --radius-pill: 999px;

  /* ── Density (A8) ─────────────────────────────────────────────── */
  --row-head: 36px;
  --row: 44px;
  --control-h: 34px;
  --control-h-lg: 36px;
  --tap-min: 44px;
  --input-font-phone: 16px;

  /* ── Aliases from the pre-redesign palette ────────────────────────
     Every CSS Module written before this plan reads these six names. They
     are kept, mapped onto the new tokens, so the redesign lands one screen
     at a time: a screen nobody has rewritten yet renders in the new palette
     on the day this file lands. `--line` is not in this list because the new
     palette uses the same name for the same job.

     `--flare` maps to `--brand-text` and not to `--brand`: it is read as
     text — links, warnings, the active nav pill's background with the canvas
     colour on top — and #EB7837 as text on white is 2.89:1.

     A screen plan deletes the alias uses in the CSS Module it rewrites. The
     last screen plan deletes this block. No new CSS may use these names. */
  --ground: var(--canvas);
  --raised: var(--panel);
  --sand: var(--ink);
  --dust: var(--ink-3);
  --dust-dim: var(--ink-4);
  --flare: var(--brand-text);
}

/* A8: the compact table row. Set on <html> by a later plan's density control. */
:root[data-density='compact'] {
  --row: 36px;
}

/* Dark by the OS preference — unless the reader said light (A1, A13). */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;

    --canvas: #0E0D0C;
    --panel: #171513;
    --sunken: #1D1A17;
    --hover: #1F1C19;
    --selected: #2A1D14;
    --line: #2B2724;
    --line-strong: #3A3531;

    --ink: #F2EDE6;
    --ink-2: #C9C1B8;
    --ink-3: #A39B93;
    --ink-4: #6F6861;

    --brand-text: #F59A5E;
    --brand-soft: #2A1D14;
    --focus: #F08A4B;

    --ok: #5CC98E;
    --ok-soft: #12261B;
    --warn: #F0C05A;
    --warn-soft: #2A2112;
    --warn-line: #4A3A1A;
    --bad: #F2877C;
    --bad-soft: #2C1614;
    --info: #7FA8F5;
    --info-soft: #141E33;

    --viz-track: #2B2724;

    --shadow-pop: 0 0 0 1px #2B2724, 0 8px 24px rgba(0, 0, 0, .5);
    --shadow-drawer: 0 0 0 1px #2B2724, 0 16px 48px rgba(0, 0, 0, .6);
  }
}

/* Dark because the reader chose it (A13). */
:root[data-theme='dark'] {
  color-scheme: dark;

  --canvas: #0E0D0C;
  --panel: #171513;
  --sunken: #1D1A17;
  --hover: #1F1C19;
  --selected: #2A1D14;
  --line: #2B2724;
  --line-strong: #3A3531;

  --ink: #F2EDE6;
  --ink-2: #C9C1B8;
  --ink-3: #A39B93;
  --ink-4: #6F6861;

  --brand-text: #F59A5E;
  --brand-soft: #2A1D14;
  --focus: #F08A4B;

  --ok: #5CC98E;
  --ok-soft: #12261B;
  --warn: #F0C05A;
  --warn-soft: #2A2112;
  --warn-line: #4A3A1A;
  --bad: #F2877C;
  --bad-soft: #2C1614;
  --info: #7FA8F5;
  --info-soft: #141E33;

  --viz-track: #2B2724;

  --shadow-pop: 0 0 0 1px #2B2724, 0 8px 24px rgba(0, 0, 0, .5);
  --shadow-drawer: 0 0 0 1px #2B2724, 0 16px 48px rgba(0, 0, 0, .6);
}
```

> `--brand`, `--brand-hover` and `--brand-ink` are absent from both dark blocks on purpose: A3 does not restate them, because the orange and the near-black on top of it are the same in both themes. `--warn-line` and the two shadows are absent from A3's list and take the mock's authored dark values (`scratchpad/mock/src/shared.css`, `.app.dark`).

- [ ] **Step 4: Run it and watch the token half turn green**

Run: `npx vitest run src/app/tokens.test.ts`
Expected: the eight `tokens.css` cases pass; the five `globals.css` cases still fail — the first with "expected `/* ... */ :root { --ground: #000000; ...` to match the `@import` pattern", the second on `#000000`, and the `.num` case with `Error: no rule for .num {`.

- [ ] **Step 5: Reduce globals.css to element defaults that read tokens**

`src/app/globals.css`, replacing the whole file:

```css
/**
 * Element defaults only. Every value here comes from tokens.css, and this
 * file declares no colour of its own — `src/app/tokens.test.ts` enforces it.
 *
 * The four classes at the bottom (`.card`, `.muted`, `.badge-warn`,
 * `.scroll-x`) are pre-redesign globals that seven screens' JSX still names.
 * They are re-pointed at the new tokens and kept on the same terms as the
 * token aliases: each screen plan removes its own uses, and the last of them
 * deletes the block.
 */
@import './tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-body), 'Segoe UI', system-ui, Arial, sans-serif;
  font-size: var(--text-body);
  line-height: var(--leading-body);
  -webkit-font-smoothing: antialiased;
}

/* A9. Never removed, anywhere, for any control. */
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/**
 * A5: Heebo carries tabular numerals by default — and "by default" here means
 * every number, because every number on this platform is already inside a
 * <bdi>: that is how the minus sign is kept from migrating across the digits
 * in bidi (A11).
 */
bdi {
  font-variant-numeric: tabular-nums;
}

/**
 * A10's single documented exception. A money column must line up by place
 * value; `text-align: start` would push it to the wrong edge of an RTL table.
 * This class is the only physical direction in the codebase.
 */
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

main {
  max-inline-size: 60rem;
  margin-inline: auto;
  padding-block: var(--space-6);
  padding-inline: var(--space-4);
}

h1 {
  font-size: var(--text-title);
  line-height: var(--leading-title);
  font-weight: 600;
  margin-block-end: var(--space-4);
}

a {
  color: var(--brand-text);
}

table {
  border-collapse: collapse;
  inline-size: 100%;
}

th,
td {
  border: 1px solid var(--line);
  padding-block: var(--space-1);
  padding-inline: var(--space-2);
  text-align: start;
  font-size: var(--text-cell);
  line-height: var(--leading-cell);
}

th {
  background: var(--sunken);
  color: var(--ink-3);
  font-weight: 500;
}

/* ── Pre-redesign globals, kept until the last screen plan ─────────── */

.card {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  margin-block-end: var(--space-4);
  background: var(--panel);
}

.muted {
  color: var(--ink-3);
}

/* Nearly every use of this class is a `role="alert"` error message, so it
   takes the error colour, not the warning colour (R3). */
.badge-warn {
  color: var(--bad);
}

.scroll-x {
  overflow-x: auto;
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run src/app/tokens.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 7: Confirm nothing that renders broke**

Run: `npx vitest run src/app src/components`
Expected: PASS. No test reads a stylesheet other than `tokens.test.ts`, so this is a regression net, not a new assertion.

- [ ] **Step 8: Commit**

```bash
git add src/app/tokens.css src/app/tokens.test.ts src/app/globals.css
git commit -F - <<'MSG'
feat(ui): one token file, a light default, and the old names kept as aliases

The light palette lands on :root, the dark palette twice — under the OS
preference guarded so an explicit light choice wins, and under
[data-theme='dark'] — with a test pinning the two copies to each other.
globals.css keeps only element defaults, and declares no colour of its own.

--ground, --raised, --sand, --dust, --dust-dim and --flare stay as aliases
onto the new tokens, so nine untouched CSS Modules render in the new palette
today. That is what makes the redesign landable one screen at a time. --flare
maps to --brand-text, not --brand: it is read as text, and #EB7837 on white
is 2.89:1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: The chart track follows the theme, the series do not move

**Files:**
- Modify: `src/components/charts/charts.module.css:1-25` (the header comment and the `.viz` block), `:78-83` (the tile)
- Test: `src/app/tokens.test.ts` (extend)

**Interfaces:**
- Consumes: `--viz-track`, `--ink-3`, `--font-body` from `tokens.css` / `globals.css`.
- Produces: no change to `--series-1`, `--series-2`, `--series-3`, which stay scoped to `.viz`.

- [ ] **Step 1: Write the failing test**

Append to `src/app/tokens.test.ts`, above the closing of the file:

```ts
describe('charts.module.css', () => {
  const charts = () =>
    readFileSync(join(process.cwd(), 'src/components/charts/charts.module.css'), 'utf8');

  /**
   * A4: the series palette is unchanged and stays scoped to `.viz`, so no page
   * stylesheet can reach it and the accent can never paint a mark.
   */
  it('keeps the three series colours where they are', () => {
    const viz = block(charts(), '.viz {');
    expect(tokenValue(viz, 'series-1')).toBe('#d95926');
    expect(tokenValue(viz, 'series-2')).toBe('#3987e5');
    expect(tokenValue(viz, 'series-3')).toBe('#199e70');
    // A4's standing rule: the accent may never colour a chart mark.
    expect(viz).not.toContain('--brand');
    expect(viz).not.toContain('--flare');
  });

  it('themes the unfilled track', () => {
    expect(tokenValue(block(charts(), '.viz {'), 'track')).toBe('var(--viz-track)');
  });

  /**
   * A5 reduces Frank Ruhl Libre to the wordmark and the sign-in page. A
   * display figure is set in the UI face at 26/600 (A6), not in the serif.
   */
  it('sets the display figure in the interface face', () => {
    expect(charts()).not.toContain('--font-display');
  });

  it('keeps the derivation line readable', () => {
    expect(block(charts(), '.tileDerivation {')).toContain('var(--ink-3)');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/tokens.test.ts`
Expected: FAIL — `expected '#2b2724' to be 'var(--viz-track)'` on the track case, `expected '...var(--font-display), Georgia, serif...' not to contain '--font-display'` on the face case, and `expected 'color: var(--dust-dim); ...' to contain 'var(--ink-3)'` on the derivation case.

- [ ] **Step 3: Move the track and the tile onto tokens**

In `src/components/charts/charts.module.css`, replace the header comment and the `.viz` block with:

```css
/*
 * Series colours are the documented steps of the validated palette and are
 * unchanged by the redesign (A4). They stay scoped to `.viz` rather than
 * moving into tokens.css, so nothing outside a chart can reach them and no
 * mark can be painted in the accent. On the light panel (#FFFFFF) they are
 * 3.88:1, 3.64:1 and 3.41:1 — all clear of the 3:1 floor for a graphical
 * object. On the dark panel they are the values they always were.
 *
 * --flare / --brand (#EB7837) is deliberately absent. It fails the dark
 * lightness band (OKLCH L 0.694 against a 0.67 ceiling) and drops the CVD
 * pair into the warn band, so it stays what it already is: the UI accent for
 * links and primary actions, never a chart mark.
 *
 * Status `serious` (#ec835a) is also absent: it sits ~5.8 ΔE from series
 * orange and almost on top of the accent, and three oranges meaning three
 * different things is how a page lies. Status here is good/warning/critical
 * only, always with an icon and a word.
 *
 * The unfilled track is the one value that follows the theme, because it is a
 * surface rather than a mark.
 */
.viz {
  --series-1: #d95926;
  --series-2: #3987e5;
  --series-3: #199e70;
  --track: var(--viz-track);
  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-critical: #d03b3b;
}
```

Then, at the tile, replace the three rules with:

```css
.tile { padding-block: var(--space-2); }
.tileValue {
  font-size: var(--text-display);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -.3px;
  font-variant-numeric: tabular-nums;
}
.tileLabel { color: var(--ink-3); font-size: var(--text-meta); }
.tileDerivation { color: var(--ink-3); font-size: var(--text-meta); }
```

> The derivation line leaves `--dust-dim` / `--ink-4`: `#A8A29E` on white is 2.52:1, and a derivation line is prose a lead has to read. Wave 1's rule is that no number is unexplained; an explanation nobody can read does not satisfy it.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/app/tokens.test.ts src/components/charts`
Expected: PASS, 17 tests in `tokens.test.ts`. The chart component tests are unaffected — they assert Hebrew labels and figures, not colours.

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/charts.module.css src/app/tokens.test.ts
git commit -F - <<'MSG'
feat(ui): the chart track follows the theme, the series do not move

A4 keeps the three series colours exactly where they are, scoped to .viz so
nothing outside a chart can reach them. Only the unfilled track is themed,
because a track is a surface and not a mark. The stat tile leaves Frank Ruhl
Libre for the interface face (A5) and its derivation line leaves --ink-4,
which is 2.52:1 on white and is not a colour for prose.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: Heebo carries the interface, Frank Ruhl Libre keeps the wordmark

**Files:**
- Modify: `src/app/layout.tsx:1-24` (the font loaders and the `<html>` class list)
- Test: `src/app/layout.test.tsx:12-19` (the font mock), plus new cases

**Interfaces:**
- Consumes: `Frank_Ruhl_Libre`, `Heebo`, `IBM_Plex_Mono` from `next/font/google`.
- Produces: the custom properties `--font-display`, `--font-body` and `--font-mono` on `<html>`.

- [ ] **Step 1: Write the failing test**

Replace everything above the first `describe(` in `src/app/layout.test.tsx` — the docblock, the imports and the font mock — with:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * The loaders run at module import time, so the record has to exist before
 * the mock factory is hoisted above the import of the layout. A plain
 * top-level `const` here throws a hoisting ReferenceError.
 */
const fontCalls = vi.hoisted(() => [] as Array<{ family: string; weight?: string[] }>);

/**
 * `next/font/google` ships an empty module outside the Next.js compiler, which
 * rewrites these calls at build time. Under Vitest the real import resolves to
 * nothing, so the loaders are stubbed with the shape Next produces: a class
 * name plus the CSS custom property the stylesheets read.
 */
vi.mock('next/font/google', () => {
  const loader = (family: string) =>
    (options: { variable: string; weight?: string[] }) => {
      fontCalls.push({ family, weight: options.weight });
      return {
        className: `__mock_${options.variable}`,
        variable: `__mock_var_${options.variable}`,
        style: { fontFamily: options.variable },
      };
    };
  return {
    Frank_Ruhl_Libre: loader('Frank_Ruhl_Libre'),
    Heebo: loader('Heebo'),
    IBM_Plex_Mono: loader('IBM_Plex_Mono'),
  };
});

import RootLayout from '@/app/layout';
```

and, inside `describe('RootLayout', ...)`:

```tsx
  it('declares the mono face for spreadsheet cell references', () => {
    const element = RootLayout({ children: null }) as React.ReactElement<{
      className: string;
    }>;
    expect(element.props.className).toContain('__mock_var_--font-mono');
  });

  /**
   * A5. Heebo carries the whole interface, so it needs the four weights the
   * kit uses: 400 body, 500 labels and nav, 600 headings and figures, 700 for
   * the few places a figure has to shout. Frank Ruhl Libre is down to the
   * wordmark and the sign-in page and needs one.
   */
  it('loads each face at the weights its job needs', () => {
    expect(fontCalls.find((call) => call.family === 'Heebo')?.weight)
      .toEqual(['400', '500', '600', '700']);
    expect(fontCalls.find((call) => call.family === 'Frank_Ruhl_Libre')?.weight)
      .toEqual(['500']);
    expect(fontCalls.find((call) => call.family === 'IBM_Plex_Mono')?.weight)
      .toEqual(['400']);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/layout.test.tsx`
Expected: FAIL — `expected '__mock_var_--font-display __mock_var_--font-body' to contain '__mock_var_--font-mono'`, and `expected [ '400', '500', '600' ] to deeply equal [ '400', '500', '600', '700' ]`.

- [ ] **Step 3: Load the three faces**

In `src/app/layout.tsx`, replace the import and the three loaders:

```tsx
import type { Metadata } from 'next';
import { Frank_Ruhl_Libre, Heebo, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/**
 * The fonts are instantiated here, at the root, and their custom properties
 * are applied to `<html>`.
 *
 * Custom properties inherit downward only, so declaring them on a per-page
 * wrapper leaves everything rendered *above* that wrapper — the admin nav in
 * particular — without them. The nav's wordmark then fell through to Georgia,
 * which has no Hebrew glyphs, so "קופת שליף" rendered in an arbitrary browser
 * fallback on every admin page.
 *
 * A5 assigns each face one job. Heebo is the interface: it has the Hebrew
 * coverage, it carries tabular numerals, and it is the only face a table,
 * a form or a figure is ever set in. Frank Ruhl Libre is a display serif and
 * is kept for the wordmark and the sign-in page and nowhere else — a serif at
 * 12.5px in a table is a legibility cost with nothing bought for it. IBM Plex
 * Mono exists for one thing: a spreadsheet cell reference such as
 * `תנועות קופה!A14`, where the Latin run has to line up like the workbook
 * shows it. Its Hebrew sheet name falls through to the system mono, which is
 * correct — Plex Mono has no Hebrew.
 */
const display = Frank_Ruhl_Libre({
  subsets: ['hebrew', 'latin'],
  weight: ['500'],
  variable: '--font-display',
});
const body = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-mono',
});
```

and extend the class list:

```tsx
    <html
      lang="he"
      dir="rtl"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/app/layout.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Check the types**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/app/layout.test.tsx
git commit -F - <<'MSG'
feat(ui): Heebo carries the interface, Frank Ruhl Libre keeps the wordmark

A5 gives each face one job. Heebo gains 700 and takes the whole interface,
tabular numerals included. Frank Ruhl Libre is down to the wordmark and the
sign-in page. IBM Plex Mono arrives for spreadsheet cell references, where a
Latin run has to line up the way the workbook shows it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: One icon component, with the paths copied rather than invented

**Files:**
- Create: `src/components/icon.tsx`, `src/components/icon.module.css`
- Test: `src/components/icon.test.tsx` (create)

**Interfaces:**
- Consumes: nothing. The path data is a local constant.
- Produces:
  - `export type IconName = keyof typeof ICON_PATHS`
  - `export type IconSize = 14 | 15 | 16 | 20`
  - `export function Icon(props: { name: IconName; size?: IconSize; label?: string }): React.ReactElement`

**The first cut.** The record ships the mock's whole set in one go — all sixty-five names below — and no screen plan edits this file again. The alternative, each plan appending the two or three glyphs its screen needs, makes `icon.tsx` the one file every parallel lane touches, which is a merge conflict with a schedule. Sixty-five stroke paths are about 9KB of string constants.

`home`, `inbox`, `users`, `user`, `receipt`, `tasks`, `wallet`, `ledger`, `pie`, `scale`, `sheet`, `search`, `sliders`, `down`, `up`, `left`, `right`, `updown`, `plus`, `filter`, `sort`, `columns`, `more`, `download`, `upload`, `x`, `check`, `alert`, `info`, `link`, `userplus`, `merge`, `calendar`, `clock`, `in`, `out`, `cash`, `bank`, `tent`, `sun`, `moon`, `copy`, `ban`, `calc`, `grid`, `logout`, `phone`, `pencil`, `trash`, `expand`, `enter`, `arrowl`, `arrowr`, `flag`, `menu`, `history`, `eye`, `layers`, `list`, `board`, `note`, `party`, `split`, `skip`, `mail`.

**Sizes.** C14 fixes the ladder at 14/15/16/20 and the type forbids anything else. Where the mock drew 12 or 13 the real component uses 14; where it drew 17 it uses 16; where it drew 24 it uses 20.

- [ ] **Step 1: Write the failing test**

`src/components/icon.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon } from '@/components/icon';

describe('Icon', () => {
  it('draws the glyph the name asks for', () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector('svg');
    expect(svg?.innerHTML).toContain('M20 6 9 17l-5-5');
  });

  /**
   * An icon beside a word is decoration: the word is already the label, and a
   * screen reader announcing both says everything twice.
   */
  it('stays out of the accessibility tree when it is decoration', () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  /** An icon that is the whole control carries the Hebrew name of that control. */
  it('takes a name when it stands alone', () => {
    render(<Icon name="x" label="סגירה" />);
    const labelled = screen.getByRole('img', { name: 'סגירה' });
    expect(labelled.getAttribute('aria-hidden')).toBeNull();
  });

  /**
   * C14: an icon that points along the line of text follows the line, and
   * `icon.module.css` mirrors it with `:dir(rtl)`. The component's job is to
   * declare which icons are directional, and that declaration is what this
   * test reads — the mirroring itself is the browser's.
   */
  it('declares a directional icon as directional', () => {
    const { container } = render(<Icon name="right" />);
    expect(container.querySelector('svg')?.getAttribute('data-direction')).toBe('inline');
  });

  it('leaves a checkmark, a clock and a media glyph alone', () => {
    for (const name of ['check', 'clock', 'skip'] as const) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.getAttribute('data-direction')).toBeNull();
    }
  });

  it('draws at the size it is given, with the one stroke width', () => {
    const { container } = render(<Icon name="search" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('defaults to 16', () => {
    const { container } = render(<Icon name="search" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/icon.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/icon"`.

- [ ] **Step 3: Write the component**

`src/components/icon.tsx`:

```tsx
/**
 * One icon component, one record of stroke paths (C14).
 *
 * R1 rules out an icon package, so the paths are copied by hand from the
 * mock's `icons.mjs`, which is Lucide-derived stroke geometry (ISC). They are
 * copied rather than redrawn: a hand-written path is a hand-drawn bug.
 *
 * The whole set ships at once. The alternative — each screen plan appending
 * the glyphs its screen needs — makes this the one file every parallel lane
 * edits, and the redesign is landing screen by screen in parallel lanes.
 *
 * Every glyph is drawn on a 24×24 canvas in a 1.75 stroke, with round caps
 * and joins, in `currentColor`. An icon never carries a colour of its own:
 * it takes the colour of the text it sits beside.
 */
import styles from './icon.module.css';

const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  tasks: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  ledger: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  updown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  filter: '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  in: '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
  out: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  cash: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  bank: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  tent: '<path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2"/>',
  expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  enter: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  arrowl: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowr: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  board: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
  note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>',
  party: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  skip: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** C14 fixes the ladder. Nothing between these steps, and nothing above 20. */
export type IconSize = 14 | 15 | 16 | 20;

/**
 * The icons whose meaning is "toward the start of the line" or "toward the
 * end of it". Under RTL they turn around with the line; `icon.module.css`
 * does the turning, and this set is the declaration of which ones qualify.
 *
 * A checkmark means the same thing in both directions. So does a clock, and
 * so does a media transport control — a skip-back button points the way it
 * points on every remote control in the world, and mirroring it reverses what
 * it says. Vertical arrows are unaffected by direction by definition.
 */
const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>([
  'left', 'right', 'arrowl', 'arrowr', 'enter', 'logout',
  'in', 'out', 'ledger', 'merge', 'split', 'expand',
]);

export function Icon({
  name, size = 16, label,
}: {
  name: IconName;
  size?: IconSize;
  /** Hebrew. Present only when the icon is the whole control (E4). */
  label?: string;
}) {
  const labelled = label !== undefined;
  return (
    <svg
      className={styles.icon}
      data-direction={DIRECTIONAL.has(name) ? 'inline' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      /* The only content is a local constant in this file. No value from a
         request, a database row or a workbook ever reaches this attribute,
         and the geometry is copied verbatim so that SVG element names and
         namespaces are handled by the parser rather than transcribed by
         hand into JSX. */
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  );
}
```

`src/components/icon.module.css`:

```css
.icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}

/**
 * C14. An icon that points along the line of text follows the line. `:dir()`
 * is used rather than an unconditional flip because a cell reference renders
 * in an LTR run inside an RTL page, and an arrow inside one of those must not
 * turn around.
 */
.icon[data-direction='inline']:dir(rtl) {
  transform: scaleX(-1);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/icon.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Check the types**

Run: `npx tsc --noEmit`
Expected: no output. `ICON_PATHS` is `as const`, so `IconName` is the union of the sixty-five literal names and a misspelled name is a compile error rather than a blank square.

- [ ] **Step 6: Commit**

```bash
git add src/components/icon.tsx src/components/icon.module.css src/components/icon.test.tsx
git commit -F - <<'MSG'
feat(ui): one icon component, with the paths copied rather than invented

R1 rules out an icon package, so C14 is a local component over a record of
stroke paths copied from the mock. The whole set ships at once: an icon record
that every screen plan appends to is the one file every parallel lane edits.

An icon is aria-hidden unless it is the whole control, in which case it takes
the Hebrew name of that control. Icons that point along the line of text
declare themselves directional and the stylesheet mirrors them under :dir(rtl);
checkmarks, clocks and media glyphs do not, because they mean the same thing
in both directions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: The theme is a cookie, so the first paint is already right

**Files:**
- Create: `src/lib/theme.ts`, `src/components/theme-toggle.tsx`, `src/components/theme-toggle.module.css`
- Modify: `src/app/layout.tsx:26-37` (the layout function), `src/app/(admin)/layout.tsx`
- Test: `src/lib/theme.test.ts` (create), `src/components/theme-toggle.test.tsx` (create), `src/app/layout.test.tsx` (extend)

**Interfaces:**
- Consumes: `cookies` from `next/headers`; `Icon` from `@/components/icon`.
- Produces:
  - `export const THEME_COOKIE = 'shliff_theme'`
  - `export const THEME_MAX_AGE_SECONDS = 31_536_000`
  - `export type Theme = 'light' | 'dark'`
  - `export function parseTheme(value: string | undefined | null): Theme | null`
  - `export function ThemeToggle(): React.ReactElement`
  - `<html data-theme>` carrying `'light'`, `'dark'`, or no attribute at all.

**The cookie.** Name `shliff_theme`, values `light` and `dark`, `path=/`, `max-age=31536000`, `samesite=lax`, and **not** `httpOnly` — the toggle writes it from the browser, so the switch costs no round trip. Absent or unrecognised means "the OS decides", which is A13's default and is expressed by leaving `data-theme` off `<html>` entirely, so `tokens.css`'s `:root:not([data-theme='light'])` guard applies.

**Why the root layout reads it.** `cookies()` is a request-time API, so reading it in the root layout opts every route into dynamic rendering. That is already true of this app: every page is behind `requireAdmin()` and reads the database. Nothing is lost, and the alternative — resolving the theme on the client — is a flash of the wrong palette on every load.

- [ ] **Step 1: Write the failing parser test**

`src/lib/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTheme, THEME_COOKIE, THEME_MAX_AGE_SECONDS } from '@/lib/theme';

describe('parseTheme', () => {
  it('reads the two themes there are', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });

  /**
   * A cookie is whatever the browser sends. Anything that is not one of the
   * two themes means "nobody chose", which is the OS preference, which is
   * expressed as no attribute at all.
   */
  it('treats anything else as no choice', () => {
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme('DARK')).toBeNull();
    expect(parseTheme('auto')).toBeNull();
    expect(parseTheme('dark; --injected')).toBeNull();
  });

  it('names the cookie once', () => {
    expect(THEME_COOKIE).toBe('shliff_theme');
    expect(THEME_MAX_AGE_SECONDS).toBe(31_536_000);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/theme"`.

- [ ] **Step 3: Write the parser**

`src/lib/theme.ts`:

```ts
/**
 * The theme choice, in the one place the server and the browser both read it.
 *
 * This module imports nothing. `next/headers` must never enter it: the client
 * toggle imports `THEME_COOKIE` from here, and pulling a server-only module
 * into the client bundle through a shared constant is a build error waiting
 * for the first person who adds one.
 */

export const THEME_COOKIE = 'shliff_theme';

/** A year. The choice is a preference, not a session. */
export const THEME_MAX_AGE_SECONDS = 31_536_000;

export type Theme = 'light' | 'dark';

/** Anything that is not one of the two themes means the OS decides (A13). */
export function parseTheme(value: string | undefined | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing layout test**

In `src/app/layout.test.tsx`, add the `next/headers` mock beneath the font mock:

```tsx
const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'shliff_theme' && cookieValue.current !== undefined
        ? { name, value: cookieValue.current }
        : undefined,
  }),
}));
```

and add a describe at the end of the file:

```tsx
describe('RootLayout theme', () => {
  /**
   * A13: the choice is on <html> before the first byte of body renders, so
   * there is no flash of the palette the reader did not choose.
   */
  it('puts the chosen theme on <html>', async () => {
    cookieValue.current = 'dark';
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBe('dark');
  });

  it('carries an explicit light choice too, so it can beat the OS preference', async () => {
    cookieValue.current = 'light';
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBe('light');
  });

  /**
   * No cookie means no attribute, which is what lets the guarded
   * `prefers-color-scheme` rule in tokens.css apply.
   */
  it('leaves the attribute off when nobody has chosen', async () => {
    cookieValue.current = undefined;
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBeUndefined();
  });

  it('ignores a cookie value that is not a theme', async () => {
    cookieValue.current = 'midnight';
    const element = (await RootLayout({ children: null })) as React.ReactElement<{
      'data-theme'?: string;
    }>;
    expect(element.props['data-theme']).toBeUndefined();
  });
});
```

Then make the four existing cases await the layout: change each `const element = RootLayout({ children: null }) as ...` to `const element = (await RootLayout({ children: null })) as ...` and each `it('...', () => {` to `it('...', async () => {`.

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/app/layout.test.tsx`
Expected: FAIL — the four new cases report `expected undefined to be 'dark'` (and so on), because `RootLayout` still ignores cookies. The four existing cases pass: awaiting a non-promise is harmless.

- [ ] **Step 7: Read the cookie in the root layout**

In `src/app/layout.tsx`, add the imports and replace the component:

```tsx
import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
```

```tsx
/**
 * A13. The theme is read from the cookie on the server and written onto
 * <html> before anything renders, so the first paint is already the palette
 * the reader chose. With no cookie the attribute is omitted entirely, which
 * is what lets tokens.css's guarded `prefers-color-scheme` rule decide.
 *
 * This is a request-time read, so it opts every route into dynamic rendering.
 * Every route here is already dynamic: they are all behind requireAdmin() and
 * they all read the database.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="he"
      dir="rtl"
      data-theme={theme ?? undefined}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/app/layout.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 9: Write the failing toggle test**

`src/components/theme-toggle.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/theme-toggle';

function stubPrefersDark(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
  }));
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.cookie = 'shliff_theme=; path=/; max-age=0';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns a chosen light theme dark, on the page and in the cookie', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.cookie).toContain('shliff_theme=dark');
  });

  it('turns a chosen dark theme light', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('shliff_theme=light');
  });

  /**
   * With no cookie the page is showing whatever the OS asked for, so the
   * first click has to turn *that* around — not the value the markup guessed.
   */
  it('turns the OS preference around when nobody has chosen yet', () => {
    stubPrefersDark(true);
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('shliff_theme=light');
  });

  it('turns a light OS preference around the other way', () => {
    stubPrefersDark(false);
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת ערכת צבעים' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.cookie).toContain('shliff_theme=dark');
  });

  /**
   * Both glyphs are in the markup and the stylesheet shows one, so the icon
   * is correct in the first paint without the server knowing the reader's OS.
   */
  it('renders both faces of the switch, and names itself in Hebrew', () => {
    const { container } = render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'החלפת ערכת צבעים' })).toBeDefined();
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

Run: `npx vitest run src/components/theme-toggle.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/theme-toggle"`.

- [ ] **Step 11: Write the toggle**

`src/components/theme-toggle.tsx`:

```tsx
'use client';

/**
 * A client component because it is a switch: it writes the cookie and flips
 * `data-theme` on <html> in the browser, so the palette changes on the click
 * rather than on a round trip. There is no server action here — the value is
 * a display preference, nothing reads it but CSS, and a navigation to change
 * a colour is a navigation nobody asked for.
 *
 * It holds no React state. The attribute on <html> *is* the state: the server
 * wrote it from the cookie for the first paint, and this button writes it
 * afterwards. Keeping a copy in a hook would be a second source of truth that
 * a soft navigation could put out of step.
 */

import { Icon } from './icon';
import { parseTheme, THEME_COOKIE, THEME_MAX_AGE_SECONDS, type Theme } from '@/lib/theme';
import styles from './theme-toggle.module.css';

/**
 * What the reader is looking at right now: their choice if they made one, and
 * otherwise whatever their OS asked for — which is what the guarded
 * `prefers-color-scheme` rule in tokens.css is showing them.
 */
function shownTheme(): Theme {
  const chosen = parseTheme(document.documentElement.dataset.theme);
  if (chosen) return chosen;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  function flip() {
    const next: Theme = shownTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.cookie =
      `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_MAX_AGE_SECONDS}; samesite=lax`;
  }

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.button}
        onClick={flip}
        aria-label="החלפת ערכת צבעים"
      >
        {/*
          Both glyphs ship and the stylesheet shows exactly one. The server
          cannot know the reader's OS preference, so choosing the glyph in JSX
          would mean guessing it — and a moon on a dark page is the guess
          being wrong in the first paint.
        */}
        <span className={styles.whenLight}><Icon name="moon" size={16} /></span>
        <span className={styles.whenDark}><Icon name="sun" size={16} /></span>
      </button>
    </div>
  );
}
```

`src/components/theme-toggle.module.css`:

```css
/**
 * `.row` is temporary: it gives the button somewhere to sit while the old nav
 * is still the shell. Plan 02 puts the button in the sidebar footer beside the
 * signed-in user (B1) and deletes this rule.
 */
.row {
  display: flex;
  justify-content: flex-end;
  padding-inline: var(--space-4);
  padding-block-start: var(--space-2);
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--control-h);
  block-size: var(--control-h);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.button:hover {
  background: var(--sunken);
  color: var(--ink);
}

/**
 * Which glyph is showing has to be decided by the same rules that decide the
 * palette, or the button will offer the theme the reader is already in. The
 * three cases are the three in tokens.css, in the same order.
 */
.whenDark { display: none; }
.whenLight { display: inline-flex; }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .whenDark { display: inline-flex; }
  :root:not([data-theme='light']) .whenLight { display: none; }
}

:root[data-theme='dark'] .whenDark { display: inline-flex; }
:root[data-theme='dark'] .whenLight { display: none; }
```

- [ ] **Step 12: Run it and watch it pass**

Run: `npx vitest run src/components/theme-toggle.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 13: Give the toggle somewhere to live**

`src/app/(admin)/layout.tsx`, replacing the whole file:

```tsx
import { Nav } from './nav';
import { ThemeToggle } from '@/components/theme-toggle';
import styles from './layout.module.css';

/**
 * The toggle sits here, above the page, until Plan 02 replaces this shell:
 * B1 puts it in the sidebar footer beside the signed-in user. It is mounted
 * now rather than later so that the theme this plan builds is switchable the
 * day the plan lands, instead of being a component with a test and no home.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.ground}>
      <Nav />
      <ThemeToggle />
      {children}
    </div>
  );
}
```

- [ ] **Step 14: Run the suite that renders**

Run: `npx vitest run src/app src/components src/lib/theme.test.ts`
Expected: PASS. Nothing renders `AdminLayout` in a test, so this is a regression net over the pages and components that do render.

- [ ] **Step 15: Check the types**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 16: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts src/components/theme-toggle.tsx src/components/theme-toggle.module.css src/components/theme-toggle.test.tsx src/app/layout.tsx src/app/layout.test.tsx "src/app/(admin)/layout.tsx"
git commit -F - <<'MSG'
feat(ui): the theme is a cookie, so the first paint is already right

A13. The root layout reads shliff_theme and writes it onto <html> as
data-theme before anything renders; with no cookie the attribute is omitted
and the guarded prefers-color-scheme rule decides. The toggle is a client
component because it is a switch: it writes the cookie and the attribute in
the browser, and holds no state of its own, because the attribute is the
state.

Both glyphs ship and the stylesheet shows one. The server cannot know the
reader's OS preference, and a moon on a dark page is that guess being wrong
in the first paint.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: One place makes an amount, one place makes a date

**Files:**
- Create: `src/lib/dates.ts`, `src/components/format.tsx`
- Modify: `src/lib/money.ts:22-28` (after `formatILS`)
- Test: `src/lib/dates.test.ts` (create), `src/components/format.test.tsx` (create), `src/lib/money.test.ts` (extend)

**Interfaces:**
- Consumes: `formatILS` from `@/lib/money`.
- Produces:
  - `export const SHEKEL = '₪'`
  - `export function formatShekels(agorot: number): string`
  - `export function formatDateShort(at: Date): string` — `07/09/26`
  - `export function formatDateFull(at: Date): string` — `07/09/2026`
  - `export function formatDateProse(at: Date): string` — `7 בספט׳ 2026`
  - `export function formatTime(at: Date): string` — `19:30`
  - `export function formatDateTime(at: Date): string` — `07/09/26 19:30`
  - `export function Money(props: { agorot: number }): React.ReactElement`
  - `export function DateText(props: { at: Date; form?: 'short' | 'full' | 'prose' | 'time' | 'datetime' }): React.ReactElement`

**What stays.** `formatILS` keeps its exact behaviour and its exported name: fourteen files call it, and each of those files loses its `{formatILS(x)} ₪` for a `<Money>` in its own screen's plan, not here. `formatShekels` is the one place the symbol is attached, and `<Money>` the one place the isolate is opened.

**Why the dates are hand-built.** `toLocaleDateString('he-IL')` gives `7.9.2026` — dots, and no zero padding. A12 asks for slashes and two-digit fields, because that is what Excel and the banks show and this screen sits next to both. `en-GB` with `day: '2-digit', month: '2-digit'` is the locale whose numeric date *is* `DD/MM/YYYY`, so the parts come from there and the separators are ours. The month names are a local table rather than ICU's, so the prose form is `7 בספט׳ 2026` on every Node build rather than whatever the runner's ICU says this year.

**Why the timezone is named.** `getDate()` reads the runner's clock, and half of this data is a `timestamp with time zone` from Postgres. A payment made at 01:10 on a Monday in Israel is 22:10 on the Sunday in UTC, and a table that shows the wrong day is worse than a table with no day.

- [ ] **Step 1: Write the failing money test**

Append to `src/lib/money.test.ts`, inside `describe('money', ...)`:

```ts
  it('attaches the symbol in one place, last', () => {
    expect(formatShekels(120000)).toBe('1,200 ₪');
    expect(formatShekels(3374055)).toBe('33,740.55 ₪');
    expect(formatShekels(0)).toBe('0 ₪');
  });

  /**
   * A11. The sign and the first digit must be one uninterrupted run. If a
   * '-' is ever prepended to an already-formatted amount in JSX, bidi
   * reordering floats it to the far side of the number and a debt reads as a
   * credit. Formatting the signed number in one call is what prevents it.
   */
  it('never lets a minus sign come off its digits', () => {
    const text = formatShekels(-120000);
    expect(text.endsWith(' ₪')).toBe(true);
    expect(text.slice(0, text.length - 2)).toMatch(/^[-−]\d/);
  });
```

and add `formatShekels` to the import at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/money.test.ts`
Expected: FAIL — `TypeError: formatShekels is not a function`. The six existing cases still pass.

- [ ] **Step 3: Add the one place the symbol is attached**

Append to `src/lib/money.ts`:

```ts
export const SHEKEL = '₪';

/**
 * A11. The one place an amount and its symbol are put together.
 *
 * The number — sign included — is formatted in a single `Intl` call, so the
 * minus stays welded to the digits. The symbol goes last, and the whole thing
 * is rendered inside a `<bdi>` by `Money` in `src/components/format.tsx`.
 * Direction is carried by the column an amount sits in, never by its sign.
 *
 * Never write `` `${formatILS(x)} ₪` `` at a call site. That is the same
 * string by luck, and the luck runs out the first time somebody writes the
 * minus separately.
 */
export function formatShekels(agorot: number): string {
  return `${formatILS(agorot)} ${SHEKEL}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/money.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing date test**

`src/lib/dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  formatDateShort, formatDateFull, formatDateProse, formatTime, formatDateTime,
} from '@/lib/dates';

// 19:30 on 7 September 2026 in the camp's timezone (IDT, UTC+3).
const evening = new Date('2026-09-07T16:30:00Z');

describe('dates', () => {
  it('writes a table date with slashes, the way Excel and the banks do', () => {
    expect(formatDateShort(evening)).toBe('07/09/26');
    expect(formatDateFull(evening)).toBe('07/09/2026');
  });

  it('writes a prose date in Hebrew', () => {
    expect(formatDateProse(evening)).toBe('7 בספט׳ 2026');
    expect(formatDateProse(new Date('2026-12-25T10:00:00Z'))).toBe('25 בדצמ׳ 2026');
    expect(formatDateProse(new Date('2026-03-01T10:00:00Z'))).toBe('1 במרץ 2026');
  });

  it('writes a time on the 24-hour clock', () => {
    expect(formatTime(evening)).toBe('19:30');
    expect(formatDateTime(evening)).toBe('07/09/26 19:30');
  });

  /**
   * The day is the camp's day, not the runner's. 22:10 UTC on the 6th is
   * already the 7th in Israel, and a test that passes only where the CI box
   * happens to sit is not a test.
   */
  it("reads the day in the camp's timezone, not the process's", () => {
    expect(formatDateShort(new Date('2026-09-06T22:10:00Z'))).toBe('07/09/26');
    expect(formatTime(new Date('2026-09-06T22:10:00Z'))).toBe('01:10');
  });

  /** And it is a real timezone, not a hardcoded offset: winter is UTC+2. */
  it('follows the summer-time change', () => {
    const winter = new Date('2026-01-31T22:30:00Z');
    expect(formatDateShort(winter)).toBe('01/02/26');
    expect(formatTime(winter)).toBe('00:30');
  });

  it('pads a single-digit day and month in the table forms only', () => {
    const early = new Date('2026-04-05T09:00:00Z');
    expect(formatDateShort(early)).toBe('05/04/26');
    expect(formatDateProse(early)).toBe('5 באפר׳ 2026');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/dates"`.

- [ ] **Step 7: Write the date helpers**

`src/lib/dates.ts`:

```ts
/**
 * A12. Every date and every time on a screen is made here.
 *
 * Tables get `DD/MM/YY` or `DD/MM/YYYY` with slashes, because that is what the
 * workbook beside the screen and the bank statement beside that both show.
 * `toLocaleDateString('he-IL')` gives `7.9.2026` — dots and no padding — so
 * the parts come from `en-GB`, the locale whose numeric date already is
 * `DD/MM/YYYY`, and the separators are ours.
 *
 * Prose gets `7 בספט׳ 2026` from the table below rather than from ICU, so the
 * string does not change under the platform.
 *
 * Everything is read in the camp's timezone. Half of this data is a
 * `timestamp with time zone` out of Postgres, and a payment recorded at 01:10
 * on a Monday in Israel is 22:10 on the Sunday in UTC. A table that shows the
 * wrong day is worse than a table with no day at all.
 */

const CAMP_TIME_ZONE = 'Asia/Jerusalem';

/** Gregorian months, Hebrew, in the form a prose date needs: "7 בספט׳ 2026". */
const MONTHS = [
  'בינו׳', 'בפבר׳', 'במרץ', 'באפר׳', 'במאי', 'ביוני',
  'ביולי', 'באוג׳', 'בספט׳', 'באוק׳', 'בנוב׳', 'בדצמ׳',
] as const;

const DATE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMP_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * `hourCycle: 'h23'` and not `hour12: false`. The two are not the same: in
 * several ICU builds `hour12: false` resolves to the h24 cycle, where midnight
 * is `24:30` rather than `00:30`. A12 asks for a 24-hour clock, and h23 is the
 * one that starts the day at 00.
 */
const TIME_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function part(
  formatter: Intl.DateTimeFormat,
  at: Date,
  type: Intl.DateTimeFormatPartTypes,
): string {
  const found = formatter.formatToParts(at).find((piece) => piece.type === type);
  if (!found) throw new Error(`no ${type} in the formatted date`);
  return found.value;
}

/** `07/09/26` — the table form. */
export function formatDateShort(at: Date): string {
  return `${part(DATE_PARTS, at, 'day')}/${part(DATE_PARTS, at, 'month')}/${part(DATE_PARTS, at, 'year').slice(-2)}`;
}

/** `07/09/2026` — the table form where the year is doing work. */
export function formatDateFull(at: Date): string {
  return `${part(DATE_PARTS, at, 'day')}/${part(DATE_PARTS, at, 'month')}/${part(DATE_PARTS, at, 'year')}`;
}

/** `7 בספט׳ 2026` — the prose form, with no leading zero on the day. */
export function formatDateProse(at: Date): string {
  const month = MONTHS[Number(part(DATE_PARTS, at, 'month')) - 1];
  return `${Number(part(DATE_PARTS, at, 'day'))} ${month} ${part(DATE_PARTS, at, 'year')}`;
}

/** `19:30`. Twenty-four hours, always. */
export function formatTime(at: Date): string {
  return `${part(TIME_PARTS, at, 'hour')}:${part(TIME_PARTS, at, 'minute')}`;
}

/** `07/09/26 19:30` — a shift's "when" is never just a day. */
export function formatDateTime(at: Date): string {
  return `${formatDateShort(at)} ${formatTime(at)}`;
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Write the failing component test**

`src/components/format.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money, DateText } from '@/components/format';

describe('Money', () => {
  /**
   * The isolate is the behaviour under test, so the assertion names the
   * element. A11: an amount inside a Hebrew sentence reorders without one,
   * and the symbol ends up leading the number.
   */
  it('puts the whole amount inside one bidi isolate', () => {
    const { container } = render(<Money agorot={120000} />);
    const isolate = container.querySelector('bdi');
    expect(isolate?.textContent).toBe('1,200 ₪');
  });

  it('keeps a negative amount whole', () => {
    const { container } = render(<Money agorot={-45050} />);
    expect(container.querySelectorAll('bdi')).toHaveLength(1);
    expect(container.querySelector('bdi')?.textContent).toMatch(/^[-−]450\.50 ₪$/);
  });

  it('reads as one amount beside Hebrew words', () => {
    render(<p>נותרו <Money agorot={240000} /> לגבייה</p>);
    expect(screen.getByText('2,400 ₪')).toBeDefined();
  });
});

describe('DateText', () => {
  const evening = new Date('2026-09-07T16:30:00Z');

  it('writes the table form by default', () => {
    const { container } = render(<DateText at={evening} />);
    expect(container.querySelector('bdi')?.textContent).toBe('07/09/26');
  });

  it('writes each form it is asked for', () => {
    expect(render(<DateText at={evening} form="full" />)
      .container.querySelector('bdi')?.textContent).toBe('07/09/2026');
    expect(render(<DateText at={evening} form="prose" />)
      .container.querySelector('bdi')?.textContent).toBe('7 בספט׳ 2026');
    expect(render(<DateText at={evening} form="time" />)
      .container.querySelector('bdi')?.textContent).toBe('19:30');
    expect(render(<DateText at={evening} form="datetime" />)
      .container.querySelector('bdi')?.textContent).toBe('07/09/26 19:30');
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

Run: `npx vitest run src/components/format.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/format"`.

- [ ] **Step 11: Write the two wrappers**

`src/components/format.tsx`:

```tsx
/**
 * The two components that put a figure on a screen.
 *
 * Both do one thing: open a bidi isolate around a string that the library
 * already formatted. Nothing here decides what an amount or a date looks
 * like — `src/lib/money.ts` and `src/lib/dates.ts` do — and nothing anywhere
 * else opens the isolate.
 *
 * Server components. A figure is not interactive.
 */

import { formatShekels } from '@/lib/money';
import {
  formatDateShort, formatDateFull, formatDateProse, formatTime, formatDateTime,
} from '@/lib/dates';

/** A11: `1,200 ₪`, symbol last, sign welded to the digits, isolated. */
export function Money({ agorot }: { agorot: number }) {
  return <bdi>{formatShekels(agorot)}</bdi>;
}

export type DateForm = 'short' | 'full' | 'prose' | 'time' | 'datetime';

const FORMS: Record<DateForm, (at: Date) => string> = {
  short: formatDateShort,
  full: formatDateFull,
  prose: formatDateProse,
  time: formatTime,
  datetime: formatDateTime,
};

/** A12. `short` is the table form, which is where most dates are. */
export function DateText({ at, form = 'short' }: { at: Date; form?: DateForm }) {
  return <bdi>{FORMS[form](at)}</bdi>;
}
```

- [ ] **Step 12: Run it and watch it pass**

Run: `npx vitest run src/components/format.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 13: Check the types**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 14: Run the whole suite once**

Run: `npx vitest run`
Expected: PASS. Read the test COUNT: it must be the count before this plan started plus 51 — 13 in `tokens.test.ts` from Task 1, 4 more from Task 2, 2 in `layout.test.tsx` from Task 3, 7 in `icon.test.tsx`, 3 in `theme.test.ts`, 4 more in `layout.test.tsx`, 5 in `theme-toggle.test.tsx`, 2 in `money.test.ts`, 6 in `dates.test.ts`, 5 in `format.test.tsx`. A missing count is a failed run, whatever the exit code says.

- [ ] **Step 15: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts src/lib/dates.ts src/lib/dates.test.ts src/components/format.tsx src/components/format.test.tsx
git commit -F - <<'MSG'
feat(ui): one place makes an amount, one place makes a date

A11: formatShekels is the only place a shekel sign is attached, and <Money>
the only place the bidi isolate is opened. The signed number is formatted in
one Intl call so the minus cannot come off its digits — the failure that turns
a debt into a credit in an RTL run.

A12: dates are DD/MM/YY and DD/MM/YYYY with slashes, the way the workbook and
the bank statement beside the screen show them, and "7 בספט׳ 2026" in prose
from a local month table rather than from whatever ICU the runner has. Every
part is read in Asia/Jerusalem: 22:10 UTC on the 6th is the 7th in the camp.

formatILS keeps its name and behaviour; the fourteen call sites move to
<Money> in their own screens' plans.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-review

### Spec coverage

| requirement | where it lands |
|---|---|
| **A1** — one `src/app/tokens.css`, imported by `globals.css`, light on `:root`, dark under both the guarded media query and `[data-theme='dark']` | Task 1, steps 3 and 5; pinned by the first four cases of `tokens.test.ts` |
| **A2** — the light palette, exact values | Task 1, step 3; pinned value by value by the `LIGHT` table in `tokens.test.ts` |
| **A3** — the dark palette, exact values | Task 1, step 3; pinned value by value by the `DARK` table against *both* dark blocks, plus the same-names check |
| **A4** — chart palette unchanged, scoped to `.viz`, track `#EEEAE5` in light | Task 2. `--viz-track` is the only chart value in `tokens.css`; the three series stay in `charts.module.css`, and the test asserts the `.viz` block never names `--brand` or `--flare` |
| **A5** — Heebo 400/500/600/700 with tabular numerals; Frank Ruhl Libre reduced to wordmark and sign-in; IBM Plex Mono for cell references | Task 3 loads the three faces at those weights; Task 1 puts `font-variant-numeric: tabular-nums` on `bdi`, which is where every number on this platform already lives; Task 2 takes the last `var(--font-display)` out of `src/components`. The six remaining `var(--font-display)` uses are in screen CSS Modules owned by later plans and by lane B — recorded as a Global Constraint, not swept here |
| **A6** — the Hebrew-corrected type scale | Task 1, step 3 (`--text-*`, `--leading-*`); the cell 14/20 and body 14.5/22 pairs are asserted |
| **A7** — 4px spacing, the radius bands, borders for structure and shadows for overlays | Task 1, step 3 (`--space-1..8`, `--radius-*`, the two `--shadow-*`); the comment states that shadows are overlay-only |
| **A8** — density heights | Task 1, step 3 (`--row-head`, `--row`, `--control-h`, `--control-h-lg`, `--tap-min`, `--input-font-phone`) and `:root[data-density='compact']` |
| **A9** — the focus ring, never removed | Task 1, step 5; the test asserts the rule is present and that `outline: none` and `outline: 0` appear nowhere in `globals.css` |
| **A10** — logical properties, with the numeric column as the one exception | Task 1, step 5. `globals.css` is written entirely in logical properties, and the exception ships as the single global `.num` class, asserted; the test also forbids `text-align: left` |
| **A11** — money from one helper, symbol last, inside `<bdi>`, sign never separated | Task 6: `formatShekels`, `<Money>`, and the negative-sign case |
| **A12** — `DD/MM/YY`, `DD/MM/YYYY`, the prose form, 24-hour times | Task 6: `formatDateShort`, `formatDateFull`, `formatDateProse`, `formatTime`, `formatDateTime`, all in `Asia/Jerusalem` |
| **A13** — cookie read on the server, `data-theme` on `<html>`, a toggle, OS preference by default | Task 5 |
| **C14** — `Icon`: one component, a named record, 14/15/16/20, stroke 1.75, `aria-hidden` unless labelled, directional icons mirrored | Task 4 |

**Two things A12 asks for that this plan records rather than builds.** "Calendars start on Sunday" has nothing to render against: no screen in the app draws a calendar today. It is in Global Constraints for the first screen plan that ships a date picker — which, per D5, is `דמי קאמפ`. And the `he-IL` long prose form (`7 בספטמבר 2026`) is not built, because the spec's own example is the short one.

### Placeholder scan

- No "TBD", no "similar to Task N", no "add error handling", no "etc." in a code block.
- Every function a step names is defined by a step: `formatShekels` (Task 6, step 3), `formatDateShort` / `formatDateFull` / `formatDateProse` / `formatTime` / `formatDateTime` (Task 6, step 7), `Money` / `DateText` (Task 6, step 11), `parseTheme` (Task 5, step 3), `ThemeToggle` (Task 5, step 11), `Icon` (Task 4, step 3). `formatILS`, `toAgorot`, `fromAgorot`, `sumAgorot` and `isBlank` already exist and are unchanged.
- Every token a CSS block reads is declared in Task 1, step 3. `--font-body` and `--font-mono` come from `next/font` in Task 3; `--font-display` is declared there and read only by `nav.module.css` and the screen modules later plans own.
- The one deliberate forward reference is `styles.row` in `theme-toggle.module.css`, labelled in the file as temporary and assigned to Plan 02 in both the Dependencies section and the component's own comment.
- The icon record is sixty-five complete entries copied from `scratchpad/mock/icons.mjs`; no name in `DIRECTIONAL` is absent from it.

### Type consistency

- `agorot: number` everywhere, integer, never a float — `formatShekels` takes what `formatILS` takes, and `<Money agorot>` passes it straight through.
- `Theme = 'light' | 'dark'`. `parseTheme` returns `Theme | null`, and `null` is rendered as `data-theme={theme ?? undefined}` so React omits the attribute rather than writing `data-theme="null"`. The test for the no-cookie case asserts `undefined`, which is what distinguishes the two.
- `RootLayout` becomes `async` in Task 5 and returns `Promise<React.ReactElement>`; the four pre-existing cases in `layout.test.tsx` are changed to `async` and `await` in the same step, which is the only reason that file is touched twice.
- `IconName` is `keyof typeof ICON_PATHS` over an `as const` record, so it is the union of sixty-five string literals and a typo is a compile error. `IconSize` is `14 | 15 | 16 | 20` and nothing else; `DIRECTIONAL` is a `ReadonlySet<IconName>`, so a name in it that leaves the record fails `tsc`.
- `DateForm` is a closed union and `FORMS` is a `Record<DateForm, (at: Date) => string>`, so adding a form without a formatter fails `tsc`.
- Every date helper takes a `Date` — never a string, never a Postgres `timestamp` string. Drizzle already hands back `Date` for `timestamp` columns.
- `Icon`, `Money` and `DateText` are Server Components with no `'use client'`; `ThemeToggle` is the only client component this plan adds and carries the comment saying why (R7).
