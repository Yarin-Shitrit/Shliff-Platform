import type { UserRow } from '@/lib/auth/users';

/**
 * `3 לצפייה · 2 לעריכה`, or the one word for an account with nothing. A
 * plain module rather than an export of the page: a `page.tsx` may export
 * only Next's own names, and the drawer's subtitle reads this too.
 */
export function accessSummary(user: Pick<UserRow, 'admin' | 'pages'>): string {
  if (user.admin) return 'כל העמודים';
  const levels = Object.values(user.pages);
  const view = levels.filter((level) => level === 'view').length;
  const edit = levels.filter((level) => level === 'edit').length;
  if (view + edit === 0) return 'אף עמוד';
  const parts: string[] = [];
  if (view > 0) parts.push(`${view} לצפייה`);
  if (edit > 0) parts.push(`${edit} לעריכה`);
  return parts.join(' · ');
}
