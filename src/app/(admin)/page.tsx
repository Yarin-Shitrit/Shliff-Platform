import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { uncoveredTasks } from '@/lib/work/coverage';
import { listUnlinkedNames } from '@/lib/members/identity';
import { formatILS } from '@/lib/money';
import styles from './overview.module.css';

export const dynamic = 'force-dynamic';

/**
 * The first screen, and the only one that answers "where does the camp stand"
 * without being asked a season first.
 *
 * It leads with the newest season because that is the one being planned. Every
 * figure links to the page that can change it — a number a lead cannot act on
 * belongs in a report, not on a landing page.
 */
export default async function OverviewPage() {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  const current = seasons[0];
  const summary = current ? await seasonFeeSummary(db, current.id) : null;
  const uncovered = current ? await uncoveredTasks(db, current.id) : [];
  const unlinked = await listUnlinkedNames(db);

  if (!summary || !current) {
    return (
      <main>
        <h1>סקירה</h1>
        <p className="muted">
          עדיין אין שנים במערכת. אפשר לזרוע את נתוני העבר מדף{' '}
          <Link href="/upload">הייבוא</Link>.
        </p>
      </main>
    );
  }

  const collectedShare = summary.expectedAgorot > 0
    ? Math.round((summary.collectedAgorot / summary.expectedAgorot) * 100)
    : 0;

  return (
    <main>
      <h1>סקירה</h1>

      <section className="card">
        <h2>{current.name}</h2>
        <dl className={styles.figures}>
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

        {/*
          * The bar reads the same figures as the list above it. It earns its
          * place because "how far through the year's collection are we" is a
          * proportion, and a proportion is faster to read as a length than as
          * two numbers a reader has to divide.
          */}
        <div
          className={styles.bar}
          role="img"
          aria-label={`נגבו ${collectedShare} אחוזים מצפי הגבייה`}
        >
          <span className={styles.barFill} style={{ inlineSize: `${collectedShare}%` }} />
        </div>

        <p className="muted">
          <bdi>{summary.memberCount}</bdi> חברים —{' '}
          <bdi>{summary.flatCount}</bdi> בתעריף רגיל,{' '}
          <bdi>{summary.exceptionCount}</bdi> חריגים
          {summary.unpaidCount > 0 && (
            <>
              {' · '}
              <span className="badge-warn">
                <bdi>{summary.unpaidCount}</bdi> טרם שילמו
              </span>
            </>
          )}
        </p>
        <p><Link href={`/fees?season=${current.id}`}>לדף דמי הקאמפ</Link></p>
      </section>

      {/*
        * These two only appear when there is something to do about them. A
        * dashboard that always shows "0 outstanding items" trains the reader
        * to stop looking at that row.
        */}
      {uncovered.length > 0 && (
        <section className="card">
          <h2>משימות שחסרים בהן אנשים</h2>
          <p className="badge-warn">
            <bdi>{uncovered.length}</bdi>{' '}
            {uncovered.length === 1 ? 'משימה' : 'משימות'} — לפני פתיחת השער
          </p>
          <ul>
            {uncovered.slice(0, 5).map((task) => (
              <li key={task.taskId}>
                {task.title}
                <span className="muted">
                  {' — '}<bdi>{task.accepted} מתוך {task.peopleNeeded}</bdi>
                </span>
              </li>
            ))}
          </ul>
          <p><Link href={`/tasks?season=${current.id}`}>לדף המשימות</Link></p>
        </section>
      )}

      {unlinked.length > 0 && (
        <section className="card">
          <h2>שמות שממתינים לשיוך</h2>
          <p className="muted">
            <bdi>{unlinked.length}</bdi> שמות שהמערכת מצאה בקבצים ולא שייכה —
            היא לא מנחשת מי הם.
          </p>
          <p><Link href="/members">לדף חברי המחנה</Link></p>
        </section>
      )}

      <section>
        <h2>מה יש כאן</h2>
        <ul>
          <li><Link href="/members">חברי מחנה</Link> — מי היה בקאמפ, בכל שנה</li>
          <li><Link href="/fees">דמי קאמפ</Link> — מי חייב, מי שילם, ולמה חריג הוא חריג</li>
          <li><Link href="/tasks">משימות</Link> — מי אחראי על מה, ומה עדיין לא מאויש</li>
          <li><Link href="/data">נתונים</Link> — כל מה שזוהה בקבצי האקסל, לפי שנה</li>
          <li><Link href="/upload">ייבוא</Link> — העלאת קובץ חדש וזיהוי הטבלאות שבו</li>
        </ul>
      </section>
    </main>
  );
}
