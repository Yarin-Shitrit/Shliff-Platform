/*
 * R6: a peek is a URL. `?peek=<personId>` renders this over the list, so it
 * survives a refresh, it can be pasted into a chat, and it holds no client
 * state at all — the `Drawer` around it owns `esc` and the focus trap, and
 * this file owns nothing but what to show.
 *
 * It writes nothing. No form, no server action, no confirmation; every control
 * in its footer is a link. That is a rule rather than a convenience: the moment
 * a peek can write, it becomes a second, smaller record page, and the two drift
 * until a lead has to know which one to trust. Everything that changes a person
 * lives on /members/<id>.
 *
 * For the same reason it carries no provenance chips and no merge. Both need
 * room, and both need the reader to be able to act on what they see.
 */

import type { ReactElement, ReactNode } from 'react';
import { db } from '@/db';
import { Drawer } from '@/components/ui/drawer';
import { ButtonLink } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Money, DateText } from '@/components/format';
import { formatShekels } from '@/lib/money';
import { roleLabel } from '@/lib/members/labels';
import type { PersonListRow } from '@/lib/members/people-list';
import { responsibilitiesOf } from '@/lib/work/coverage';
import { personChangeLog, type ChangeEntry } from '@/lib/members/change-log';
import { DUES_STATE_LABELS } from './people-table';
import styles from './people.module.css';

export interface PeekDrawerProps {
  row: PersonListRow;
  seasonId: string | null;
  seasonName: string | null;
  /** The list's own URL, so close and the footer links can be built from it. */
  closeHref: string;
}

/**
 * E5's glossary lives on the screen, which is why `personChangeLog` returns
 * structure and not sentences. Every form here is a noun phrase: Hebrew verbs
 * inflect for gender, the schema records none, and the roster is mixed.
 */
function changeSentence(entry: ChangeEntry): string {
  switch (entry.kind) {
    case 'joined_season': return `הצטרפות ל${entry.subject}`;
    case 'alias_linked': return `קישור הכינוי ${entry.subject}`;
    case 'alias_merged': return `הכינוי ${entry.subject} הגיע ממיזוג`;
    case 'exception_decided':
      return `חריג — ${entry.subject}`;
    case 'payment_recorded':
      return `נרשם תשלום ${formatShekels(entry.amountAgorot ?? 0)} ב${entry.subject}`;
    case 'assigned': return `שיבוץ ל${entry.subject}`;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className={styles.peekRow}>
      <span className={styles.peekLabel}>{label}</span>
      <span className={styles.peekValue}>{children}</span>
    </div>
  );
}

export async function PeekDrawer({
  row, seasonId, seasonName, closeHref,
}: PeekDrawerProps): Promise<ReactElement> {
  /*
   * The two reads the list row cannot carry: they are one person deep, and
   * doing them per row would put them back into the N+1 that Task 2 removed.
   * That is precisely why they live in the drawer and not in the list.
   */
  const responsibilities = await responsibilitiesOf(db, row.personId);
  const log = await personChangeLog(db, row.personId);

  const titles = responsibilities
    .filter((task) => seasonName === null || task.seasonName === seasonName)
    .slice(0, 2)
    .map((task) => task.title);

  const state = row.dues?.state ?? 'none';

  return (
    <Drawer
      title={row.displayName}
      lead={<Avatar name={row.displayName} size="md" />}
      subtitle={row.role === null ? undefined : roleLabel(row.role)}
      expandHref={`/members/${row.personId}`}
      closeHref={closeHref}
    >
      {row.aliases.length > 0 ? (
        <p className={styles.al}>{`גם: ${row.aliases.join(' · ')}`}</p>
      ) : null}

      <Row label="שנים">
        {row.seasons.length === 0
          ? <span className="muted">לא שויך/ה לאף שנה</span>
          : <bdi>{row.seasons.map((season) => season.name).join(' · ')}</bdi>}
      </Row>

      <Row label={seasonName === null ? 'דמי קאמפ' : `דמי קאמפ · ${seasonName}`}>
        {/*
          Someone on no season gets a sentence, not a pill. `אין חיוב` would
          say the camp decided not to bill them; it decided nothing — they are
          not on the list this season.
        */}
        {!row.onScopeSeason && seasonName !== null ? (
          <span className="muted">{`לא ברשימת ${seasonName}`}</span>
        ) : (
          <>
            <Pill tone={state === 'unpaid' ? 'bad' : state === 'partial' ? 'warn' : 'neutral'} dot>
              {DUES_STATE_LABELS[state]}
            </Pill>
            {row.dues === null ? null : (
              // One `<bdi>` for the whole phrase, per A17.
              <span className={styles.peekNote}>
                <bdi>{`שולם ${formatShekels(row.dues.paidAgorot)} מתוך ${formatShekels(row.dues.amountAgorot)}`}</bdi>
              </span>
            )}
          </>
        )}
      </Row>

      <Row label="יתרה לתשלום">
        {row.outstandingAgorot === 0
          ? <span className="muted">אין חוב לקאמפ</span>
          : <Money agorot={row.outstandingAgorot} />}
      </Row>

      <Row label="משימות">
        {row.taskCount === 0
          ? <span className="muted">אין משימות</span>
          : (
            <>
              <bdi>{row.taskCount}</bdi>
              {titles.length === 0 ? null : (
                <span className={styles.peekNote}>{titles.join(' · ')}</span>
              )}
            </>
          )}
      </Row>

      <Row label="שינויים אחרונים">
        {log.length === 0 ? (
          <span className="muted">עדיין לא נרשם דבר</span>
        ) : (
          <ul className={styles.peekLog}>
            {log.slice(0, 3).map((entry, index) => (
              <li key={`${entry.kind}-${index}`}>
                <span>{changeSentence(entry)}</span>
                {/* An undated entry gets no date rather than a guessed one:
                    `dues` records who decided an exception, never when. */}
                {entry.at === null
                  ? <span className="muted"> · ללא תאריך</span>
                  : <span className="muted"> · <DateText at={entry.at} /></span>}
              </li>
            ))}
          </ul>
        )}
      </Row>

      <footer className={styles.peekFooter}>
        <ButtonLink tone="primary" size="sm" href={`/members/${row.personId}`}>
          פתיחת הרשומה המלאה
        </ButtonLink>
        {/* These two hand off to screens other plans own. If their `person`
            param is not read yet the link still lands on the right screen. */}
        <ButtonLink size="sm" href={`/fees?season=${seasonId ?? ''}&person=${row.personId}`}>
          רישום תשלום
        </ButtonLink>
        <ButtonLink size="sm" href={`/tasks?season=${seasonId ?? ''}&person=${row.personId}`}>
          שיבוץ למשימה
        </ButtonLink>
      </footer>
    </Drawer>
  );
}
