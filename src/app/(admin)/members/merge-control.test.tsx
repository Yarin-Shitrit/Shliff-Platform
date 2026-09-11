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
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over (see `member-fee-row.test.tsx`).
 */
const { mergePeopleAction } = vi.hoisted(() => ({
  mergePeopleAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ mergePeopleAction }));

import { MergeControl } from './merge-control';

const CANDIDATES = [
  { personId: 'p2', displayName: 'אופק כהן' },
  { personId: 'p3', displayName: 'עמירם דהן' },
];

function selectAndConfirm(targetName: string) {
  fireEvent.change(screen.getByLabelText('מזג לתוך'), {
    target: { value: CANDIDATES.find((c) => c.displayName === targetName)!.personId },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('MergeControl', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders nothing when there is no one else to merge into', () => {
    const { container } = render(
      <MergeControl personId="p1" displayName="אופק" candidates={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('will not submit before a target is chosen and confirmed', () => {
    render(<MergeControl personId="p1" displayName="אופק" candidates={CANDIDATES} />);
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));
    expect(mergePeopleAction).not.toHaveBeenCalled();
  });

  it('will not submit with a target chosen but not confirmed', () => {
    render(<MergeControl personId="p1" displayName="אופק" candidates={CANDIDATES} />);
    fireEvent.change(screen.getByLabelText('מזג לתוך'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));
    expect(mergePeopleAction).not.toHaveBeenCalled();
  });

  it('calls the action with (source, target) once confirmed', () => {
    render(<MergeControl personId="p1" displayName="אופק" candidates={CANDIDATES} />);
    selectAndConfirm('אופק כהן');
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));

    expect(mergePeopleAction).toHaveBeenCalledWith('p1', 'p2');
  });

  it('renders a conflict refusal prominently, naming every conflict', async () => {
    mergePeopleAction.mockResolvedValueOnce({
      ok: false,
      error: 'לא ניתן למזג — קיימים: חברות במחנה, דמי קאמפ',
    });
    render(<MergeControl personId="p1" displayName="אופק" candidates={CANDIDATES} />);
    selectAndConfirm('עמירם דהן');
    fireEvent.click(screen.getByRole('button', { name: 'מזג' }));

    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('חברות במחנה');
    expect(refusal.textContent).toContain('דמי קאמפ');
  });
});
