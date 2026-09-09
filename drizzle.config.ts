import type { Config } from 'drizzle-kit';

export default {
  schema: ['./src/db/schema/source.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config;
