import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listWarehouse, warehouseCounts } from '@/lib/logistics/warehouse';
import {
  parseWarehouseQuery, warehouseHref, categoryHref,
  type RawParams, type WarehouseView,
} from '@/lib/logistics/warehouse-views';
import { CATEGORY_LABELS } from '@/lib/logistics/labels';
import type { LogisticsCategory } from '@/db/schema/logistics';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { WarehouseTable } from './warehouse-table';
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

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1>מחסן</h1>
          <p className={styles.sub}>
            {counts.total} פריטים · {counts.needsTesting + counts.needsRepair} דורשים טיפול
          </p>
        </div>
      </header>

      <Banner
        tone="neutral"
        headline="המחסן אינו משויך לשנה."
        detail="ציוד שנקנה בשנה אחת עדיין שייך לקאמפ בשנה הבאה, ולכן הרשימה הזו זהה בכל שנה. רק רשימת הרכש מתחלפת."
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

      <nav className={styles.chips} aria-label="סינון לפי קטגוריה">
        {(Object.keys(VIEW_LABELS) as WarehouseView[]).map((view) => (
          <Link
            key={view}
            href={warehouseHref(params, { view: view === 'all' ? null : view })}
            aria-current={query.view === view ? 'true' : undefined}
            className={styles.chip}
          >
            {VIEW_LABELS[view]}
          </Link>
        ))}
        <span className={styles.spacer} />
        {CATEGORIES.map((category) => (
          <Link
            key={category}
            href={categoryHref(params, category)}
            aria-current={query.category === category ? 'true' : undefined}
            className={styles.chip}
          >
            {CATEGORY_LABELS[category]} {counts.byCategory[category]}
          </Link>
        ))}
      </nav>

      <WarehouseTable
        rows={rows}
        params={params}
        shownQuantity={counts.shownQuantity}
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
          <EmptyState kind="nothing-yet" noun="פריטים במחסן" />
        )}
      />

    </div>
  );
}
