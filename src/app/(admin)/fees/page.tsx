import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { formatILS } from '@/lib/money';
import { MemberFeeRow, IssueMissingDuesButton } from './member-fee-row';
import styles from './fees.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'דמי קאמפ' };

export default async function FeesPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main>
        <h1>דמי קאמפ</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const { season: requested } = await searchParams;
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  const summary = await seasonFeeSummary(db, season.id);
  const rows = await listSeasonFees(db, season.id);
  const missingCount = rows.filter((row) => row.dueId === null).length;

  return (
    <main>
      <h1>דמי קאמפ</h1>

      <nav className={styles.seasons} aria-label="בחירת שנה">
        {seasons.map((option) => (
          <Link
            key={option.id}
            href={`/fees?season=${option.id}`}
            aria-current={option.id === season.id ? 'page' : undefined}
          >
            {option.name}
          </Link>
        ))}
      </nav>

      <section className="card">
        <h2>{season.name}</h2>
        <dl className={styles.summary}>
          <div><dt>חברים</dt><dd><bdi>{summary.memberCount}</bdi></dd></div>
          <div><dt>רגילים</dt><dd><bdi>{summary.flatCount}</bdi></dd></div>
          <div><dt>חריגים</dt><dd><bdi>{summary.exceptionCount}</bdi></dd></div>
          <div>
            <dt>צפי גבייה</dt>
            <dd><bdi>{formatILS(summary.expectedAgorot)} ₪</bdi></dd>
          </div>
          <div>
            <dt>נגבה</dt>
            <dd><bdi>{formatILS(summary.collectedAgorot)} ₪</bdi></dd>
          </div>
          <div>
            <dt>נותר</dt>
            <dd className={summary.outstandingAgorot > 0 ? 'badge-warn' : undefined}>
              <bdi>{formatILS(summary.outstandingAgorot)} ₪</bdi>
            </dd>
          </div>
        </dl>
      </section>

      <IssueMissingDuesButton seasonId={season.id} missingCount={missingCount} />

      {rows.length === 0 ? (
        /*
         * Name the season, matching the fix on the task board: the default is
         * the newest season, which early in a planning year legitimately has
         * no members on it yet — but an unnamed "nothing here" reads as a
         * broken page, and the reader has no reason to suspect the picker
         * above holds the answer.
         */
        <p className="muted">
          אין עדיין חברים רשומים ל<bdi>{season.name}</bdi>. אם חיפשתם שנה אחרת,
          בחרו אותה למעלה.
        </p>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>שם</th><th>לתשלום</th><th>שולם</th><th>יתרה</th><th>סוג</th><th>שינוי</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <MemberFeeRow key={row.personId} row={row} seasonId={season.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
