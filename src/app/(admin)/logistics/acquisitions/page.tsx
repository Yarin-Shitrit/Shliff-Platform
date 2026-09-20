import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listRoster } from '@/lib/members/roster';
import { listBudgetLines } from '@/lib/money/budget';
import {
  listAcquisitions, acquisitionCounts, acquisitionById,
} from '@/lib/logistics/acquisitions';
import { listWarehouse } from '@/lib/logistics/warehouse';
import {
  parseAcquisitionQuery, acquisitionsHref, arrivalHref, newAcquisitionHref,
  acquisitionSortHref, ACQUISITION_SORTS,
  type RawParams, type AcquisitionView, type AcquisitionSort,
} from '@/lib/logistics/acquisitions-views';
import { itemHref, WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';
import { CATEGORY_LABELS, STATUS_LABELS } from '@/lib/logistics/labels';
import type { LogisticsCategory } from '@/db/schema/logistics';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { SavedViews } from '@/components/ui/saved-views';
import { FilterBar, type FilterOption } from '@/components/ui/filter-bar';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { AcquisitionsTable } from './acquisitions-table';
import { AcquisitionDrawer } from './acquisition-drawer';
import { ArrivalDrawer } from './arrival-drawer';
import { StatusMenu } from './status-menu';
import styles from './acquisitions.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'רכש' };

const CATEGORIES: readonly LogisticsCategory[] = [
  'kitchen', 'sanitation', 'living', 'build', 'general',
];

/** `all` plus the four statuses, whose labels are the library's. */
const VIEW_LABELS: Record<AcquisitionView, string> = {
  all: 'הכול',
  to_search: STATUS_LABELS.to_search,
  in_review: STATUS_LABELS.in_review,
  ordered: STATUS_LABELS.ordered,
  arrived: STATUS_LABELS.arrived,
};

const SORT_LABELS: Record<AcquisitionSort, string> = {
  status: 'סטטוס',
  name: 'שם',
  category: 'קטגוריה',
  estimate: 'אומדן',
  actual: 'בפועל',
  assignee: 'אחראי',
};

/**
 * What the camp still needs for this season.
 *
 * Season-scoped, unlike the warehouse next door, and it says which season in
 * the top bar (R5). The two screens meet at one row action — `רישום למחסן` —
 * and that meeting is a decision a lead makes in a drawer, never one this
 * page infers from a status.
 */
export default async function AcquisitionsPage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseAcquisitionQuery(params);
  const { seasons, current } = await resolveSeason(db, query.season || undefined);

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'רכש' }]} />
        <h1>רכש</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  const [rows, counts, roster, budgetLines, warehouse] = await Promise.all([
    listAcquisitions(db, current.id, query),
    acquisitionCounts(db, current.id, query),
    listRoster(db, current.id),
    listBudgetLines(db, current.id),
    listWarehouse(db, {
      view: 'all', q: '', category: null, sort: 'name', dir: 'asc',
      peek: null, creating: false,
    }),
  ]);

  const peeked = query.peek === null ? null : await acquisitionById(db, query.peek);
  const closeHref = acquisitionsHref(params, {});
  const addHref = newAcquisitionHref(params);
  const filtered = Boolean(query.q || query.category || query.view !== 'all');

  /**
   * The roster, plus whoever a row already names. Somebody can be taken off a
   * season's roster while still holding an order, and a picker that quietly
   * dropped them would turn "save" into "unassign" without saying so.
   */
  const people = [...roster.map((entry) => ({ id: entry.personId, name: entry.displayName }))];
  for (const row of [peeked].filter((one): one is AcquisitionRow => one !== null)) {
    for (const person of [row.assignee, row.lender]) {
      if (person !== null && !people.some((option) => option.id === person.id)) {
        people.push({ id: person.id, name: person.name });
      }
    }
  }

  const lineOptions = budgetLines.map((line) => ({
    id: line.id, label: line.label, totalAgorot: line.totalAgorot,
  }));

  const categoryOptions: FilterOption[] = CATEGORIES.map((category) => ({
    id: category,
    label: CATEGORY_LABELS[category],
    href: acquisitionsHref(params, { cat: category }),
    current: query.category === category,
  }));

  const sortOptions: FilterOption[] = ACQUISITION_SORTS.map((sort) => ({
    id: sort,
    label: SORT_LABELS[sort],
    href: acquisitionSortHref(params, sort),
    current: query.sort === sort,
  }));

  /** The row action the artboard draws, chosen by what the row still needs. */
  function rowAction(row: AcquisitionRow) {
    if (row.arrivedItemId !== null) {
      return (
        <ButtonLink size="sm" href={itemHref({}, row.arrivedItemId)}>
          פתיחת הפריט במחסן
        </ButtonLink>
      );
    }
    if (row.status === 'arrived') {
      /* The open decision, and the only primary button in the table: this row
         says the thing is here and cannot say where. */
      return (
        <ButtonLink size="sm" tone="primary" href={arrivalHref(params, row.id)}>
          רישום למחסן
        </ButtonLink>
      );
    }
    if (row.status === 'ordered') {
      return <ButtonLink size="sm" href={arrivalHref(params, row.id)}>רישום למחסן</ButtonLink>;
    }
    return null;
  }

  return (
    <main className={styles.page}>
      <TopBar
        crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'רכש' }]}
        chip={<SeasonChip seasonName={current.name} />}
        actions={(
          <ButtonLink tone="primary" size="sm" href={addHref}>
            <Icon name="plus" size={14} />
            הוספת פריט לרכש
          </ButtonLink>
        )}
      />

      <div className={styles.head}>
        <div>
          <h1>רכש</h1>
          <p className={styles.sub}>
            <bdi>{`${counts.remainingRows} פריטים חסרים ל${current.name}`}</bdi>
            {' · '}
            <bdi>{`${counts.byStatus.arrived} כבר הגיעו`}</bdi>
            {seasons.length > 1 ? <>{' · '}<bdi>{`${seasons.length} שנים במערכת`}</bdi></> : null}
          </p>
        </div>
      </div>

      {counts.unregisteredArrivals > 0 && (
        /* The screen's open decision, said out loud. It is a banner rather
           than a silent row state because a thing that has arrived and has no
           location is the one case where the warehouse is quietly wrong. */
        <Banner
          tone="warn"
          headline={(
            <bdi>
              {counts.unregisteredArrivals === 1
                ? 'פריט אחד הגיע ועדיין לא נרשם במחסן.'
                : `${counts.unregisteredArrivals} פריטים הגיעו ועדיין לא נרשמו במחסן.`}
            </bdi>
          )}
          detail="המערכת לא ממציאה מיקום ומצב — צריך להגיד לה איפה זה אוחסן."
          action={{ label: 'הצגתם', href: acquisitionsHref(params, { view: 'arrived' }) }}
        />
      )}

      <div className={styles.tiles}>
        <StatTile
          label="אומדן תקציב"
          valueAgorot={counts.estimatedAgorot}
          derivation={<bdi>{`${counts.budgetLinked} פריטים משויכים לסעיף תקציב`}</bdi>}
          href="/money#budget"
        />
        <StatTile
          label="הוצא בפועל"
          valueAgorot={counts.actualAgorot}
          tone="ok"
          derivation={<bdi>{`${counts.byStatus.arrived} פריטים הגיעו`}</bdi>}
          href="/money/ledger"
        />
        <StatTile
          label="נותר לרכוש"
          valueAgorot={counts.remainingAgorot}
          derivation={<bdi>{`על פי האומדן של ${counts.remainingRows} פריטים שטרם הגיעו`}</bdi>}
        />
        <StatTile
          label="הגיעו למחסן"
          value={counts.byStatus.arrived - counts.unregisteredArrivals}
          derivation={counts.unregisteredArrivals === 0
            ? 'כל אחד מהם נרשם כפריט במחסן'
            : <bdi>{`${counts.unregisteredArrivals} נוספים הגיעו וטרם נרשמו`}</bdi>}
          href={WAREHOUSE_PATH}
        />
      </div>

      <SavedViews
        label="תצוגות"
        currentId={query.view}
        views={(Object.keys(VIEW_LABELS) as AcquisitionView[]).map((view) => ({
          id: view,
          label: VIEW_LABELS[view],
          href: acquisitionsHref(params, { view: view === 'all' ? null : view }),
          count: view === 'all' ? counts.total : counts.byStatus[view],
        }))}
      />

      <div className={styles.toolbar}>
        <FilterBar
          searchValue={query.q}
          searchLabel="חיפוש ברכש"
          searchPlaceholder="שם פריט"
          chips={query.category === null ? [] : [{
            id: 'cat',
            label: 'קטגוריה',
            value: CATEGORY_LABELS[query.category],
            clearHref: acquisitionsHref(params, { cat: null }),
            options: categoryOptions,
          }]}
          addFilter={query.category === null ? { options: categoryOptions } : undefined}
          sort={{ value: SORT_LABELS[query.sort], options: sortOptions }}
          rowCount={counts.shownRows}
        />
      </div>

      <AcquisitionsTable
        rows={rows}
        params={params}
        shownEstimatedAgorot={counts.shownEstimatedAgorot}
        shownActualAgorot={counts.shownActualAgorot}
        rowActions={(row) => (
          <span className={styles.rowActions}>
            {rowAction(row)}
            <StatusMenu row={row} />
          </span>
        )}
        empty={filtered ? (
          <EmptyState
            kind="no-matches"
            filterSummary="הסינון הנוכחי"
            action={{
              label: 'ניקוי הסינון',
              href: acquisitionsHref(params, { view: null, cat: null, q: null }),
            }}
          />
        ) : (
          <EmptyState
            kind="nothing-this-season"
            noun="פריטים ברכש"
            seasonName={current.name}
            action={{ label: 'הוספת פריט לרכש', href: addHref }}
          />
        )}
      />

      {/*
        Three drawers, one slot, resolved in this order: the arrival decision
        wins over the record it is about, and the create form only opens when
        no record is named at all (`parseAcquisitionQuery` enforces the last
        part). A URL naming two of them means one of them.
      */}
      {peeked !== null && query.arriving && (
        <ArrivalDrawer
          row={peeked}
          items={warehouse.map((item) => ({
            id: item.id, name: item.name, locationText: item.locationText, quantity: item.quantity,
          }))}
          budgetLines={lineOptions}
          closeHref={closeHref}
        />
      )}
      {peeked !== null && !query.arriving && (
        <AcquisitionDrawer
          row={peeked}
          seasonId={current.id}
          seasonName={current.name}
          people={people}
          budgetLines={lineOptions}
          closeHref={closeHref}
        />
      )}
      {query.creating && (
        <AcquisitionDrawer
          row={null}
          seasonId={current.id}
          seasonName={current.name}
          people={people}
          budgetLines={lineOptions}
          closeHref={closeHref}
        />
      )}
    </main>
  );
}
