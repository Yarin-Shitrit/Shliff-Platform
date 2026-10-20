import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What the משמרות screen shows while its queries run — three tiles and a
 * seven-column board, the shape the real screen lands in, so nothing jumps.
 * No figure is drawn: a number here would be a lie with a short shelf life.
 */
export default function ShiftsLoading() {
  return (
    <SkeletonPage label="טוען את לוח המשמרות…">
      <SkeletonTiles count={3} />
      <SkeletonTable rows={5} columns={7} />
    </SkeletonPage>
  );
}
