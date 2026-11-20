import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { warehouseCounts } from '@/lib/logistics/warehouse';
import { parseWarehouseQuery, warehouseHref, WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';
import { acquisitionCounts } from '@/lib/logistics/acquisitions';
import { acquisitionsHref, parseAcquisitionQuery } from '@/lib/logistics/acquisitions-views';
import { listPlan, listTopics, planRoster, summarizePlan, isOverdue } from '@/lib/logistics/plan';
import { planHref } from '@/lib/logistics/plan-views';
import { eventLabel, listEvents } from '@/lib/logistics/attendance';
import { eventHref, newEventHref } from '@/lib/logistics/attendance-views';
import { listCrew, type WorkDay } from '@/lib/logistics/workdays';
import { workdaysHref, weekdayOf, shortDate } from '@/lib/logistics/workdays-views';
import { campDayOf } from '@/lib/logistics/shift-time';
import {
  CONDITION_LABELS, STATUS_LABELS, WORK_STATUS_LABELS, WORK_STATUS_TONES,
} from '@/lib/logistics/labels';
import {
  attentionRows, barWords, daysAway, shareOf, upcomingDays,
  type BarSegment, type HubDay, type HubTarget,
} from '@/lib/logistics/hub';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoTip } from '@/components/ui/info-tip';
import { ButtonLink } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/cx';
import styles from './hub.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'לוגיסטיקה' };

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** One screen as a card: its headline figure, how it divides, and where it came from. */
function ScreenCard({
  label, figure, unit, segments, derivation, href,
}: {
  label: string;
  figure: number;
  unit: string;
  segments: readonly BarSegment[];
  derivation: ReactNode;
  href: string;
}) {
  return (
    <Link className={styles.card} href={href}>
      <span className={styles.label}>{label}</span>
      <span className={styles.cardValue}>
        <bdi className={styles.cardFigure}>{figure}</bdi>
        <span className={styles.cardUnit}>{unit}</span>
      </span>
      {segments.length === 0 ? null : (
        <>
          <span className={styles.bar} role="img" aria-label={barWords(segments)}>
            {segments.filter((segment) => segment.count > 0).map((segment) => (
              <i
                key={segment.id}
                className={styles[segment.kind]}
                style={{ inlineSize: `${shareOf(segment, segments)}%` }}
              />
            ))}
          </span>
          <ul className={styles.legend}>
            {segments.map((segment) => (
              <li key={segment.id}>
                <span className={cx(styles.swatch, styles[segment.kind])} aria-hidden="true" />
                <span>{segment.label}</span>
                <bdi>{segment.count}</bdi>
              </li>
            ))}
          </ul>
        </>
      )}
      <span className={styles.derivation}>{derivation}</span>
    </Link>
  );
}

/** `14 מתוך 22 משובצים`, as a bar a reader can also hear. */
function StaffingBar({ assigned, roster }: { assigned: number; roster: number }) {
  const share = roster === 0 ? 0 : Math.min(100, (assigned / roster) * 100);
  return (
    <span className={styles.bar} role="img" aria-label={`${assigned} מתוך ${roster} משובצים`}>
      <i className={styles.brand} style={{ inlineSize: `${share}%` }} />
    </span>
  );
}

function dayPill(day: HubDay) {
  if (day.tasks === 0) return <Pill tone="neutral">בלי משימות</Pill>;
  if (day.uncrewed.length > 0) {
    return <Pill tone="warn">{day.uncrewed.length === 1 ? 'משימה אחת בלי צוות' : `${day.uncrewed.length} משימות בלי צוות`}</Pill>;
  }
  return <Pill tone="ok">לכל משימה יש צוות</Pill>;
}

const tasksWord = (count: number) => (count === 0 ? 'בלי משימות' : count === 1 ? 'משימה אחת' : `${count} משימות`);

/**
 * לוגיסטיקה — what each logistics screen would say if it were open.
 *
 * The route used to redirect to מחסן: with three screens there was nothing
 * an overview could add. There are now the plan and its work days as well,
 * and the question a lead arrives with — what needs a hand before the next
 * work day — has its answer spread over all of them. This page is that
 * answer and nothing else: no figure here is computed for the hub alone
 * (each is the owning screen's own count), and every row and card is the
 * link to the screen that can change it.
 *
 * It shows only what the account may open. A section whose grant is missing
 * is left out rather than drawn empty, because an empty מחסן card would say
 * the warehouse is empty, and that is a different fact. An account that can
 * open none of them is told there is no such page.
 */
export default async function LogisticsPage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const [warehouse, acquisitions, plan, attendance] = await Promise.all([
    requireAdmin('warehouse'), requireAdmin('acquisitions'), requireAdmin('plan'), requireAdmin('attendance'),
  ]);
  if (!warehouse.ok && !acquisitions.ok && !plan.ok) notFound();

  const params = await searchParams;
  const { current } = await resolveSeason(db, one(params.season) || undefined);

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={[{ label: 'לוגיסטיקה' }]} />
        <h1>לוגיסטיקה</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  const season: RawParams = { season: current.id };
  const today = campDayOf(new Date());

  const [gear, purchases, items, topics, occasions, crew, roster] = await Promise.all([
    warehouse.ok ? warehouseCounts(db, parseWarehouseQuery({})) : null,
    acquisitions.ok ? acquisitionCounts(db, current.id, parseAcquisitionQuery(season)) : null,
    plan.ok ? listPlan(db, current.id) : null,
    plan.ok ? listTopics(db, current.id) : [],
    plan.ok ? listEvents(db, current.id) : [],
    plan.ok ? listCrew(db, current.id) : [],
    plan.ok ? planRoster(db, current.id) : [],
  ]);

  const workDays: WorkDay[] = occasions
    .filter((occasion) => occasion.kind === 'work_day' && occasion.cancelledAt === null)
    .map((occasion) => ({ id: occasion.id, label: eventLabel(occasion), heldOn: occasion.heldOn }));
  const ahead = items === null ? [] : upcomingDays(workDays, today, items, topics, crew, roster);
  const nextDay = ahead[0] ?? null;
  const dayWords = (day: WorkDay) => `${weekdayOf(day.heldOn)} ${shortDate(day.heldOn)}`;

  const hrefOf: Record<HubTarget, string> = {
    'plan-list': `${planHref(season, {})}#list`,
    'plan-timeline': `${planHref(season, {})}#timeline`,
    workday: workdaysHref(season, { day: nextDay?.day.id ?? null }),
    'acquisitions-to-search': acquisitionsHref(season, { view: 'to_search' }),
    'acquisitions-arrived': acquisitionsHref(season, { view: 'arrived' }),
    'warehouse-attention': warehouseHref({}, { view: 'attention' }),
  };

  const attention = attentionRows({
    warehouse: gear === null ? null : { needsRepair: gear.needsRepair, needsTesting: gear.needsTesting },
    acquisitions: purchases === null
      ? null
      : { toSearch: purchases.byStatus.to_search, unregisteredArrivals: purchases.unregisteredArrivals },
    plan: items === null
      ? null
      : { items, today, nextDay, nextDayWords: nextDay === null ? null : dayWords(nextDay.day) },
  });

  const totals = items === null ? null : summarizePlan(items);
  const overdue = items === null ? 0 : items.filter((item) => isOverdue(item, today)).length;
  const addDayHref = attendance.ok && attendance.level !== 'view' ? newEventHref(season) : null;

  return (
    <main className={styles.page}>
      <TopBar crumbs={[{ label: 'לוגיסטיקה' }]} chip={<SeasonChip seasonName={current.name} />} />

      <div>
        <h1>לוגיסטיקה</h1>
        {nextDay === null ? null : (
          <p className={styles.sub}>
            <bdi>{`יום העבודה הבא ${daysAway(today, nextDay.day.heldOn)}`}</bdi>
          </p>
        )}
      </div>

      <div className={styles.top}>
        <section className={styles.panel} aria-label="דורש טיפול">
          <div className={styles.panelHead}>
            <h2>דורש טיפול</h2>
          </div>
          {attention.length === 0 ? (
            <div className={styles.clear}><EmptyState kind="all-clear" /></div>
          ) : (
            <ul className={styles.rows}>
              {attention.map((row) => (
                <li key={row.id}>
                  <Link className={styles.row} href={hrefOf[row.target]}>
                    <span className={styles.rowWord}><Pill tone={row.tone}>{row.word}</Pill></span>
                    <span className={styles.rowWords}>
                      <bdi className={styles.rowHeadline}>{row.headline}</bdi>
                      {row.detail === null ? null : <span className={styles.rowDetail}>{row.detail}</span>}
                    </span>
                    <span className={styles.rowScreen}>
                      {row.screen}
                      <Icon name="arrowl" size={14} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {items === null ? null : (
          <section className={cx(styles.panel, styles.next)} aria-label="יום העבודה הבא">
            {nextDay === null ? (
              <>
                <h2 className={styles.label}>יום העבודה הבא</h2>
                <EmptyState
                  kind="none-of-this-kind"
                  noun="ימי עבודה מהיום והלאה"
                  action={addDayHref === null
                    ? { label: 'מעבר לימי עבודה', href: workdaysHref(season) }
                    : { label: 'הוספת יום עבודה בלוח הנוכחות', href: addDayHref }}
                />
              </>
            ) : (
              <>
                <div className={styles.nextHead}>
                  <div className={styles.nextWhen}>
                    <h2 className={styles.label}>יום העבודה הבא</h2>
                    <div className={styles.nextDate}><bdi>{dayWords(nextDay.day)}</bdi></div>
                    <div className={styles.hint}>
                      <bdi>{nextDay.day.label}</bdi>{' · '}<bdi>{daysAway(today, nextDay.day.heldOn)}</bdi>
                    </div>
                  </div>
                  <Pill tone="info">{tasksWord(nextDay.tasks)}</Pill>
                </div>

                <div>
                  <div className={styles.meterHead}>
                    <bdi className={styles.meterLead}>{`${nextDay.assigned} מתוך ${roster.length} משובצים`}</bdi>
                    <span className={styles.hint}>
                      <bdi>{`${Math.max(0, roster.length - nextDay.assigned)} בלי משימה`}</bdi>{' · נרשם ידנית'}
                    </span>
                  </div>
                  <StaffingBar assigned={nextDay.assigned} roster={roster.length} />
                </div>

                {nextDay.lines.length === 0 ? null : (
                  <ul className={styles.lines}>
                    {nextDay.lines.slice(0, 6).map((line) => (
                      <li key={line.id} className={styles.line}>
                        <span className={styles.lineTitle}>{line.title}</span>
                        {line.done ? (
                          <Pill tone={WORK_STATUS_TONES.done}>{WORK_STATUS_LABELS.done}</Pill>
                        ) : line.crew.length === 0 ? (
                          <Pill tone="warn">בלי צוות</Pill>
                        ) : (
                          <span className={styles.lineCrew}>
                            {line.crew.slice(0, 3).map((name) => (
                              <Avatar key={name} name={name} size="sm" decorative />
                            ))}
                            <bdi>{line.crew.length === 1 ? line.crew[0] : `${line.crew.length} משובצים`}</bdi>
                          </span>
                        )}
                      </li>
                    ))}
                    {nextDay.lines.length > 6 ? (
                      <li className={styles.hint}><bdi>{`ועוד ${nextDay.lines.length - 6}`}</bdi></li>
                    ) : null}
                  </ul>
                )}

                <div className={styles.nextActions}>
                  <ButtonLink tone="primary" size="sm" href={workdaysHref(season, { day: nextDay.day.id })}>
                    <Icon name="calendar" size={14} />
                    שיבוץ ליום הזה
                  </ButtonLink>
                  {attendance.ok ? (
                    <ButtonLink size="sm" href={eventHref(season, nextDay.day.id)}>
                      <Icon name="check" size={14} />
                      נוכחות ביום הזה
                    </ButtonLink>
                  ) : null}
                </div>
              </>
            )}
          </section>
        )}
      </div>

      <section aria-label="המסכים">
        <div className={styles.sectionHead}>
          <h2>המסכים</h2>
        </div>
        <div className={styles.cards}>
          {gear === null ? null : (
            <ScreenCard
              label="מחסן"
              figure={gear.total}
              unit={gear.total === 1 ? 'פריט' : 'פריטים'}
              href={WAREHOUSE_PATH}
              derivation="נספרו ידנית · אין קובץ מקור"
              segments={[
                {
                  id: 'ready', kind: 'ok', label: CONDITION_LABELS.ready,
                  count: gear.total - gear.needsTesting - gear.needsRepair - gear.retired,
                },
                { id: 'testing', kind: 'warn', label: CONDITION_LABELS.needs_testing, count: gear.needsTesting },
                { id: 'repair', kind: 'bad', label: CONDITION_LABELS.needs_repair, count: gear.needsRepair },
                { id: 'retired', kind: 'muted', label: CONDITION_LABELS.retired, count: gear.retired },
              ]}
            />
          )}
          {purchases === null ? null : (
            <ScreenCard
              label="רכש"
              figure={purchases.byStatus.arrived}
              unit={`מתוך ${purchases.total} הגיעו`}
              href={acquisitionsHref(season, {})}
              derivation="נרשם ידנית · התקציב נשאר במסך הרכש"
              segments={[
                { id: 'arrived', kind: 'ok', label: STATUS_LABELS.arrived, count: purchases.byStatus.arrived },
                { id: 'ordered', kind: 'warn', label: STATUS_LABELS.ordered, count: purchases.byStatus.ordered },
                { id: 'review', kind: 'info', label: STATUS_LABELS.in_review, count: purchases.byStatus.in_review },
                { id: 'search', kind: 'bad', label: STATUS_LABELS.to_search, count: purchases.byStatus.to_search },
              ]}
            />
          )}
          {totals === null ? null : (
            <ScreenCard
              label="לוח עבודה"
              figure={totals.open}
              unit={totals.open === 1 ? 'משימה פתוחה' : 'משימות פתוחות'}
              href={planHref(season, {})}
              derivation="נרשם ידנית"
              segments={[
                { id: 'done', kind: 'ok', label: 'הושלמו', count: totals.done },
                { id: 'placed', kind: 'info', label: 'על ציר הזמן', count: totals.scheduled - overdue },
                { id: 'unplaced', kind: 'warn', label: 'בלי יום', count: totals.unscheduled },
                { id: 'overdue', kind: 'bad', label: 'עבר התאריך', count: overdue },
              ]}
            />
          )}
          {items === null ? null : (
            <ScreenCard
              label="ימי עבודה"
              figure={ahead.length}
              unit={ahead.length === 1 ? 'יום עבודה לפנינו' : 'ימי עבודה לפנינו'}
              href={workdaysHref(season)}
              derivation="הימים מלוח הנוכחות · השיבוץ נרשם ידנית"
              segments={nextDay === null ? [] : [
                { id: 'assigned', kind: 'info', label: 'משובצים ליום הבא', count: nextDay.assigned },
                {
                  id: 'free', kind: 'muted', label: 'בלי משימה ביום הבא',
                  count: Math.max(0, roster.length - nextDay.assigned),
                },
              ]}
            />
          )}
        </div>
      </section>

      {ahead.length === 0 ? null : (
        <section aria-label="ימי העבודה הקרובים">
          <div className={styles.sectionHead}>
            <h2>ימי העבודה הקרובים</h2>
            <InfoTip id="hub-days" label="מאיפה ימי העבודה">
              הימים מגיעים מלוח הנוכחות, והשיבוץ מימי עבודה.
            </InfoTip>
            <span className={styles.spacer} />
            <Link href={workdaysHref(season)}>כל ימי העבודה</Link>
          </div>
          <div className={styles.cards}>
            {ahead.slice(0, 4).map((day, index) => (
              <Link
                key={day.day.id}
                className={cx(styles.dayCard, index === 0 && styles.dayNext)}
                href={workdaysHref(season, { day: day.day.id })}
              >
                <span className={styles.dayHead}>
                  <bdi className={styles.dayDate}>{dayWords(day.day)}</bdi>
                  {dayPill(day)}
                </span>
                <span className={styles.hint}>
                  <bdi>{tasksWord(day.tasks)}</bdi>{' · '}
                  <bdi>{`${day.assigned} מתוך ${roster.length} משובצים`}</bdi>
                </span>
                <StaffingBar assigned={day.assigned} roster={roster.length} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
