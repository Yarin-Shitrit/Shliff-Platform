'use client';

/**
 * Whether the map is saved. The top bar always says one of three things
 * (spec §6.3) — never nothing — and when saving stops, it says what to do:
 * a lost connection is retried from the top bar itself; a conflict with
 * another lead is a choice between two maps (§6.4); a refusal is a Hebrew
 * reason and a way back, in a banner under the bar.
 */

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import type { QueueSnapshot, SaveStatus as QueueStatus } from '../save-queue';
import styles from '../editor.module.css';

const SAID: Record<QueueStatus, string> = {
  saved: 'כל השינויים נשמרו',
  pending: 'שומר…',
  saving: 'שומר…',
  error: 'לא נשמר —',
  conflict: 'לא נשמר — המפה שונתה ממקום אחר',
};

export function SaveStatus({ snapshot, onRetry }: {
  snapshot: QueueSnapshot;
  onRetry: () => void;
}): ReactElement {
  return (
    <span className={styles.saveState} data-status={snapshot.status}>
      <span className={styles.saveText} role="status">
        <span className={styles.saveDot} aria-hidden="true" />
        {SAID[snapshot.status]}
      </span>
      {snapshot.status === 'error' ? (
        <Button size="sm" tone="ghost" onClick={onRetry}>ניסיון חוזר</Button>
      ) : null}
    </span>
  );
}

/** Another lead saved since this map was loaded: the lead chooses, nothing is overwritten (§6.4). */
export function ConflictBanner({ busy, onTheirs, onMine }: {
  busy: boolean;
  onTheirs: () => void;
  onMine: () => void;
}): ReactElement {
  return (
    <div className={styles.banner} data-tone="warn" role="alert">
      <p className={styles.bannerText}>
        המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.
      </p>
      <span className={styles.bannerActions}>
        <Button size="sm" onClick={onTheirs} disabled={busy}>טעינת הגרסה העדכנית</Button>
        <Button size="sm" onClick={onMine} disabled={busy}>שמירת השינויים שלי מעליה</Button>
      </span>
    </div>
  );
}

/**
 * The server refused the batch (`errorKind: 'refused'`). `message` is already
 * Hebrew — the server's refusal, mapped by `failure-messages.ts`. The retry
 * stays in the top bar's status; this offers the way back.
 *
 * Never for a lost connection (plan 04, ruling P8): a reload must not be the
 * only way out of a dropped connection, so that case gets the retry alone.
 */
export function SaveErrorBanner({ message, busy, onReload }: {
  message: string;
  busy: boolean;
  onReload: () => void;
}): ReactElement {
  return (
    <div className={styles.banner} data-tone="bad" role="alert">
      <p className={styles.bannerText}>{message}</p>
      <span className={styles.bannerActions}>
        <Button size="sm" onClick={onReload} disabled={busy}>טעינת הגרסה העדכנית</Button>
      </span>
    </div>
  );
}
