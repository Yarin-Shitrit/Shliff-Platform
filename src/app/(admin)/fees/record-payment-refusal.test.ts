import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import type { AdminCheck } from '@/lib/auth/guard';

/**
 * Integration §5 A20, for `recordPaymentAction`'s own refusal.
 *
 * `payment.account_id` carries no foreign key, so the action checks the id
 * against the open accounts itself and refuses in Hebrew when it is not one
 * of them. That refusal used to reach the screen through `toHebrewError`'s
 * alphabet passthrough — it survived only because the sentence happens to
 * contain no Latin character.
 *
 * It is one interpolation from breaking. Name the קופה a lead actually chose
 * — `Petty Cash`, say — and the message fails the predicate and is replaced
 * by the generic fallback, with the screen still looking right and nothing
 * going red. Throwing `HebrewRefusal` says the sentence was meant, so it no
 * longer depends on which alphabet it is written in.
 *
 * The mocking follows `src/app/(admin)/shell/actions.test.ts`: `./actions`
 * imports `@/db` and `@/lib/auth/guard` at module scope, and the database
 * stand-in is a proxy so each test's own PGlite instance resolves through it.
 */
const { dbRef, adminRef, dbProxy, revalidatePath } = vi.hoisted(() => {
  const dbRef: { current: TestDb | null } = { current: null };
  const adminRef: { current: AdminCheck } = {
    current: { ok: true, email: 'admin@example.com' },
  };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { dbRef, adminRef, dbProxy, revalidatePath: vi.fn() };
});

vi.mock('@/db', () => ({ db: dbProxy }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { recordPaymentAction } from './actions';

const REFUSAL = 'הקופה שנבחרה לא קיימת או נסגרה.';

describe('recordPaymentAction refuses an account that is not open', () => {
  beforeEach(async () => {
    dbRef.current = await createTestDb();
    adminRef.current = { ok: true, email: 'admin@example.com' };
    revalidatePath.mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  /** There are no accounts at all in a fresh database, so any id is "not one
   *  of the open ones" and the refusal fires before `recordPayment` is
   *  reached — which is the point of checking it there. */
  it('says so in Hebrew', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await recordPaymentAction({
      dueId: crypto.randomUUID(),
      amount: 100,
      channel: 'מזומן',
      paidOn: '2026-01-01',
      accountId: crypto.randomUUID(),
    });

    expect(result).toEqual({ ok: false, error: REFUSAL });
  });

  /**
   * The migration itself. `toHebrewError` logs every message it lets through
   * on the alphabet inference, and that log is the list of call sites still
   * relying on it. A marked refusal is not one of them, so this action must
   * not appear — otherwise the list never empties and stops meaning anything.
   */
  it('reaches the screen as a marked refusal, not through the alphabet inference', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recordPaymentAction({
      dueId: crypto.randomUUID(),
      amount: 100,
      channel: 'מזומן',
      paidOn: '2026-01-01',
      accountId: crypto.randomUUID(),
    });

    expect(warned).not.toHaveBeenCalled();
  });
});
