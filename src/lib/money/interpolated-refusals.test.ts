import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { toHebrewError, HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { seasonMoneySummary } from './summary';
import { duesFundingIdentity } from './funding';
import { settleObligation } from './obligations';

const LEAD = 'lead@example.com';
const NOWHERE = '00000000-0000-0000-0000-00000000000f';
let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

/**
 * Three refusals in this module interpolate a uuid, and that is fatal to the
 * one mechanism that was carrying them.
 *
 * `toHebrewError`'s last resort accepts a message that has a Hebrew letter
 * **and no Latin letter**. The Latin test is not incidental: this schema's
 * own enum labels are Hebrew, so a driver message like `invalid input value
 * for enum payment_channel: "מזומן"` would otherwise be echoed raw to a lead.
 *
 * A uuid is hex. It always contains a letter in `a`–`f`. So
 * `עונה לא נמצאה: 0f8e…` satisfies the Hebrew test and *also* satisfies the
 * Latin test, the passthrough cannot fire, and the lead is handed
 * `משהו השתבש. הפעולה לא נשמרה.` instead of the reason. Nothing goes red,
 * because the author wrote Hebrew and they did.
 *
 * These tests go through `toHebrewError` with an empty map on purpose. An
 * assertion on `error.message` would pass against the defect: the message is
 * correct at the throw and is lost at the boundary, so the boundary is where
 * the claim has to be made. `HebrewRefusal` is what makes it hold — it is
 * checked before the map and returns the message verbatim, whatever alphabet
 * it is written in (integration §5 A20, A27).
 */
describe('a refusal that names the row it refuses', () => {
  it('confirms the mechanism: these messages carry both alphabets', () => {
    const message = `עונה לא נמצאה: ${NOWHERE}`;
    expect(/[֐-׿]/.test(message)).toBe(true);
    expect(/[A-Za-z]/.test(message)).toBe(true);
  });

  it('reaches the lead from seasonMoneySummary', async () => {
    const error = await seasonMoneySummary(db, NOWHERE).catch((caught: unknown) => caught);
    const hebrew = toHebrewError(error, []);
    expect(hebrew).toBe(`עונה לא נמצאה: ${NOWHERE}`);
    expect(hebrew).not.toBe(HEBREW_FALLBACK);
  });

  it('reaches the lead from duesFundingIdentity', async () => {
    const error = await duesFundingIdentity(db, NOWHERE).catch((caught: unknown) => caught);
    const hebrew = toHebrewError(error, []);
    expect(hebrew).toBe(`עונה לא נמצאה: ${NOWHERE}`);
    expect(hebrew).not.toBe(HEBREW_FALLBACK);
  });

  it('reaches the lead from settleObligation', async () => {
    const error = await settleObligation(db, {
      obligationId: NOWHERE, amount: 100, kind: 'cash',
      settledOn: new Date('2026-09-10T00:00:00Z'), recordedBy: LEAD,
    }).catch((caught: unknown) => caught);
    const hebrew = toHebrewError(error, []);
    expect(hebrew).toBe(`חוב לא קיים: ${NOWHERE}`);
    expect(hebrew).not.toBe(HEBREW_FALLBACK);
  });
});
