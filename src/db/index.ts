import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as source from './schema/source';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const client = postgres(connectionString);
export const db = drizzle(client, { schema: { ...source } });
export type Db = typeof db;
