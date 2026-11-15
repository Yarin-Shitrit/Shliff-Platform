import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import {
  listEvents, listMarks, attendanceRoster, eventById, marksOf, buildBoard, summarizeBoard,
  ATTENDANCE_KINDS, eventLabel, civilDate,
} from '@/lib/logistics/attendance';
import { ATTENDANCE_KIND_LABELS } from '@/lib/logistics/labels';
import { campDayOf } from '@/lib/logistics/shift-time';
import {
  parseAttendanceQuery, attendanceHref, eventHref, newEventHref, type RawParams,
} from '@/lib/logistics/attendance-views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { DateText } from '@/components/format';
import { AttendanceBoard, EventList } from './attendance-board';
import { EventDrawer } from './event-drawer';
import styles from './attendance.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'נוכחות' };

/**
 * נוכחות — who was at what during the year.
 *
 * A lead adds a day (a work day, a build day, a shopping run, a meeting)
 * and ticks who came. The board is the roster against those days, and the
 * count at the end of every row is what the camp reads at the end of the
 * year: who carried it, and how much. Every figure is one a lead typed —
 * there is no attendance workbook — and every one links to the drawer
 * that changes it.
 *
 * Season-scoped (R5): a year's effort is that year's. The roster is the
 * season's roster, from אנשים; the board adds nobody to it.
 */
export default async function AttendancePage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseAttendanceQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={[{ label: 'נוכחות' }]} />
        <h1>נוכחות</h1>
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

  const [events, marks, roster] = await Promise.all([
    listEvents(db, current.id),
    listMarks(db, current.id),
    attendanceRoster(db, current.id),
  ]);
  const board = buildBoard(events, marks, roster);
  const totals = summarizeBoard(board);

  const closeHref = attendanceHref(here, {});
  const addHref = newEventHref(here);

  /* The peeked day is fetched by id rather than found among the list: a
     link to a day the board does not draw (cancelled) must still open
     something that says so. */
  const peeked = query.peekEvent === null ? null : await eventById(db, query.peekEvent);
  const peekedMarks = peeked === null ? [] : await marksOf(db, [peeked.id]);

  const kindsPresent = ATTENDANCE_KINDS.filter((kind) => totals.byKind[kind] > 0);

  return (
    <main className={styles.page}>
      <TopBar
        crumbs={[{ label: 'נוכחות' }]}
        chip={<SeasonChip seasonName={current.name} />}
        actions={(
          /* Laptop only (`.topActions`): on a phone this moves to the fixed
             bar at the end of this page — see `attendance.module.css`. */
          <span className={styles.topActions}>
            <ButtonLink tone="primary" size="sm" href={addHref}>
              <Icon name="plus" size={14} />
              יום חדש
            </ButtonLink>
          </span>
        )}
      />

      <div className={styles.head}>
        <div>
          <h1>נוכחות</h1>
          <p className={styles.sub}>
            <bdi>{`מי היה באיזה יום במהלך השנה של ${current.name}, וכמה פעמים`}</bdi>
            {' · '}
            <bdi>{`${roster.length} ברשימת השנה`}</bdi>
          </p>
        </div>
      </div>

      <div className={styles.tiles}>
        <StatTile
          label="ימים בלוח"
          value={totals.occasions}
          derivation={kindsPresent.length === 0 ? 'נרשם ידנית' : (
            <bdi>{kindsPresent.map((kind) => `${totals.byKind[kind]} ${ATTENDANCE_KIND_LABELS[kind]}`).join(' · ')}</bdi>
          )}
        />
        <StatTile
          label="סימוני נוכחות"
          value={totals.marks}
          derivation="ימי־אדם: כל סימון של חבר ביום אחד · נרשם ידנית"
        />
        <StatTile
          label="חברים בלי אף סימון"
          value={totals.idle}
          tone={totals.idle > 0 && totals.occasions > 0 ? 'warn' : 'default'}
          derivation={<bdi>{`מתוך ${roster.length} ברשימת ${current.name}`}</bdi>}
          href="/members"
        />
      </div>

      {board.events.length === 0 ? (
        <EmptyState
          kind="nothing-this-season"
          noun="ימים בלוח הנוכחות"
          seasonName={current.name}
          action={{ label: 'הוספת יום', href: addHref }}
        />
      ) : roster.length === 0 ? (
        <EmptyState
          kind="nothing-this-season"
          noun="חברים ברשימה"
          seasonName={current.name}
          action={{ label: 'מעבר לאנשים', href: '/members' }}
        />
      ) : (
        <>
          <section className={styles.laptopOnly} aria-label="לוח הנוכחות">
            <AttendanceBoard board={board} params={here} currentEventId={query.peekEvent} />
          </section>
          <section className={styles.phoneOnly} aria-label="ימים">
            <div className={styles.sectionHead}>
              <h2>ימים</h2>
              <span className={styles.sectionHint}>פותחים יום ומסמנים מי היה.</span>
            </div>
            <EventList board={board} params={here} currentEventId={query.peekEvent} />
          </section>
          <section className={styles.phoneOnly} aria-label="סיכום לפי חבר">
            <div className={styles.sectionHead}>
              <h2>לפי חבר</h2>
              <span className={styles.sectionHint}>בכמה ימים כל אחד היה.</span>
            </div>
            <ul className={styles.totalsList}>
              {board.rows.map((row) => (
                <li key={row.personId} className={styles.totalsRow}>
                  <Link href={`/members/${row.personId}`} className={styles.nameLink}>{row.displayName}</Link>
                  <span className={cxNum(row.total)}>{row.total}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {board.cancelled.length > 0 ? (
        <section className={styles.section} aria-label="ימים שבוטלו">
          <div className={styles.sectionHead}>
            <h2>ימים שבוטלו</h2>
            <span className={styles.sectionHint}>לא נספרים בלוח. הסימונים שלהם נשמרו, ואפשר להחזיר אותם.</span>
          </div>
          <ul className={styles.cancelledList}>
            {board.cancelled.map((event) => (
              <li key={event.id}>
                <Link href={eventHref(here, event.id)}>{eventLabel(event)}</Link>
                {' · '}
                <DateText at={civilDate(event.heldOn)} />
                {event.presentCount === 0 ? null : <bdi>{` · ${event.presentCount} סימונים`}</bdi>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Phone only (`.phoneActions`): the page's one verb, fixed above the
        tab bar where a thumb reaches it from anywhere on the list. The same
        URL as the top bar's, so there is one way to open the drawer.
      */}
      <div className={styles.phoneActions}>
        <ButtonLink tone="primary" href={addHref}>
          <Icon name="plus" size={16} />
          יום חדש
        </ButtonLink>
      </div>

      {peeked !== null ? (
        <EventDrawer
          event={peeked}
          seasonId={current.id}
          seasonName={current.name}
          closeHref={closeHref}
          params={here}
          roster={roster}
          present={peekedMarks.map((mark) => mark.personId)}
        />
      ) : null}
      {query.creating ? (
        <EventDrawer
          event={null}
          seasonId={current.id}
          seasonName={current.name}
          closeHref={closeHref}
          params={here}
          roster={roster}
          present={[]}
          presetDay={today}
        />
      ) : null}
    </main>
  );
}

/** The figure at the end of a phone row: tabular, and quiet when it is zero. */
function cxNum(total: number): string {
  return total === 0 ? `${styles.totalsFigure} ${styles.totalsZero} num` : `${styles.totalsFigure} num`;
}
