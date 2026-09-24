'use client';

/**
 * Turn, duplicate, lock and remove (spec §10) — one set of buttons for the
 * inspector's footer (`labelled`) and for the selection bar floating by the
 * selection (icons, each named). The handlers are SiteEditor's, so every one
 * of these edits says what it did the same way from either place.
 *
 * The lock is a switch: `aria-pressed` carries the state and the name stays
 * "נעילה", rather than a name that flips between two verbs.
 */

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { EditorIcon } from './editor-icons';
import styles from './selection-actions.module.css';

export function SelectionActions({ locked, labelled, onTurn, onDuplicate, onLock, onRemove }: {
  /** Every selected item is locked. */
  locked: boolean;
  labelled: boolean;
  onTurn: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
}): ReactElement {
  const lock = (
    <button type="button" className={styles.iconButton} aria-label="נעילה" aria-pressed={locked} onClick={onLock}>
      <EditorIcon name="lock" size={14} />
    </button>
  );

  if (labelled) {
    return (
      <>
        <Button size="sm" onClick={onTurn}>
          <EditorIcon name="turn" size={14} />
          סיבוב
        </Button>
        <Button size="sm" onClick={onDuplicate}>
          <Icon name="copy" size={14} />
          שכפול
        </Button>
        {lock}
        <span className={styles.pushEnd}>
          <Button size="sm" tone="danger" onClick={onRemove}>
            <Icon name="trash" size={14} />
            הסרה
          </Button>
        </span>
      </>
    );
  }

  return (
    <>
      <button type="button" className={styles.iconButton} aria-label="סיבוב ברבע" onClick={onTurn}>
        <EditorIcon name="turn" size={14} />
      </button>
      <button type="button" className={styles.iconButton} aria-label="שכפול" onClick={onDuplicate}>
        <Icon name="copy" size={14} />
      </button>
      {lock}
      <button type="button" className={styles.iconButton} aria-label="הסרה" onClick={onRemove}>
        <Icon name="trash" size={14} />
      </button>
    </>
  );
}
