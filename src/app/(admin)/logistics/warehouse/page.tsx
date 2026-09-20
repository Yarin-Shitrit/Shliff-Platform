import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listWarehouse, warehouseCounts, itemById } from '@/lib/logistics/warehouse';
import {
  parseWarehouseQuery, warehouseHref, categoryHref, newItemHref, sortHref,
  warehouseExportHref, WAREHOUSE_SORTS,
  type RawParams, type WarehouseView, type WarehouseSort,
} from '@/lib/logistics/warehouse-views';
import { ACQUISITIONS_PATH } from '@/lib/logistics/acquisitions-views';
import { CATEGORY_LABELS } from '@/lib/logistics/labels';
import type { LogisticsCategory } from '@/db/schema/logistics';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { SavedViews } from '@/components/ui/saved-views';
import { FilterBar, type FilterOption } from '@/components/ui/filter-bar';
import { ButtonLink } from '@/components/ui/button';
import { TopBar, ScopeChip } from '@/components/shell/top-bar';
import { Icon } from '@/components/ui/icon';
import { DateText } from '@/components/format';
import { WarehouseTable } from './warehouse-table';
import { ConditionMenu } from './condition-menu';
import { ItemDrawer } from './item-drawer';
import styles from './warehouse.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'מחסן' };

const CATEGORIES: readonly LogisticsCategory[] = [
  'kitchen', 'sanitation', 'living', 'build', 'general',
];

const VIEW_LABELS: Record<WarehouseView, string> = {
  all: 'הכול',
  attention: 'דורש טיפול',
  retired: 'יצא משימוש',
};

/** The sort chip's face. The same five the URL accepts, in the same order. */
const SORT_LABELS: Record<WarehouseSort, string> = {
  condition: 'מצב',
  name: 'שם',
  category: 'קטגוריה',
  quantity: 'כמות',
  location: 'מיקום',
};

/**
 * The warehouse is camp-wide, so this page reads no season and the banner
 * says so (R5). A `?season=` in the URL is ignored rather than honoured —
 * silently ignoring it would leave a lead switching years and wondering why
 * the list never changes.
 */
export default async function WarehousePage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseWarehouseQuery(params);
  const [rows, counts] = await Promise.all([
    listWarehouse(db, query),
    warehouseCounts(db, query),
  ]);

  const filtered = Boolean(query.q || query.category || query.view !== 'all');

  /* Both drawers close to the same place: the list as it was, filters and
     view intact (R6, and `drawer-url.ts`'s reasoning about what survives). */
  const closeHref = warehouseHref(params, {});
  const addHref = newItemHref(params);

  /* The peeked row is fetched rather than found among `rows`: a lead can
     arrive on a link to an item that the current filter excludes, and
     "the drawer is empty because of a filter you did not set" is not
     something a URL should be able to say. */
  const peeked = query.peek === null ? null : await itemById(db, query.peek);

  const categoryOptions: FilterOption[] = CATEGORIES.map((category) => ({
    id: category,
    label: `${CATEGORY_LABELS[category]} (${counts.byCategory[category]})`,
    href: categoryHref(params, category),
    current: query.category === category,
  }));

  const sortOptions: FilterOption[] = WAREHOUSE_SORTS.map((sort) => ({
    id: sort,
    label: SORT_LABELS[sort],
    href: sortHref(params, sort),
    current: query.sort === sort,
  }));

  return (
    <main className={styles.page}>
      {/*
        Ruling S1: the top bar belongs to the page, because every screen's
        crumbs, chip and actions differ. The chip is `ScopeChip` and not
        `SeasonChip` on purpose — this screen has no season, and saying so
        where every other screen names one is the whole of R5's requirement
        that camp-wide data declare itself rather than ignore `?season=`
        quietly.
      */}
      <TopBar
        crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'מחסן' }]}
        chip={<ScopeChip icon="layers">כלל־קאמפי · לא משויך לשנה</ScopeChip>}
        actions={(
          <>
            {/* `download`, because the destination is a file and not a page:
                without it the client router fetches the Route Handler's CSV as
                an RSC payload and nothing reaches the reader's downloads
                folder. The kit's `ButtonLink` carries the prop for this. */}
            <ButtonLink size="sm" href={warehouseExportHref(params)} download>
              <Icon name="download" size={14} />
              ייצוא
            </ButtonLink>
            <ButtonLink tone="primary" size="sm" href={addHref}>
              <Icon name="plus" size={14} />
              הוספת פריט
            </ButtonLink>
          </>
        )}
      />

      <div className={styles.head}>
        <div>
          <h1>מחסן</h1>
          <p className={styles.sub}>
            <bdi>{`${counts.total} פריטים ב־${CATEGORIES.length} קטגוריות`}</bdi>
            {' · '}
            <bdi>{`${counts.needsTesting + counts.needsRepair} דורשים טיפול`}</bdi>
            {counts.lastUpdatedAt === null ? null : (
              <>{' · עודכן לאחרונה '}<DateText at={counts.lastUpdatedAt} /></>
            )}
          </p>
        </div>
      </div>

      {/*
        The artboard puts a fourth tile here, `חסרים ונמצאים ברכש`. It is not
        built, and deliberately: that number belongs to one season, and this
        screen has just said in the line above that it belongs to none.
        Drawing a season's figure under that sentence would contradict it on
        the same screen. The link goes to רכש, where the number is in scope.
      */}
      <Banner
        tone="neutral"
        headline="המחסן אינו משויך לשנה."
        detail="ציוד שנקנה בשנה אחת עדיין שייך לקאמפ בשנה הבאה, ולכן הרשימה הזו זהה בכל שנה. רק רשימת הרכש מתחלפת."
        action={{ label: 'מעבר לרכש', href: ACQUISITIONS_PATH }}
      />

      <div className={styles.tiles}>
        <StatTile
          label="סך הפריטים"
          value={counts.total}
          derivation="נספרו ידנית · אין קובץ מקור"
        />
        <StatTile
          label="דורשים בדיקה"
          value={counts.needsTesting}
          tone="warn"
          href={warehouseHref(params, { view: 'attention' })}
          derivation="לבדוק לפני היציאה"
        />
        <StatTile
          label="דורשים תיקון"
          value={counts.needsRepair}
          tone="bad"
          href={warehouseHref(params, { view: 'attention' })}
          derivation="לא במצב עבודה"
        />
      </div>

      <SavedViews
        label="תצוגות"
        currentId={query.view}
        views={(Object.keys(VIEW_LABELS) as WarehouseView[]).map((view) => ({
          id: view,
          label: VIEW_LABELS[view],
          href: warehouseHref(params, { view: view === 'all' ? null : view }),
          count: view === 'all' ? counts.total
            : view === 'attention' ? counts.needsTesting + counts.needsRepair
              : counts.retired,
        }))}
      />

      <div className={styles.toolbar}>
        <FilterBar
          searchValue={query.q}
          searchLabel="חיפוש במחסן"
          searchPlaceholder="שם פריט או מיקום"
          chips={query.category === null ? [] : [{
            id: 'cat',
            label: 'קטגוריה',
            value: CATEGORY_LABELS[query.category],
            clearHref: warehouseHref(params, { cat: null }),
            options: categoryOptions,
          }]}
          addFilter={query.category === null ? { options: categoryOptions } : undefined}
          sort={{ value: SORT_LABELS[query.sort], options: sortOptions }}
          /* Counted on the server over the whole filtered set, never
             `rows.length` — the two agree today and would drift the day this
             list is paged. */
          rowCount={counts.shownRows}
        />
      </div>

      <WarehouseTable
        rows={rows}
        params={params}
        shownQuantity={counts.shownQuantity}
        rowActions={(row) => <ConditionMenu item={row} />}
        empty={filtered ? (
          <EmptyState
            kind="no-matches"
            filterSummary="הסינון הנוכחי"
            action={{
              label: 'ניקוי הסינון',
              href: warehouseHref(params, { view: null, cat: null, q: null }),
            }}
          />
        ) : (
          /* An invitation, not an apology: it says what the screen is for,
             and the action is the point of the screen rather than a
             consolation prize for it being empty. */
          <EmptyState kind="nothing-yet" noun="פריטים במחסן" action={{ label: 'הוספת פריט', href: addHref }} />
        )}
      />

      {peeked === null ? null : (
        <ItemDrawer item={peeked} closeHref={closeHref} />
      )}
      {query.creating ? <ItemDrawer item={null} closeHref={closeHref} /> : null}
    </main>
  );
}
