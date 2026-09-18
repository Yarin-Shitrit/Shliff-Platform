import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What /money shows while its queries run.
 *
 * The counts are the real screen's, so nothing jumps when the data lands. No
 * figure is drawn, not even a zero: a number here is a lie with a short shelf
 * life, and a reader who learns that a zero means "not yet" will read the real
 * zeroes the same way. One sentence is announced and every shape is hidden.
 */
export default function MoneyLoading() {
  return (
    <SkeletonPage label="טוען את הסקירה הכספית…">
      <SkeletonTiles count={5} />
      <SkeletonTable rows={5} columns={3} />
      <SkeletonTable rows={7} columns={6} />
    </SkeletonPage>
  );
}
