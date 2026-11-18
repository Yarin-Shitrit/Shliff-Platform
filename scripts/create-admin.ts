import { db } from '@/db';
import { users } from '@/db/schema/auth';
import { hashPassword } from '@/lib/auth/password';
import { generatePassword } from '@/lib/auth/generate-password';

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error('usage: [ADMIN_PASSWORD=...] npx tsx scripts/create-admin.ts <email>');
    process.exit(1);
  }
  // No password given: make one, and print it once below — this is the one
  // account that cannot be made from /users, because /users needs it first.
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || generatePassword();

  const passwordHash = await hashPassword(password);
  const [row] = await db.insert(users)
    .values({ email, passwordHash, role: 'admin' })
    .returning();

  console.log(`created admin ${row.email}`);
  if (generated) console.log(`password (shown once, only the hash is stored): ${password}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
