import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What /inbox shows while its queries run.
 *
 * The counts are the real screen's, so nothing jumps when the data lands. No
 * figure is drawn, not even a zero: a number here is a lie with a short shelf
 * life, and a reader who learns that a zero means "not yet" will read the real
 * zeroes the same way. One sentence is announced and every shape is hidden.
 */
export default function InboxLoading() {
  return (
    <SkeletonPage label="טוען את מה שמחכה לטיפול…">
      <SkeletonTiles count={4} />
      <SkeletonTable rows={8} columns={3} />
    </SkeletonPage>
  );
}
