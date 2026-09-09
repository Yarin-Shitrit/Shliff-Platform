import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema/auth';
import { verifyPassword } from './password';
import { authConfig } from './edge-config';

/**
 * Node-runtime NextAuth instance. Spreads the edge-safe shared config
 * (session shape, `authorized`/jwt/session callbacks, sign-in page) and adds
 * the Credentials provider, whose `authorize` needs the database and argon2
 * — neither of which the Edge runtime supports. Used by route handlers,
 * server actions, and `guard.ts`; never by `src/middleware.ts`.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const email = typeof raw?.email === 'string' ? raw.email : '';
        const password = typeof raw?.password === 'string' ? raw.password : '';
        if (!email || !password) return null;

        const [user] = await db.select().from(users).where(eq(users.email, email));
        if (!user) return null;
        if (!(await verifyPassword(user.passwordHash, password))) return null;

        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
});
