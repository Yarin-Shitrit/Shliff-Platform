/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';

const { createPlanAction, setPlotAction } = vi.hoisted(() => ({ createPlanAction: vi.fn(), setPlotAction: vi.fn() }));
vi.mock('./actions', () => ({ createPlanAction, setPlotAction }));
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

import { NORTH_INVALID } from './failure-messages';
import { PlotDrawer } from './plot-drawer';

const PLAN = { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 30, notes: null };

function renderDrawer(plan: typeof PLAN | null = PLAN) {
  render(
    <ToastProvider>
      <PlotDrawer seasonId="s26" seasonName="ברן 26" plan={plan} items={[]} closeHref="/site?season=s26" />
    </ToastProvider>,
  );
}

const north = () => screen.getByLabelText('כיוון הצפון') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  setPlotAction.mockResolvedValue({ ok: true });
  createPlanAction.mockResolvedValue({ ok: true, value: 'p1' });
});

describe('the plot settings', () => {
  it('ask for north in whole degrees, starting from the plan’s own', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'הגדרות המגרש' })).toBeTruthy();
    expect(north().value).toBe('30');
    // Since N1 the compass needle and "north up" read it too: the hint says every use, not "only shade".
    expect(screen.getByText(/משמש לצל לפי שעה, למחט המצפן ולכפתור ״צפון למעלה״\./)).toBeTruthy();
    expect(screen.queryByText(/משמש רק לצל לפי שעה/)).toBeNull();
  });

  it('refuse a north that is not a whole degree from 0 to 359, in Hebrew, and send nothing', () => {
    renderDrawer();
    for (const text of ['360', '12.5', '-1', '']) {
      fireEvent.change(north(), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
      expect(screen.getByText(NORTH_INVALID)).toBeTruthy();
    }
    expect(setPlotAction).not.toHaveBeenCalled();
  });

  it('send the north with the plot, and refresh the page', async () => {
    renderDrawer();
    fireEvent.change(north(), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => {
      expect(setPlotAction).toHaveBeenCalledWith('p1', { widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 15, notes: null });
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('start a new map with north up', async () => {
    renderDrawer(null);
    fireEvent.click(screen.getByRole('button', { name: 'יצירת המפה' }));
    await waitFor(() => {
      expect(createPlanAction).toHaveBeenCalledWith('s26', expect.objectContaining({ northDeg: 0 }));
    });
  });
});
