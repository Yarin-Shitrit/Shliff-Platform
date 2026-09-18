import { barGeometry } from '@/components/charts/geometry';
import styles from './money.module.css';

const WIDTH = 120;
const HEIGHT = 3;

/**
 * Spend against plan, as a hairline under the line's name.
 *
 * This is **status**, not identity: it never takes a series hue and never
 * takes the brand accent (A4). It is also never the only carrier of its
 * meaning — an over-budget row also says `חריגה` in words, and carries the
 * overrun as a figure (R3). The geometry comes from `barGeometry` with an
 * explicit direction, because SVG has no logical properties and a bar drawn
 * from x=0 reads correctly only in an LTR screenshot.
 */
export function SpendBar({ spentAgorot, plannedAgorot, over }: {
  spentAgorot: number;
  plannedAgorot: number;
  over: boolean;
}) {
  const bar = barGeometry({
    valueAgorot: spentAgorot, maxAgorot: plannedAgorot, width: WIDTH, direction: 'rtl',
  });
  return (
    <svg className={styles.spendBar} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
         role="presentation" aria-hidden="true">
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={1.5} className={styles.spendTrack} />
      <rect x={bar.x} y={0} width={bar.width} height={HEIGHT} rx={1.5}
            className={over ? styles.spendOver : styles.spendMark} />
    </svg>
  );
}
