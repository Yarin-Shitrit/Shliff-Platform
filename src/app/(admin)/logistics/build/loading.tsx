import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. Three tiles and a seven-column table, the shape the real screen lands
 * in. No figure is drawn: a number here is a lie with a short shelf life, and
 * a reader who learns that a zero means "not yet" reads the real zeroes the
 * same way.
 */
export default function BuildLoading() {
  return (
    <SkeletonPage label="טוען את משימות ההקמה…">
      <SkeletonTiles count={3} />
      <SkeletonTable rows={8} columns={7} />
    </SkeletonPage>
  );
}
