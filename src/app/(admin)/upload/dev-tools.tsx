/**
 * A Server Component: it renders two client buttons and decides nothing at
 * render time except whether this is production, which hardening T4 already
 * established is the server's call. The actions refuse there regardless —
 * hiding a button has never been the enforcement on this project.
 *
 * **This task moves rendering, not policy** (the plan's Ruling 3), and T4's
 * condition is narrower than it first looks: it guards `SeedButton` and its
 * note, because `seedAction` reads the camp's real workbooks off disk and
 * those files are excluded from every deployed function's trace. It does NOT
 * guard `CampSeedButton` — `seedCampAction` has no production refusal, reads
 * nothing from disk, and is idempotent by design, so a lead can press it
 * after a database rebuild. The plan's sample code puts both buttons behind
 * the production check, which would quietly make the camp seed unreachable in
 * production; that is a policy change the plan's own ruling forbids, so T4's
 * condition is carried across as T4 drew it.
 */
import { SeedButton } from './seed-button';
import { CampSeedButton } from './camp-seed-button';
import styles from './upload.module.css';

export function DevTools() {
  const isProduction = process.env.NODE_ENV === 'production';

  return (
    <details className={styles.devTools}>
      <summary className={styles.devSummary}>כלי פיתוח</summary>
      {isProduction ? null : (
        <>
          <p className={styles.devNote}>
            טעינת שלושת קובצי האקסל ההיסטוריים של הקאמפ למסד הנתונים. פעולה זו ניתנת
            להרצה חוזרת בבטחה — קבצים שכבר נטענו לא ייטענו פעם נוספת.
          </p>
          <SeedButton />
        </>
      )}
      <CampSeedButton />
    </details>
  );
}
