import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What ימי עבודה shows while its queries run — the strip of days, three
 * tiles and the day's tasks, in the real screen's order. No figure is drawn:
 * a number here would be a lie with a short shelf life.
 */
export default function WorkdaysLoading() {
  return (
    <SkeletonPage label="טוען את ימי העבודה…">
      <SkeletonTable rows={1} columns={5} />
      <SkeletonTiles count={3} />
      <SkeletonTable rows={5} columns={3} />
    </SkeletonPage>
  );
}
