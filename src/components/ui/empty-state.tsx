/**
 * C10 / E1: five distinct kinds, not five strings through one generic door.
 * The parent spec's rule is that an empty state is an invitation, not an
 * apology — the wrong kind on a screen sends a lead hunting for a filter they
 * never set, or wastes the one moment the app has to say "you're done". The
 * discriminated union on `kind` is what makes the five distinguishable in the
 * type system, not just in copy: a screen cannot pass `no-matches` and get
 * `nothing-yet`'s sentence by accident.
 *
 * The kit owns the title verbatim and builds the body from the kind's own
 * template. A screen supplies at most a plural noun and a season name, never
 * a sentence — so eleven list screens do not grow eleven dialects of
 * "nothing here", and the wording can be changed in one place.
 *
 * `IconName` has no `lock` glyph (the 65-icon set in `icon.tsx`, which this
 * plan does not edit, was hand-copied from the mock and the mock never draws
 * one). `not-permitted` uses `ban` — the circle-slash "no entry" glyph — as
 * the nearest existing member, per the brief's own escape hatch for a
 * rejected icon name.
 */
import type { ReactElement } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { ButtonLink } from './button';
import { cx } from './cx';
import styles from './empty-state.module.css';

export type EmptyStateAction = { label: string; href: string };

export type EmptyStateProps =
  | { kind: 'nothing-yet'; noun: string; action?: EmptyStateAction }
  | { kind: 'nothing-this-season'; noun: string; seasonName: string; action?: EmptyStateAction }
  | { kind: 'no-matches'; filterSummary?: string; action?: EmptyStateAction }
  /**
   * We looked, and there is none of this kind here. Reported twice by the
   * imports lane — a workbook that parsed and holds no tables, and a filter
   * under which nothing was refused — and it is neither of its neighbours:
   * `nothing-yet` says nobody has added one, which is wrong when something
   * was added and read; `no-matches` sends a reader off to remove a filter
   * they may never have set. Telling a lead to go looking for something that
   * is not there is exactly what this union exists to prevent.
   */
  | { kind: 'none-of-this-kind'; noun: string; action?: EmptyStateAction }
  | { kind: 'not-permitted' }
  | { kind: 'all-clear' };

export const EMPTY_TITLES: Readonly<Record<EmptyStateProps['kind'], string>> = {
  'nothing-yet': 'אין כאן כלום עדיין',
  'nothing-this-season': 'אין כאן כלום לשנה הזו',
  'no-matches': 'אין תוצאות לסינון הזה',
  'none-of-this-kind': 'אין כאן כלום מהסוג הזה',
  'not-permitted': 'אין לך גישה לתוכן הזה',
  'all-clear': 'הכול מטופל',
};

const KIND_ICON: Readonly<Record<EmptyStateProps['kind'], IconName>> = {
  'nothing-yet': 'inbox',
  'nothing-this-season': 'calendar',
  'no-matches': 'filter',
  /* `search`: the glyph for having looked, which is the whole difference
     between this kind and `nothing-yet`. */
  'none-of-this-kind': 'search',
  'not-permitted': 'ban',
  'all-clear': 'check',
};

/**
 * The kit writes the sentence. A screen supplies a plural noun and a season
 * name at most, so that eleven lists do not grow eleven dialects of "nothing
 * here" — and so that the wording can be changed in one place.
 */
export function emptyStateBody(props: EmptyStateProps): string {
  switch (props.kind) {
    case 'nothing-yet':
      return `כאן יופיעו ${props.noun}. עדיין לא נוספו.`;
    case 'nothing-this-season':
      return `אין ${props.noun} ב${props.seasonName}. בשנים אחרות ייתכן שיש.`;
    case 'no-matches':
      return props.filterSummary === undefined
        ? 'נסו להסיר סינון או לשנות את החיפוש.'
        : `נסו להסיר את הסינון ״${props.filterSummary}״.`;
    /* Says that something was read, which is the fact `nothing-yet` gets
       wrong here. The invitation, if there is one, is the screen's `action` —
       a screen still passes a plural noun and never a sentence (C10). */
    case 'none-of-this-kind':
      return `נבדק הכול — אין כאן ${props.noun}.`;
    case 'not-permitted':
      return 'החלק הזה פתוח למנהלי הקאמפ בלבד. אם זו טעות, פנו למי שנתן לכם את הגישה.';
    case 'all-clear':
      return 'לא נשאר כלום לטפל בו כאן.';
  }
}

export function EmptyState(props: EmptyStateProps): ReactElement {
  const action = 'action' in props ? props.action : undefined;
  return (
    <div className={cx(styles.empty, props.kind === 'all-clear' && styles.celebrate)}>
      <span className={styles.icon}><Icon name={KIND_ICON[props.kind]} size={20} /></span>
      <h3 className={styles.title}>{EMPTY_TITLES[props.kind]}</h3>
      <p className={styles.body}>{emptyStateBody(props)}</p>
      {action ? (
        <ButtonLink tone="primary" size="sm" href={action.href}>{action.label}</ButtonLink>
      ) : null}
    </div>
  );
}
