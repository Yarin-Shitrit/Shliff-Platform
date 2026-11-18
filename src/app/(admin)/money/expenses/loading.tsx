import { SkeletonPage, SkeletonTable } from '@/components/ui/skeleton';

/**
 * E3. What /money/expenses shows while its queries run.
 *
 * The form's block first, then the table of the reader's own expenses, in the
 * real screen's order, so nothing jumps when the data lands. No figure is
 * drawn, not even a zero: a number here is a lie with a short shelf life. One
 * sentence is announced and every shape is hidden.
 */
export default function ExpensesLoading() {
  return (
    <SkeletonPage label="טוען את ההוצאות…">
      <SkeletonTable rows={4} columns={2} />
      <SkeletonTable rows={6} columns={7} />
    </SkeletonPage>
  );
}
