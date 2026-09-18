/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** `vi.mock` factories are hoisted above every other statement. */
const { issueDueForAction, issueDuesAction } = vi.hoisted(() => ({
  issueDueForAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  issueDuesAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ issueDueForAction, issueDuesAction }));

import { IssueDueButton, IssueMissingDuesButton } from './issue-due-button';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

describe('IssueDueButton', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * The control sits on ONE member's row and says "issue a due at the flat
   * rate". Wired to the season-wide action it would fill in every member
   * missing one — a larger action than the label promises, and not one a lead
   * would notice until after it happened.
   */
  it('issues the due for that member alone, not the whole season', () => {
    render(<IssueDueButton personId="p1" seasonId={SEASON} flatRateAgorot={120000} />);
    fireEvent.click(screen.getByRole('button', { name: 'הנפקת חיוב 1,200 ₪' }));
    expect(issueDueForAction).toHaveBeenCalledWith('p1', SEASON);
    expect(issueDuesAction).not.toHaveBeenCalled();
  });

  it('shows a Hebrew refusal rather than pretending the due was issued', async () => {
    issueDueForAction.mockResolvedValueOnce({
      ok: false, error: 'האדם הזה לא ברשימת החברים של השנה הזאת.',
    });
    render(<IssueDueButton personId="p1" seasonId={SEASON} flatRateAgorot={120000} />);
    fireEvent.click(screen.getByRole('button', { name: 'הנפקת חיוב 1,200 ₪' }));
    expect((await screen.findByRole('alert')).textContent)
      .toBe('האדם הזה לא ברשימת החברים של השנה הזאת.');
  });
});

describe('IssueMissingDuesButton', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('says how many are missing and what they come to, so the size is read first', () => {
    render(
      <IssueMissingDuesButton seasonId={SEASON} missingCount={2} flatRateAgorot={120000} />,
    );
    expect(screen.getByRole('button', { name: 'הנפקת חיוב ל־2 — 2,400 ₪' })).toBeDefined();
  });

  it('offers nothing at all when every member already has a due', () => {
    const { container } = render(
      <IssueMissingDuesButton seasonId={SEASON} missingCount={0} flatRateAgorot={120000} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('issues for the whole season once, and says so if it is refused', async () => {
    issueDuesAction.mockResolvedValueOnce({ ok: false, error: 'השנה הזאת לא נמצאה.' });
    render(
      <IssueMissingDuesButton seasonId={SEASON} missingCount={2} flatRateAgorot={120000} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'הנפקת חיוב ל־2 — 2,400 ₪' }));
    expect(issueDuesAction).toHaveBeenCalledWith(SEASON);
    expect((await screen.findByRole('alert')).textContent).toBe('השנה הזאת לא נמצאה.');
  });
});
