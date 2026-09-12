import { formatILS } from '@/lib/money';
import { stackGeometry } from './geometry';
import styles from './charts.module.css';

const WIDTH = 640;
const HEIGHT = 22;
const GAP = 2;

export interface Segment {
  id: string;
  label: string;
  valueAgorot: number;
  /** Palette slot, 1-3. Assigned in fixed order, never cycled. */
  series: 1 | 2 | 3;
}

const MARK = { 1: styles.mark1, 2: styles.mark2, 3: styles.mark3 } as const;

/**
 * Part-to-whole plus progress against a limit. The unfilled remainder is the
 * track showing through, never a third series — a shortfall means "not yet",
 * which is a state, and states do not take identity colours.
 */
export function StackedBar({ segments, totalAgorot, remainderLabel }: {
  segments: Segment[];
  totalAgorot: number;
  remainderLabel?: string;
}) {
  const boxes = stackGeometry({
    segmentsAgorot: segments.map((s) => s.valueAgorot),
    totalAgorot, width: WIDTH, direction: 'rtl', gap: GAP,
  });
  const filled = segments.reduce((n, s) => n + s.valueAgorot, 0);
  const remainder = Math.max(0, totalAgorot - filled);

  return (
    <div className={styles.viz}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" aria-hidden="true">
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={4} className={styles.track} />
        {segments.map((segment, index) => (
          <rect key={segment.id} x={boxes[index].x} y={0} width={boxes[index].width}
                height={HEIGHT} rx={4} className={MARK[segment.series]} />
        ))}
      </svg>

      <div className={styles.legend}>
        {segments.map((segment) => (
          <span key={segment.id}>
            <span className={styles.swatch}
                  style={{ background: `var(--series-${segment.series})` }} />
            {/* The label is its own element so a test can match it exactly;
                a span reading "דמי קאמפ 42,000 ₪" matches neither half. */}
            <span className={styles.legendLabel}>{segment.label}</span>{' '}
            <bdi>{formatILS(segment.valueAgorot)} ₪</bdi>
          </span>
        ))}
        {remainderLabel && remainder > 0 ? (
          <span>
            <span className={styles.swatch} style={{ background: 'var(--track)' }} />
            <span className={styles.legendLabel}>{remainderLabel}</span>{' '}
            <bdi>{formatILS(remainder)} ₪</bdi>
          </span>
        ) : null}
      </div>

      <table className={styles.tableView}>
        <caption>הנתונים שמאחורי התרשים</caption>
        <thead><tr><th>שם</th><th>סכום</th></tr></thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={segment.id}>
              <td>{segment.label}</td>
              <td><bdi>{formatILS(segment.valueAgorot)} ₪</bdi></td>
            </tr>
          ))}
          {remainderLabel && remainder > 0 ? (
            <tr>
              <td>{remainderLabel}</td>
              <td><bdi>{formatILS(remainder)} ₪</bdi></td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
