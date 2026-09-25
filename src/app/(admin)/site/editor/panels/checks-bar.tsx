'use client';

/**
 * The checks, top centre (spec §10): how many items are past the fence, how
 * many pairs overlap, how many sit in a net's unshaded strip, how many stand in a net's rope band — or "הכול
 * תקין". Each press selects the next case and flies to it. They replace the
 * four stat tiles and the outside-the-fence banner of the old page.
 */

import { useState, type ReactElement } from 'react';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import styles from './checks-bar.module.css';

type Check = 'outside' | 'pairs' | 'partly' | 'ropes';

/** The case a chip last went to, and where it stood in the list then. */
interface Visit {
  key: string;
  index: number;
}

const keyOf = (ids: readonly string[]): string => JSON.stringify(ids);

/**
 * Which case a press goes to. The lead fixes cases between presses, so a
 * position alone would skip one: the case after the one last visited if it
 * is still there, else — it was fixed — whatever now stands where it stood.
 */
function nextIndex(list: readonly string[][], last: Visit | null): number {
  if (last === null) return 0;
  const at = list.findIndex((ids) => keyOf(ids) === last.key);
  return (at === -1 ? last.index : at + 1) % list.length;
}

/**
 * One check's chip. It keeps its own place, so a chip whose count goes to
 * nothing — and so leaves the bar — starts from its first case when it comes
 * back.
 */
function CheckChip({ cases, tone, text, title, onGo }: {
  cases: readonly string[][];
  tone: 'bad' | 'warn';
  text: string;
  title: string;
  onGo: (ids: string[]) => void;
}): ReactElement {
  const [last, setLast] = useState<Visit | null>(null);

  function go(): void {
    if (cases.length === 0) return;
    const index = nextIndex(cases, last);
    setLast({ key: keyOf(cases[index]), index });
    onGo(cases[index]);
  }

  return (
    <button type="button" className={styles.chip} data-tone={tone} title={title} onClick={go}>
      <span className={styles.chipDot} aria-hidden="true" />
      <bdi>{text}</bdi>
    </button>
  );
}

export function ChecksBar({ doc, flags, onGo }: {
  doc: EditorDoc;
  flags: EditorFlags;
  onGo: (ids: string[]) => void;
}): ReactElement {
  const cases: Record<Check, string[][]> = {
    outside: doc.items.filter((item) => flags.outside.has(item.id)).map((item) => [item.id]),
    pairs: flags.pairs.map(([a, b]) => [a, b]),
    partly: doc.items.filter((item) => flags.partly.has(item.id)).map((item) => [item.id]),
    ropes: flags.ropePairs.map(([net, id]) => [net, id]),
  };

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
  if (cases.ropes.length > 0) {
    chips.push({
      check: 'ropes', tone: 'warn', text: `${cases.ropes.length} בשטח החבלים`,
      title: 'פריטים שעומדים בין שולי הבד של רשת צל לבין היתדות שלה',
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
        <CheckChip
          key={chip.check}
          cases={cases[chip.check]}
          tone={chip.tone}
          text={chip.text}
          title={chip.title}
          onGo={onGo}
        />
      ))}
    </div>
  );
}
