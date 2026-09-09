import { auth } from './config';

export type AdminCheck = { ok: true; email: string } | { ok: false };

/**
 * Server-side authorization gate. Every mutating route and server action calls
 * this. UI hiding is never the enforcement mechanism.
 */
export async function requireAdmin(): Promise<AdminCheck> {
  const session = await auth();
  const email = session?.user?.email;
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!email || role !== 'admin') return { ok: false };
  return { ok: true, email };
}
