import { SkeletonPage, SkeletonTiles, SkeletonTable, SkeletonText } from '@/components/ui/skeleton';

/**
 * E3. What /fees shows while its queries run.
 *
 * The counts are the real screen's, so nothing jumps when the data lands. No
 * figure is drawn, not even a zero: a number here is a lie with a short shelf
 * life, and a reader who learns that a zero means "not yet" will read the real
 * zeroes the same way. One sentence is announced and every shape is hidden.
 */
export default function FeesLoading() {
  return (
    <SkeletonPage label="טוען את דמי הקאמפ…">
      <SkeletonTiles count={4} />
      <SkeletonText lines={1} />
      <SkeletonTable rows={11} columns={6} />
    </SkeletonPage>
  );
}
