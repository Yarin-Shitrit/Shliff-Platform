import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What the נוכחות screen shows while its queries run — three tiles and
 * a wide board, the shape the real screen lands in, so nothing jumps. No
 * figure is drawn: a number here would be a lie with a short shelf life.
 */
export default function AttendanceLoading() {
  return (
    <SkeletonPage label="טוען את לוח הנוכחות…">
      <SkeletonTiles count={3} />
      <SkeletonTable rows={8} columns={6} />
    </SkeletonPage>
  );
}
