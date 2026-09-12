import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { seasonMoneySummary } from '@/lib/money/summary';
import { listMovements } from '@/lib/money/ledger';
import { listBudgetLines, budgetDerivation } from '@/lib/money/budget';
import type { ObligationRow } from '@/lib/money/obligations';
import { formatILS } from '@/lib/money';
import { StatTile } from '@/components/charts/stat-tile';
import { BarList } from '@/components/charts/bar-list';
import { StackedBar } from '@/components/charts/stacked-bar';
import { Meter } from '@/components/charts/meter';
import styles from './money.module.css';

export const dynamic = 'force-dynamic';

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
  const summary = await seasonMoneySummary(db, season.id);
  const movements = await listMovements(db, { seasonId: season.id });
  const budget = await listBudgetLines(db, season.id);
  const { identity } = summary;

  // `listSeasons` is ordered by year descending, so the first season older
  // than this one is its predecessor. Without one there is nothing to derive
  // from, and the section is omitted rather than rendered empty.
  const previousSeason = seasons.find((option) => option.year < season.year);
  const derivation = previousSeason
    ? await budgetDerivation(db, previousSeason.id, season.id)
    : [];

  // `duesFundingIdentity` (src/lib/money/funding.ts) sets both of these to
  // `null` in exactly the same branch — no planned camp size — so bundling
  // them into one non-null object gates the thesis sentence, the mismatch
  // warning and the bar identically, and lets each branch read the values
  // back typed as plain numbers instead of `number | null`.
  const perPerson = identity.perPersonFullAgorot !== null && identity.perPersonFundingAgorot !== null
    ? { fullAgorot: identity.perPersonFullAgorot, fundingAgorot: identity.perPersonFundingAgorot }
    : null;
  const unattributedAgorot = summary.unattributed.paymentsAgorot
    + summary.unattributed.entriesAgorot;

  return (
    <main>
      <h1>כספים</h1>

      <nav className={styles.seasons} aria-label="בחירת שנה">
        {seasons.map((option) => (
          <Link key={option.id} href={`/money?season=${option.id}`}
                aria-current={option.id === season.id ? 'page' : undefined}>
            {option.name}
          </Link>
        ))}
      </nav>

      <section className={styles.lead}>
        <p className={styles.hero}><bdi>{formatILS(identity.flatRateAgorot)} ₪</bdi></p>
        {perPerson ? (
          <p className={styles.thesis}>
            כל חבר משלם. התקציב המלא הוא{' '}
            <bdi>{formatILS(identity.budgetTotalAgorot)} ₪</bdi> ל־
            <bdi>{identity.plannedSize}</bdi> איש —{' '}
            <bdi>{formatILS(perPerson.fullAgorot)} ₪</bdi> לאדם.
            הגיוס מכסה <bdi>{formatILS(perPerson.fundingAgorot)} ₪</bdi> מכל אחד מהם.
          </p>
        ) : (
          <p className="muted">
            אי אפשר לחשב עלות לאדם בלי גודל מחנה מתוכנן לשנה הזו.
          </p>
        )}
        {!identity.closes && perPerson ? (
          <p className="badge-warn">
            ⚠ דמי הקאמפ והגיוס לא מסתכמים לתקציב. משהו כאן לא מתאים — התקציב,
            היעד או גודל המחנה.
          </p>
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
      </section>

      <section className={styles.tiles}>
        <StatTile label="יתרה בכל החשבונות" valueAgorot={summary.totalBalanceAgorot}
                  derivation={`${summary.accounts.length} חשבונות`} />
        <StatTile label="נכנס בשנה הזו" valueAgorot={summary.ledger.inAgorot}
                  derivation={`${summary.ledger.count} תנועות`} />
        <StatTile label="יצא בשנה הזו" valueAgorot={summary.ledger.outAgorot} />
        <StatTile label="אנחנו חייבים" valueAgorot={summary.campOwesAgorot} />
      </section>

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
        {unattributedAgorot > 0 ? (
          <p className="badge-warn">
            ⚠ <bdi>{formatILS(unattributedAgorot)} ₪</bdi>{' '}
            נרשמו בלי לציין לאיזה חשבון נכנסו.
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
              <p className="muted">אין חובות שהקאמפ חייב.</p>
            ) : (
              <ObligationsTable rows={summary.campOwes} />
            )}

            <h3>מה חייבים לנו</h3>
            {summary.owedToCamp.length === 0 ? (
              <p className="muted">אין חובות שחייבים לקאמפ.</p>
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
                <tr><th>תאריך</th><th>תיאור</th><th>חשבון</th><th>נכנס</th><th>יצא</th></tr>
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

      {derivation.length > 0 ? (
        <section className="card">
          <h2>מאיפה התקציב הזה בא</h2>
          <p className="muted">
            כל סעיף מול מה שהוצא עליו ב<bdi>{previousSeason!.name}</bdi>.
          </p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>סעיף</th><th>בפועל</th><th>בתקציב</th><th>הפרש</th><th>למה</th>
                </tr>
              </thead>
              <tbody>
                {derivation.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.actualAgorot === null
                      ? <span className="muted">סעיף חדש</span>
                      : <bdi>{formatILS(row.actualAgorot)} ₪</bdi>}</td>
                    <td>{row.forecastAgorot === null
                      ? <span className="muted">ירד מהתקציב</span>
                      : <bdi>{formatILS(row.forecastAgorot)} ₪</bdi>}</td>
                    <td>{row.bufferAgorot === null ? '' : (
                      <bdi className={row.bufferAgorot < 0 ? 'badge-warn' : undefined}>
                        {row.bufferAgorot > 0 ? '+' : ''}{formatILS(row.bufferAgorot)} ₪
                      </bdi>
                    )}</td>
                    <td className="muted">{row.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
