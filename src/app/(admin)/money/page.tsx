import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { moneyOverview } from '@/lib/money/overview';
import { formatShekels } from '@/lib/money';
import { Money } from '@/components/format';
import { Banner } from '@/components/ui/banner';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { StackedBar } from '@/components/charts/stacked-bar';
import { AccountCard } from './account-card';
import { CountDrawer } from './count-drawer';
import { NewAccountDrawer } from './new-account-drawer';
import { moneyHref } from './href';
import { ObligationsTable } from './obligations-table';
import { BudgetTable } from './budget-table';
import { RecentMovements } from './recent-movements';
import styles from './money.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'כספים' };

/**
 * The page the lead opens to see where the money is. It leads with the
 * sentence no single sheet of the source workbook states — the true
 * per-head cost versus what members actually pay versus what fundraising is
 * meant to cover — because that relationship, not any one number, is what
 * nobody could see before this page existed.
 */
export default async function MoneyPage(
  { searchParams }: {
    searchParams: Promise<{ season?: string; act?: string; account?: string }>;
  },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main>
        <h1>כספים</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const params = await searchParams;
  const season = seasons.find((s) => s.id === params.season) ?? seasons[0];
  const view = await moneyOverview(db, season.id);
  const { summary } = view;
  const { identity } = summary;
  const scope = `?season=${season.id}`;

  /**
   * The two drawers this screen owns, read from the URL (R6): `?act=count&
   * account=<id>` counts one account, `?act=new-account` adds one. An
   * `account` the summary does not know is treated as no drawer rather
   * than as an empty form — a form over a missing record would write to
   * nothing and say it had.
   */
  const counting = params.act === 'count'
    ? summary.accounts.find((row) => row.accountId === params.account)
    : undefined;
  const addingAccount = params.act === 'new-account';
  const closeHref = moneyHref({ season: season.id });

  // `duesFundingIdentity` (src/lib/money/funding.ts) sets both of these to
  // `null` in exactly the same branch — no planned camp size — so bundling
  // them into one non-null object gates the thesis sentence, the mismatch
  // warning and the bar identically, and lets each branch read the values
  // back typed as plain numbers instead of `number | null`.
  //
  // Also gated on `budgetTotalAgorot > 0`: ברן 25 has a planned size but no
  // `camp`-category budget line, so the identity honestly reports a budget
  // total (and so a per-person figure) of 0 — not null. Without this guard
  // the thesis below would print "0 ₪ לאדם", asserting the camp budget is
  // zero rather than admitting it was never recorded.
  const hasCampBudget = identity.budgetTotalAgorot > 0;
  const perPerson = hasCampBudget
    && identity.perPersonFullAgorot !== null && identity.perPersonFundingAgorot !== null
    ? { fullAgorot: identity.perPersonFullAgorot, fundingAgorot: identity.perPersonFundingAgorot }
    : null;
  // A dues payment is always money in, so it joins the ledger's own inflow;
  // outflow has no payments counterpart. Kept as two figures, not one sum —
  // money that arrived somewhere unrecorded and money that left somewhere
  // unrecorded are different facts about the camp's finances.
  const unattributedInAgorot = summary.unattributed.inAgorot + summary.unattributed.paymentsAgorot;
  const unattributedOutAgorot = summary.unattributed.outAgorot;

  return (
    <main className={styles.page}>
      <h1 className="sr-only">כספים</h1>

      <section className={`card ${styles.lead}`}>
        <div className={styles.leadFigure}>
          <div className={styles.leadLabel}>דמי קאמפ לאדם · <bdi>{season.name}</bdi></div>
          <p className={styles.hero}><Money agorot={identity.flatRateAgorot} /></p>
          <Link className="link" href={`/fees${scope}`}>לדף דמי הקאמפ ←</Link>
        </div>

        <div className={styles.leadArgument}>
          {perPerson ? (
            <p className={styles.thesis}>
              כל חבר משלם. התקציב המלא הוא{' '}
              <Money agorot={identity.budgetTotalAgorot} /> ל־
              <bdi>{identity.plannedSize}</bdi> איש —{' '}
              <Money agorot={perPerson.fullAgorot} /> לאדם.
              הגיוס מכסה <Money agorot={perPerson.fundingAgorot} /> מכל אחד מהם.
            </p>
          ) : identity.plannedSize === null ? (
            <p className="muted">
              אי אפשר לחשב עלות לאדם ל<bdi>{season.name}</bdi> בלי גודל מחנה
              מתוכנן. אם חיפשתם שנה אחרת, בחרו אותה בבורר השנה בסרגל הצד.
            </p>
          ) : (
            <p className="muted">
              ל<bdi>{season.name}</bdi> עדיין לא נרשם תקציב קאמפ, ולכן אי אפשר
              לחשב עלות לאדם. אם חיפשתם שנה אחרת, בחרו אותה בבורר השנה בסרגל הצד.
            </p>
          )}

          {/*
            * R3: gold, an icon and a sentence, in place of a bare `⚠` in a red
            * `.badge-warn` — a glyph whose only carrier of meaning was colour.
            * `Banner` takes the lead clause and the rest of the sentence as
            * two props (C9), so the sentence is split at its own full stop
            * rather than reworded.
            */}
          {!identity.closes && perPerson ? (
            <Banner
              tone="warn"
              headline="דמי הקאמפ והגיוס לא מסתכמים לתקציב."
              detail="משהו כאן לא מתאים — התקציב, היעד או גודל המחנה."
            />
          ) : null}

          {/*
            * `duesCoverAgorot` is only ever `null` in the same "no planned
            * size" branch that makes `perPerson` null, so the bar is gated on
            * that instead of defaulted to 0 — a zero-length "דמי קאמפ" segment
            * would assert the camp collects ₪0 in dues, which is false; it is
            * simply not computable yet, and the muted message above already
            * says so on its own.
            */}
          {perPerson ? (
            <StackedBar
              segments={[
                { id: 'dues', label: 'דמי קאמפ', valueAgorot: identity.duesCoverAgorot ?? 0, series: 1 },
                { id: 'raise', label: 'יעד גיוס', valueAgorot: identity.fundingTargetAgorot, series: 2 },
              ]}
              totalAgorot={identity.budgetTotalAgorot}
            />
          ) : null}
          <p className={styles.provenanceNote}>
            כל מספר כאן נגזר משורות אמיתיות. אין כאן שום סכום שנכתב ביד.
          </p>
        </div>
      </section>

      {/*
        * Wave 1's `אנחנו חייבים` tile is gone: band 4 below carries both
        * directions' totals in its own headings, and a tile that repeats the
        * heading under it is a figure, not an argument.
        *
        * Every tile links onward and every link carries the season, so the
        * shell's switcher stays in step (R5). `נכנס`/`יצא` link to the route
        * rather than to a direction filter — D7's filter vocabulary is plan
        * 09's to define, and a link to a param that never ships is worse than
        * a link to the route.
        */}
      <ul className={styles.tiles} aria-label="סיכום כספי">
        <li>
          <StatTile
            label="יתרה בכל החשבונות"
            valueAgorot={summary.totalBalanceAgorot}
            derivation={`${summary.accounts.length} חשבונות · לא תלוי בשנה`}
            href={`/money/ledger${scope}`}
          />
        </li>
        <li>
          <StatTile
            label="נכנס בשנה הזו"
            valueAgorot={summary.ledger.inAgorot}
            derivation={`${summary.ledger.count} תנועות`}
            href={`/money/ledger${scope}`}
          />
        </li>
        <li>
          <StatTile
            label="יצא בשנה הזו"
            valueAgorot={summary.ledger.outAgorot}
            href={`/money/ledger${scope}`}
          />
        </li>
        <li>
          <StatTile
            label="נותר לגייס"
            valueAgorot={view.fundraising.remainingAgorot}
            /* The one figure on this page whose definition is a choice — the
             * season's ledger inflow, dues excluded — so the choice is printed
             * where a reader can check it rather than left to be inferred. */
            derivation={view.fundraising.targetAgorot > 0
              ? `גויסו ${formatShekels(view.fundraising.raisedAgorot)} מתוך ${formatShekels(view.fundraising.targetAgorot)}`
              : `לא נרשם יעד גיוס ל${season.name}`}
            href={`/money/ledger${scope}`}
          />
        </li>
        <li>
          <StatTile
            label="דורש הכרעה"
            value={<bdi>{view.decisions.total}</bdi>}
            derivation={view.decisions.total === 0
              ? 'הכל מטופל'
              : `${view.decisions.unnamedCount} חובות בלי שם · ${view.decisions.arithmeticCount} סעיפים שלא מסתדרים`}
            href={`/inbox${scope}`}
          />
        </li>
      </ul>

      <section>
        {/* The note sits beside the heading, not inside it: an `<h2>` whose
          * accessible name carries a whole caveat is a heading nobody can
          * navigate to by name. */}
        <div className={styles.sectionTitle}>
          <h2 className={styles.sectionHeading}>איפה הכסף</h2>
          <span className={styles.sectionNote}>
            חשבונות אינם שייכים לשנה — היתרה היא תמיד הנוכחית
          </span>
          <Link className={`link ${styles.sectionLink}`} href={moneyHref({ season: season.id, newAccount: true })}>
            חשבון חדש
          </Link>
        </div>
        {/* The way in when the book was not kept: count what there is, say
          * when, and go on from there. Said here, once, above the cards that
          * each carry the link — a lead who has never counted needs the
          * sentence more than the link. */}
        <p className={styles.sectionLead}>
          לא עקבתם אחרי כל ההכנסות וההוצאות? ספרו כמה כסף יש בכל חשבון היום, ומאותו יום
          כל תנועה שתירשם תעדכן את היתרה. מה שנרשם מלפני הספירה נשמר כהיסטוריה.
        </p>

        {/* A bar list compared account balances against each other, which is
          * not a question anyone asks — a קופה does not compete with a bank
          * account. A card answers the questions that are asked: how much,
          * whose, and is anything wrong with it. */}
        {summary.accounts.length === 0 ? (
          <EmptyState kind="nothing-yet" noun="חשבונות"
                      action={{ href: moneyHref({ season: season.id, newAccount: true }), label: 'חשבון חדש' }} />
        ) : (
          <div className={styles.accountGrid}>
            {summary.accounts.map((row) => (
              <AccountCard
                key={row.accountId}
                account={row}
                countHref={moneyHref({ season: season.id, count: row.accountId })}
              />
            ))}
          </div>
        )}

        {counting === undefined ? null : (
          <CountDrawer
            account={{
              id: counting.accountId,
              name: counting.name,
              balanceAgorot: counting.balanceAgorot,
              countedAgorot: counting.countedAgorot,
              countedOn: counting.countedOn,
            }}
            closeHref={closeHref}
          />
        )}
        {!addingAccount ? null : <NewAccountDrawer closeHref={closeHref} />}

        {unattributedInAgorot > 0 ? (
          <Banner
            tone="warn"
            action={{ href: `/money/ledger${scope}`, label: 'שיוך לחשבון' }}
            headline={<><Money agorot={unattributedInAgorot} /> נרשמו בלי לציין לאיזה חשבון נכנסו.</>}
          />
        ) : null}
        {unattributedOutAgorot > 0 ? (
          <Banner
            tone="warn"
            action={{ href: `/money/ledger${scope}`, label: 'שיוך לחשבון' }}
            headline={<><Money agorot={unattributedOutAgorot} /> נרשמו בלי לציין מאיזה חשבון יצאו.</>}
          />
        ) : null}
      </section>

      <section>
        <div className={styles.sectionTitle}>
          <h2 className={styles.sectionHeading}>מה חייבים ומה חייבים לנו</h2>
          <Link className={`link ${styles.sectionLink}`} href={`/money/debts${scope}`}>
            לכל החובות ←
          </Link>
        </div>

        {summary.campOwes.length === 0 && summary.owedToCamp.length === 0 ? (
          <EmptyState kind="nothing-this-season" noun="חובות רשומים"
                      seasonName={season.name}
                      action={{ href: '/upload', label: 'לדף הייבוא' }} />
        ) : (
          <div className={styles.debtGrid}>
            <div>
              <h3 className={styles.debtHeading}>
                מה אנחנו חייבים — <Money agorot={summary.campOwesAgorot} />
              </h3>
              {summary.campOwes.length === 0 ? (
                <EmptyState kind="nothing-this-season" noun="חובות שהקאמפ חייב"
                            seasonName={season.name}
                            action={{ href: '/upload', label: 'לדף הייבוא' }} />
              ) : (
                <ObligationsTable direction="camp_owes" rows={summary.campOwes}
                                  sources={view.sources} scope={scope} />
              )}
            </div>
            <div>
              <h3 className={styles.debtHeading}>
                מה חייבים לנו — <Money agorot={summary.owedToCampAgorot} />
              </h3>
              {summary.owedToCamp.length === 0 ? (
                <EmptyState kind="nothing-this-season" noun="חובות שחייבים לקאמפ"
                            seasonName={season.name}
                            action={{ href: '/upload', label: 'לדף הייבוא' }} />
              ) : (
                <ObligationsTable direction="owed_to_camp" rows={summary.owedToCamp}
                                  sources={view.sources} scope={scope} />
              )}
            </div>
          </div>
        )}

        {summary.unnamed.length > 0 ? (
          <Banner
            tone="warn"
            action={{ href: `/inbox${scope}`, label: 'לטיפול' }}
            headline={<bdi>{summary.unnamed.length} חובות בלי שם.</bdi>}
            detail="אי אפשר לסגור אותם עד שיירשם למי מגיע הכסף."
          />
        ) : null}
      </section>

      {/* `id="budget"` is where the nav's תקציב entry (`/money#budget`) lands;
          each line below carries `budget-<id>` for the palette and the task rows. */}
      <section id="budget">
        <div className={styles.sectionTitle}>
          <h2 className={styles.sectionHeading}>התקציב</h2>
          <span className={styles.sectionNote}>
            עמודת ״למה״ היא הנימוק כפי שנכתב בגיליון
          </span>
        </div>
        <BudgetTable groups={view.budget} totals={view.budgetTotals}
                     sources={view.sources} seasonName={season.name} />
      </section>

      <RecentMovements rows={view.recent} total={view.movementCount}
                       sources={view.sources} scope={scope} seasonName={season.name} />
    </main>
  );
}
