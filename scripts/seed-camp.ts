/**
 * Seeds the camp baseline into the configured database.
 *
 * Idempotent: safe to run repeatedly. Reads DATABASE_URL from the environment,
 * so it must be invoked with .env.local loaded.
 */
import { db } from '@/db';
import { seedCampBaseline } from '@/lib/seed/camp-seed';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error('usage: tsx scripts/seed-camp.ts <admin-email>');

  const result = await seedCampBaseline(db, email);
  console.log(JSON.stringify(result));
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
