import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases, memberships, seasons, dues, payments } from '@/db/schema/camp';
import { resolveName } from './identity';
import { suggestPeopleForName } from './suggest';

let db: TestDb;
let seasonId: string;

async function addPerson(name: string, opts: { inSeason?: boolean } = {}): Promise<string> {
  const [person] = await db.insert(persons).values({ displayName: name }).returning();
  await db.insert(personAliases).values({
    personId: person.id, alias: name, normalized: name, source: 'manual',
    confirmedBy: 'lead@shliff.test', confirmedAt: new Date(),
  });
  if (opts.inSeason) {
    await db.insert(memberships).values({ personId: person.id, seasonId, role: 'member' });
  }
  return person.id;
}

beforeEach(async () => {
  db = await createTestDb();
  const [season] = await db.insert(seasons).values({
    name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35,
  }).returning();
  seasonId = season.id;
});

describe('suggestPeopleForName', () => {
  it('calls a sole exact match חזקה and says why', async () => {
    const id = await addPerson('נועה לוי', { inSeason: true });
    const [top] = await suggestPeopleForName(db, 'נועה לוי', { seasonId });

    expect(top.personId).toBe(id);
    expect(top.confidence).toBe('חזקה');
    expect(top.reasons.map((r) => r.key)).toEqual(['exact-normalized', 'in-season-roster']);
    expect(top.reasons[0].label).toBe('איות זהה');
  });

  it('never returns a number anywhere on a suggestion', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    const [top] = await suggestPeopleForName(db, 'נועה לוי', { seasonId });
    expect(JSON.stringify(top)).not.toMatch(/"confidence":\s*[\d.]/);
    expect(top.confidence).not.toMatch(/\d/);
  });

  it('calls a first-name match in this season’s roster אפשרית', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    const suggestions = await suggestPeopleForName(db, 'נועה', { seasonId });
    const noa = suggestions.find((s) => s.displayName === 'נועה לוי')!;
    expect(noa.confidence).toBe('אפשרית');
    expect(noa.reasons.map((r) => r.key)).toContain('same-first-name');
  });

  it('calls a first-name match outside the roster חלשה and says it is outside', async () => {
    await addPerson('נועה ליבוביץ');
    const [only] = await suggestPeopleForName(db, 'נועה', { seasonId });
    expect(only.confidence).toBe('חלשה');
    expect(only.reasons.map((r) => r.key)).toContain('not-in-season-roster');
    expect(only.reasons.find((r) => r.key === 'not-in-season-roster')!.label)
      .toBe('לא ברשימת ברן 26');
  });

  it('recognises a surname initial', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    const [top] = await suggestPeopleForName(db, 'נועה ל.', { seasonId });
    expect(top.reasons.map((r) => r.key)).toContain('surname-initial');
    expect(top.reasons.find((r) => r.key === 'surname-initial')!.label)
      .toBe('האות הראשונה של שם המשפחה');
  });

  // The reason the test above needs its own candidate pass, pinned so nobody
  // "simplifies" suggest.ts back onto resolveName's list alone: resolveName is
  // exact-or-space-anchored-prefix, and `נועה ל.` is neither of `נועה לוי`.
  // It returns nothing, and a suggester built only on it can never carry a
  // surname-initial reason.
  it('offers a surname initial that resolveName itself refuses to see', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    const resolution = await resolveName(db, 'נועה ל.');
    expect(resolution.candidates).toEqual([]);
    expect(await suggestPeopleForName(db, 'נועה ל.', { seasonId })).toHaveLength(1);
  });

  it('does not offer a stranger who merely shares a surname initial', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    await addPerson('דנה לוין', { inSeason: true });
    const suggestions = await suggestPeopleForName(db, 'נועה ל.', { seasonId });
    expect(suggestions.map((s) => s.displayName)).toEqual(['נועה לוי']);
  });

  it('adds the payment reason only when the evidence matches amount and day', async () => {
    const id = await addPerson('נועה לוי', { inSeason: true });
    const [due] = await db.insert(dues).values({
      personId: id, seasonId, amount: '1200.00', kind: 'flat',
    }).returning();
    await db.insert(payments).values({
      dueId: due.id, amount: '1200.00', channel: 'העברה',
      paidOn: new Date('2026-06-18T00:00:00Z'), recordedBy: 'lead@shliff.test',
    });

    const withEvidence = await suggestPeopleForName(db, 'נועה ל.', {
      seasonId,
      evidence: { amountAgorot: 120000, onDate: new Date('2026-06-18T00:00:00Z') },
    });
    expect(withEvidence[0].reasons.map((r) => r.key)).toContain('paid-same-amount-same-day');
    expect(withEvidence[0].reasons.find((r) => r.key === 'paid-same-amount-same-day')!.label)
      .toBe('שולמו 1,200 ₪ באותו תאריך');

    const wrongDay = await suggestPeopleForName(db, 'נועה ל.', {
      seasonId,
      evidence: { amountAgorot: 120000, onDate: new Date('2026-06-19T00:00:00Z') },
    });
    expect(wrongDay[0].reasons.map((r) => r.key)).not.toContain('paid-same-amount-same-day');

    const noEvidence = await suggestPeopleForName(db, 'נועה ל.', { seasonId });
    expect(noEvidence[0].reasons.map((r) => r.key)).not.toContain('paid-same-amount-same-day');
  });

  it('returns at most three candidates, strongest first', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    await addPerson('נועה ליבוביץ');
    await addPerson('נועה כהן');
    await addPerson('נועה ברק');
    const suggestions = await suggestPeopleForName(db, 'נועה', { seasonId });
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].confidence).toBe('אפשרית');
    expect(suggestions.at(-1)!.confidence).toBe('חלשה');
  });

  it('returns nothing for a name nobody resembles, rather than the whole roster', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    expect(await suggestPeopleForName(db, 'אלמוני פלמוני', { seasonId })).toEqual([]);
  });

  it('writes nothing', async () => {
    await addPerson('נועה לוי', { inSeason: true });
    const before = await db.select().from(personAliases);
    await suggestPeopleForName(db, 'נועה ל.', { seasonId });
    expect(await db.select().from(personAliases)).toHaveLength(before.length);
    expect(await db.select().from(persons)).toHaveLength(1);
  });

  it('offers no person who was merged away', async () => {
    const survivor = await addPerson('נועה לוי', { inSeason: true });
    const merged = await addPerson('נועה לוין', { inSeason: true });
    await db.update(persons).set({ mergedIntoId: survivor })
      .where(eq(persons.id, merged));
    const suggestions = await suggestPeopleForName(db, 'נועה', { seasonId });
    expect(suggestions.map((s) => s.displayName)).toEqual(['נועה לוי']);
  });
});
