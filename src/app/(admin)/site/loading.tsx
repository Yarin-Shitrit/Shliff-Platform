import { SkeletonPage, SkeletonTiles, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What /site shows while its queries run. The counts are the real
 * screen's — four tiles, then the list under the board — so nothing jumps
 * when the data lands. No figure is drawn, not even a zero.
 */
export default function SiteLoading() {
  return (
    <SkeletonPage label="טוען את מפת הקאמפ…">
      <SkeletonTiles count={4} />
      <SkeletonTable rows={6} columns={6} />
    </SkeletonPage>
  );
}
