/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
/**
 * `@testing-library/user-event` is not an installed dependency in this repo
 * (absent from package.json and node_modules) and adding it is out of scope
 * here — installing packages is off-limits for this task. `fireEvent.change`
 * from the already-installed `@testing-library/react` sets a field's value in
 * one event rather than typing it character by character, and `fireEvent.click`
 * exercises the same click path these tests need.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over (see `src/lib/auth/guard.test.ts` and
 * `src/app/(admin)/members/unlinked-queue.test.tsx`).
 */
const { setExceptionAction } = vi.hoisted(() => ({
  setExceptionAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ setExceptionAction }));

import { ExceptionForm } from './exception-form';

function renderForm() {
  return render(
    <ExceptionForm
      personId="p1"
      seasonId="s1"
      displayName="עמירם דהן"
      currentAgorot={150000}
    />,
  );
}

describe('ExceptionForm', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('will not save an exception with no reason', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('סיבה');
  });

  it('saves an exception that carries a reason', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('סיבה'), {
      target: { value: 'פטור מלא — הוביל את ההקמה' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).toHaveBeenCalledWith({
      personId: 'p1',
      seasonId: 's1',
      amount: 0,
      reason: 'פטור מלא — הוביל את ההקמה',
    });
  });

  it('rejects a negative amount before it reaches the server', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '-100' } });
    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'טעות' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).not.toHaveBeenCalled();
  });

  it('shows a server refusal rather than pretending it saved', async () => {
    setExceptionAction.mockResolvedValueOnce({ ok: false, error: 'אין הרשאה' });
    renderForm();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'הנחה' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(await screen.findByText('אין הרשאה')).toBeDefined();
  });
});
