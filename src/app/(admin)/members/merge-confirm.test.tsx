/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
/**
 * `@testing-library/user-event` is not an installed dependency in this repo
 * and adding it is out of scope here — installing packages is off-limits for
 * this task. `fireEvent.change` / `fireEvent.click` from the already-installed
 * `@testing-library/react` exercise the same paths these tests need.
 *
 * Lifted with the rest of these tests from `merge-control.test.tsx`, which
 * this replaces. The reason has not changed, so neither has the comment.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: () => {} }),
}));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over.
 */
const { mergePeopleAction } = vi.hoisted(() => ({
  mergePeopleAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ mergePeopleAction }));

import { MergeConfirm } from './merge-confirm';

function renderConfirm() {
  return render(
    <MergeConfirm
      sourceId="p1"
      targetId="p2"
      sourceName="אופק"
      successHref="/members/p2"
    />,
  );
}

const ACKNOWLEDGE = 'אני מאשר/ת שמדובר באותו אדם, וזו פעולה בלתי הפיכה מהמסך הזה.';

beforeEach(() => { vi.clearAllMocks(); });

describe('MergeConfirm', () => {
  it('keeps R8 acknowledgement verbatim, and the verb on the button', () => {
    renderConfirm();
    expect(screen.getByLabelText(ACKNOWLEDGE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'מזג' })).toBeTruthy();
  });

  /*
   * The whole point of the checkbox. R8 keeps it for merge specifically —
   * the preview added by the panel above does not replace it, because reading
   * what will move and accepting that it cannot be undone are two different
   * acts.
   */
  it('will not merge before the box is ticked', () => {
    renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));
    expect(mergePeopleAction).not.toHaveBeenCalled();
  });

  it('calls the action with (source, target) once acknowledged', () => {
    renderConfirm();
    fireEvent.click(screen.getByLabelText(ACKNOWLEDGE));
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));
    expect(mergePeopleAction).toHaveBeenCalledWith('p1', 'p2');
  });

  it('renders a conflict refusal prominently, naming every conflict', async () => {
    mergePeopleAction.mockResolvedValueOnce({
      ok: false,
      error: 'לא ניתן למזג — קיימים: חברות במחנה, דמי קאמפ',
    });
    renderConfirm();
    fireEvent.click(screen.getByLabelText(ACKNOWLEDGE));
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));

    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('חברות במחנה');
    expect(refusal.textContent).toContain('דמי קאמפ');
    expect(push).not.toHaveBeenCalled();
  });

  /*
   * The record that survived, never the one that no longer exists. Landing on
   * the source's page after a merge would show a person who has been folded
   * away, which every list deliberately hides.
   */
  it('lands on the record that survived', async () => {
    renderConfirm();
    fireEvent.click(screen.getByLabelText(ACKNOWLEDGE));
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));
    await screen.findByRole('button', { name: 'מזג' });
    expect(push).toHaveBeenCalledWith('/members/p2');
  });
});
