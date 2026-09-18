import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Money } from '@/components/format';
import { cx } from './cx';
import styles from './stat-tile.module.css';

export type StatTileBarSegment = {
  id: string;
  /** 0–100, clamped. The unfilled remainder is the track (A4). */
  percent: number;
  kind: 'dues' | 'fund' | 'reserve' | 'partial';
};

export type StatTileBar = {
  segments: readonly StatTileBarSegment[];
  /** The bar's accessible name — it is `role="img"`, as `Meter` already is. */
  label: string;
};

type StatTileValue =
  | { valueAgorot: number; value?: never }
  | { value: ReactNode; valueAgorot?: never };

export type StatTileProps = StatTileValue & {
  label: string;
  /** Wave 1's rule: no number is unexplained. */
  derivation?: ReactNode;
  bar?: StatTileBar;
  /** D1: every figure links to the page that can change it. */
  href?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
};

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

export function StatTile(props: StatTileProps): ReactElement {
  const { label, derivation, bar, href, tone = 'default' } = props;

  const body = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={cx(styles.value, tone !== 'default' && styles[tone])}>
        {props.valueAgorot === undefined ? props.value : <Money agorot={props.valueAgorot} />}
      </span>
      {bar ? (
        <span className={styles.bar} role="img" aria-label={bar.label}>
          {bar.segments.map((segment) => (
            <i
              key={segment.id}
              className={styles[segment.kind]}
              style={{ inlineSize: `${clampPercent(segment.percent)}%` }}
            />
          ))}
        </span>
      ) : null}
      {derivation ? <span className={styles.derivation}>{derivation}</span> : null}
    </>
  );

  if (href === undefined) {
    return <div className={styles.tile}>{body}</div>;
  }

  return (
    <Link className={cx(styles.tile, styles.linked)} href={href}>
      {body}
    </Link>
  );
}
