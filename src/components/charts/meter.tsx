import { formatILS } from '@/lib/money';
import { barGeometry } from './geometry';
import styles from './charts.module.css';

const WIDTH = 200;
const HEIGHT = 10;

/** One ratio against a limit — settled against owed. */
export function Meter({ label, valueAgorot, totalAgorot }: {
  label: string;
  valueAgorot: number;
  totalAgorot: number;
}) {
  const bar = barGeometry({
    valueAgorot, maxAgorot: totalAgorot, width: WIDTH, direction: 'rtl',
  });
  return (
    <span className={styles.viz}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
           aria-label={`${label}: ${formatILS(valueAgorot)} מתוך ${formatILS(totalAgorot)} שקלים`}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={4} className={styles.track} />
        <rect x={bar.x} y={0} width={bar.width} height={HEIGHT} rx={4} className={styles.mark1} />
      </svg>
    </span>
  );
}
