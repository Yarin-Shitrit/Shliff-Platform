import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listPlan, listTopics, planRoster } from '@/lib/logistics/plan';
import { eventLabel, listEvents } from '@/lib/logistics/attendance';
import { eventHref, newEventHref } from '@/lib/logistics/attendance-views';
import { itemHref, planHref } from '@/lib/logistics/plan-views';
import { campDayOf } from '@/lib/logistics/shift-time';
import { buildDay, listCrew, pickDay, tasksOn, type WorkDay } from '@/lib/logistics/workdays';
import {
  parseWorkdaysQuery, workdaysHref, weekdayOf, shortDate, type RawParams,
} from '@/lib/logistics/workdays-views';
import { WORK_STATUS_LABELS, WORK_STATUS_TONES } from '@/lib/logistics/labels';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/cx';
import { CrewDrawer, type CrewOption } from './crew-drawer';
import styles from './workdays.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'ימי עבודה' };

/**
 * ימי עבודה — who works on what, on each work day of the season.
 *
 * The days are the ״יום עבודה״ occasions on לוח הנוכחות; a day's tasks are
 * the plan's items whose days include it (a right-click on לוח עבודה puts a
 * task on a work day). One day is on screen at a time: its tasks as cards,
 * each with the people on it, and the people on none of them underneath.
 *
 * It is the plan's screen and uses the plan's grant. What it plans is not
 * what happened: who actually came is ticked on לוח הנוכחות, which each day
 * links to.
 */
export default async function WorkdaysPage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin('plan');
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseWorkdaysQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);
  const crumbs = [
    { label: 'לוגיסטיקה', href: '/logistics' },
    { label: 'לוח עבודה', href: current === null ? '/logistics/plan' : planHref({ season: current.id }, {}) },
    { label: 'ימי עבודה' },
  ];

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} />
        <h1>ימי עבודה</h1>
        <EmptyState kind="nothing-yet" noun="שנים" action={{ label: 'ייבוא מהגיליון', href: '/imports' }} />
      </main>
    );
  }

  const seasonParams: RawParams = { season: current.id };
  const today = campDayOf(new Date());
  const canEdit = admin.level !== 'view';

  const [items, topics, occasions, crew, roster, attendance] = await Promise.all([
    listPlan(db, current.id),
    listTopics(db, current.id),
    listEvents(db, current.id),
    listCrew(db, current.id),
    planRoster(db, current.id),
    requireAdmin('attendance'),
  ]);

  const days: WorkDay[] = occasions
    .filter((occasion) => occasion.kind === 'work_day' && occasion.cancelledAt === null)
    .map((occasion) => ({ id: occasion.id, label: eventLabel(occasion), heldOn: occasion.heldOn }));
  const day = pickDay(days, query.day, today);
  const planLink = planHref(seasonParams, {});
  const addDayHref = attendance.ok && attendance.level !== 'view' ? newEventHref(seasonParams) : null;

  if (day === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} />
        <div>
          <h1>ימי עבודה</h1>
          <p className={styles.sub}>ימי העבודה מגיעים מלוח הנוכחות: כל יום מסוג ״יום עבודה״ שם מופיע כאן.</p>
        </div>
        <EmptyState
          kind="nothing-this-season"
          noun="ימי עבודה"
          seasonName={current.name}
          action={addDayHref === null
            ? { label: 'חזרה ללוח העבודה', href: planLink }
            : { label: 'הוספת יום עבודה בלוח הנוכחות', href: addDayHref }}
        />
      </main>
    );
  }

  /* `day` pinned to the one this page chose, so the drawer and its close
     link name the day on screen even when the URL named none. */
  const here: RawParams = { season: current.id, day: day.id };
  const view = buildDay(day.heldOn, items, topics, crew, roster);
  const dayWords = `${day.label} · ${weekdayOf(day.heldOn)} ${shortDate(day.heldOn)}`;

  const peeked = !canEdit || query.task === null
    ? null
    : view.tasks.find((task) => task.item.id === query.task) ?? null;

  /* The drawer's list: the roster by name, then whoever is on the task and
     has left the roster — they can be taken off, and are named until then. */
  let people: CrewOption[] = [];
  if (peeked !== null) {
    const others = new Map<string, string[]>();
    for (const task of view.tasks) {
      if (task.item.id === peeked.item.id) continue;
      for (const person of task.crew) {
        others.set(person.personId, [...(others.get(person.personId) ?? []), task.item.title]);
      }
    }
    people = [
      ...roster.map((person) => ({
        personId: person.personId,
        displayName: person.displayName,
        onRoster: true,
        alsoOn: others.get(person.personId) ?? [],
      })),
      ...peeked.crew.filter((person) => !person.onRoster).map((person) => ({
        personId: person.personId,
        displayName: person.displayName,
        onRoster: false,
        alsoOn: others.get(person.personId) ?? [],
      })),
    ];
  }

  return (
    <main className={styles.page}>
      <TopBar
        crumbs={crumbs}
        chip={<SeasonChip seasonName={current.name} />}
        actions={addDayHref === null ? undefined : (
          <ButtonLink size="sm" href={addDayHref}>
            <Icon name="plus" size={14} />
            יום עבודה
          </ButtonLink>
        )}
      />

      <div>
        <h1>ימי עבודה</h1>
        <p className={styles.sub}>
          <bdi>{`מי עובד על מה בכל יום עבודה של ${current.name}`}</bdi>
          {' · '}
          <bdi>{days.length === 1 ? 'יום עבודה אחד' : `${days.length} ימי עבודה`}</bdi>
        </p>
      </div>

      <nav aria-label="ימי העבודה של השנה">
        <ul className={styles.days}>
          {days.map((one) => {
            const count = tasksOn(items, one.heldOn).length;
            return (
              <li key={one.id}>
                <Link
                  href={workdaysHref(seasonParams, { day: one.id })}
                  className={cx(styles.day, one.id === day.id && styles.dayCurrent, one.heldOn < today && styles.dayPast)}
                  aria-current={one.id === day.id ? 'true' : undefined}
                >
                  <span className={styles.dayDate}><bdi>{`${weekdayOf(one.heldOn)} ${shortDate(one.heldOn)}`}</bdi></span>
                  <span className={styles.dayMeta}>
                    <bdi>{one.label}</bdi>
                    {' · '}
                    <bdi>{count === 0 ? 'בלי משימות' : count === 1 ? 'משימה אחת' : `${count} משימות`}</bdi>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={styles.tiles}>
        <StatTile
          label="משימות ביום הזה"
          value={view.tasks.length}
          derivation="משימות בלוח העבודה שהימים שלהן כוללים את היום"
          href={planLink}
        />
        <StatTile
          label="משובצים"
          value={view.assigned}
          derivation={<bdi>{`מתוך ${roster.length} ברשימת ${current.name} · נרשם ידנית`}</bdi>}
          href="#tasks"
        />
        <StatTile
          label="בלי משימה ביום הזה"
          value={view.free.length}
          derivation="חברים ברשימה שלא שובצו לאף משימה של היום"
          href="#free"
        />
      </div>

      {view.doubled.length === 0 ? null : (
        <Banner
          tone="warn"
          label="שיבוץ כפול"
          headline={view.doubled.length === 1
            ? 'מישהו אחד משובץ ליותר ממשימה אחת ביום הזה.'
            : <bdi>{`${view.doubled.length} אנשים משובצים ליותר ממשימה אחת ביום הזה.`}</bdi>}
          detail={(
            <ul className={styles.doubled}>
              {view.doubled.map((person) => (
                <li key={person.personId}><bdi>{`${person.displayName}: ${person.titles.join(', ')}`}</bdi></li>
              ))}
            </ul>
          )}
        />
      )}

      <section className={styles.section} id="tasks" aria-label="המשימות של היום">
        <div className={styles.sectionHead}>
          <h2><bdi>{dayWords}</bdi></h2>
          <span className={styles.spacer} />
          {attendance.ok ? (
            <ButtonLink size="sm" tone="ghost" href={eventHref(seasonParams, day.id)}>
              <Icon name="check" size={14} />
              נוכחות ביום הזה
            </ButtonLink>
          ) : null}
        </div>

        {view.tasks.length === 0 ? (
          <>
            <EmptyState
              kind="none-of-this-kind"
              noun="משימות ביום הזה"
              action={{ label: 'מעבר ללוח העבודה', href: planLink }}
            />
            <p className={styles.note}>
              בלוח העבודה, לחיצה ימנית על משימה משייכת אותה ליום עבודה, והיא מופיעה כאן.
            </p>
          </>
        ) : (
          <ul className={styles.cards}>
            {view.tasks.map((task) => (
              <li key={task.item.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>
                    <Link href={itemHref(seasonParams, task.item.id)}>{task.item.title}</Link>
                  </h3>
                  <span className={styles.cardMeta}>
                    <bdi>{task.topicName ?? 'בלי נושא'}</bdi>
                    {task.parentTitle === null ? null : <>{' · '}<bdi>{`חלק של ${task.parentTitle}`}</bdi></>}
                    {' · '}
                    <bdi>{task.item.assignee === null ? 'אחראי: לא נקבע' : `אחראי: ${task.item.assignee.displayName}`}</bdi>
                  </span>
                  {task.item.status === 'done' ? (
                    <span><Pill tone={WORK_STATUS_TONES.done} dot>{WORK_STATUS_LABELS.done}</Pill></span>
                  ) : null}
                </div>

                {task.crew.length === 0 ? (
                  <p className={styles.note}>עדיין לא שובץ אף אחד למשימה הזו.</p>
                ) : (
                  <ul className={styles.crew} aria-label={`משובצים ל${task.item.title}`}>
                    {task.crew.map((person) => (
                      <li key={person.personId} className={cx(styles.person, !person.onRoster && styles.personOff)}>
                        <Avatar name={person.displayName} size="sm" decorative />
                        {person.displayName}
                        {person.onRoster ? null : ' · לא ברשימת השנה'}
                      </li>
                    ))}
                  </ul>
                )}

                {canEdit ? (
                  <div className={styles.cardFoot}>
                    <ButtonLink size="sm" href={workdaysHref(here, { task: task.item.id })}>
                      <Icon name="plus" size={14} />
                      {task.crew.length === 0 ? 'שיבוץ אנשים' : `שינוי השיבוץ · ${task.crew.length}`}
                    </ButtonLink>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} id="free" aria-label="בלי משימה ביום הזה">
        <div className={styles.sectionHead}>
          <h2>בלי משימה ביום הזה</h2>
          <span className={styles.sectionHint}>
            <bdi>{`${view.free.length} מתוך ${roster.length} ברשימת ${current.name}`}</bdi>
          </span>
        </div>
        {roster.length === 0 ? (
          <EmptyState
            kind="nothing-this-season"
            noun="חברים ברשימה"
            seasonName={current.name}
            action={{ label: 'מעבר לאנשים', href: '/members' }}
          />
        ) : view.free.length === 0 ? (
          <p className={styles.note}>כל מי שברשימה משובץ למשימה כלשהי ביום הזה.</p>
        ) : (
          <ul className={styles.crew}>
            {view.free.map((person) => (
              <li key={person.personId} className={styles.person}>
                <Avatar name={person.displayName} size="sm" decorative />
                <Link href={`/members/${person.personId}`}>{person.displayName}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {peeked === null ? null : (
        <CrewDrawer
          key={peeked.item.id}
          task={{ id: peeked.item.id, title: peeked.item.title }}
          dayLabel={dayWords}
          closeHref={workdaysHref(here)}
          people={people}
          onTask={peeked.crew.map((person) => person.personId)}
        />
      )}
    </main>
  );
}
