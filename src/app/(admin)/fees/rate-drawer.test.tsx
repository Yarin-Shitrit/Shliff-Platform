/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const { setFlatRateAction } = vi.hoisted(() => ({
  setFlatRateAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ setFlatRateAction }));

import { RateDrawer } from './rate-drawer';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

function renderDrawer(over: Partial<Parameters<typeof RateDrawer>[0]> = {}) {
  return render(
    <RateDrawer
      seasonId={SEASON}
      seasonName="ברן 26"
      view="unpaid"
      flatRateAgorot={120000}
      issued={{ count: 3, withPayments: 1 }}
      {...over}
    />,
  );
}

describe('RateDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens on the rate the season charges now, and names the season', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'התעריף של ברן 26' })).toBeTruthy();
    expect((screen.getByLabelText('דמי קאמפ לאדם') as HTMLInputElement).value).toBe('1200');
  });

  /*
   * The decision about the dues already out is stated both ways, with the
   * count, before the button — never a checkbox over a number nobody saw.
   */
  it('says the issued dues stay where they are until the box is ticked', () => {
    renderDrawer();
    expect(screen.getByText('3 החיובים שכבר הונפקו בתעריף הרגיל יישארו על 1,200 ₪.')).toBeTruthy();
    expect(screen.queryByText(/היתרה שלו תשתנה/)).toBeNull();
  });

  it('says what the issued dues move to once the box is ticked, and whose balance moves', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('דמי קאמפ לאדם'), { target: { value: '1350' } });
    fireEvent.click(screen.getByLabelText('לעדכן גם את 3 החיובים שכבר הונפקו בתעריף הרגיל'));
    expect(screen.getByText('3 החיובים שכבר הונפקו בתעריף הרגיל יעברו ל־1,350 ₪.')).toBeTruthy();
    expect(screen.getByText('על אחד מהם כבר נרשם תשלום — היתרה שלו תשתנה.')).toBeTruthy();
  });

  it('agrees with a single issued due', () => {
    renderDrawer({ issued: { count: 1, withPayments: 0 } });
    expect(screen.getByText('החיוב האחד שכבר הונפק בתעריף הרגיל יישאר על 1,200 ₪.')).toBeTruthy();
  });

  it('offers no decision when nothing was issued yet', () => {
    renderDrawer({ issued: { count: 0, withPayments: 0 } });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/עדיין לא הונפק אף חיוב/)).toBeTruthy();
  });

  it('always says that exceptions are untouched', () => {
    renderDrawer();
    expect(screen.getByText(/חריגים לא משתנים/)).toBeTruthy();
  });

  it('saves the rate in shekels with the decision, then closes to the same view', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('דמי קאמפ לאדם'), { target: { value: '1350' } });
    fireEvent.click(screen.getByLabelText(/לעדכן גם את/));
    fireEvent.click(screen.getByRole('button', { name: 'שמירת התעריף' }));
    await vi.waitFor(() => expect(setFlatRateAction).toHaveBeenCalledWith(SEASON, 1350, true));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(`/fees?season=${SEASON}&view=unpaid`));
    expect(refresh).toHaveBeenCalled();
  });

  it('refuses a negative or empty rate before the round trip', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('דמי קאמפ לאדם'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת התעריף' }));
    expect(screen.getByText('דמי הקאמפ חייבים להיות מספר שאינו שלילי.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('דמי קאמפ לאדם'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת התעריף' }));
    expect(screen.getByText('דמי הקאמפ חייבים להיות מספר.')).toBeTruthy();
    expect(setFlatRateAction).not.toHaveBeenCalled();
  });

  it('shows the refusal the action hands back, in place', async () => {
    setFlatRateAction.mockResolvedValueOnce({ ok: false, error: 'השנה הזאת לא נמצאה.' });
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת התעריף' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('השנה הזאת לא נמצאה.');
    expect(replace).not.toHaveBeenCalled();
  });
});
