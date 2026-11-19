import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import {
  listPlan, listTopics, topicById, buildPlanTree, buildTimeline, summarizePlan, planRoster,
  nowSummary, adoptableItems, filterPlan, filterCounts,
} from '@/lib/logistics/plan';
import { campDayOf } from '@/lib/logistics/shift-time';
import {
  parsePlanQuery, planHref, itemHref, newItemHref, newTopicHref, adoptHref, itemDrawerKey, filterHref,
  PLAN_FILTERS, PLAN_FILTER_LABELS, type RawParams,
} from '@/lib/logistics/plan-views';
import { acquisitionsHref } from '@/lib/logistics/acquisitions-views';
import { adoptOutcomes } from '@/lib/logistics/acquisitions';
import { eventLabel, listEvents } from '@/lib/logistics/attendance';
import { newEventHref } from '@/lib/logistics/attendance-views';
import { workdaysHref } from '@/lib/logistics/workdays-views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { DateText } from '@/components/format';
import { cx } from '@/components/ui/cx';
import { PlanList, civil, type PlanLine } from './plan-list';
import { PlanTimeline } from './plan-timeline';
import { StatusMenu } from './status-menu';
import { PurchaseMenu } from './purchase-menu';
import { DoneToggle } from './done-toggle';
import { ItemDrawer } from './item-drawer';
import { TopicDrawer } from './topic-drawer';
import { AdoptDrawer } from './adopt-drawer';
import { WorkDayMenu } from './work-day-menu';
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
  const admin = await requireAdmin('plan');
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

  const [items, topics, occasions, attendance] = await Promise.all([
    listPlan(db, current.id), listTopics(db, current.id), listEvents(db, current.id), requireAdmin('attendance'),
  ]);
  /* The days a right-click can put a task on: the season's work days from
     לוח הנוכחות, the ones still on that board. Only an account that may
     write the plan gets the menu, and only one that may open נוכחות gets
     the link that adds a day there. */
  const canEdit = admin.level !== 'view';
  const workDays = occasions
    .filter((occasion) => occasion.kind === 'work_day' && occasion.cancelledAt === null)
    .map((occasion) => ({ id: occasion.id, label: eventLabel(occasion), heldOn: occasion.heldOn }));
  const placeable = canEdit
    ? items
      .filter((item) => item.status !== 'cancelled')
      .map((item) => ({ id: item.id, title: item.title, startsOn: item.startsOn, endsOn: item.endsOn }))
    : [];
  const addWorkDayHref = attendance.ok && attendance.level !== 'view' ? newEventHref({ season: current.id }) : null;
  const totals = summarizePlan(items);
  /* The list narrowed to one question; the timeline and the tiles always
     read the whole plan. A topic with nothing left under the filter is left
     out: its empty heading says ״עדיין אין משימות״, which under a filter
     would be false. */
  const counts = filterCounts(items, today);
  const narrowed = query.filter !== 'all';
  const groups = buildPlanTree(filterPlan(items, query.filter, today), topics)
    .filter((group) => !narrowed || group.branches.length > 0);
  /* The week or month around the day the URL named, else around today. */
  const timeline = buildTimeline(items, topics);
  const now = nowSummary(items, today);
  const activeTopics = topics.filter((topic) => topic.archivedAt === null);

  const closeHref = planHref(here, {});

  const peekedItem = query.peek === null ? null : items.find((item) => item.id === query.peek) ?? null;
  const peekedTopic = query.peekTopic === null ? null : await topicById(db, query.peekTopic);
  const drawerOpen = peekedItem !== null || query.creatingItem;

  /* Only loaded when the item drawer is open: the roster is the one thing
     the list itself does not need. */
  const roster = drawerOpen ? await planRoster(db, current.id) : [];
  /* Plus whoever the open item already names, as the acquisitions screen
     does: somebody taken off the season's roster can still hold a line,
     and a picker that quietly dropped them showed ״עדיין לא נקבע״ over a
     person it could neither keep nor clear. */
  if (peekedItem?.assignee && !roster.some((entry) => entry.personId === peekedItem.assignee!.personId)) {
    roster.push({ personId: peekedItem.assignee.personId, displayName: peekedItem.assignee.displayName });
  }
  const parents = items
    .filter((item) => item.parentId === null && item.status !== 'cancelled' && item.id !== peekedItem?.id)
    .map((item) => ({ id: item.id, title: item.title, topicId: item.topicId }));
  const others = items
    .filter((item) => item.id !== peekedItem?.id && item.status !== 'cancelled')
    .map((item) => ({ id: item.id, title: item.title }));

  const nothingYet = items.length === 0 && topics.length === 0;

  /* The open items not yet in the acquisitions list, and how many of them
     read as buying. A purchase entered on רכש lands here on its own; these
     are the ones written here first, and the banner offers the move. */
  const adoptable = adoptableItems(items);
  /* What the move would do with each, only when its drawer is open. */
  const outcomes = query.adopting ? await adoptOutcomes(db, current.id, adoptable) : null;
  const suggested = adoptable.filter((candidate) => candidate.suggested).length;
  const listHref = acquisitionsHref(here, {});

  return (
    <main className={styles.page}>
      <TopBar
        crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'לוח עבודה' }]}
        chip={<SeasonChip seasonName={current.name} />}
        actions={(
          <span className={styles.topActions}>
            <ButtonLink size="sm" tone="ghost" href={workdaysHref({ season: current.id })}>
              <Icon name="calendar" size={14} />
              ימי עבודה
            </ButtonLink>
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
            {totals.done > 0 ? <>{' · '}<bdi>{`${totals.done} הושלמו`}</bdi></> : null}
            {totals.unscheduled > 0 ? <>{' · '}<bdi>{`${totals.unscheduled} עדיין בלי יום`}</bdi></> : null}
          </p>
        </div>
      </div>

      {nothingYet ? (
        <>
          <Banner
            tone="neutral"
            headline="זה לוח ההכנות של הלוגיסטיקה, לא לוח המשימות של הקאמפ."
            detail="כאן מפרקים הכנה גדולה לחלקים, פורסים אותם על ימים ואומרים מה חייב להיות מוכן לפני מה. שיבוץ אנשים למשמרות ולמשימות האירוע נשאר ב״משימות״."
            action={{ label: 'מעבר למשימות', href: '/tasks' }}
          />
          <EmptyState
            kind="nothing-this-season"
            noun="משימות בלוח העבודה"
            seasonName={current.name}
            action={{ label: 'הוספת נושא ראשון', href: newTopicHref(here) }}
          />
        </>
      ) : (
        <>
          {/*
            What today looks like, in one strip: what is being worked on,
            what comes next, what slipped. Every name is the link to its
            drawer. Nothing here is a figure a reader cannot act on.
          */}
          <section className={styles.now} aria-label="מה קורה עכשיו">
            <div className={styles.nowCol}>
              <span className={styles.nowLabel}><Icon name="clock" size={14} />בעבודה עכשיו</span>
              {now.underway.length === 0 ? (
                <span className={styles.nowEmpty}>אין משימה שהימים שלה כוללים את היום.</span>
              ) : (
                <ul className={styles.nowList}>
                  {now.underway.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <Link href={itemHref(here, item.id)}>{item.title}</Link>
                      {item.assignee === null ? null : <span className={styles.nowMeta}>{` · ${item.assignee.displayName}`}</span>}
                    </li>
                  ))}
                  {now.underway.length > 4 ? <li className={styles.nowMeta}>{`ועוד ${now.underway.length - 4}`}</li> : null}
                </ul>
              )}
            </div>
            <div className={styles.nowCol}>
              <span className={styles.nowLabel}><Icon name="arrowl" size={14} />הבאה בתור</span>
              {now.next === null ? (
                <span className={styles.nowEmpty}>אין משימה שעוד לא התחילה ויש לה יום.</span>
              ) : (
                <span>
                  <Link href={itemHref(here, now.next.id)}>{now.next.title}</Link>
                  <span className={styles.nowMeta}>{' · '}<DateText at={civil(now.next.startsOn!)} form="prose" /></span>
                </span>
              )}
            </div>
          </section>

          {suggested > 0 ? (
            <Banner
              tone="info"
              label="משימות קנייה שאינן ברכש"
              headline={(
                <bdi>
                  {suggested === 1
                    ? 'משימה אחת בלוח מתחילה ב״לקנות״ ועדיין אינה ברשימת הרכש.'
                    : `${suggested} משימות בלוח מתחילות ב״לקנות״ ועדיין אינן ברשימת הרכש.`}
                </bdi>
              )}
              detail="רכש נכנס מרשימת הרכש ומופיע כאן לבד; מה שנכתב קודם בלוח אפשר להעביר בלחיצה אחת, והמשימות נשארות בלוח."
              action={{ label: 'העברה לרכש', href: adoptHref(here) }}
            />
          ) : null}

          <div className={styles.tiles}>
            <StatTile
              label="משימות פתוחות"
              value={totals.open}
              derivation={<bdi>{`${totals.done} הושלמו · נרשם ידנית`}</bdi>}
              href={filterHref(here, 'all')}
            />
            <StatTile
              label="עדיין בלי יום"
              value={totals.unscheduled}
              tone={totals.unscheduled > 0 ? 'warn' : 'default'}
              derivation={<bdi>{`${totals.scheduled} כבר על ציר הזמן · לחיצה מסננת את הרשימה`}</bdi>}
              href={filterHref(here, 'unscheduled')}
            />
            <StatTile
              label="עבר התאריך"
              value={now.overdue.length}
              tone={now.overdue.length > 0 ? 'bad' : 'ok'}
              derivation={now.overdue.length === 0 ? 'הכול בזמן' : 'פתוחות אחרי היום האחרון שלהן · לחיצה מסננת את הרשימה'}
              href={filterHref(here, 'overdue')}
            />
            <StatTile
              label="סדר שהתאריכים סותרים"
              value={totals.conflicts}
              tone={totals.conflicts > 0 ? 'bad' : 'ok'}
              derivation={totals.conflicts === 0
                ? 'כל מה שחייב להסתיים קודם אכן מסתיים קודם'
                : 'מתחילה לפני שמה שהיא מחכה לו נגמר'}
              href="#timeline"
            />
          </div>

          <WorkDayMenu items={placeable} workDays={workDays} addHref={addWorkDayHref}>
          <section className={styles.section} id="timeline" aria-label="ציר זמן">
            <div className={styles.sectionHead}>
              <h2>ציר זמן</h2>
              <span className={styles.sectionHint}>
                {timeline === null
                  ? 'משימה עולה לציר ברגע שיש לה יום התחלה.'
                  : `${timeline.placed} משימות על הימים שלהן · כל נושא בצבע שלו · שבוע מתחיל ביום ראשון, שישי ושבת מודגשים${workDays.length === 0 ? '' : ' · ימי העבודה מסומנים כעמודה'}`}
              </span>
            </div>
            {timeline === null ? (
              <p className={styles.topicEmpty}>
                {'עדיין אין משימה עם תאריך. פותחים משימה מהרשימה למטה ובוחרים לה יום התחלה, והיא מופיעה כאן.'}
              </p>
            ) : (
              <PlanTimeline
                timeline={timeline}
                scale={query.scale}
                params={here}
                today={today}
                currentItemId={query.peek}
                workDays={workDays}
              />
            )}
          </section>

          <section className={styles.section} id="list" aria-label="הרשימה המלאה">
            <div className={styles.sectionHead}>
              <h2>הרשימה המלאה</h2>
              <span className={styles.sectionHint}>לפי נושא, כל נושא בצבע שלו. משימה כללית, ותחתיה החלקים שלה עם קו מחבר. לחיצה על העיגול מסמנת שהושלמה.{canEdit ? ' לחיצה ימנית על משימה משייכת אותה ליום עבודה.' : ''}</span>
              {adoptable.length === 0 ? null : (
                <ButtonLink size="sm" tone="ghost" href={adoptHref(here)}>
                  <Icon name="wallet" size={14} />
                  העברת קניות לרכש
                </ButtonLink>
              )}
            </div>
            <nav className={styles.filters} aria-label="סינון הרשימה">
              {PLAN_FILTERS.map((filter) => (
                <Link
                  key={filter}
                  href={filterHref(here, filter)}
                  className={cx(styles.filterChip, filter === query.filter && styles.filterCurrent)}
                  aria-current={filter === query.filter ? 'true' : undefined}
                >
                  {PLAN_FILTER_LABELS[filter]}
                  <bdi className={styles.filterCount}>{counts[filter]}</bdi>
                </Link>
              ))}
            </nav>
            {groups.length === 0 && narrowed ? (
              <EmptyState
                kind="no-matches"
                filterSummary={PLAN_FILTER_LABELS[query.filter]}
                action={{ label: 'הצגת כל המשימות', href: filterHref(here, 'all') }}
              />
            ) : groups.length === 0 ? (
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
                today={today}
                currentItemId={query.peek}
                /* A purchase's line has no check: it is done when the thing
                   arrives, which its menu and its pill both say. */
                rowLead={(line: PlanLine) => (line.item.status === 'cancelled' || line.item.purchase !== null ? null : (
                  <DoneToggle item={{ id: line.item.id, title: line.item.title, status: line.item.status }} />
                ))}
                rowActions={(line: PlanLine) => (
                  <span className={styles.rowActions}>
                    {line.sub || line.item.status === 'cancelled' ? null : (
                      <ButtonLink size="sm" tone="ghost" href={newItemHref(here, { parentId: line.item.id })}>
                        <Icon name="plus" size={14} />
                        חלק
                      </ButtonLink>
                    )}
                    {line.item.purchase !== null && line.item.status !== 'cancelled' ? (
                      <PurchaseMenu item={{ acquisitionId: line.item.purchase.id, title: line.item.title, status: line.item.purchase.status }} />
                    ) : (
                      <StatusMenu item={{ id: line.item.id, title: line.item.title, status: line.item.status }} />
                    )}
                  </span>
                )}
              />
            )}
          </section>
          </WorkDayMenu>

          <Banner
            tone="neutral"
            headline="זה לוח ההכנות של הלוגיסטיקה, לא לוח המשימות של הקאמפ."
            detail="שיבוץ אנשים למשמרות ולמשימות האירוע נשאר ב״משימות״."
            action={{ label: 'מעבר למשימות', href: '/tasks' }}
          />
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
        <ButtonLink href={workdaysHref({ season: current.id })} iconLabel="ימי עבודה">
          <Icon name="calendar" size={16} />
        </ButtonLink>
      </div>

      {peekedTopic !== null ? (
        <TopicDrawer topic={peekedTopic} seasonId={current.id} seasonName={current.name} closeHref={closeHref} />
      ) : null}
      {query.creatingTopic ? (
        <TopicDrawer topic={null} seasonId={current.id} seasonName={current.name} closeHref={closeHref} />
      ) : null}
      {query.adopting ? (
        <AdoptDrawer
          seasonId={current.id}
          seasonName={current.name}
          candidates={adoptable.map((candidate) => ({ ...candidate, outcome: outcomes?.get(candidate.id) }))}
          closeHref={closeHref}
          listHref={listHref}
        />
      ) : null}
      {drawerOpen ? (
        <ItemDrawer
          key={itemDrawerKey(peekedItem, query.presetParent, query.presetTopic)}
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
