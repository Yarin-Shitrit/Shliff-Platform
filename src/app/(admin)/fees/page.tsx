import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listDues } from '@/lib/fees/dues';
import { settlementFor } from '@/lib/fees/payments';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { formatILS } from '@/lib/money';
import { ExceptionForm } from './exception-form';
import styles from './fees.module.css';

export const dynamic = 'force-dynamic';

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
  const rows = await listDues(db, season.id);

  const settled = new Map<string, Awaited<ReturnType<typeof settlementFor>>>();
  for (const row of rows) settled.set(row.dueId, await settlementFor(db, row.dueId));

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
        {summary.missingDues.length > 0 && (
          <p className="badge-warn">
            חברים ללא חיוב: {summary.missingDues.join(', ')}
          </p>
        )}
      </section>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>שם</th><th>לתשלום</th><th>שולם</th><th>יתרה</th><th>סוג</th><th>שינוי</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const settlement = settled.get(row.dueId)!;
              return (
                <tr key={row.dueId}>
                  <td>
                    <Link href={`/members/${row.personId}`}>{row.displayName}</Link>
                  </td>
                  <td><bdi>{formatILS(row.amountAgorot)} ₪</bdi></td>
                  <td><bdi>{formatILS(settlement.paidAgorot)} ₪</bdi></td>
                  <td className={settlement.settled ? undefined : 'badge-warn'}>
                    <bdi>{formatILS(settlement.outstandingAgorot)} ₪</bdi>
                  </td>
                  <td>
                    {row.kind === 'exception'
                      ? <span title={row.exceptionReason ?? ''}>חריג</span>
                      : <span className="muted">רגיל</span>}
                  </td>
                  <td>
                    <ExceptionForm
                      personId={row.personId}
                      seasonId={season.id}
                      displayName={row.displayName}
                      currentAgorot={row.amountAgorot}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
