/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
import type { MemberFeeRow } from '@/lib/fees/season-fees';
/**
 * `@testing-library/user-event` is not installed and R1 forbids adding it;
 * `fireEvent` is what every component test in this repo already uses.
 */

const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

/** `vi.mock` factories are hoisted above every other statement. */
const { setExceptionAction, clearExceptionAction } = vi.hoisted(() => ({
  setExceptionAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  clearExceptionAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ setExceptionAction, clearExceptionAction }));

import { ExceptionDrawer } from './exception-drawer';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

function row(over: Partial<MemberFeeRow> = {}): MemberFeeRow {
  return {
    personId: 'p1', displayName: 'איתי כהן', role: 'member',
    dueId: 'd1', amountAgorot: 120000, kind: 'flat',
    exceptionReason: null, decidedBy: null,
    paidAgorot: 0, outstandingAgorot: 120000, settled: false, payments: [], ...over,
  };
}

const EXISTING = row({
  kind: 'exception', amountAgorot: 60000, outstandingAgorot: 60000,
  exceptionReason: 'חצי עונה בלבד', decidedBy: 'noa@shliff.camp',
});

const NO_DUE = row({
  dueId: null, amountAgorot: null, kind: null, outstandingAgorot: 0,
});

function renderDrawer(over: Partial<Parameters<typeof ExceptionDrawer>[0]> = {}) {
  return render(
    <ExceptionDrawer
      row={row()}
      seasonId={SEASON}
      seasonName="ברן 26"
      view="unpaid"
      flatRateAgorot={120000}
      decidedBy="noa@shliff.camp"
      {...over}
    />,
  );
}

describe('ExceptionDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens on the amount the member owes now', () => {
    renderDrawer();
    expect((screen.getByLabelText('סכום') as HTMLInputElement).value).toBe('1200');
  });

  /**
   * The kit's `Banner` splits a sentence into a bold lead clause and the rest,
   * so the whole sentence is never one text node and `getByText` on it cannot
   * match. Asserting the banner's own `textContent` still pins both fragments,
   * their order and the single space between them — it does not weaken to a
   * substring.
   */
  it('says why the reason is required, before the lead types anything', () => {
    renderDrawer();
    const lead = screen.getByText('חריג מחייב סיבה.');
    expect(lead.closest('div')?.textContent).toBe(
      'חריג מחייב סיבה. בלי זה אי אפשר יהיה לדעת בעוד שנה למה שילמו סכום אחר.',
    );
  });

  it('will not save an exception with no reason', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת החריג' }));

    expect(setExceptionAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent)
      .toBe('חריג חייב לכלול סיבה. בלי זה אי אפשר יהיה לדעת בעוד שנה למה.');
  });

  it('will not save an exception whose reason is only spaces', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת החריג' }));
    expect(setExceptionAction).not.toHaveBeenCalled();
  });

  it('refuses a negative amount before it reaches the server', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '-100' } });
    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'טעות' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת החריג' }));

    expect(setExceptionAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('הסכום חייב להיות מספר שאינו שלילי.');
  });

  it('saves an exception that carries a reason, zero included', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('סיבה'),
      { target: { value: 'פטור מלא — הובלת ההקמה' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת החריג' }));

    expect(setExceptionAction).toHaveBeenCalledWith({
      personId: 'p1', seasonId: SEASON, amount: 0, reason: 'פטור מלא — הובלת ההקמה',
    });
  });

  it('names the lead who will be recorded as the decider', () => {
    renderDrawer();
    expect(screen.getByText('יירשם על שמך · noa@shliff.camp')).toBeDefined();
  });

  it('shows who decided an exception that already exists', () => {
    renderDrawer({ row: EXISTING });
    expect(screen.getByText('נקבע על ידי noa@shliff.camp')).toBeDefined();
    expect((screen.getByLabelText('סיבה') as HTMLInputElement).value)
      .toBe('חצי עונה בלבד');
  });

  it('offers to clear an exception only when there is one', () => {
    renderDrawer();
    expect(screen.queryByRole('button', { name: 'ביטול החריג' })).toBeNull();
    renderDrawer({ row: EXISTING });
    expect(screen.getAllByRole('button', { name: 'ביטול החריג' }).length).toBeGreaterThan(0);
  });

  /**
   * `alertdialog`, not `dialog`: the kit's `ConfirmDialog` is an alertdialog
   * and the `Drawer` behind it is the `dialog`. Querying `dialog` would match
   * the drawer, whose own text already carries the reason and the rate, and
   * both assertions would pass with no confirmation on screen at all.
   */
  it('confirms before clearing, naming the reason that will be lost (R8)', () => {
    renderDrawer({ row: EXISTING });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול החריג' }));

    expect(clearExceptionAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('חצי עונה בלבד');
    expect(dialog.textContent).toContain('1,200 ₪');
  });

  it('clears once the lead confirms', () => {
    renderDrawer({ row: EXISTING });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול החריג' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ביטול החריג' }));
    expect(clearExceptionAction).toHaveBeenCalledWith('p1', SEASON);
  });

  it('shows a server refusal rather than pretending it saved', async () => {
    setExceptionAction.mockResolvedValueOnce({
      ok: false, error: 'אין חיוב לאדם הזה בשנה הזאת. הנפיקו קודם חיוב לפי התעריף הרגיל.',
    });
    renderDrawer();
    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'הנחה' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת החריג' }));
    expect((await screen.findByRole('alert')).textContent)
      .toBe('אין חיוב לאדם הזה בשנה הזאת. הנפיקו קודם חיוב לפי התעריף הרגיל.');
  });

  it('refuses to define an exception for a member with no due', () => {
    renderDrawer({ row: NO_DUE });
    expect(screen.getByText(
      'אין עדיין חיוב לאיתי כהן. צריך להנפיק חיוב לפני שאפשר להגדיר חריג.',
    )).toBeDefined();
    expect(screen.queryByLabelText('סכום')).toBeNull();
  });

  /**
   * I12: `persons` records no gender, so no copy this drawer ships may inflect
   * for one. The net is on inflected verbs, not on the four words the mock
   * used — the plan's own copy for this drawer carried `{name} יחזור לתעריף`
   * and `הוביל את ההקמה`, and the plan's own `/שילמה|שילם /` caught neither.
   *
   * Grammatical agreement with a Hebrew noun is not on the net and must not
   * be: `הסיבה … יימחקו` agrees with סיבה, which is a fact about the word.
   * What the net forbids is a verb inflected for the *person*, which is
   * always a guess — so the copy is written so the subject is the action or
   * the חיוב, and the member's name is never what a verb agrees with.
   *
   * Watch it fail by restoring the plan's own sentence: change `מחזיר את
   * החיוב של {name}` back to `{name} יחזור`.
   */
  it('inflects no copy for a gender the platform does not record', () => {
    renderDrawer({ row: EXISTING });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול החריג' }));

    expect(document.body.textContent)
      .not.toMatch(/שילמה|שילם |פטורה|יחזור|תחזור|הוביל |הובילה|החליט |החליטה|זכאית|זכאי /);
    // Placeholders are attributes, so the sweep above cannot see them.
    expect(screen.getByLabelText('סיבה').getAttribute('placeholder'))
      .toBe('למשל: פטור מלא — הובלת ההקמה');
  });
});
