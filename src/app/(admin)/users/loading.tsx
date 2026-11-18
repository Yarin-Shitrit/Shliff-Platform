import { SkeletonPage, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What /users shows while the accounts are read. One table, the real
 * screen's column count; no figure is drawn.
 */
export default function UsersLoading() {
  return (
    <SkeletonPage label="טוען את המשתמשים…">
      <SkeletonTable rows={6} columns={4} />
    </SkeletonPage>
  );
}
