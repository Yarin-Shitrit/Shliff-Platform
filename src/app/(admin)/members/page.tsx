import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listPeople } from '@/lib/members/dossier';
import { listUnlinkedNames, resolveName } from '@/lib/members/identity';
import { listSeasons } from '@/lib/members/roster';
import { formatILS } from '@/lib/money';
import { AddMember } from './add-member';
import { UnlinkedQueue, type QueuedName } from './unlinked-queue';
import styles from './members.module.css';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const people = await listPeople(db);
  const unlinked = await listUnlinkedNames(db);
  const seasons = await listSeasons(db);

  const queue: QueuedName[] = [];
  for (const name of unlinked) {
    const resolution = await resolveName(db, name.alias);
    queue.push({
      aliasId: name.aliasId,
      alias: name.alias,
      candidates: resolution.candidates.map((candidate) => ({
        personId: candidate.personId,
        displayName: candidate.displayName,
        exact: candidate.exact,
      })),
    });
  }

  return (
    <main>
      <h1>חברי מחנה</h1>

      <section className="card">
        <h2>שמות שממתינים לשיוך</h2>
        <p className="muted">
          שמות שהמערכת מצאה בקבצים ולא ידעה לשייך בוודאות. היא לא מנחשת — מיזוג
          של שני אנשים אינו הפיך, ולכן ההחלטה כאן שלכם.
        </p>
        <UnlinkedQueue names={queue} />
      </section>

      <section>
        <div className={styles.sectionHead}>
          <h2>אנשים</h2>
          {/*
            One plain anchor per season, deliberately: this is a file download
            from a Route Handler, not a page to navigate to client-side —
            `Link` would prefetch the CSV response on hover/viewport for
            nothing. The season used to be implicit (whichever the route
            defaulted to), so a lead exporting for one season silently got a
            different one's roster with nothing saying so — naming every
            season here and carrying it through the query string is the fix.
          */}
          {seasons.length > 0 && (
            <span className={styles.exportLinks}>
              ייצוא לקובץ CSV:{' '}
              {seasons.map((season, index) => (
                <span key={season.id}>
                  {index > 0 && ' · '}
                  <a href={`/members/export?season=${season.id}`}>{season.name}</a>
                </span>
              ))}
            </span>
          )}
        </div>
        <AddMember seasons={seasons.map((season) => ({ id: season.id, name: season.name }))} />
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>כינויים</th>
                <th>שנים</th>
                <th>יתרה לתשלום</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.personId}>
                  <td>
                    <Link href={`/members/${person.personId}`}>{person.displayName}</Link>
                  </td>
                  <td><bdi>{person.aliasCount}</bdi></td>
                  <td><bdi>{person.seasonCount}</bdi></td>
                  <td className={person.outstandingAgorot > 0 ? 'badge-warn' : undefined}>
                    <bdi>{formatILS(person.outstandingAgorot)} ₪</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {people.length === 0 && (
          <p className="muted">עדיין אין אנשים. הריצו את הזריעה מדף הייבוא.</p>
        )}
      </section>
    </main>
  );
}
