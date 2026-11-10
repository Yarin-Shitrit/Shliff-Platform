import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import {
  listPlan, listTopics, topicById, buildPlanTree, buildTimeline, summarizePlan, planRoster,
} from '@/lib/logistics/plan';
import { campDayOf } from '@/lib/logistics/shift-time';
import {
  parsePlanQuery, planHref, newItemHref, newTopicHref, type RawParams,
} from '@/lib/logistics/plan-views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PlanList, type PlanLine } from './plan-list';
import { PlanTimeline } from './plan-timeline';
import { StatusMenu } from './status-menu';
import { ItemDrawer } from './item-drawer';
import { TopicDrawer } from './topic-drawer';
import styles from './plan.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'לוח עבודה' };

/**
 * לוח עבודה — what the camp builds before the burn, under which topic, in
 * what order and on which days.
 *
 * Three ideas and nothing more: a topic (״סלון״, ״מטבח״), an item under it
 * that may be broken into parts (״להכין סלון״ → ״לקנות קרשים״, ״יום בניית
 * ספסלים״), and an order between items (the boards before the build day).
 * The timeline is those items on their days; the list is everything,
 * placed or not.
 *
 * The rows are the plan's own, not the משימות board's: that board is one
 * level deep and knows no order between tasks. The banner says so, with
 * the link, rather than letting a lead look for these under משימות.
 */
export default async function PlanPage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parsePlanQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'לוח עבודה' }]} />
        <h1>לוח עבודה</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  /* `season` pinned to the one this page resolved, so every drawer names
     the year on screen even when the URL named none. */
  const here: RawParams = { ...params, season: current.id };
  const today = campDayOf(new Date());

  const [items, topics] = await Promise.all([listPlan(db, current.id), listTopics(db, current.id)]);
  const totals = summarizePlan(items);
  const groups = buildPlanTree(items, topics);
  const timeline = buildTimeline(items, topics);
  const activeTopics = topics.filter((topic) => topic.archivedAt === null);

  const closeHref = planHref(here, {});

  const peekedItem = query.peek === null ? null : items.find((item) => item.id === query.peek) ?? null;
  const peekedTopic = query.peekTopic === null ? null : await topicById(db, query.peekTopic);
  const drawerOpen = peekedItem !== null || query.creatingItem;

  /* Only loaded when the item drawer is open: the roster is the one thing
     the list itself does not need. */
  const roster = drawerOpen ? await planRoster(db, current.id) : [];
  const parents = items
    .filter((item) => item.parentId === null && item.status !== 'cancelled' && item.id !== peekedItem?.id)
    .map((item) => ({ id: item.id, title: item.title, topicId: item.topicId }));
  const others = items
    .filter((item) => item.id !== peekedItem?.id && item.status !== 'cancelled')
    .map((item) => ({ id: item.id, title: item.title }));

  const nothingYet = items.length === 0 && topics.length === 0;

  return (
    <main className={styles.page}>
      <TopBar
        crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'לוח עבודה' }]}
        chip={<SeasonChip seasonName={current.name} />}
        actions={(
          <span className={styles.topActions}>
            <ButtonLink size="sm" href={newTopicHref(here)}>
              <Icon name="plus" size={14} />
              נושא
            </ButtonLink>
            <ButtonLink tone="primary" size="sm" href={newItemHref(here)}>
              <Icon name="plus" size={14} />
              משימה
            </ButtonLink>
          </span>
        )}
      />

      <div className={styles.head}>
        <div>
          <h1>לוח עבודה</h1>
          <p className={styles.sub}>
            <bdi>{`${totals.open} משימות פתוחות ל${current.name}`}</bdi>
            {' · '}
            <bdi>{`${totals.unscheduled} עדיין בלי תאריך`}</bdi>
            {totals.conflicts > 0 ? (
              <>{' · '}<bdi>{`${totals.conflicts} סדרי קדימות שהתאריכים סותרים`}</bdi></>
            ) : null}
          </p>
        </div>
      </div>

      <Banner
        tone="neutral"
        headline="זה לוח ההכנות של הלוגיסטיקה, לא לוח המשימות של הקאמפ."
        detail="כאן מפרקים הכנה גדולה לחלקים, פורסים אותם על ימים ואומרים מה חייב להיות מוכן לפני מה. שיבוץ אנשים למשמרות ולמשימות האירוע נשאר ב״משימות״."
        action={{ label: 'מעבר למשימות', href: '/tasks' }}
      />

      {nothingYet ? (
        <EmptyState
          kind="nothing-this-season"
          noun="משימות בלוח העבודה"
          seasonName={current.name}
          action={{ label: 'הוספת נושא ראשון', href: newTopicHref(here) }}
        />
      ) : (
        <>
          <div className={styles.tiles}>
            <StatTile
              label="משימות פתוחות"
              value={totals.open}
              derivation={<bdi>{`${totals.done} הושלמו · נרשם ידנית`}</bdi>}
              href="#list"
            />
            <StatTile
              label="עדיין בלי תאריך"
              value={totals.unscheduled}
              tone={totals.unscheduled > 0 ? 'warn' : 'default'}
              derivation={<bdi>{`${totals.scheduled} כבר על ציר הזמן`}</bdi>}
              href="#list"
            />
            <StatTile
              label="סדרי קדימות שהתאריכים סותרים"
              value={totals.conflicts}
              tone={totals.conflicts > 0 ? 'bad' : 'ok'}
              derivation={totals.conflicts === 0
                ? 'כל מה שחייב להסתיים קודם אכן מסתיים קודם'
                : 'משימה שמתחילה לפני שמה שהיא מחכה לו נגמר'}
              href="#timeline"
            />
          </div>

          <section className={styles.section} id="timeline" aria-label="ציר זמן">
            <div className={styles.sectionHead}>
              <h2>ציר זמן</h2>
              <span className={styles.sectionHint}>
                {timeline === null
                  ? 'משימה עולה לציר ברגע שיש לה יום התחלה.'
                  : `${timeline.placed} משימות על הימים שלהן · שישי ושבת מודגשים`}
              </span>
            </div>
            {timeline === null ? (
              <p className={styles.topicEmpty}>
                {'עדיין אין משימה עם תאריך. פותחים משימה מהרשימה למטה ובוחרים לה יום התחלה, והיא מופיעה כאן.'}
              </p>
            ) : (
              <PlanTimeline timeline={timeline} params={here} today={today} currentItemId={query.peek} />
            )}
          </section>

          <section className={styles.section} id="list" aria-label="הרשימה המלאה">
            <div className={styles.sectionHead}>
              <h2>הרשימה המלאה</h2>
              <span className={styles.sectionHint}>לפי נושא. משימה כללית, ותחתיה החלקים שלה.</span>
            </div>
            {groups.length === 0 ? (
              <EmptyState
                kind="nothing-this-season"
                noun="משימות בלוח העבודה"
                seasonName={current.name}
                action={{ label: 'הוספת משימה', href: newItemHref(here) }}
              />
            ) : (
              <PlanList
                groups={groups}
                params={here}
                currentItemId={query.peek}
                rowActions={(line: PlanLine) => (
                  <span className={styles.rowActions}>
                    {line.sub || line.item.status === 'cancelled' ? null : (
                      <ButtonLink size="sm" tone="ghost" href={newItemHref(here, { parentId: line.item.id })}>
                        <Icon name="plus" size={14} />
                        חלק
                      </ButtonLink>
                    )}
                    <StatusMenu item={{ id: line.item.id, title: line.item.title, status: line.item.status }} />
                  </span>
                )}
              />
            )}
          </section>
        </>
      )}

      <div className={styles.phoneActions}>
        <ButtonLink tone="primary" href={newItemHref(here)}>
          <Icon name="plus" size={16} />
          משימה
        </ButtonLink>
        <ButtonLink href={newTopicHref(here)} iconLabel="נושא חדש">
          <Icon name="list" size={16} />
        </ButtonLink>
      </div>

      {peekedTopic !== null ? (
        <TopicDrawer topic={peekedTopic} seasonId={current.id} seasonName={current.name} closeHref={closeHref} />
      ) : null}
      {query.creatingTopic ? (
        <TopicDrawer topic={null} seasonId={current.id} seasonName={current.name} closeHref={closeHref} />
      ) : null}
      {drawerOpen ? (
        <ItemDrawer
          item={peekedItem}
          seasonId={current.id}
          closeHref={closeHref}
          params={here}
          topics={activeTopics}
          parents={parents}
          others={others}
          roster={roster}
          presetTopicId={query.presetTopic}
          presetParentId={query.presetParent}
        />
      ) : null}
    </main>
  );
}
