import { SkeletonPage, SkeletonTiles } from '@/components/ui/skeleton';

/**
 * E3. This route only redirects to מחסן, so there is no shape of its own to
 * draw. It borrows the warehouse's tiles rather than showing nothing, because
 * that is where the reader is about to land.
 */
export default function LogisticsLoading() {
  return (
    <SkeletonPage label="טוען…">
      <SkeletonTiles count={3} />
    </SkeletonPage>
  );
}
