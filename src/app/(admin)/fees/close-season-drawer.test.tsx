/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { SeasonClosePreview, CloseSeasonResult } from '@/lib/fees/close-season';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const { closeSeasonAction } = vi.hoisted(() => ({
  closeSeasonAction: vi.fn(async (): Promise<ActionResult<CloseSeasonResult>> => ({
    ok: true,
    value: { duesClosed: 2, duesAgorot: 240000, obligationsClosed: 1, obligationsAgorot: 30000, unnamedLeft: 1 },
  })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ closeSeasonAction }));

import { CloseSeasonDrawer, closedSentence } from './close-season-drawer';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

function preview(over: Partial<SeasonClosePreview> = {}): SeasonClosePreview {
  return {
    seasonId: SEASON,
    seasonName: 'ברן 25',
    dues: {
      rows: [
        { dueId: 'd1', personId: 'p1', displayName: 'נטלי', outstandingAgorot: 90000 },
        { dueId: 'd2', personId: 'p2', displayName: 'יוסף', outstandingAgorot: 150000 },
      ],
      count: 2,
      totalAgorot: 240000,
    },
    unissued: 1,
    obligations: {
      rows: [{ id: 'o1', direction: 'camp_owes', displayParty: 'יוסף', description: 'החזר על קרח', outstandingAgorot: 30000 }],
      count: 1,
      campOwesAgorot: 30000,
      owedToCampAgorot: 0,
    },
    unnamed: 1,
    ...over,
  };
}

function renderDrawer(over: Partial<SeasonClosePreview> = {}, latest = false) {
  return render(
    <ToastProvider>
      <CloseSeasonDrawer preview={preview(over)} view="unpaid" latest={latest} />
    </ToastProvider>,
  );
}

describe('CloseSeasonDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('names the season and states the decision in numbers before the button', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'סגירת היתרות של ברן 25' })).toBeTruthy();
    expect(screen.getByLabelText('דמי קאמפ — 2 אנשים עדיין חייבים 2,400 ₪')).toBeTruthy();
    expect(screen.getByLabelText('חובות — חוב אחד (אנחנו חייבים 300 ₪, חייבים לנו 0 ₪)')).toBeTruthy();
    const who = screen.getByRole('list', { name: 'מי עדיין חייב' });
    expect(within(who).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['נטלי · 900 ₪', 'יוסף · 1,500 ₪']);
    expect(screen.getByText(/שום כסף לא זז ושום קופה לא משתנה/)).toBeTruthy();
  });

  /*
   * What stays open is said before the button: a nameless debt cannot be
   * closed, and a member never billed has nothing to close.
   */
  it('says what will not close, and why', () => {
    renderDrawer();
    expect(screen.getByText(/חוב אחד בלי שם יישאר פתוח/).textContent)
      .toContain('אי אפשר לסגור חוב בלי לדעת למי מגיע הכסף');
    expect(screen.getByText('אדם אחד ברשימה בלי חיוב בכלל — אין להם מה לאפס.')).toBeTruthy();
  });

  it('opens with both boxes ticked when both have something to close, and sends the choice as made', async () => {
    renderDrawer();
    expect((screen.getByLabelText(/^דמי קאמפ/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^חובות/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/^חובות/));
    fireEvent.click(screen.getByRole('button', { name: 'איפוס היתרות של ברן 25' }));
    await vi.waitFor(() => expect(closeSeasonAction).toHaveBeenCalledWith(SEASON, { dues: true, obligations: false }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(`/fees?season=${SEASON}&view=unpaid`));
    expect(refresh).toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent)
      .toContain('היתרות של ברן 25 אופסו: 2 אנשים עם 2,400 ₪ של דמי קאמפ פתוחים, חוב אחד בסך 300 ₪. חוב אחד בלי שם נשאר פתוח.');
  });

  it('leaves a box unticked and disabled when there is nothing of that kind to close', () => {
    renderDrawer({ obligations: { rows: [], count: 0, campOwesAgorot: 0, owedToCampAgorot: 0 } });
    const debts = screen.getByLabelText('חובות — אין חוב פתוח עם שם') as HTMLInputElement;
    expect(debts.checked).toBe(false);
    expect(debts.disabled).toBe(true);
  });

  it('refuses a close that chooses nothing, before the round trip', () => {
    renderDrawer();
    fireEvent.click(screen.getByLabelText(/^דמי קאמפ/));
    fireEvent.click(screen.getByLabelText(/^חובות/));
    fireEvent.click(screen.getByRole('button', { name: 'איפוס היתרות של ברן 25' }));
    expect(screen.getByText('בחרו מה לסגור: חיובים, חובות, או שניהם.').getAttribute('role')).toBe('alert');
    expect(closeSeasonAction).not.toHaveBeenCalled();
  });

  it('offers nothing to close over an empty year, and says so', () => {
    renderDrawer({
      dues: { rows: [], count: 0, totalAgorot: 0 },
      obligations: { rows: [], count: 0, campOwesAgorot: 0, owedToCampAgorot: 0 },
      unnamed: 0, unissued: 0,
    });
    expect(screen.getByText(/אין יתרות פתוחות בברן 25/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'איפוס היתרות של ברן 25' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  // Closing the newest season is almost always the wrong season.
  it('warns when the season is the newest one, and points at the switcher', () => {
    renderDrawer({}, true);
    expect(screen.getByText('ברן 25 היא השנה החדשה ביותר.')).toBeTruthy();
    expect(screen.getByText(/בחרו אותה בבורר השנה בסרגל הצד/)).toBeTruthy();
  });

  it('shows the refusal the action hands back, in place', async () => {
    closeSeasonAction.mockResolvedValueOnce({ ok: false, error: 'אין יתרות פתוחות לסגור בברן 25.' });
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'איפוס היתרות של ברן 25' }));
    const refusal = await screen.findByText('אין יתרות פתוחות לסגור בברן 25.');
    expect(refusal.getAttribute('role')).toBe('alert');
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('closedSentence', () => {
  it('agrees with the numbers and leaves out what did not happen', () => {
    expect(closedSentence(
      { duesClosed: 1, duesAgorot: 90000, obligationsClosed: 0, obligationsAgorot: 0, unnamedLeft: 0 }, 'ברן 25',
    )).toBe('היתרות של ברן 25 אופסו: אדם אחד עם 900 ₪ של דמי קאמפ פתוחים.');
    expect(closedSentence(
      { duesClosed: 0, duesAgorot: 0, obligationsClosed: 3, obligationsAgorot: 130000, unnamedLeft: 2 }, 'ברן 25',
    )).toBe('היתרות של ברן 25 אופסו: 3 חובות בסך 1,300 ₪. 2 חובות בלי שם נשארו פתוחים.');
  });
});
