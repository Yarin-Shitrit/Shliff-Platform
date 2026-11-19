import { SkeletonPage, SkeletonTiles } from '@/components/ui/skeleton';

/**
 * E3. The overview is cards: what needs a hand and the next work day, then
 * one card per screen. The skeleton draws the two rows of them.
 */
export default function LogisticsLoading() {
  return (
    <SkeletonPage label="טוען…">
      <SkeletonTiles count={2} />
      <SkeletonTiles count={4} />
    </SkeletonPage>
  );
}
