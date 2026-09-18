import type { ReactElement } from 'react';
import Link from 'next/link';
import { normalizeHebrew } from '@/lib/text/normalize';
import { cx } from './cx';
import styles from './avatar.module.css';

export type AvatarSize = 'sm' | 'md' | 'lg';

export type AvatarProps =
  | { name: string; size?: AvatarSize; decorative?: boolean; empty?: never; label?: never }
  | { empty: true; size?: AvatarSize; label: string; name?: never; decorative?: never };

export type StackPerson = { id: string; name: string };

export type AvatarStackProps = {
  people: readonly StackPerson[];
  /** Avatars shown before the `+N` cap. Default 4. */
  max?: number;
  size?: AvatarSize;
  /** D9's clickable gaps: `5/8` renders three dashed slots. */
  emptySlots?: number;
  /** Where an empty slot leads — the assign popover's URL for slot `index`. */
  emptySlotHref?: (index: number) => string;
  /** The accessible name of the whole group: `משובצים למשמרת שער`. */
  label: string;
};

/** Hebrew has no case, so there is nothing to upper-case. */
export function initials(name: string): string {
  const words = normalizeHebrew(name).split(' ').filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return [...words[0]][0] ?? '';
  return `${[...words[0]][0] ?? ''}${[...words[1]][0] ?? ''}`;
}

/**
 * Pure and deterministic: the same person is the same colour on the server and
 * in the browser, so hydration matches, and no column has to store a colour.
 * Derived from the name, never from list position, so the tint stays a
 * recognition aid rather than noise when a list reorders.
 */
export function tintIndex(name: string): number {
  const normalized = normalizeHebrew(name);
  let sum = 0;
  for (const character of normalized) sum += character.codePointAt(0) ?? 0;
  return sum % 6;
}

export function Avatar(props: AvatarProps): ReactElement {
  const size = props.size ?? 'md';

  if (props.empty) {
    return (
      <span
        className={cx(styles.avatar, styles[size], styles.empty)}
        role="img"
        aria-label={props.label}
      />
    );
  }

  const decorative = props.decorative ?? true;
  return (
    <span
      className={cx(styles.avatar, styles[size], styles[`tint${tintIndex(props.name)}`])}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : props.name}
    >
      {initials(props.name)}
    </span>
  );
}

export function AvatarStack({
  people, max = 4, size = 'sm', emptySlots = 0, emptySlotHref, label,
}: AvatarStackProps): ReactElement {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <span className={styles.stack} role="group" aria-label={label}>
      {shown.map((person) => (
        <Avatar key={person.id} name={person.name} size={size} decorative={false} />
      ))}
      {overflow > 0 ? (
        <span
          className={cx(styles.avatar, styles[size], styles.overflow)}
          role="img"
          aria-label={`ועוד ${overflow}`}
        >
          {`+${overflow}`}
        </span>
      ) : null}
      {Array.from({ length: emptySlots }, (_, index) =>
        emptySlotHref ? (
          <Link
            key={`slot-${index}`}
            href={emptySlotHref(index)}
            className={styles.slotLink}
            aria-label="שיבוץ לתפקיד פנוי"
          >
            <Avatar empty size={size} label="" />
          </Link>
        ) : (
          <Avatar key={`slot-${index}`} empty size={size} label="תפקיד פנוי" />
        ),
      )}
    </span>
  );
}
