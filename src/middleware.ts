export { auth as middleware } from '@/lib/auth/config';

export const config = {
  /** Everything except Next internals, static assets, and the sign-in flow. */
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|signin).*)'],
};
