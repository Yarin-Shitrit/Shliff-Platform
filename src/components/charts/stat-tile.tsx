import { formatILS } from '@/lib/money';
import styles from './charts.module.css';

export function StatTile({ label, valueAgorot, derivation }: {
  label: string;
  valueAgorot: number;
  /** The arithmetic behind the figure, so no number is unexplained. */
  derivation?: string;
}) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>
        <bdi>{formatILS(valueAgorot)} ₪</bdi>
      </div>
      {derivation ? <div className={styles.tileDerivation}>{derivation}</div> : null}
    </div>
  );
}
