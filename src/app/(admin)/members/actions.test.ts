import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses
 * (see `export/route.test.ts`).
 */
const {
  requireAdmin, addMember, issueFlatDueFor, revalidatePath,
  unlinkAlias, aliasUnlinkTarget,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  addMember: vi.fn(),
  issueFlatDueFor: vi.fn(),
  revalidatePath: vi.fn(),
  unlinkAlias: vi.fn(),
  aliasUnlinkTarget: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/members/roster', () => ({ addMember }));
vi.mock('@/lib/fees/dues', () => ({ issueFlatDueFor }));
vi.mock('@/lib/members/link', () => ({
  unlinkAlias, aliasUnlinkTarget,
  createPerson: vi.fn(), createPersonFromAlias: vi.fn(),
  linkAlias: vi.fn(), mergePersons: vi.fn(),
}));

import { addToSeasonBulkAction, issueDuesBulkAction, unlinkAliasAction } from './actions';

const LAST_ALIAS_REFUSAL =
  'לא ניתן לבטל את הכינוי האחרון של אדם — בלעדיו אי אפשר יהיה לזהות אותו בקבצים.';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
});

describe('addToSeasonBulkAction', () => {
  it('refuses without admin and touches nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await addToSeasonBulkAction(['a', 'b'], 's26', 'member'))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(addMember).not.toHaveBeenCalled();
  });

  it('adds every person named and reports how many', async () => {
    const result = await addToSeasonBulkAction(['a', 'b', 'c'], 's26', 'member');
    expect(result).toEqual({ ok: true, added: 3 });
    expect(addMember).toHaveBeenCalledTimes(3);
    expect(addMember).toHaveBeenCalledWith({}, 'a', 's26', 'member');
    expect(revalidatePath).toHaveBeenCalledWith('/members');
  });

  /* Before any query runs: an empty batch is a UI slip, not a database round
     trip, and the refusal should read the same either way. */
  it('refuses an empty selection before it reads anything', async () => {
    expect(await addToSeasonBulkAction([], 's26', 'member'))
      .toEqual({ ok: false, error: 'לא נבחרו אנשים.' });
    expect(addMember).not.toHaveBeenCalled();
  });
});

describe('issueDuesBulkAction', () => {
  it('refuses without admin and touches nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await issueDuesBulkAction(['a'], 's26'))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(issueFlatDueFor).not.toHaveBeenCalled();
  });

  it('refuses an empty selection before it reads anything', async () => {
    expect(await issueDuesBulkAction([], 's26'))
      .toEqual({ ok: false, error: 'לא נבחרו אנשים.' });
    expect(issueFlatDueFor).not.toHaveBeenCalled();
  });

  it('splits its report into issued and already-had, because both are success', async () => {
    issueFlatDueFor.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await issueDuesBulkAction(['a', 'b'], 's26');
    expect(result).toEqual({ ok: true, issued: 1, already: 1, offRoster: [] });
  });

  /*
   * The whole point of the per-person `try`. Without it the batch's outcome
   * would depend on which order the rows happened to be in — one off-roster
   * person early in the list would abandon everyone after them.
   */
  it('bills everyone it can and names the ones it could not, rather than abandoning the batch', async () => {
    issueFlatDueFor
      .mockRejectedValueOnce(new Error('that person is not on this season roster'))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('that person is not on this season roster'));
    const result = await issueDuesBulkAction(['a', 'b', 'c'], 's26', {
      a: 'רוני אדלר', b: 'נועה לוי', c: 'עמירם דהן',
    });
    expect(result).toEqual({
      ok: true, issued: 1, already: 0, offRoster: ['רוני אדלר', 'עמירם דהן'],
    });
    expect(issueFlatDueFor).toHaveBeenCalledTimes(3);
  });

  /* R9: a failure the map does not know must never reach a Hebrew screen as
     the English the library threw. */
  it('refuses the whole batch in Hebrew when something other than the roster is wrong', async () => {
    issueFlatDueFor.mockRejectedValue(new Error('unknown season s99'));
    const result = await issueDuesBulkAction(['a'], 's99');
    expect(result).toEqual({ ok: false, error: 'השנה המבוקשת לא נמצאה.' });
  });
});


describe('unlinkAliasAction', () => {
  it('refuses without admin and touches nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await unlinkAliasAction('al1')).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(unlinkAlias).not.toHaveBeenCalled();
  });

  /*
   * The one refusal, and it is enforced here rather than only in the dialog.
   * `createPerson` writes the display name as the first alias and
   * `resolveName` matches against aliases and nothing else, so a person with
   * none is invisible to every future import — and would turn up in the
   * unlinked queue as a name looking for a person, sitting next to their own
   * record.
   */
  it('refuses a person their last spelling, and unlinks nothing', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 0 });
    expect(await unlinkAliasAction('al1'))
      .toEqual({ ok: false, error: LAST_ALIAS_REFUSAL });
    expect(unlinkAlias).not.toHaveBeenCalled();
  });

  it('unlinks when the person keeps at least one other spelling', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 2 });
    expect(await unlinkAliasAction('al1')).toEqual({ ok: true });
    expect(unlinkAlias).toHaveBeenCalledWith({}, 'al1');
  });

  it('revalidates the record it changed as well as the list', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 2 });
    await unlinkAliasAction('al1');
    expect(revalidatePath).toHaveBeenCalledWith('/members/p1');
    expect(revalidatePath).toHaveBeenCalledWith('/members');
  });

  it('refuses an alias that names nothing rather than throwing', async () => {
    aliasUnlinkTarget.mockResolvedValue(null);
    expect(await unlinkAliasAction('ghost'))
      .toEqual({ ok: false, error: 'הכינוי לא נמצא.' });
    expect(unlinkAlias).not.toHaveBeenCalled();
  });
});
