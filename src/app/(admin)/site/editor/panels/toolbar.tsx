'use client';

/**
 * The 48px tool row (spec §10): select or measure, undo and redo, plan or 3D,
 * the labels' three styles — floating, none, printed on the item — and the
 * switches: shade by hour, hiding the nets, the picture under the map (once
 * there is one), snapping.
 * Each switch is a real button with `aria-pressed` and a label that does not
 * change; each keycap is the key `keyboard.ts` reads.
 */

/** The three ways to name the items, in the tool row's order, with the mode each button chooses. */
const LABEL_MODES = [['floating', 'מרחפות'], ['none', 'בלי'], ['printed', 'מודפסות']] as const;

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { EditorUi } from '../scene/scene-view';
import { EditorIcon } from './editor-icons';
import styles from '../editor.module.css';

export function Toolbar({ ui, onUi, canUndo, canRedo, onUndo, onRedo, hasUnderlay }: {
  ui: EditorUi;
  onUi: (patch: Partial<EditorUi>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** The map has a picture under it: the switch that shows and hides it appears (spec §18.6). */
  hasUnderlay?: boolean;
}): ReactElement {
  return (
    <div className={styles.toolRow} role="group" aria-label="כלי העריכה">
      <div className={styles.seg} role="group" aria-label="כלי">
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.tool === 'select'}
          onClick={() => { onUi({ tool: 'select' }); }}
        >
          <EditorIcon name="pointer" size={14} />
          בחירה
          <kbd className={styles.kbd}>V</kbd>
        </button>
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.tool === 'measure'}
          onClick={() => { onUi({ tool: 'measure' }); }}
        >
          <EditorIcon name="ruler" size={14} />
          מדידה
          <kbd className={styles.kbd}>M</kbd>
        </button>
      </div>

      <Button tone="ghost" size="sm" iconLabel="ביטול הפעולה האחרונה" disabled={!canUndo} onClick={onUndo}>
        <EditorIcon name="undo" />
      </Button>
      <Button tone="ghost" size="sm" iconLabel="ביצוע מחדש" disabled={!canRedo} onClick={onRedo}>
        <EditorIcon name="redo" />
      </Button>

      <span className={styles.grow} />

      <div className={styles.seg} role="group" aria-label="תצוגה">
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.mode === 'plan'}
          onClick={() => { onUi({ mode: 'plan' }); }}
        >
          <EditorIcon name="plan" size={14} />
          תוכנית
          <kbd className={styles.kbd}>2</kbd>
        </button>
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.mode === '3d'}
          onClick={() => { onUi({ mode: '3d' }); }}
        >
          <EditorIcon name="cube" size={14} />
          תלת־ממד
          <kbd className={styles.kbd}>3</kbd>
        </button>
      </div>

      <span className={styles.grow} />

      <div className={styles.seg} role="group" aria-label="תוויות">
        {LABEL_MODES.map(([mode, name]) => (
          <button
            key={mode}
            type="button"
            className={styles.segButton}
            aria-pressed={ui.labels === mode}
            onClick={() => { onUi({ labels: mode }); }}
          >
            {mode === 'floating' ? <EditorIcon name="tag" size={14} /> : null}
            {name}
          </button>
        ))}
      </div>
      <button type="button" className={styles.toggle} aria-pressed={ui.sun} onClick={() => { onUi({ sun: !ui.sun }); }}>
        <Icon name="sun" size={14} />
        צל לפי שעה
      </button>
      <button type="button" className={styles.toggle} aria-pressed={ui.netsHidden} onClick={() => { onUi({ netsHidden: !ui.netsHidden }); }}>
        <EditorIcon name="eyeOff" size={14} />
        הסתרת רשתות צל
      </button>
      {hasUnderlay === true ? (
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={ui.underlay.shown}
          onClick={() => { onUi({ underlay: { ...ui.underlay, shown: !ui.underlay.shown } }); }}
        >
          <Icon name="layers" size={14} />
          תמונת רקע
        </button>
      ) : null}
      <button type="button" className={styles.toggle} aria-pressed={ui.snap} onClick={() => { onUi({ snap: !ui.snap }); }}>
        <EditorIcon name="magnet" size={14} />
        הצמדה
      </button>
    </div>
  );
}
