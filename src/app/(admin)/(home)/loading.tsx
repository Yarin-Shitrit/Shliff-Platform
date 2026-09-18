import styles from './home.module.css';

/** The four figures and the three panels, by name, so the skeleton's shape is
 *  read off the same list the screen is. */
const TILES = ['dues', 'cash', 'debts', 'coverage'];
const NARROW_PANELS = ['tasks', 'unpaid'];

/**
 * The home screen's own skeleton (E3).
 *
 * It lives in the `(home)` route group rather than at `(admin)/` so it is not
 * inherited by `/fees`, `/money` and the rest — a home-shaped skeleton over the
 * fees table is worse than no skeleton at all.
 *
 * It renders no figure, not even a zero. A number here is a lie with a short
 * shelf life, and a reader who learns that a zero on this screen means "not
 * yet" will read the real zeroes the same way.
 *
 * One sentence is announced and every shape is hidden: reading out a dozen
 * empty boxes to somebody who cannot see them is noise, not information.
 */
export default function HomeLoading() {
  return (
    <main className={styles.page} role="status" aria-live="polite">
      <span className={styles.srOnly}>טוען את מסך הבית</span>

      <div className={styles.head} aria-hidden="true">
        <div>
          <span className={`${styles.skelLine} ${styles.skelTitle}`} />
          <span className={`${styles.skelLine} ${styles.skelSub}`} />
        </div>
      </div>

      <div className={styles.figures} aria-hidden="true">
        {TILES.map((key) => (
          <div key={key} className={`${styles.panel} ${styles.skelTile}`}>
            <span className={`${styles.skelLine} ${styles.skelLabel}`} />
            <span className={`${styles.skelLine} ${styles.skelValue}`} />
            <span className={`${styles.skelLine} ${styles.skelSub}`} />
          </div>
        ))}
      </div>

      <div className={styles.columns} aria-hidden="true">
        <div className={styles.wide}>
          <div className={`${styles.panel} ${styles.skelPanel}`}>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <span key={row} className={`${styles.skelLine} ${styles.skelRow}`} />
            ))}
          </div>
        </div>
        <div className={styles.narrow}>
          {NARROW_PANELS.map((key) => (
            <div key={key} className={`${styles.panel} ${styles.skelPanel}`}>
              {[0, 1, 2, 3].map((row) => (
                <span key={row} className={`${styles.skelLine} ${styles.skelRow}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
