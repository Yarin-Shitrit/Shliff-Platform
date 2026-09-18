/*
 * R8 and D4. Merge stops being a `<select>` over everyone in the system and
 * becomes a comparison of two named people, driven by A3's
 * `?peek=<absorbed>&act=merge&with=<survivor>`.
 *
 * Everything here is server-rendered. Only the acknowledgement and the submit
 * are a client component, and they live in `merge-confirm.tsx`.
 *
 * Which side is which is stated in words — `נמזג` and `נשאר` — and never by
 * position. In an RTL layout "the one on the left" is not a stable
 * instruction, and this is the one screen where being wrong about that is
 * unrecoverable.
 */

import type { ReactElement } from 'react';
import Link from 'next/link';
import { Drawer } from '@/components/ui/drawer';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/format';
import type { MergePreview, MergeSide } from '@/lib/members/link';
import { MergeConfirm } from './merge-confirm';
import styles from './people.module.css';

/**
 * The Hebrew agrees with the number, the same rule the kit's `selectionLabel`
 * follows: `יעברו 1 כינויים` is not a sentence anybody writes, and a merge is
 * the one screen where a lead is being asked to read carefully.
 */
function movingSentence(count: number): string {
  if (count === 0) return 'לא יעבור אף כינוי';
  if (count === 1) return 'יעבור כינוי אחד';
  return `יעברו ${count} כינויים`;
}

export interface MergePanelProps {
  preview: MergePreview;
  /** Back to the screen the merge was started from. */
  cancelHref: string;
  /** The same two people the other way round. */
  swapHref: string;
}

function SideCard(
  { side, label, fate }: { side: MergeSide; label: string; fate: 'absorbed' | 'survivor' },
): ReactElement {
  return (
    <div className={styles.mergeSide} data-fate={fate}>
      <div className={styles.mergeSideHead}>
        <Avatar name={side.displayName} size="sm" />
        <span className={styles.mergeSideName}>{side.displayName}</span>
      </div>
      <Pill tone={fate === 'survivor' ? 'ok' : 'neutral'}>{label}</Pill>
      <ul className={styles.mergeFacts}>
        <li>{`כינויים: ${side.aliases.join(' · ')}`}</li>
        <li>{side.seasons.length === 0 ? 'לא שויך/ה לאף שנה' : `שנים: ${side.seasons.join(' · ')}`}</li>
        <li><bdi>{`חיובים ${side.duesCount} · תשלומים ${side.paymentsCount} · שיבוצים ${side.assignmentsCount}`}</bdi></li>
        <li>
          {side.outstandingAgorot === 0
            ? 'אין חוב לקאמפ'
            : <>יתרה: <Money agorot={side.outstandingAgorot} /></>}
        </li>
      </ul>
    </div>
  );
}

export function MergePanel({ preview, cancelHref, swapHref }: MergePanelProps): ReactElement {
  const blocked = preview.conflicts.length > 0;

  return (
    <Drawer title="מיזוג שתי רשומות" width={500} closeHref={cancelHref}>
      {/*
        The refusals lead, and they are not styled as an error. This is D4's
        change: today the same information arrives only after a lead presses
        מזג, as a role="alert" — so the screen invites an action it already
        knows it will refuse. Here the reason comes first and the confirm
        control is not rendered at all, because there is nothing to confirm.
      */}
      {blocked ? (
        <section className={styles.mergeBlock}>
          <h3>למה אי אפשר למזג עדיין</h3>
          <ul className={styles.mergeBlockers}>
            {preview.blockers.map((blocker) => (
              <li key={blocker.conflict} className={styles.mergeBlockerRow}>
                {/* One `<bdi>` for the whole phrase, per A17. */}
                {blocker.href === null ? (
                  <span><bdi>{`${blocker.conflict} · ${blocker.count}`}</bdi></span>
                ) : (
                  <Link href={blocker.href}>
                    <bdi>{`${blocker.conflict} · ${blocker.count}`}</bdi>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.mergeSides}>
        <SideCard side={preview.source} label="נמזג" fate="absorbed" />
        <SideCard side={preview.target} label="נשאר" fate="survivor" />
      </div>

      <p>
        <Link href={swapHref}>
          <Icon name="updown" size={14} /> החלפת הכיוון
        </Link>
      </p>

      <section className={styles.mergeBlock}>
        <h3>מה יעבור</h3>
        <p><bdi>{movingSentence(preview.movingAliases.length)}</bdi></p>
        <p>{preview.movingAliases.join(' · ')}</p>
        {/*
          The honest form of the library's rule: a permitted merge moves
          aliases and nothing else, which is exactly why the other five
          refusals exist. Listing what stays put — with its counts — is what
          stops a lead assuming a merge tidies up money.
        */}
        <ul className={styles.mergeStaying}>
          <li><bdi>{`לא יעברו — חברות במחנה: ${preview.source.seasons.length}`}</bdi></li>
          <li><bdi>{`לא יעברו — דמי קאמפ: ${preview.source.duesCount}`}</bdi></li>
          <li><bdi>{`לא יעברו — תשלומים: ${preview.source.paymentsCount}`}</bdi></li>
          <li><bdi>{`לא יעברו — שיבוצים למשימות: ${preview.source.assignmentsCount}`}</bdi></li>
        </ul>
      </section>

      {blocked ? null : (
        <MergeConfirm
          sourceId={preview.source.personId}
          targetId={preview.target.personId}
          sourceName={preview.source.displayName}
          successHref={`/members/${preview.target.personId}`}
        />
      )}
    </Drawer>
  );
}
