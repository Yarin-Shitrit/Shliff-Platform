/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
/**
 * `@testing-library/user-event` is not an installed dependency in this repo;
 * `fireEvent` from the already-installed `@testing-library/react` exercises
 * the same click path (see `assign-control.test.tsx`).
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws a hoisting `ReferenceError` —
 * `vi.hoisted` is what this codebase already uses to give the factory
 * something to close over.
 */
const { seedAction } = vi.hoisted(() => ({
  seedAction: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ seedAction }));

import { SeedButton } from './seed-button';

describe('SeedButton', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows Hebrew, not the raw "unauthorized" code, when the admin session has lapsed', async () => {
    seedAction.mockRejectedValueOnce(new Error('unauthorized'));
    render(<SeedButton />);

    fireEvent.click(screen.getByRole('button', { name: 'טען את קבצי העבר' }));

    expect(await screen.findByText('אין לך הרשאה לטעון את קבצי העבר.')).toBeDefined();
    expect(screen.queryByText('unauthorized')).toBeNull();
    expect(screen.queryByText(/unauthorized/)).toBeNull();
  });

  it('shows the Hebrew production refusal for the "production" code', async () => {
    seedAction.mockRejectedValueOnce(new Error('production'));
    render(<SeedButton />);

    fireEvent.click(screen.getByRole('button', { name: 'טען את קבצי העבר' }));

    expect(
      await screen.findByText('טעינת קבצי העבר היא כלי פיתוח בלבד ואינה זמינה בסביבת ייצור.'),
    ).toBeDefined();
  });

  it('falls back to a generic Hebrew message for an unrecognized error', async () => {
    seedAction.mockRejectedValueOnce(new Error('boom'));
    render(<SeedButton />);

    fireEvent.click(screen.getByRole('button', { name: 'טען את קבצי העבר' }));

    expect(await screen.findByText('הטעינה נכשלה, נסו שוב.')).toBeDefined();
    expect(screen.queryByText('boom')).toBeNull();
  });
});
