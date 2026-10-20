/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { PlotSides } from '@/lib/site/geometry';

const { createPlanAction, setPlotAction } = vi.hoisted(() => ({ createPlanAction: vi.fn(), setPlotAction: vi.fn() }));
vi.mock('./actions', () => ({ createPlanAction, setPlotAction }));
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

import { NORTH_INVALID, PLOT_SIDE_INVALID, PLOT_SIDES_OPEN } from './failure-messages';
import { PlotDrawer } from './plot-drawer';
import { isOwnPlotSave } from './editor/own-plot-saves';

const PLAN = { id: 'p1', widthCm: 2600, depthCm: 2400, sides: null as PlotSides | null, gridCm: 50, northDeg: 30, notes: null };

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
  setPlotAction.mockResolvedValue({ ok: true, value: 8 });
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
      expect(setPlotAction).toHaveBeenCalledWith('p1', { widthCm: 2600, depthCm: 2400, sides: null, gridCm: 50, northDeg: 15, notes: null });
    });
    expect(refresh).toHaveBeenCalled();
    // This tab saved version 8 of the plot: the editor, handed version 8, knows it was the lead's own save.
    expect(isOwnPlotSave('p1', 8)).toBe(true);
    expect(isOwnPlotSave('p1', 9)).toBe(false);
  });

  it('start a new map with north up', async () => {
    renderDrawer(null);
    fireEvent.click(screen.getByRole('button', { name: 'יצירת המפה' }));
    await waitFor(() => {
      expect(createPlanAction).toHaveBeenCalledWith('s26', expect.objectContaining({ northDeg: 0 }));
    });
  });
});

describe('a plot with four sides', () => {
  const CAMP = { northCm: 3300, southCm: 3500, westCm: 2500, eastCm: 2500 };
  const shape = () => screen.getByLabelText('צורת המגרש') as HTMLSelectElement;
  const side = (name: string) => screen.getByLabelText(new RegExp(`^${name} במטרים`)) as HTMLInputElement;
  const typeSides = (sides: Record<'צפון' | 'דרום' | 'מערב' | 'מזרח', string>) => {
    for (const [name, value] of Object.entries(sides)) fireEvent.change(side(name), { target: { value } });
  };

  it('offers four sides in place of width and depth, previews the box they fit in, and sends both', async () => {
    renderDrawer();
    expect(shape().value).toBe('rect');
    fireEvent.change(shape(), { target: { value: 'four' } });
    // The sides start as the rectangle they replace, so switching alone changes nothing.
    expect(side('צפון').value).toBe('26');
    expect(side('דרום').value).toBe('26');
    expect(side('מערב').value).toBe('24');
    expect(side('מזרח').value).toBe('24');
    expect(screen.queryByLabelText(/^רוחב במטרים/)).toBeNull();
    typeSides({ צפון: '33', דרום: '35', מערב: '25', מזרח: '25' });
    expect(screen.getByText('שטח המגרש: 849.3 מ״ר')).toBeTruthy();
    expect(screen.getByText('נכנס בתוך 35 × 24.98 מ׳')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => {
      expect(setPlotAction).toHaveBeenCalledWith('p1', {
        widthCm: 3500, depthCm: 2498, sides: CAMP, gridCm: 50, northDeg: 30, notes: null,
      });
    });
  });

  it('says in Hebrew when the four sides cannot close, before anything is sent', () => {
    renderDrawer();
    fireEvent.change(shape(), { target: { value: 'four' } });
    typeSides({ צפון: '30', דרום: '30', מערב: '20', מזרח: '21' });
    expect(screen.getByText(PLOT_SIDES_OPEN)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    // Said twice: in the preview before the save, and as the refusal after it.
    expect(screen.getAllByText(PLOT_SIDES_OPEN)).toHaveLength(2);
    expect(setPlotAction).not.toHaveBeenCalled();
    // A side that is a typo is the side refusal, as for a rectangle.
    typeSides({ צפון: '0.5', דרום: '30', מערב: '20', מזרח: '20' });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(screen.getAllByText(PLOT_SIDE_INVALID)).toHaveLength(2);
    expect(setPlotAction).not.toHaveBeenCalled();
  });

  it('opens on the four sides a plan has, and clears them when the lead goes back to a rectangle', async () => {
    renderDrawer({ ...PLAN, widthCm: 3500, depthCm: 2498, sides: CAMP });
    expect(shape().value).toBe('four');
    expect(side('צפון').value).toBe('33');
    expect(side('דרום').value).toBe('35');
    fireEvent.change(shape(), { target: { value: 'rect' } });
    // The rectangle offered is the box the fence fit in.
    expect((screen.getByLabelText(/^רוחב במטרים/) as HTMLInputElement).value).toBe('35');
    expect((screen.getByLabelText(/^עומק במטרים/) as HTMLInputElement).value).toBe('24.98');
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => {
      expect(setPlotAction).toHaveBeenCalledWith('p1', {
        widthCm: 3500, depthCm: 2498, sides: null, gridCm: 50, northDeg: 30, notes: null,
      });
    });
  });
});
