import { formatILS } from '@/lib/money';
import { barGeometry } from './geometry';
import styles from './charts.module.css';

const WIDTH = 320;
const HEIGHT = 14;

export interface BarItem {
  id: string;
  label: string;
  valueAgorot: number;
  tone?: 'warning' | 'critical';
  note?: string;
}

/**
 * Nominal categories: every bar wears the same series-1 hue. Colouring a
 * nominal bar by its value spends the identity channel re-encoding what the
 * bar's length already shows.
 */
export function BarList({ items, emptyMessage }: {
  items: BarItem[];
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="muted">{emptyMessage ?? 'אין מה להציג כאן עדיין'}</p>;
  }

  const max = Math.max(...items.map((item) => item.valueAgorot), 0);

  return (
    <div className={styles.viz}>
      {items.map((item) => {
        const bar = barGeometry({
          valueAgorot: item.valueAgorot, maxAgorot: max, width: WIDTH, direction: 'rtl',
        });
        return (
          <div key={item.id} className={styles.row}>
            <span className={styles.label}>
              {item.label}
              {item.tone ? (
                <span role="img" aria-label={item.tone === 'warning' ? 'אזהרה' : 'שגיאה'}>
                  {' '}⚠
                </span>
              ) : null}
            </span>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" aria-hidden="true">
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={4} className={styles.track} />
              <rect x={bar.x} y={0} width={bar.width} height={HEIGHT} rx={4}
                    className={styles.mark1} />
            </svg>
            <span className={styles.value}><bdi>{formatILS(item.valueAgorot)} ₪</bdi></span>
            {item.note ? <span className={styles.note}>{item.note}</span> : null}
          </div>
        );
      })}
      <table className={styles.tableView}>
        <caption>הנתונים שמאחורי התרשים</caption>
        <thead><tr><th>שם</th><th>סכום</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.label}</td>
              <td><bdi>{formatILS(item.valueAgorot)} ₪</bdi></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
