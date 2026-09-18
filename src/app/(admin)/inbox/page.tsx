import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import {
  inboxItems, openDecisionCount, tabOf, groupOf,
  type InboxGroup,
} from '@/lib/inbox/items';
import { resolvedItems, clearedToday } from '@/lib/inbox/resolved';
import { EmptyState } from '@/components/ui/empty-state';
import { readSnoozes } from './snooze';
import { ItemRail } from './item-rail';
import { ItemDetail } from './item-detail';
import styles from './inbox.module.css';

export const dynamic = 'force-dynamic';

/** B8: every page sets its own title; today every page is "פלטפורמת שליף". */
export const metadata = { title: 'לטיפול · קופת שליף' };

const TABS: Array<{ id: 'decide' | 'notice' | 'done'; label: string }> = [
  { id: 'decide', label: 'ממתין להחלטה' },
  { id: 'notice', label: 'לידיעה' },
  { id: 'done', label: 'טופלו' },
];

const GROUP_LABELS: Array<{ group: InboxGroup; label: string }> = [
  { group: 'names', label: 'שמות' },
  { group: 'sheets', label: 'גיליונות' },
  { group: 'blocks', label: 'טבלאות' },
  { group: 'debts', label: 'חובות' },
  { group: 'refusals', label: 'סירובים' },
];

function one(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${String(date.getUTCFullYear()).slice(-2)}`;
}

/**
 * לטיפול — every decision the platform refused to make on its own.
 *
 * **There is deliberately no promote-everything control here.** The plan's
 * file table put one in this header; integration A23, confirmed by the camp
 * lead, forbids it, because re-promoting one real block re-inserts rows its
 * bounds swept in from a summary sub-table and doubles ברן 26's budget
 * unrepairably. What the register may do is *render what promotion would do*,
 * which is Task 11. `page.test.tsx` scans this file and holds the line.
 */
export default async function InboxPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const tab = (['decide', 'notice', 'done'] as const)
    .find((t) => t === one(params.tab)) ?? 'decide';
  const kind = ([...GROUP_LABELS.map((g) => g.group), 'all'] as const)
    .find((k) => k === one(params.kind)) ?? 'all';

  // A33 permits `?season=all`, which is a view and not a season id. Passed
  // through as one it would send the name suggester looking up a season
  // called "all"; the register is camp-wide anyway (Ruling 7), and the season
  // only ever explains a candidate.
  const seasonParam = one(params.season);
  const seasonId = seasonParam === 'all' ? null : seasonParam;

  const now = new Date();
  const snoozed = await readSnoozes(now);
  const items = await inboxItems(db, {
    snoozed,
    now,
    recordedBy: admin.email,
    seasonId,
    // This is the screen that renders refused rows, so it is the one caller
    // that asks for the dry run behind them.
    includeRefusals: true,
  });
  const resolved = await resolvedItems(db);

  const decideCount = openDecisionCount(items);
  const noticeCount = items.length - decideCount;

  const inTab = items.filter((item) => tabOf(item) === tab);
  const filtered = kind === 'all' ? inTab : inTab.filter((item) => groupOf(item) === kind);
  const activeId = one(params.item) ?? filtered[0]?.id ?? null;
  const active = filtered.find((item) => item.id === activeId) ?? null;
  const activeIndex = filtered.findIndex((i) => i.id === activeId);

  const groups = GROUP_LABELS
    .map((g) => ({ ...g, count: inTab.filter((i) => groupOf(i) === g.group).length }))
    .filter((g) => g.count > 0);

  const nothingAtAll = items.length === 0 && resolved.length === 0;
  const kindLabel = GROUP_LABELS.find((g) => g.group === kind)?.label ?? '';

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1>לטיפול</h1>
          <p className={styles.lead}>
            המערכת לא מנחשת. כאן כל מה שהיא סירבה להכריע לבד — אתם מכריעים, היא כותבת.
          </p>
          <p className={styles.scope}>
            הרשימה הזו חוצה שנים — שם, גיליון או חוב לא שייכים לעונה אחת.
          </p>
        </div>
        <div className={styles.headActions}>
          <span className={styles.cleared}>
            <bdi>נוקו היום: {clearedToday(resolved, now)}</bdi>
          </span>
        </div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="מצב הפריטים">
        {TABS.map((t) => (
          <Link
            key={t.id}
            role="tab"
            href={`/inbox?tab=${t.id}&kind=all`}
            aria-selected={t.id === tab}
            className={styles.tab}
          >
            {t.label}
            {t.id === 'decide' && decideCount > 0 && <span className={styles.n}>{decideCount}</span>}
            {t.id === 'notice' && noticeCount > 0 && <span className={styles.n}>{noticeCount}</span>}
          </Link>
        ))}
      </div>

      {tab === 'done' ? (
        resolved.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState
              kind="nothing-yet"
              noun="ההחלטות שהוכרעו"
              action={{ label: 'העלאת קובץ', href: '/imports' }}
            />
          </div>
        ) : (
          <ul className={styles.doneList} aria-label="החלטות שהוכרעו">
            {resolved.map((item) => (
              <li key={item.id} className={styles.doneRow}>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={styles.rowDetail}>{item.detail}</span>
                <span className={styles.doneWhen}>
                  {item.decidedAt === null
                    ? 'התאריך לא נשמר'
                    : <bdi>{formatDate(item.decidedAt)} · {item.decidedBy}</bdi>}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className={styles.body}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {nothingAtAll ? (
                <EmptyState
                  kind="nothing-yet"
                  noun="ההחלטות שהמערכת לא הכריעה לבד"
                  action={{ label: 'העלאת קובץ', href: '/imports' }}
                />
              ) : kind !== 'all' ? (
                <EmptyState
                  kind="no-matches"
                  filterSummary={kindLabel}
                  action={{ label: 'הצגת הכול', href: `/inbox?tab=${tab}&kind=all` }}
                />
              ) : tab === 'decide' ? (
                <>
                  <EmptyState kind="all-clear" />
                  {/*
                    The onward link sits beside the empty state rather than
                    inside it: the kit's `all-clear` takes no action, and C10
                    gives the kit the sentence — a screen supplies a noun at
                    most, never copy of its own. Reported as a kit gap.
                  */}
                  <p className={styles.onward}>
                    <Link href="/money">כספים</Link>
                  </p>
                </>
              ) : (
                <EmptyState
                  kind="none-of-this-kind"
                  noun="דברים לידיעה"
                  action={{ label: 'ממתין להחלטה', href: '/inbox?tab=decide&kind=all' }}
                />
              )}
            </div>
          ) : (
            <>
              <ItemRail
                items={filtered} groups={groups} activeId={activeId} tab={tab} kind={kind}
              />
              <ItemDetail
                item={active}
                position={activeIndex + 1}
                total={filtered.length}
                nextId={filtered[activeIndex + 1]?.id ?? null}
                prevId={activeIndex > 0 ? filtered[activeIndex - 1]?.id ?? null : null}
                tab={tab} kind={kind}
              />
            </>
          )}
        </div>
      )}
    </main>
  );
}
