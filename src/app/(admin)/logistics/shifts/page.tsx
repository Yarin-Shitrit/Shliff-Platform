import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import {
  listSchedule, listShiftTypes, shiftTypeById, buildBoard, personLoad, summarizeSchedule,
  shiftRoster, windowFor,
} from '@/lib/logistics/shifts';
import { EVENT_CLOSES, EVENT_OPENS, formatMinutes } from '@/lib/logistics/shift-time';
import {
  parseShiftsQuery, shiftsHref, typeHref, newTypeHref, scheduleHref, printHref,
  type RawParams,
} from '@/lib/logistics/shifts-views';
import { seasonDateHref } from '@/app/(admin)/shell/season-href';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Table, type TableRowModel } from '@/components/ui/table';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/cx';
import { DateText } from '@/components/format';
import buttonStyles from '@/components/ui/button.module.css';
import { ScheduleGrid } from './schedule-grid';
import { TypeDrawer } from './type-drawer';
import { SlotDrawer } from './slot-drawer';
import styles from './shifts.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'משמרות' };

type LoadRow = { personId: string; displayName: string; shifts: number; minutes: number };

/**
 * משמרות — the shift types, and one season's schedule of them.
 *
 * The schedule is six days wide, from the gate at 16:00 to the fifth day at
 * noon, and the gate is `seasons.starts_on` — the same date the משימות board
 * counts down to. A season nobody has dated has no schedule: the page says
 * so and links to the drawer that sets the date, rather than drawing a
 * board around today.
 *
 * Every slot on the board is a task of kind `shift`, so the board under
 * משימות, the coverage tile on the home screen and a person's own page all
 * show the same shifts and the same people. The types are camp-wide and the
 * strip says so (R5).
 */
export default async function ShiftsPage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseShiftsQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'משמרות' }]} />
        <h1>משמרות</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  /* `season` pinned to the one this page resolved, so every drawer and the
     printed sheet name the year on screen even when the URL named none. */
  const here: RawParams = { ...params, season: current.id };
  const window = windowFor(current.startsOn);

  const [slots, types] = await Promise.all([listSchedule(db, current.id), listShiftTypes(db)]);
  const roster = await shiftRoster(db, current.id, slots);
  const totals = summarizeSchedule(slots);
  const load = personLoad(slots, roster);
  const idle = load.filter((entry) => entry.shifts === 0).length;
  const activeTypes = types.filter((type) => type.retiredAt === null);
  const board = window === null ? null : buildBoard(slots, types, window);

  const closeHref = shiftsHref(here, {});
  const gateHref = seasonDateHref('/logistics/shifts', Object.entries(here).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ));

  /* The peeked records are fetched by id rather than found among the lists:
     a link to a slot the board does not show (cancelled, or on a day outside
     the event) must still open something that says so. */
  const peekedSlot = query.peek === null ? null : slots.find((slot) => slot.taskId === query.peek) ?? null;
  const peekedType = query.peekType === null ? null : await shiftTypeById(db, query.peekType);

  const loadRows: Array<TableRowModel<LoadRow>> = load.map((entry) => ({
    id: entry.personId,
    data: entry,
    tone: entry.shifts === 0 ? ('warn' as const) : undefined,
  }));

  return (
    <main className={styles.page}>
      <TopBar
        crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'משמרות' }]}
        chip={<SeasonChip seasonName={current.name} />}
        actions={(
          <span className={styles.topActions}>
            {/*
              A plain anchor, not the kit's `ButtonLink`: the sheet is a
              document served by a route handler, and the client router
              would fetch it as a page payload. `target="_blank"` keeps the
              app where it is while the sheet opens and asks to print. It
              wears the kit's own classes so it is not a second button.
            */}
            {window === null ? null : (
              <a
                className={cx(buttonStyles.btn, buttonStyles.sm)}
                href={printHref(here)}
                target="_blank"
                rel="noopener"
              >
                <Icon name="download" size={14} />
                הדפסה
              </a>
            )}
            <ButtonLink size="sm" href={newTypeHref(here)}>
              <Icon name="plus" size={14} />
              סוג משמרת
            </ButtonLink>
            {window === null ? null : (
              <ButtonLink tone="primary" size="sm" href={scheduleHref(here)}>
                <Icon name="plus" size={14} />
                שיבוץ ללוח
              </ButtonLink>
            )}
          </span>
        )}
      />

      <div className={styles.head}>
        <div>
          <h1>משמרות</h1>
          <p className={styles.sub}>
            {window === null ? (
              <bdi>{`${current.name} · עדיין בלי תאריך פתיחת שער`}</bdi>
            ) : (
              <>
                <bdi>{`האירוע נמשך מ${window.days[0].weekday} `}</bdi>
                <DateText at={window.startsAt} form="full" />
                <bdi>{` ב־${EVENT_OPENS.clock} עד ${window.days[EVENT_CLOSES.dayOffset].weekday} `}</bdi>
                <DateText at={window.endsAt} form="full" />
                <bdi>{` ב־${EVENT_CLOSES.clock}`}</bdi>
              </>
            )}
          </p>
        </div>
      </div>

      {window === null ? (
        <Banner
          tone="warn"
          headline="אין עדיין לוח, כי לא נקבע מתי השער נפתח."
          detail={`הלוח נפרש מיום פתיחת השער ב־${EVENT_OPENS.clock} עד היום החמישי אחריו ב־${EVENT_CLOSES.clock}. אפשר כבר להגדיר סוגי משמרות; השיבוץ מחכה לתאריך.`}
          action={{ label: 'קביעת תאריך פתיחת השער', href: gateHref }}
        />
      ) : null}

      <div className={styles.tiles}>
        <StatTile
          label="מקומות מאוישים"
          value={<bdi>{`${totals.placesFilled} מתוך ${totals.placesNeeded}`}</bdi>}
          tone={totals.placesNeeded > 0 && totals.placesFilled < totals.placesNeeded ? 'warn' : 'default'}
          derivation="נספר מהשיבוצים שאושרו · נרשם ידנית"
        />
        <StatTile
          label="משמרות שחסרים בהן אנשים"
          value={totals.uncoveredSlots}
          tone={totals.uncoveredSlots > 0 ? 'warn' : 'ok'}
          derivation={<bdi>{`מתוך ${totals.slots} משמרות בלוח`}</bdi>}
        />
        <StatTile
          label="חברים בלי משמרת"
          value={idle}
          tone={idle > 0 && totals.slots > 0 ? 'warn' : 'default'}
          derivation={<bdi>{`מתוך ${roster.length} ברשימת ${current.name}`}</bdi>}
          href="#load"
        />
      </div>

      {/*
        The kinds of shift, one chip each: name, usual window, head-count. A
        chip opens the type to edit; a retired one is dashed and says so.
        Camp-wide, so the strip says so — these are the same chips under
        every season (R5).
      */}
      <nav className={styles.strip} aria-label="סוגי משמרות">
        <span className={styles.stripLabel}>סוגי משמרות · כלל־קאמפי:</span>
        {types.length === 0 ? (
          <span className={styles.stripEmpty}>
            {'עדיין אין סוגי משמרות. סוג משמרת הוא שם, שעות רגילות וכמה אנשים צריך — '}
            <Link href={newTypeHref(here)}>הוספת סוג</Link>
          </span>
        ) : types.map((type) => (
          <Link
            key={type.id}
            href={typeHref(here, type.id)}
            className={cx(styles.chip, type.retiredAt !== null && styles.chipRetired)}
            aria-current={query.peekType === type.id ? 'true' : undefined}
          >
            <Icon name="clock" size={14} />
            {type.name}
            <bdi className={styles.chipMeta} dir="ltr">{`${type.startsClock}–${type.endsClock}`}</bdi>
            <span className={styles.chipMeta}>{`· ${type.peopleNeeded}`}</span>
            {type.retiredAt !== null ? <span className={styles.chipMeta}>· יצא משימוש</span> : null}
          </Link>
        ))}
      </nav>

      {window !== null && board !== null ? (
        board.rows.length === 0 ? (
          <EmptyState
            kind="nothing-this-season"
            noun="משמרות בלוח"
            seasonName={current.name}
            action={types.length === 0
              ? { label: 'הוספת סוג משמרת', href: newTypeHref(here) }
              : { label: 'שיבוץ ללוח', href: scheduleHref(here) }}
          />
        ) : (
          <ScheduleGrid board={board} days={window.days} params={here} currentTaskId={query.peek} />
        )
      ) : null}

      {board !== null && board.outside.length > 0 ? (
        <section className={styles.section} aria-label="משמרות מחוץ לימי האירוע">
          <div className={styles.sectionHead}>
            <h2>מחוץ לימי האירוע</h2>
            <span className={styles.sectionHint}>משמרות שנוצרו במסך המשימות ביום שאינו בלוח. הן נשארות שם.</span>
          </div>
          <ul className={styles.outside}>
            {board.outside.map((slot) => (
              <li key={slot.taskId}>
                <Link href="/tasks">{slot.title}</Link>
                {' · '}
                <DateText at={slot.startsAt} form="datetime" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} id="load" aria-label="עומס לפי חבר">
        <div className={styles.sectionHead}>
          <h2>עומס לפי חבר</h2>
          <span className={styles.sectionHint}>כל מי שברשימת השנה, גם מי שעדיין בלי משמרת.</span>
        </div>
        <Table<LoadRow>
          caption={`עומס משמרות ${current.name}`}
          density="compact"
          columns={[
            { key: 'name', header: 'שם', card: 'title', cell: (row) => row.displayName },
            {
              key: 'shifts', header: 'משמרות', card: 'figure', numeric: true,
              cell: (row) => row.shifts,
            },
            {
              key: 'hours', header: 'שעות', card: 'meta', numeric: true,
              cell: (row) => <bdi>{row.minutes === 0 ? '—' : formatMinutes(row.minutes)}</bdi>,
            },
          ]}
          rows={loadRows}
          empty={<EmptyState kind="nothing-this-season" noun="חברים" seasonName={current.name} action={{ label: 'מעבר לאנשים', href: '/members' }} />}
        />
      </section>

      {peekedType !== null ? <TypeDrawer type={peekedType} closeHref={closeHref} /> : null}
      {query.creatingType ? <TypeDrawer type={null} closeHref={closeHref} /> : null}
      {window !== null && (peekedSlot !== null || query.scheduling) ? (
        <SlotDrawer
          slot={peekedSlot}
          seasonId={current.id}
          closeHref={closeHref}
          params={here}
          types={activeTypes}
          days={window.days}
          roster={roster}
          presetTypeId={query.presetType}
          presetDay={query.presetDay}
        />
      ) : null}
    </main>
  );
}
