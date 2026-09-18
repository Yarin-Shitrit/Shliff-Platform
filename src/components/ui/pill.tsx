import type { ReactElement } from 'react';
import { isBlank } from '@/lib/text/normalize';
import { cx } from './cx';
import styles from './pill.module.css';

export type PillTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'outline';

export type PillProps = {
  tone?: PillTone;
  /** The status dot. Decorative — the word is what carries the meaning. */
  dot?: boolean;
  /** The word. Always present; blank throws in development (R3). */
  children: string;
};

export function Pill({ tone = 'neutral', dot, children }: PillProps): ReactElement {
  /**
   * R3: the accent never carries meaning a colour-blind reader needs, so a
   * state is a word first. A dot on its own is not a state.
   */
  if (process.env.NODE_ENV !== 'production' && isBlank(children)) {
    throw new Error('Pill: כל תגית מצב חייבת לשאת מילה, לא רק צבע');
  }

  return (
    <span className={cx(styles.pill, styles[tone])}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
