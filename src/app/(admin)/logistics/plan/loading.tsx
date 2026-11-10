import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What the לוח עבודה screen shows while its queries run — three tiles
 * and a list, the shape the real screen lands in, so nothing jumps. No
 * figure is drawn: a number here would be a lie with a short shelf life.
 */
export default function PlanLoading() {
  return (
    <SkeletonPage label="טוען את לוח העבודה…">
      <SkeletonTiles count={3} />
      <SkeletonTable rows={6} columns={5} />
    </SkeletonPage>
  );
}
