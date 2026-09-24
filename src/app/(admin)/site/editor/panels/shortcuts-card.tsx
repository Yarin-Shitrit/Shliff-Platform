'use client';

/**
 * Every gesture and key the editor reads (spec §8), opened with ? or from the
 * view controls. Keycaps are glyphs (⇧ ⌘ ⌥ ⌫) and single letters, which is
 * what is printed on a keyboard; `esc` is the one word, as on the command
 * palette. The note under the list is the reason a Hebrew layout works.
 *
 * The keys are the ones `keyboard.ts` reads; `view-controls.test.tsx` holds
 * the two lists against each other.
 */

import { Fragment, useId, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import shell from '../editor.module.css';
import chrome from './panel.module.css';
import styles from './shortcuts-card.module.css';

const ROWS: ReadonlyArray<{ what: string; keys: readonly string[] }> = [
  { what: 'בחירה · מדידה', keys: ['V', 'M'] },
  { what: 'גרירה על שטח ריק — הזזת המבט', keys: ['גרירה'] },
  { what: 'בחירת כמה פריטים במלבן', keys: ['⇧', 'גרירה'] },
  { what: 'הוספה או הסרה מהבחירה', keys: ['⇧', 'לחיצה'] },
  { what: 'סיבוב המבט בתלת־ממד', keys: ['גרירה ימנית', '⌃ גרירה'] },
  { what: 'טיסה אל פריט', keys: ['לחיצה כפולה'] },
  { what: 'הזזה בצעד רשת · בצעד של מטר', keys: ['←↑→↓', '⇧'] },
  { what: 'הזזה בלי הצמדה', keys: ['⌥', 'גרירה'] },
  { what: 'סיבוב ברבע · שכפול · נעילה', keys: ['R', '⌘D', 'L'] },
  { what: 'הסרה', keys: ['⌫'] },
  { what: 'ביטול · ביצוע מחדש', keys: ['⌘Z', '⇧⌘Z'] },
  { what: 'בחירת הכול, בלי רשתות הצל', keys: ['⌘A'] },
  { what: 'ביטול הבחירה', keys: ['esc'] },
  { what: 'תוכנית · תלת־ממד · התאמה למסך', keys: ['2', '3', 'F'] },
  { what: 'סיבוב המבט · התקרבות והתרחקות', keys: ['Q', 'E', '+', '−'] },
  { what: 'הכרטיס הזה', keys: ['?'] },
];

export function ShortcutsCard({ onClose }: { onClose: () => void }): ReactElement {
  const titleId = useId();
  return (
    <div className={cx(chrome.card, styles.keysCard)} role="dialog" aria-labelledby={titleId} data-panel="true">
      <div className={chrome.cardHead}>
        <h2 className={styles.title} id={titleId}>קיצורי מקלדת</h2>
        <Button tone="ghost" size="sm" iconLabel="סגירה" onClick={onClose}>
          <Icon name="x" size={14} />
        </Button>
      </div>
      <dl className={styles.keysList}>
        {ROWS.map((row) => (
          <Fragment key={row.what}>
            <dt>{row.what}</dt>
            <dd>{row.keys.map((key) => <kbd key={key} className={shell.kbd}>{key}</kbd>)}</dd>
          </Fragment>
        ))}
      </dl>
      <p className={chrome.meta}>המקשים נקראים לפי מיקומם במקלדת, כך שהם עובדים גם כשהמקלדת בעברית.</p>
    </div>
  );
}
