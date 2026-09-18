/**
 * @vitest-environment jsdom
 *
 * Its own file, and it renders `RawGrid` exactly once. Both facts are
 * load-bearing, and the first version of this assertion had neither.
 *
 * Each row of the grid renders as two `<tr>`s — the cells, and where there is
 * one, the reason — so the pair needs a keyed `<Fragment>` rather than the
 * `<>` shorthand, which takes no key. React reports a missing key **once per
 * owner component** and then never again in that module registry, and vitest
 * **clears a spy's call history between tests**. Together those two mean an
 * assertion written anywhere but the first render in a file sees an empty
 * spy and passes against a component with no keys at all: the earlier version
 * of this test stayed green with every `key` deleted.
 *
 * Vitest isolates each test file, so rendering the grid once here, in the
 * first test of its own file, is the only place the warning can still be
 * observed. `KeylessProbe` is the positive control — a different owner
 * component, so React's dedupe does not cover it — and it proves the spy is
 * live before the real assertion is trusted.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { GridRow } from '@/lib/import/review';
import { RawGrid } from './raw-grid';

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

const KEY_WARNING = /unique "key"/;

function keyWarnings(): string[] {
  return consoleError.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => KEY_WARNING.test(message));
}

/** An owner React has not warned about yet, so the dedupe cannot hide it. */
function KeylessProbe() {
  return <ul>{[1, 2].map((n) => <><li>{n}</li></>)}</ul>;
}

const rows: GridRow[] = [
  { sheetRow: 3, cells: ['תאריך', 'פירוט'], state: 'header', message: null },
  { sheetRow: 4, cells: ['05/07/26', 'תשלום גנרטור'], state: 'written', message: null },
  { sheetRow: 5, cells: ['14/07/26', 'נועה ל.'], state: 'noted', message: 'שם לא זוהה' },
  { sheetRow: 6, cells: ['', 'סה״כ'], state: 'refused', message: 'שורת סיכום' },
];

describe('RawGrid keys', () => {
  it('renders each row and its reason without a missing-key warning', () => {
    render(<KeylessProbe />);
    expect(keyWarnings()).toHaveLength(1);
    consoleError.mockClear();

    render(<RawGrid uploadId="u1" blockId="b1" left={1} rows={rows} filter="all" />);
    expect(keyWarnings()).toEqual([]);
  });
});
