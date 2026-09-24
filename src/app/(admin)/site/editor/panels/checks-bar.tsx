'use client';

/**
 * The checks, top centre (spec §10): how many items are past the fence, how
 * many pairs overlap, how many sit in a net's unshaded strip — or "הכול
 * תקין". Each press selects the next case and flies to it. They replace the
 * four stat tiles and the outside-the-fence banner of the old page.
 */

import { useState, type ReactElement } from 'react';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import styles from './checks-bar.module.css';

type Check = 'outside' | 'pairs' | 'partly';

export function ChecksBar({ doc, flags, onGo }: {
  doc: EditorDoc;
  flags: EditorFlags;
  onGo: (ids: string[]) => void;
}): ReactElement {
  const [turns, setTurns] = useState<Record<Check, number>>({ outside: 0, pairs: 0, partly: 0 });
  const cases: Record<Check, string[][]> = {
    outside: doc.items.filter((item) => flags.outside.has(item.id)).map((item) => [item.id]),
    pairs: flags.pairs.map(([a, b]) => [a, b]),
    partly: doc.items.filter((item) => flags.partly.has(item.id)).map((item) => [item.id]),
  };

  function go(check: Check): void {
    const list = cases[check];
    if (list.length === 0) return;
    const index = turns[check] % list.length;
    setTurns((current) => ({ ...current, [check]: index + 1 }));
    onGo(list[index]);
  }

  const chips: Array<{ check: Check; tone: 'bad' | 'warn'; text: string; title: string }> = [];
  if (cases.outside.length > 0) {
    chips.push({ check: 'outside', tone: 'bad', text: `${cases.outside.length} מחוץ לגדר`, title: 'מעבר לפריט הבא שמחוץ לגדר' });
  }
  if (cases.pairs.length > 0) {
    chips.push({
      check: 'pairs', tone: 'warn',
      text: cases.pairs.length === 1 ? 'חפיפה אחת' : `${cases.pairs.length} חפיפות`,
      title: 'מעבר לחפיפה הבאה',
    });
  }
  if (cases.partly.length > 0) {
    chips.push({
      check: 'partly', tone: 'warn', text: `${cases.partly.length} בשולי רשת צל`,
      title: 'פריטים שנראים מכוסים אבל יושבים ברצועה שאין בה צל',
    });
  }

  return (
    <div className={styles.checks} role="group" aria-label="בדיקות המפה" data-panel="true">
      {chips.length === 0 ? (
        <span className={styles.chip} data-tone="ok">
          <span className={styles.chipDot} aria-hidden="true" />
          הכול תקין
        </span>
      ) : chips.map((chip) => (
        <button
          key={chip.check}
          type="button"
          className={styles.chip}
          data-tone={chip.tone}
          title={chip.title}
          onClick={() => { go(chip.check); }}
        >
          <span className={styles.chipDot} aria-hidden="true" />
          <bdi>{chip.text}</bdi>
        </button>
      ))}
    </div>
  );
}
