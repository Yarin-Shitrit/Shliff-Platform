import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '@/test/db';
import { accounts, ledgerEntries, obligations } from '@/db/schema/money';

describe('money schema', () => {
  it('is listed in drizzle.config.ts', () => {
    const config = readFileSync(join(process.cwd(), 'drizzle.config.ts'), 'utf8');
    expect(config).toContain('./src/db/schema/money.ts');
  });

  it('creates an account and derives nothing on it', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(accounts).values({
      name: 'קופת מזומן', kind: 'cash', openingBalance: '0.00',
    }).returning();
    expect(row.name).toBe('קופת מזומן');
    expect(row).not.toHaveProperty('balance');
  });

  it('stores a movement as a direction plus a positive amount', async () => {
    const db = await createTestDb();
    const [entry] = await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-07-18T00:00:00Z'),
      direction: 'in',
      amount: '57000.00',
      description: 'רווח מסיבת פקאנים',
      recordedBy: 'lead@example.com',
    }).returning();
    expect(entry.direction).toBe('in');
    expect(entry.amount).toBe('57000.00');
  });

  it('lets an obligation exist with no party at all', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(obligations).values({
      direction: 'camp_owes',
      description: 'מקפיא באיחסון נוסף',
      amount: '500.00',
      openedOn: new Date('2025-05-20T00:00:00Z'),
    }).returning();
    expect(row.partyPersonId).toBeNull();
    expect(row.partyName).toBeNull();
  });
});
