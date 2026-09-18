/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
/**
 * `@testing-library/user-event` is not an installed dependency in this repo
 * (absent from package.json and node_modules) and adding it is out of scope
 * here — installing packages is off-limits for this task. `fireEvent.click`
 * from the already-installed `@testing-library/react` exercises the same
 * click path for these tests.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over (see `src/lib/auth/guard.test.ts`).
 */
const { linkNameAction, promoteNameAction } = vi.hoisted(() => ({
  linkNameAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  promoteNameAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ linkNameAction, promoteNameAction }));

import { UnlinkedQueue } from './unlinked-queue';

const NAMES = [
  { aliasId: 'a1', alias: 'ראנצ׳ו ונטלי', candidates: [] },
  {
    aliasId: 'a2',
    alias: 'אופק כהן',
    candidates: [{ personId: 'p1', displayName: 'אופק', exact: false }],
  },
];

describe('UnlinkedQueue', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists every unlinked name', () => {
    render(<UnlinkedQueue names={NAMES} />);
    expect(screen.getByText('ראנצ׳ו ונטלי')).toBeDefined();
    expect(screen.getByText('אופק כהן')).toBeDefined();
  });

  it('offers a candidate as a suggestion, never as a done deal', () => {
    render(<UnlinkedQueue names={NAMES} />);
    // The candidate is presented as a choice the lead makes.
    expect(screen.getByRole('button', { name: /קשר ל.*אופק/ })).toBeDefined();
    expect(linkNameAction).not.toHaveBeenCalled();
  });

  it('links a name to the person a lead picks', async () => {
    render(<UnlinkedQueue names={NAMES} />);
    fireEvent.click(screen.getByRole('button', { name: /קשר ל.*אופק/ }));
    expect(linkNameAction).toHaveBeenCalledWith('a2', 'p1');
  });

  it('promotes a name with no candidates to a new person', async () => {
    render(<UnlinkedQueue names={NAMES} />);
    const buttons = screen.getAllByRole('button', { name: 'צור אדם חדש' });
    fireEvent.click(buttons[0]);
    expect(promoteNameAction).toHaveBeenCalledWith('a1');
  });

  it('surfaces an action failure instead of silently doing nothing', async () => {
    promoteNameAction.mockResolvedValueOnce({ ok: false, error: 'כבר מקושר' });
    render(<UnlinkedQueue names={NAMES} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'צור אדם חדש' })[0]);
    expect(await screen.findByText('כבר מקושר')).toBeDefined();
  });

  it('says so plainly when the queue is empty', () => {
    render(<UnlinkedQueue names={[]} />);
    expect(screen.getByText('אין שמות שממתינים לשיוך.')).toBeDefined();
  });
});
