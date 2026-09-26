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
import chrome from './panel.module.css';
import styles from './selection-actions.module.css';

export function SelectionActions({ locked, labelled, onTurn, onDuplicate, onLock, onRemove, onGroup, onUngroup }: {
  /** Every selected item is locked. */
  locked: boolean;
  labelled: boolean;
  onTurn: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
  /**
   * Group the selection, or dissolve the groups in it. Each is offered only
   * when it would do something — two or more items not already one group;
   * at least one grouped item — so neither is a button that answers with
   * nothing. Undefined draws no button.
   */
  onGroup?: () => void;
  onUngroup?: () => void;
}): ReactElement {
  const lock = (
    <button type="button" className={chrome.iconButton} aria-label="נעילה" aria-pressed={locked} onClick={onLock}>
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
        {onGroup === undefined ? null : (
          <Button size="sm" onClick={onGroup}>
            <Icon name="grid" size={14} />
            קיבוץ
          </Button>
        )}
        {onUngroup === undefined ? null : (
          <Button size="sm" onClick={onUngroup}>
            <Icon name="split" size={14} />
            פירוק הקיבוץ
          </Button>
        )}
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
      <button type="button" className={chrome.iconButton} aria-label="סיבוב ברבע" onClick={onTurn}>
        <EditorIcon name="turn" size={14} />
      </button>
      <button type="button" className={chrome.iconButton} aria-label="שכפול" onClick={onDuplicate}>
        <Icon name="copy" size={14} />
      </button>
      {onGroup === undefined ? null : (
        <button type="button" className={chrome.iconButton} aria-label="קיבוץ" onClick={onGroup}>
          <Icon name="grid" size={14} />
        </button>
      )}
      {onUngroup === undefined ? null : (
        <button type="button" className={chrome.iconButton} aria-label="פירוק הקיבוץ" onClick={onUngroup}>
          <Icon name="split" size={14} />
        </button>
      )}
      {lock}
      <button type="button" className={chrome.iconButton} aria-label="הסרה" onClick={onRemove}>
        <Icon name="trash" size={14} />
      </button>
    </>
  );
}
