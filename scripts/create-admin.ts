import { db } from '@/db';
import { users } from '@/db/schema/auth';
import { hashPassword } from '@/lib/auth/password';

async function main() {
  const [email] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('usage: ADMIN_PASSWORD=... npx tsx scripts/create-admin.ts <email>');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const [row] = await db.insert(users)
    .values({ email, passwordHash, role: 'admin' })
    .returning();

  console.log(`created admin ${row.email}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
