import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HebrewRefusal, HEBREW_FALLBACK } from '@/lib/errors/hebrew';

const {
  requireAdmin, createParty, updateParty, recordPartyMovement, deletePartyMovement, revalidatePath,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createParty: vi.fn(),
  updateParty: vi.fn(),
  recordPartyMovement: vi.fn(),
  deletePartyMovement: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/money/parties', () => ({
  createParty, updateParty, recordPartyMovement, deletePartyMovement,
}));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  createPartyAction, updatePartyAction, recordPartyMovementAction, deletePartyMovementAction,
} from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  createParty.mockResolvedValue('p1');
  updateParty.mockResolvedValue(undefined);
  recordPartyMovement.mockResolvedValue('e1');
  deletePartyMovement.mockResolvedValue(undefined);
});

const MOVEMENT = {
  eventId: 'p1', part: 'tickets' as const, amount: 500, occurredOn: '2026-07-18',
};

describe('the party actions', () => {
  it('refuse a caller who is not an admin, and write nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await createPartyAction({ seasonId: 's', name: 'x', heldOn: '2026-07-18' }))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await updatePartyAction('p1', { name: 'x', heldOn: '2026-07-18' }))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await recordPartyMovementAction(MOVEMENT)).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await deletePartyMovementAction('p1', 'e1')).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(createParty).not.toHaveBeenCalled();
    expect(updateParty).not.toHaveBeenCalled();
    expect(recordPartyMovement).not.toHaveBeenCalled();
    expect(deletePartyMovement).not.toHaveBeenCalled();
  });

  it('hands back the new party\'s id, so the form can open its page', async () => {
    expect(await createPartyAction({ seasonId: 's', name: 'x', heldOn: '2026-07-18' }))
      .toEqual({ ok: true, value: 'p1' });
    expect(createParty.mock.calls[0][1].heldOn).toEqual(new Date('2026-07-18'));
  });

  it('takes recordedBy from the session, never from the client', async () => {
    await recordPartyMovementAction({ ...MOVEMENT, recordedBy: 'someone@else.example' } as never);
    expect(recordPartyMovement.mock.calls[0][1].recordedBy).toBe('lead@shliff.camp');
  });

  it('refreshes every screen that reads the party\'s money', async () => {
    await recordPartyMovementAction(MOVEMENT);
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining([
      '/money/events', '/money/events/p1', '/money/ledger', '/money',
    ]));
  });

  it('hands the library refusal to the screen unchanged, and refreshes nothing', async () => {
    recordPartyMovement.mockRejectedValue(new HebrewRefusal('להוצאה חייב להיות תיאור — על מה שילמנו'));
    expect(await recordPartyMovementAction({ ...MOVEMENT, part: 'cost' }))
      .toEqual({ ok: false, error: 'להוצאה חייב להיות תיאור — על מה שילמנו' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('never lets an English failure reach a Hebrew screen', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    deletePartyMovement.mockRejectedValue(new Error('connection refused'));
    expect(await deletePartyMovementAction('p1', 'e1')).toEqual({ ok: false, error: HEBREW_FALLBACK });
    logged.mockRestore();
  });
});
