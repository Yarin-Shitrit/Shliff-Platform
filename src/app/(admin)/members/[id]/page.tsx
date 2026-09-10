import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { personDossier } from '@/lib/members/dossier';
import type { Responsibility } from '@/lib/work/coverage';
import { formatILS } from '@/lib/money';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  deliverable: 'אחריות תקציבית',
  shift: 'משמרת',
  build: 'הקמה ולוגיסטיקה',
  event_task: 'משימה באירוע',
};

/** he-IL, date and time together — a shift's "when" is never just a day. */
function formatDateTime(date: Date): string {
  return date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * A `shift` responsibility that cannot say when it runs does not answer
 * "what am I responsible for" — so timing is rendered whenever any of it is
 * present, not only for shifts. A start and an end become a range; a lone
 * start or end stands alone; a `dueOn` is a deadline, not a window, and is
 * shown independently of the other two.
 */
function timingParts(item: Responsibility): Array<{ label: string; value: string }> {
  const parts: Array<{ label: string; value: string }> = [];
  if (item.startsAt && item.endsAt) {
    parts.push({ label: 'מ־', value: formatDateTime(item.startsAt) });
    parts.push({ label: 'עד', value: formatDateTime(item.endsAt) });
  } else if (item.startsAt) {
    parts.push({ label: 'החל מ־', value: formatDateTime(item.startsAt) });
  } else if (item.endsAt) {
    parts.push({ label: 'עד', value: formatDateTime(item.endsAt) });
  }
  if (item.dueOn) {
    parts.push({ label: 'מועד יעד', value: formatDateTime(item.dueOn) });
  }
  return parts;
}

export default async function PersonPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const { id } = await params;
  const dossier = await personDossier(db, id);
  if (!dossier) notFound();

  return (
    <main>
      <h1>{dossier.displayName}</h1>

      <section className="card">
        <h2>כינויים</h2>
        <p className="muted">כל האיותים שהופיעו בקבצים, מקושרים לאדם אחד.</p>
        <ul>
          {dossier.aliases.map((alias) => (
            <li key={alias.aliasId}>
              {alias.alias}
              {alias.confirmedBy && (
                <span className="muted"> — אושר ע״י <bdi>{alias.confirmedBy}</bdi></span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>דמי קאמפ</h2>
        {dossier.dues.length === 0 && <p className="muted">אין חיוב רשום.</p>}
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>שנה</th><th>לתשלום</th><th>שולם</th><th>יתרה</th><th>הערה</th>
              </tr>
            </thead>
            <tbody>
              {dossier.dues.map((due) => (
                <tr key={due.dueId}>
                  <td>{due.seasonName}</td>
                  <td><bdi>{formatILS(due.amountAgorot)} ₪</bdi></td>
                  <td><bdi>{formatILS(due.paidAgorot)} ₪</bdi></td>
                  <td className={due.settled ? undefined : 'badge-warn'}>
                    <bdi>{formatILS(due.outstandingAgorot)} ₪</bdi>
                  </td>
                  <td>
                    {due.kind === 'exception' ? (
                      <>
                        {due.exceptionReason}
                        {due.decidedBy && (
                          <span className="muted"> — <bdi>{due.decidedBy}</bdi></span>
                        )}
                      </>
                    ) : (
                      <span className="muted">תעריף רגיל</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>אחריות</h2>
        {dossier.responsibilities.length === 0 && <p className="muted">אין משימות משויכות.</p>}
        <ul>
          {dossier.responsibilities.map((item) => (
            <li key={item.taskId}>
              {item.title}
              <span className="muted">
                {' — '}{KIND_LABELS[item.kind] ?? item.kind}, {item.seasonName}
                {item.eventName && <>, {item.eventName}</>}
                {item.budgetAgorot !== null && (
                  <> — תקציב <bdi>{formatILS(item.budgetAgorot)} ₪</bdi></>
                )}
                {timingParts(item).map((part) => (
                  <span key={part.label}>
                    {' — '}{part.label} <bdi>{part.value}</bdi>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
