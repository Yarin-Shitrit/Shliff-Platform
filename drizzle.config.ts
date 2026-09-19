import type { Config } from 'drizzle-kit';

export default {
  schema: [
    './src/db/schema/source.ts',
    './src/db/schema/auth.ts',
    './src/db/schema/camp.ts',
    './src/db/schema/money.ts',
    './src/db/schema/logistics.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config;
