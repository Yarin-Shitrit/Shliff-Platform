import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What /money/events shows while its queries run.
 *
 * The counts are the real screen's, so nothing jumps when the data lands. No
 * figure is drawn, not even a zero: a number here is a lie with a short shelf
 * life. One sentence is announced and every shape is hidden.
 */
export default function EventsLoading() {
  return (
    <SkeletonPage label="טוען את המסיבות…">
      <SkeletonTiles count={3} />
      <SkeletonTable rows={8} columns={7} />
    </SkeletonPage>
  );
}
