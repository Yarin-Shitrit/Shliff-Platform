import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';

type AnyDb = Db | TestDb;

/**
 * Records an admin's confirmation of one block: updates the block, replaces
 * its mapping, and stores the mapping as a reusable layout signature so the
 * same layout is recognized automatically in future uploads.
 *
 * Takes the database as its first argument, rather than importing `@/db`
 * itself, so it stays importable (and testable against `createTestDb()`)
 * without `DATABASE_URL` set. It is also why this lives outside the
 * `'use server'` actions file: a server action may only take serializable
 * arguments, and a database handle is not one.
 */
export async function applyConfirmation(
  db: AnyDb,
  email: string,
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
): Promise<void> {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) throw new Error(`unknown block ${blockId}`);

  await db.update(blocks)
    .set({ archetype, confidence: '1.0000', confirmedBy: email, confirmedAt: new Date() })
    .where(eq(blocks.id, blockId));

  await db.update(blockMappings)
    .set({ columnMap, source: 'admin' })
    .where(eq(blockMappings.blockId, blockId));

  // Headerless blocks never fingerprinted, so there is nothing for a future
  // upload to recognize this layout by. Never store a signature for them.
  if (!block.fingerprint) return;

  await db.insert(layoutSignatures).values({
    fingerprint: block.fingerprint,
    archetype,
    columnMap,
    pipelineVersion: block.pipelineVersion,
    confirmedBy: email,
  }).onConflictDoUpdate({
    target: layoutSignatures.fingerprint,
    set: { archetype, columnMap, confirmedBy: email },
  });
}
