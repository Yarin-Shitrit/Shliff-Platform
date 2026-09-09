import NextAuth, { type NextAuthConfig } from 'next-auth';
import { isAuthorized } from './authorized';

/**
 * Edge-safe NextAuth configuration: no `@/db`, no `argon2`, no drizzle.
 * Next.js runs middleware on the Edge runtime, which supports none of those.
 * This holds only what middleware needs — the `authorized` callback plus the
 * JWT/session shape — and is spread into the full Node-runtime config in
 * `./config`, which adds the database-backed Credentials provider.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  providers: [],
  callbacks: {
    authorized({ auth }) {
      return isAuthorized(auth);
    },
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string | undefined;
      }
      return session;
    },
  },
};

export const { auth } = NextAuth(authConfig);
