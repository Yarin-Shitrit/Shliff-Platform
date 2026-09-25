/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { KindDefaults } from '@/lib/site/defaults';
import type { ItemShape } from '@/lib/site/derive';

const { createPlanAction, setPlotAction } = vi.hoisted(() => ({ createPlanAction: vi.fn(), setPlotAction: vi.fn() }));
vi.mock('./actions', () => ({ createPlanAction, setPlotAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import { PlotDrawer } from './plot-drawer';

/*
 * The plot drawer's "would be outside" count, with ropes (Review Focus #4):
 * the same footprint the editor flags. An 8 × 8 m net at (4, 4) m on its
 * kind's 3 m height: its cloth ends at 12 m, its 45° ropes at 15 m. A 14 m
 * wide plot keeps the cloth and cuts the ropes.
 */
const PLAN = { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, notes: null };
const NET: ItemShape = {
  id: 'n1', kind: 'shade', xCm: 400, yCm: 400, widthCm: 800, depthCm: 800, insetCm: 50, heightCm: null, ropeAngleDeg: null,
};
const CAMP_45: KindDefaults = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };

function renderDrawer(defaults?: KindDefaults) {
  render(
    <ToastProvider>
      <PlotDrawer seasonId="s26" seasonName="ברן 26" plan={PLAN} items={[NET]} defaults={defaults} closeHref="/site?season=s26" />
    </ToastProvider>,
  );
  // The label carries a decorative " *" (the field is required), so match its start.
  fireEvent.change(screen.getByLabelText(/^רוחב במטרים/), { target: { value: '14' } });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the plot drawer, with a net’s ropes', () => {
  it('counts a net whose ropes the new fence would cut, with the camp’s angle', () => {
    renderDrawer(CAMP_45);
    expect(screen.getByText('1 פריטים יהיו מחוץ למגרש החדש. הם לא יזוזו לבד.')).toBeTruthy();
  });

  it('counts it by its cloth while the camp has no angle', () => {
    renderDrawer();
    expect(screen.getByText('כל הפריטים יישארו בתוך המגרש')).toBeTruthy();
  });
});
