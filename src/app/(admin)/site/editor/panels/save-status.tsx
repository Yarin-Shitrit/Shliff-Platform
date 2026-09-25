'use client';

/**
 * Whether the map is saved. The top bar always says one of three things
 * (spec §6.3) — never nothing — and when saving stops, a banner under it says
 * why: a lost connection is a Hebrew reason, retried from the top bar; a
 * refusal is a Hebrew reason and a way back; a conflict with another lead is
 * a choice between two maps (§6.4).
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

export function SaveStatus({ snapshot, onRetry, busy = false, reasonId }: {
  snapshot: QueueSnapshot;
  onRetry: () => void;
  /** A reload is under way: a retry now would resend what it is about to drop. */
  busy?: boolean;
  /** The id of the sentence saying why the save stopped (`SaveErrorBanner`), read with the retry. */
  reasonId?: string;
}): ReactElement {
  return (
    <span className={styles.saveState} data-status={snapshot.status}>
      <span className={styles.saveText} role="status">
        <span className={styles.saveDot} aria-hidden="true" />
        {SAID[snapshot.status]}
      </span>
      {snapshot.status === 'error' ? (
        <Button size="sm" tone="ghost" onClick={onRetry} disabled={busy} aria-describedby={reasonId}>
          ניסיון חוזר
        </Button>
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
 * Why the batch did not go through. `message` is already Hebrew — the queue's
 * own network sentence, or the server's refusal mapped by
 * `failure-messages.ts`. The retry stays in the top bar's status, described
 * by this sentence (`id`).
 *
 * `onReload` — the way back — only for a refusal. A lost connection gets the
 * reason and the retry, never a reload (plan 04, ruling P8): a reload must not
 * be the only way out of a dropped connection.
 *
 * `onMine` — also only for a refusal (review C2): the retry resends the same
 * refused batch, and the reload drops everything unsent, so the third way
 * keeps the work — the latest map, with what can still apply replayed on top
 * and the rest named.
 *
 * `onRefresh` — when a deploy replaced the build this page runs (review I2):
 * the reload and keep-mine would call the same missing server actions, so
 * the one way out is refreshing the page, and the unsaved work waits for it.
 */
export function SaveErrorBanner({ message, busy, onReload, onMine, onRefresh, id }: {
  message: string;
  busy: boolean;
  onReload?: () => void;
  onMine?: () => void;
  onRefresh?: () => void;
  id?: string;
}): ReactElement {
  const actions = onReload !== undefined || onMine !== undefined || onRefresh !== undefined;
  return (
    <div className={styles.banner} data-tone="bad" role="alert">
      <p className={styles.bannerText} id={id}>{message}</p>
      {actions ? (
        <span className={styles.bannerActions}>
          {onReload === undefined ? null : (
            <Button size="sm" onClick={onReload} disabled={busy}>טעינת הגרסה העדכנית</Button>
          )}
          {onMine === undefined ? null : (
            <Button size="sm" onClick={onMine} disabled={busy}>שמירת השינויים שלי מעליה</Button>
          )}
          {onRefresh === undefined ? null : (
            <Button size="sm" onClick={onRefresh}>רענון הדף</Button>
          )}
        </span>
      ) : null}
    </div>
  );
}
