import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { obligations } from '@/db/schema/money';
import { persons, personAliases } from '@/db/schema/camp';
import { aliasSourcesFor } from './alias-sources';

let db: TestDb;

const LEAD = 'lead@shliff.test';

/** Reuses the fixture shape `src/lib/money/trace.test.ts` builds — one
 *  upload, one sheet, one confirmed block. */
async function addSheet(filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}/${name}`, storageKey: `k/${name}`,
    sizeBytes: 1, uploadedBy: LEAD, status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name, index: 0, rowCount: 20, colCount: 6,
  }).returning();
  return sheet.id;
}

async function addBlock(
  onSheet: string, opts: { top?: number; left?: number } = {},
): Promise<string> {
  const top = opts.top ?? 1;
  const left = opts.left ?? 1;
  const [block] = await db.insert(blocks).values({
    sheetId: onSheet, top, left, bottom: top, right: left,
    archetype: 'obligations', confidence: '1.0000', headerRow: null, fingerprint: null,
    pipelineVersion: 1, rawGrid: [['x']],
    confirmedBy: LEAD, confirmedAt: new Date(),
  }).returning();
  return block.id;
}

async function addPerson(displayName: string): Promise<string> {
  const [person] = await db.insert(persons).values({ displayName }).returning();
  return person.id;
}

beforeEach(async () => {
  db = await createTestDb();
});

describe('aliasSourcesFor', () => {
  it('a manual alias carries no cell — נרשם ידנית is the whole truth about it', async () => {
    const personId = await addPerson('אופק');
    await db.insert(personAliases).values({
      personId, alias: 'אופק', normalized: 'אופק', source: 'manual',
      confirmedBy: LEAD, confirmedAt: new Date(),
    });

    const [source] = await aliasSourcesFor(db, personId);

    expect(source.source).toBe('manual');
    expect(source.cell).toBeNull();
  });

  it('an import alias whose text matches an obligation shows that obligation\'s cell', async () => {
    const personId = await addPerson('יוסף');
    await db.insert(personAliases).values({
      personId, alias: 'יוסף', normalized: 'יוסף', source: 'import',
    });
    const sheetId = await addSheet('2026.xlsx', 'חובות');
    const blockId = await addBlock(sheetId, { top: 1, left: 1 });
    await db.insert(obligations).values({
      direction: 'camp_owes', partyName: 'יוסף', description: 'חוב יוסף',
      amount: '300.00', sourceBlockId: blockId, sourceRow: 5,
    });

    const [source] = await aliasSourcesFor(db, personId);

    expect(source.cell).not.toBeNull();
    expect(source.cell!.reference).toBe('חובות!A5');
  });

  it('an import alias nothing corroborates carries no cell', async () => {
    const personId = await addPerson('עמירם דהן');
    await db.insert(personAliases).values({
      personId, alias: 'עמירם דהן', normalized: 'עמירם דהן', source: 'import',
    });

    const [source] = await aliasSourcesFor(db, personId);

    expect(source.cell).toBeNull();
  });

  it('an obligation with a party name but no source block yields no cell', async () => {
    const personId = await addPerson('דניאל');
    await db.insert(personAliases).values({
      personId, alias: 'דניאל', normalized: 'דניאל', source: 'import',
    });
    // Seeded by hand — party_name is set, source_block_id is not.
    await db.insert(obligations).values({
      direction: 'camp_owes', partyName: 'דניאל', description: 'חוב דניאל', amount: '150.00',
    });

    const [source] = await aliasSourcesFor(db, personId);

    expect(source.cell).toBeNull();
  });

  it('matches ignore stray whitespace because both sides normalize', async () => {
    const personId = await addPerson('נטלי');
    await db.insert(personAliases).values({
      personId, alias: 'נטלי', normalized: 'נטלי', source: 'import',
    });
    const sheetId = await addSheet('2026.xlsx', 'חובות');
    const blockId = await addBlock(sheetId, { top: 1, left: 1 });
    await db.insert(obligations).values({
      direction: 'camp_owes', partyName: '  נטלי   ', description: 'חוב נטלי',
      amount: '80.00', sourceBlockId: blockId, sourceRow: 9,
    });

    const [source] = await aliasSourcesFor(db, personId);

    expect(source.cell).not.toBeNull();
    expect(source.cell!.reference).toBe('חובות!A9');
  });

  it('an alias that arrived in a merge reports the person it came from', async () => {
    const survivorId = await addPerson('אופק');
    const sourceId = await addPerson('אופק כהן');
    await db.insert(personAliases).values({
      personId: survivorId, alias: 'אופק כהן', normalized: 'אופק כהן', source: 'manual',
      mergedFromPersonId: sourceId, confirmedBy: LEAD, confirmedAt: new Date(),
    });

    const [source] = await aliasSourcesFor(db, survivorId);

    expect(source.mergedFromPersonId).toBe(sourceId);
  });
});
