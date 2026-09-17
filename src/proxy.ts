export { auth as proxy } from '@/lib/auth/edge-config';

export const config = {
  /**
   * Everything except Next internals, static assets, and the sign-in flow.
   * Each excluded segment is anchored with `(?:/|$)` (or `$` for the exact
   * file `favicon.ico`) so the exclusion matches a whole path segment, not a
   * prefix (M15) — `/signin-x`, `/signinfoo`, `/api/authz` and
   * `/favicon.icox` are real routes and must still be gated, while
   * `/signin`, `/signin/…`, `/api/auth/…`, `/_next/static/…`,
   * `/_next/image…` and exactly `/favicon.ico` stay excluded.
   */
  matcher: [
    '/((?!signin(?:/|$)|api/auth(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)',
  ],
};
