import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listPersonChoices } from '@/lib/members/dossier';
import { moneyOverview } from '@/lib/money/overview';
import { ACCOUNT_FUNDS, ACCOUNT_FUND_NAMES } from '@/lib/money/labels';
import { Money } from '@/components/format';
import { Banner } from '@/components/ui/banner';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { StackedBar } from '@/components/charts/stacked-bar';
import { CountDrawer } from './count-drawer';
import { NewAccountDrawer } from './new-account-drawer';
import { HolderDrawer } from './holder-drawer';
import { FundDrawer } from './fund-drawer';
import { FundSections } from './fund-sections';
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
  const admin = await requireAdmin('money');
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
  /* `?act=holder&account=<id>`: whose money this is now. The people list is
     read only while the drawer is open — it is the one thing the page does
     not otherwise need. */
  const holding = params.act === 'holder'
    ? summary.accounts.find((row) => row.accountId === params.account)
    : undefined;
  const people = holding === undefined ? [] : await listPersonChoices(db);
  /* `?act=fund&account=<id>`: whose money this is — the camp's or the gift's. */
  const placing = params.act === 'fund'
    ? summary.accounts.find((row) => row.accountId === params.account)
    : undefined;
  /* Plus whoever holds it now, as the acquisitions screen does: a merge does
     not refuse a person who holds an account, and the list above leaves
     merged-away records out. A picker that quietly dropped the holder showed
     ״אף אחד״ over an id it still sent, which the library then refused. */
  if (holding !== undefined && holding.holderPersonId !== null && holding.holderName !== null
    && !people.some((person) => person.id === holding.holderPersonId)) {
    people.push({ id: holding.holderPersonId, displayName: holding.holderName });
  }
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
          ) : null /* A season with a planned size and no camp budget line says
                    * nothing here: the budget band below is where its absence
                    * shows, with the way to fill it. */}

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
        {/* Two balances, never their sum: the camp's money and the gift's are
          * different money, and one figure over both hid whichever pot was
          * overdrawn. Each links to the ledger read through that pot. */}
        {ACCOUNT_FUNDS.map((fund) => {
          const pot = summary.funds[fund];
          const overdrawn = pot.balanceAgorot < 0;
          const count = pot.accountCount === 0 ? 'אין עדיין חשבון'
            : pot.accountCount === 1 ? 'חשבון אחד' : `${pot.accountCount} חשבונות`;
          return (
            <li key={fund}>
              <StatTile
                label={`יתרת ${ACCOUNT_FUND_NAMES[fund]}`}
                valueAgorot={pot.balanceAgorot}
                tone={overdrawn ? 'bad' : 'default'}
                derivation={`${count} · לא תלוי בשנה${overdrawn ? ' · במינוס' : ''}`}
                href={`/money/ledger${scope}&fund=${fund}`}
              />
            </li>
          );
        })}
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
      </ul>

      <section>
        {/* The heading is kept for whoever navigates by headings, and drawn for
          * nobody: the two pots under it each carry their own name, and the
          * tiles above already say whose money is whose. */}
        <h2 className="sr-only">איפה הכסף</h2>

        {/* A bar list compared account balances against each other, which is
          * not a question anyone asks — a קופה does not compete with a bank
          * account. A card answers the questions that are asked: how much,
          * whose, and is anything wrong with it. The cards are drawn under
          * the pot they belong to (`FundSections`). */}
        {summary.accounts.length === 0 ? (
          <EmptyState kind="nothing-yet" noun="חשבונות"
                      action={{ href: moneyHref({ season: season.id, newAccount: true }), label: 'חשבון חדש' }} />
        ) : (
          <FundSections
            accounts={summary.accounts}
            funds={summary.funds}
            flows={summary.fundFlows}
            seasonId={season.id}
            seasonName={season.name}
          />
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
        {holding === undefined ? null : (
          <HolderDrawer
            account={{
              id: holding.accountId,
              name: holding.name,
              holderPersonId: holding.holderPersonId,
              holderName: holding.holderName,
            }}
            people={people}
            closeHref={closeHref}
          />
        )}

        {placing === undefined ? null : (
          <FundDrawer
            account={{ id: placing.accountId, name: placing.name, fund: placing.fund }}
            closeHref={closeHref}
          />
        )}

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
