import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { issueFlatDues } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { isHebrewRefusal } from '@/lib/errors/hebrew';
import { createAccount, accountBalances } from './accounts';
import { recordEntry } from './ledger';
import { listLedgerRows } from './ledger-view';
import { attributeMovement } from './attribution';

const LEAD = 'lead@example.com';
const NOWHERE = '00000000-0000-0000-0000-000000000000';
let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });

/** A due with a payment against it, for the dues half of the union. */
async function seedPaidDues(
  channel: 'מזומן' | 'קיזוז', accountId?: string,
): Promise<string> {
  const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
  const personId = await createPerson(db, 'נועה לוי', LEAD);
  await addMember(db, personId, season.id);
  await issueFlatDues(db, season.id);
  const [fee] = await listSeasonFees(db, season.id);
  return recordPayment(db, {
    dueId: fee.dueId!, amount: 1200, channel,
    note: channel === 'קיזוז' ? 'מול חוב נועה' : undefined,
    paidOn: new Date('2026-09-10T00:00:00Z'), recordedBy: LEAD, accountId,
  });
}

describe('attributing a movement to an account', () => {
  it('gives a ledger entry with no account the account it belongs to', async () => {
    const account = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    const entryId = await recordEntry(db, {
      occurredOn: new Date('2026-08-18T00:00:00Z'), direction: 'out', amount: 1200,
      description: 'מים וקרח', recordedBy: LEAD,
    });
    await attributeMovement(db, { origin: 'ledger', id: entryId, accountId: account.id });
    const [row] = await listLedgerRows(db);
    expect(row.accountName).toBe('קופה מזומן');
    expect(row.accountId).toBe(account.id);
    // The repair has to reach the balance, or the banner it clears was lying
    // about what attributing would achieve.
    expect((await accountBalances(db))[0].balanceAgorot).toBe(-120000);
  });

  it('gives a dues payment with no account the קופה that received it', async () => {
    const account = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    const paymentId = await seedPaidDues('מזומן');
    await attributeMovement(db, { origin: 'dues', id: paymentId, accountId: account.id });
    const [row] = await listLedgerRows(db);
    expect(row.origin).toBe('dues');
    expect(row.accountName).toBe('קופה מזומן');
    expect((await accountBalances(db))[0].balanceAgorot).toBe(120000);
  });

  it('refuses a movement that does not exist', async () => {
    const account = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    await expect(attributeMovement(db, {
      origin: 'ledger', id: NOWHERE, accountId: account.id,
    })).rejects.toThrow('אין תנועה כזו');
    await expect(attributeMovement(db, {
      origin: 'dues', id: NOWHERE, accountId: account.id,
    })).rejects.toThrow('אין תנועה כזו');
  });

  it('refuses an account that does not exist', async () => {
    const entryId = await recordEntry(db, {
      occurredOn: new Date('2026-08-18T00:00:00Z'), direction: 'out', amount: 1200,
      description: 'מים וקרח', recordedBy: LEAD,
    });
    await expect(attributeMovement(db, {
      origin: 'ledger', id: entryId, accountId: NOWHERE,
    })).rejects.toThrow('אין חשבון כזה');
  });

  it('refuses a movement that already names an account', async () => {
    const first = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    const second = await createAccount(db, { name: 'קופת מסיבות', kind: 'cash' });
    const entryId = await recordEntry(db, {
      occurredOn: new Date('2026-08-18T00:00:00Z'), direction: 'out', amount: 1200,
      description: 'מים וקרח', accountId: first.id, recordedBy: LEAD,
    });
    await expect(attributeMovement(db, {
      origin: 'ledger', id: entryId, accountId: second.id,
    })).rejects.toThrow('התנועה הזו כבר משויכת לחשבון');
  });

  it('refuses a קיזוז, because it moves no cash', async () => {
    const account = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    const paymentId = await seedPaidDues('קיזוז');
    await expect(attributeMovement(db, {
      origin: 'dues', id: paymentId, accountId: account.id,
    })).rejects.toThrow('קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון');
  });

  /**
   * A20: a refusal says it is one rather than being guessed at by alphabet.
   * These four all happen to be pure Hebrew today, so the passthrough would
   * carry them — but the passthrough is the inference `HebrewRefusal` exists
   * to replace, and it logs a warning on every hit. Marking them keeps the
   * log a list of call sites still to migrate rather than a list including
   * this one.
   */
  it('marks every refusal as a refusal rather than leaving it to be sniffed', async () => {
    const account = await createAccount(db, { name: 'קופה מזומן', kind: 'cash' });
    await expect(attributeMovement(db, {
      origin: 'ledger', id: NOWHERE, accountId: account.id,
    })).rejects.toSatisfy(isHebrewRefusal);
  });
});
