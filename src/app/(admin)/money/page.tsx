import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { moneyOverview } from '@/lib/money/overview';
import type { ObligationRow } from '@/lib/money/obligations';
import { formatILS, formatShekels } from '@/lib/money';
import { Money } from '@/components/format';
import { Banner } from '@/components/ui/banner';
import { StatTile } from '@/components/ui/stat-tile';
import { BarList } from '@/components/charts/bar-list';
import { StackedBar } from '@/components/charts/stacked-bar';
import { Meter } from '@/components/charts/meter';
import styles from './money.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'כספים' };

/**
 * One direction's worth of obligation rows. Split out so the page can render
 * "what we owe" and "what's owed to us" as two separately headed tables —
 * concatenating both directions under one header left a reader with no way
 * to tell, from a single row, which way the money was supposed to move.
 */
function ObligationsTable({ rows }: { rows: ObligationRow[] }) {
  return (
    <table>
      <thead>
        <tr><th>למי</th><th>על מה</th><th>סכום</th><th>קוזז</th><th>נותר</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.displayParty ?? <span className="badge-warn">⚠ חסר שם</span>}</td>
            <td>{row.description}</td>
            <td><bdi>{formatILS(row.amountAgorot)} ₪</bdi></td>
            <td>
              <Meter label={row.description} valueAgorot={row.settledAgorot}
                     totalAgorot={row.amountAgorot} />
            </td>
            <td><bdi>{formatILS(row.outstandingAgorot)} ₪</bdi></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The page the lead opens to see where the money is. It leads with the
 * sentence no single sheet of the source workbook states — the true
 * per-head cost versus what members actually pay versus what fundraising is
 * meant to cover — because that relationship, not any one number, is what
 * nobody could see before this page existed.
 */
export default async function MoneyPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
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

  const { season: requested } = await searchParams;
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  const view = await moneyOverview(db, season.id);
  const { summary } = view;
  const { identity } = summary;
  const scope = `?season=${season.id}`;
  // Transitional: the budget band is still Wave 1's flat table until Task 9
  // replaces it with `BudgetTable`, which reads the groups directly.
  const budget = view.budget.flatMap((group) => group.lines);
  const movements = view.recent;

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

      <section className="card">
        <h2>איפה הכסף</h2>
        <BarList
          emptyMessage="עדיין לא נרשמו חשבונות. אפשר לייבא נתונים מדף הייבוא."
          items={summary.accounts.map((account) => ({
            id: account.accountId,
            label: account.name,
            valueAgorot: account.balanceAgorot,
            tone: account.kind === 'personal' ? ('warning' as const) : undefined,
            note: account.kind === 'personal'
              ? `חשבון פרטי של ${account.holderName ?? 'חבר מחנה'} שמחזיק כסף של הקאמפ`
              : undefined,
          }))}
        />
        {unattributedInAgorot > 0 ? (
          <p className="badge-warn">
            ⚠ <bdi>{formatILS(unattributedInAgorot)} ₪</bdi>{' '}
            נרשמו בלי לציין לאיזה חשבון נכנסו.
          </p>
        ) : null}
        {unattributedOutAgorot > 0 ? (
          <p className="badge-warn">
            ⚠ <bdi>{formatILS(unattributedOutAgorot)} ₪</bdi>{' '}
            נרשמו בלי לציין מאיזה חשבון יצאו.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>מה חייבים ומה חייבים לנו</h2>
        {summary.campOwes.length === 0 && summary.owedToCamp.length === 0 ? (
          <p className="muted">
            אין חובות רשומים ל<bdi>{season.name}</bdi>. אפשר לייבא נתונים מ
            <Link href="/upload">דף הייבוא</Link>, או אם חיפשתם שנה אחרת — לבחור
            אותה למעלה.
          </p>
        ) : (
          <>
            <h3>מה אנחנו חייבים</h3>
            {summary.campOwes.length === 0 ? (
              <p className="muted">
                אין חובות שהקאמפ חייב ל<bdi>{season.name}</bdi>. אפשר לייבא
                נתונים מ<Link href="/upload">דף הייבוא</Link>, או אם חיפשתם
                שנה אחרת — לבחור אותה למעלה.
              </p>
            ) : (
              <ObligationsTable rows={summary.campOwes} />
            )}

            <h3>מה חייבים לנו</h3>
            {summary.owedToCamp.length === 0 ? (
              <p className="muted">
                אין חובות שחייבים לקאמפ ל<bdi>{season.name}</bdi>. אפשר לייבא
                נתונים מ<Link href="/upload">דף הייבוא</Link>, או אם חיפשתם
                שנה אחרת — לבחור אותה למעלה.
              </p>
            ) : (
              <ObligationsTable rows={summary.owedToCamp} />
            )}
          </>
        )}
        {summary.unnamed.length > 0 ? (
          <p className="badge-warn">
            ⚠ <bdi>{summary.unnamed.length}</bdi> חובות בלי שם. אי אפשר לסגור
            אותם עד שיירשם למי מגיע הכסף.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>התנועות</h2>
        {movements.length === 0 ? (
          <p className="muted">
            עדיין אין תנועות ל<bdi>{season.name}</bdi>. אפשר לייבא נתונים מ
            <Link href="/upload">דף הייבוא</Link>, או אם חיפשתם שנה אחרת — לבחור
            אותה למעלה.
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>תאריך</th><th>תיאור</th><th>חשבון</th><th>נכנס</th><th>יצא</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((move) => (
                  <tr key={`${move.source}-${move.id}`}>
                    <td><bdi>{move.occurredOn.toLocaleDateString('he-IL')}</bdi></td>
                    <td>{move.description}</td>
                    <td>{move.accountName ?? <span className="muted">לא צוין</span>}</td>
                    <td>{move.direction === 'in'
                      ? <bdi>{formatILS(move.amountAgorot)} ₪</bdi> : null}</td>
                    <td>{move.direction === 'out'
                      ? <bdi>{formatILS(move.amountAgorot)} ₪</bdi> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>התקציב</h2>
        {budget.length === 0 ? (
          <p className="muted">
            עדיין לא נרשם תקציב ל<bdi>{season.name}</bdi>. אפשר לייבא נתונים מ
            <Link href="/upload">דף הייבוא</Link>, או אם חיפשתם שנה אחרת — לבחור
            אותה למעלה.
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr><th>סעיף</th><th>כמות</th><th>ליחידה</th><th>סה״כ</th><th>למה</th></tr>
              </thead>
              <tbody>
                {budget.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.label}
                      {line.arithmeticOff ? (
                        <span className="badge-warn" title="כמות × מחיר ליחידה אינו שווה לסה״כ">
                          {' '}⚠
                        </span>
                      ) : null}
                    </td>
                    <td><bdi>{line.quantityText ?? ''}</bdi></td>
                    <td>{line.unitCostAgorot === null
                      ? '' : <bdi>{formatILS(line.unitCostAgorot)} ₪</bdi>}</td>
                    <td><bdi>{formatILS(line.totalAgorot)} ₪</bdi></td>
                    <td className="muted">{line.rationale ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
