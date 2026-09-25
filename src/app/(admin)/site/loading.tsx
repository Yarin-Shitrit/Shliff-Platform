import { SkeletonPage, SkeletonTable, SkeletonText } from '@/components/ui/skeleton';

/**
 * E3. What /site shows while its queries run: a line for the tool row, then
 * the item table — the view a phone and a browser without WebGL get, and the
 * one shape of this page a skeleton can honestly draw. The four stat tiles
 * retired with the board (spec §12). No figure is drawn, not even a zero.
 */
export default function SiteLoading() {
  return (
    <SkeletonPage label="טוען את מפת הקאמפ…">
      <SkeletonText lines={1} />
      <SkeletonTable rows={6} columns={7} />
    </SkeletonPage>
  );
}
