import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What the warehouse shows while its queries run.
 *
 * Three tiles and a six-column table, matching the real screen, so nothing
 * jumps when the data lands. No figure is drawn — a number here is a lie with
 * a short shelf life, and a reader who learns that a zero means "not yet"
 * will read the real zeroes the same way.
 */
export default function WarehouseLoading() {
  return (
    <SkeletonPage label="טוען את המחסן…">
      <SkeletonTiles count={3} />
      <SkeletonTable rows={8} columns={6} />
    </SkeletonPage>
  );
}
