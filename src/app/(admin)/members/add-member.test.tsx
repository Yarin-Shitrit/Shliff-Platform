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
const { createPersonAction, addMemberAction } = vi.hoisted(() => ({
  createPersonAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  addMemberAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ createPersonAction, addMemberAction }));

import { AddMember, AddToSeason } from './add-member';

const SEASONS = [
  { id: 's25', name: 'ברן 25' },
  { id: 's26', name: 'ברן 26' },
];

describe('AddMember', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('refuses a blank name client-side without calling the action', () => {
    render(<AddMember seasons={SEASONS} />);
    fireEvent.click(screen.getByRole('button', { name: 'הוסף אדם' }));

    expect(createPersonAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('ריק');
  });

  it('will not call the action for a name that is only directional marks', () => {
    // isBlank, not .trim() — LRM (U+200E) is invisible but not whitespace.
    render(<AddMember seasons={SEASONS} />);
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: '‎' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף אדם' }));

    expect(createPersonAction).not.toHaveBeenCalled();
  });

  it('creates a person with the chosen season', async () => {
    render(<AddMember seasons={SEASONS} />);
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'דניאל פינטו' } });
    fireEvent.change(screen.getByLabelText('שיוך לשנה'), { target: { value: 's26' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף אדם' }));

    expect(createPersonAction).toHaveBeenCalledWith('דניאל פינטו', 's26');
  });

  it('creates a person with no season when none is chosen', async () => {
    render(<AddMember seasons={SEASONS} />);
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'דניאל ענבר' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף אדם' }));

    expect(createPersonAction).toHaveBeenCalledWith('דניאל ענבר', undefined);
  });

  it('clears the field and refreshes on success', async () => {
    render(<AddMember seasons={SEASONS} />);
    const input = screen.getByLabelText('שם') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'אופק' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף אדם' }));

    await screen.findByDisplayValue('');
    expect(input.value).toBe('');
  });

  it('surfaces a server refusal naming who it already matched', async () => {
    createPersonAction.mockResolvedValueOnce({
      ok: false, error: 'כבר קיים אדם בשם אופק — לא ניתן ליצור כפילות.',
    });
    render(<AddMember seasons={SEASONS} />);
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'אופק' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף אדם' }));

    expect(await screen.findByText(/כבר קיים אדם בשם אופק/)).toBeDefined();
  });
});

describe('AddToSeason', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('offers only seasons the person is not already on', () => {
    render(
      <AddToSeason personId="p1" seasons={SEASONS} memberSeasonIds={['s25']} />,
    );
    expect(screen.getByRole('option', { name: 'ברן 26' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'ברן 25' })).toBeNull();
  });

  it('shows a disabled message when every season already has this person', () => {
    render(
      <AddToSeason personId="p1" seasons={SEASONS} memberSeasonIds={['s25', 's26']} />,
    );
    expect(screen.getByText('משויך/ת כבר לכל השנים הקיימות.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'שייך לשנה' })).toBeNull();
  });

  it('says so distinctly when there are no seasons in the system at all', () => {
    render(<AddToSeason personId="p1" seasons={[]} memberSeasonIds={[]} />);
    expect(screen.getByText('עדיין אין שנים במערכת.')).toBeDefined();
  });

  it('adds the person to the chosen season with the chosen role', () => {
    render(
      <AddToSeason personId="p1" seasons={SEASONS} memberSeasonIds={[]} />,
    );
    fireEvent.change(screen.getByLabelText('שנה'), { target: { value: 's26' } });
    fireEvent.change(screen.getByLabelText('תפקיד'), { target: { value: 'lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'שייך לשנה' }));

    expect(addMemberAction).toHaveBeenCalledWith('p1', 's26', 'lead');
  });

  it('surfaces a server refusal', async () => {
    addMemberAction.mockResolvedValueOnce({ ok: false, error: 'אין הרשאה' });
    render(
      <AddToSeason personId="p1" seasons={SEASONS} memberSeasonIds={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'שייך לשנה' }));

    expect(await screen.findByText('אין הרשאה')).toBeDefined();
  });
});
