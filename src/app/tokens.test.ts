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
   * against the second copy drifting from the first — names and values,
   * across every declared token, not only the ones listed in DARK.
   */
  it('gives the two dark blocks the same tokens, names and values', () => {
    const css = tokens();
    const byPreference = block(css, ":root:not([data-theme='light'])");
    const byAttribute = block(css, ":root[data-theme='dark']");
    expect(declaredNames(byPreference)).toEqual(declaredNames(byAttribute));
    for (const name of declaredNames(byPreference)) {
      const bare = name.slice(2);
      expect(`${name}: ${tokenValue(byPreference, bare)}`)
        .toBe(`${name}: ${tokenValue(byAttribute, bare)}`);
    }
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

  it('keeps the four pre-redesign global classes, re-pointed at the new tokens', () => {
    const css = globals();
    expect(block(css, '.card {')).toContain('var(--panel)');
    expect(block(css, '.muted {')).toContain('var(--ink-3)');
    expect(block(css, '.badge-warn {')).toContain('var(--bad)');
    expect(block(css, '.scroll-x {')).toContain('overflow-x');
  });
});

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
