/**
 * A Server Component. The step is derived from the upload's status and its
 * blocks' states, never stored — so it cannot be stale the moment a block is
 * confirmed, which is exactly when a lead looks at it.
 */
import type { ReviewStep } from '@/lib/import/review';
import { Icon } from '@/components/ui/icon';
import styles from './import-review.module.css';

const STEPS = ['העלאה', 'זיהוי טבלאות', 'סקירה ואישור', 'קידום לנתונים'] as const;

export function Stepper(
  { current, confirmed, total }: {
    current: ReviewStep; confirmed: number; total: number;
  },
) {
  return (
    <div className={styles.stepper}>
      <ol className={styles.steps} aria-label="שלבי הייבוא">
        {STEPS.map((name, index) => {
          const step = index + 1;
          const done = step < current;
          return (
            <li
              key={name}
              className={styles.step}
              aria-current={step === current ? 'step' : undefined}
            >
              <span className={done ? styles.stepDone : styles.stepMark}>
                {done ? <Icon name="check" size={14} /> : <bdi>{step}</bdi>}
              </span>
              <span className={step === current ? styles.stepNow : styles.stepName}>
                {name}
              </span>
            </li>
          );
        })}
      </ol>
      {/* A17: one isolate for the whole phrase, not one per number. */}
      <span className={styles.stepProgress}>
        <bdi>אושרו {confirmed} מתוך {total}</bdi>
      </span>
    </div>
  );
}
