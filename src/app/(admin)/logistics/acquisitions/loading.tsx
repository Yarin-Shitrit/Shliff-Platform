import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What the רכש screen shows while its queries run — four tiles and a
 * nine-column table, the shape the real screen lands in, so nothing jumps.
 *
 * No figure is drawn. A number here is a lie with a short shelf life, and a
 * reader who learns that a zero means "not yet" will read the real zeroes the
 * same way.
 */
export default function AcquisitionsLoading() {
  return (
    <SkeletonPage label="טוען את רשימת הרכש…">
      <SkeletonTiles count={4} />
      <SkeletonTable rows={8} columns={9} />
    </SkeletonPage>
  );
}
