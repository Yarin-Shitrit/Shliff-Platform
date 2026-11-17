import { pgTable, uuid, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /**
   * `admin` sees and edits every page, and is the only role that can open
   * משתמשים והרשאות. Any other value — the column's default `viewer` — means
   * the account sees exactly the pages `user_page_access` grants it, at the
   * level each row names, and nothing else.
   */
  role: text('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per (account, page) a non-admin account may open. `page` is a
 * `PageKey` from `src/lib/auth/pages.ts` — the same id the rail uses for
 * the item — and `level` is `view` or `edit`. No row means no access: the
 * absence is the refusal, so there is no third value to keep in sync.
 *
 * Rows go with their account (`onDelete: 'cascade'`): an access grant with
 * nobody to grant it to is not a decision anyone made.
 */
export const userPageAccess = pgTable('user_page_access', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  page: text('page').notNull(),
  level: text('level').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.page] }),
]);
