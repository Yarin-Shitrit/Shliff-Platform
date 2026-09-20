import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guard';
import { WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';

export const metadata: Metadata = { title: 'לוגיסטיקה' };

/**
 * No hub screen. The acquisition budget summary belongs on רכש, and a fourth
 * nav item holding four tiles is not worth the sidebar space; if the camp asks
 * for an overview later it can have this route.
 *
 * It still guards. `admin-guard.test.ts` requires every admin entry point to
 * call `requireAdmin`, and a redirect is an entry point: without the check
 * this route would confirm, to anyone at all, that `/logistics/warehouse`
 * exists. Cheap to add, and the net is right to insist.
 */
export default async function LogisticsPage(): Promise<never> {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();
  redirect(WAREHOUSE_PATH);
}
