import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as source from './schema/source';
import * as camp from './schema/camp';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

/**
 * Serverless changes what a pool is for. Each Vercel instance loads this
 * module once and holds its own pool, so postgres.js's default `max: 10` is
 * ten sockets *per instance* — twenty warm instances would ask Railway for two
 * hundred. `max: 3` still lets one page's `Promise.all` of queries overlap,
 * which is the latency the fra1 ↔ europe-west4 pairing exists to protect,
 * while bounding that same burst to sixty.
 *
 * `idle_timeout` matters for the same reason: an instance is frozen between
 * requests, and a socket held across the freeze is dead on the next thaw.
 *
 * TLS is conditional on the host, not unconditional. `shliff-pg`
 * (postgres:16-alpine on 5433) serves no TLS, and neither does CI's fake
 * address, so `ssl: 'require'` everywhere would break every developer's
 * machine while reading as a production-only change. `'require'` encrypts
 * without demanding a verifiable CA chain, which is what Railway's TCP proxy
 * presents.
 *
 * NOT set: `prepare: false`. That is required against a *transaction-mode
 * pooler* — PgBouncer, Supabase's Supavisor, Neon's pooled endpoint — which
 * rejects named prepared statements. Railway's proxy is a plain passthrough,
 * and turning prepared statements off costs performance for nothing. If this
 * database is ever moved behind a pooler, `prepare: false` becomes mandatory
 * and the symptom is every query failing on a prepared statement.
 */
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);

const client = postgres(connectionString, {
  ssl: isLocal ? false : 'require',
  max: isLocal ? 10 : 3,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema: { ...source, ...camp } });
export type Db = typeof db;
