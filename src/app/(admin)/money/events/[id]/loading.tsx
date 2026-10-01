import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What a party's page shows while its queries run. Same rule as the
 * list: shapes only, never a figure.
 */
export default function PartyLoading() {
  return (
    <SkeletonPage label="טוען את המסיבה…">
      <SkeletonTiles count={4} />
      <SkeletonTable rows={6} columns={6} />
    </SkeletonPage>
  );
}
