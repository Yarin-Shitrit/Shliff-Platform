import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { recordEntry } from '@/lib/money/ledger';
import { createBudgetLine } from '@/lib/money/budget';
import { searchPalette } from '@/lib/search/palette';

const LEAD = 'lead@shliff.camp';

describe('searchPalette', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
  });

  it('answers nothing to a query too short to mean anything', async () => {
    await createPerson(db, 'רוני אדלר', LEAD);
    expect(await searchPalette(db, 'ר', seasonId)).toEqual([]);
  });

  it('finds a person and links to their page', async () => {
    const id = await createPerson(db, 'רוני אדלר', LEAD);
    const [hit] = await searchPalette(db, 'רונ', seasonId);
    expect(hit.kind).toBe('person');
    expect(hit.title).toBe('רוני אדלר');
    expect(hit.href).toBe(`/members/${id}`);
  });

  it('matches a name however it is spelled, through normalizeHebrew', async () => {
    await createPerson(db, 'ראנצ׳ו ונטלי', LEAD);
    expect(await searchPalette(db, "ראנצ'ו", seasonId)).toHaveLength(1);
  });

  it('finds a movement by its description', async () => {
    await recordEntry(db, {
      occurredOn: new Date('2026-07-18T00:00:00Z'),
      direction: 'in',
      amount: 570,
      description: 'רווח מסיבת פקאנים',
      recordedBy: LEAD,
      seasonId,
    });
    const [hit] = await searchPalette(db, 'פקאנים', seasonId);
    expect(hit.kind).toBe('movement');
    expect(hit.href.startsWith('/money')).toBe(true);
  });

  it('finds a budget line in the season it was asked about', async () => {
    await createBudgetLine(db, {
      seasonId, label: 'מים', category: 'camp', total: 4200,
    });
    const [hit] = await searchPalette(db, 'מים', seasonId);
    expect(hit.kind).toBe('budget');
  });

  it('returns kinds in the order the palette groups them', async () => {
    await createPerson(db, 'מים בן דוד', LEAD);
    await createBudgetLine(db, {
      seasonId, label: 'מים', category: 'camp', total: 4200,
    });
    expect((await searchPalette(db, 'מים', seasonId)).map((hit) => hit.kind))
      .toEqual(['person', 'budget']);
  });
});
