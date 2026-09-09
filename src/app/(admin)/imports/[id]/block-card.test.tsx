/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
/** `./actions` is a `'use server'` module that imports `@/db` at load time. */
vi.mock('./actions', () => ({ confirmBlock: vi.fn() }));

import { BlockCard } from './block-card';

function renderCard(overrides: Partial<React.ComponentProps<typeof BlockCard>> = {}) {
  return render(
    <BlockCard
      blockId="b1"
      sheetName="סיכום כללי"
      top={1}
      left={1}
      bottom={5}
      right={4}
      archetype="ledger"
      confidence={0.9}
      mappingSource="rules"
      columnMap={[
        { column: 1, field: 'date', confidence: 1 },
        { column: 2, field: 'outflow', confidence: 1 },
      ]}
      rawGrid={[['תאריך', 'סכום']]}
      needsReview={false}
      confirmedBy={null}
      confirmedAt={null}
      {...overrides}
    />,
  );
}

/**
 * The admin UI is a single RTL paragraph flow. Latin identifiers, A1 column
 * letters, timestamps and the `→` in the column map are all neutral or LTR
 * runs inside it, and without an isolate the bidi algorithm reorders them
 * against the surrounding Hebrew — "A1:D5" renders as "D5:A1", and the two
 * halves of a timestamp swap. Each such run must sit in its own `<bdi>`.
 */
describe('BlockCard bidi isolation', () => {
  it('isolates the A1 range from the Hebrew sheet name beside it', () => {
    const { container } = renderCard();
    const range = screen.getByText('A1:D5');
    expect(range.tagName).toBe('BDI');
    expect(container.querySelectorAll('bdi').length).toBeGreaterThan(0);
  });

  it('isolates the column map, which mixes Hebrew, Latin and an arrow', () => {
    renderCard();
    const mapping = screen.getByText('A → date · B → outflow');
    expect(mapping.tagName).toBe('BDI');
  });

  it('isolates the confirming email and timestamp inside the Hebrew note', () => {
    renderCard({
      confirmedBy: 'admin@example.com',
      confirmedAt: new Date(Date.UTC(2026, 8, 9, 22, 44)),
    });
    expect(screen.getByText('admin@example.com').tagName).toBe('BDI');
    expect(screen.getByText('2026-09-09 22:44').tagName).toBe('BDI');
  });

  it('leaves pure-Hebrew runs unwrapped', () => {
    renderCard({ columnMap: [] });
    expect(screen.getByText('לא זוהו עמודות באופן אוטומטי.').tagName).toBe('P');
  });
});
