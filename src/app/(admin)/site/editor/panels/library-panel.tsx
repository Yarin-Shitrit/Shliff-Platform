'use client';

/**
 * הוספה למפה (spec §10): every kind the map knows, grouped as `kinds.ts`
 * groups them, each tile showing the size it lands at — the camp's own
 * default when there is one, with a dot saying so.
 *
 * A tile is placed two ways (§8). Dragged, it follows the pointer and lands
 * where it is let go; clicked, or Enter or Space on it, it lands at the free
 * spot nearest the middle of the view. The tile only reports the pointer;
 * SiteEditor asks the scene where the ground is.
 */

import { useRef, useState, type MouseEvent, type PointerEvent, type ReactElement } from 'react';
import type { SiteItemKind } from '@/db/schema/site';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { effectiveSize, isCustomised, type KindDefaults } from '@/lib/site/defaults';
import { formatSize } from '@/lib/site/geometry';
import { KIND_GROUP_LABELS, KIND_GROUP_ORDER, KIND_ORDER, SITE_KINDS } from '@/lib/site/kinds';
import chrome from './panel.module.css';
import styles from './library-panel.module.css';

/** A press that travels less than this is a click, not a drag. */
const DRAG_START_PX = 4;

type Glyph = 'box' | 'low' | 'long' | 'tent' | 'cyl' | 'net';
type Face = 'top' | 'side' | 'side2' | 'line';

/** The mock's isometric tile drawings, on a 30 × 24 canvas. */
const GLYPHS: Record<Glyph, ReadonlyArray<{ d: string; face: Face }>> = {
  box: [
    { d: 'M3 9 L15 14 L15 22 L3 17 Z', face: 'side' },
    { d: 'M27 9 L15 14 L15 22 L27 17 Z', face: 'side2' },
    { d: 'M15 4 L27 9 L15 14 L3 9 Z', face: 'top' },
  ],
  low: [
    { d: 'M3 12 L15 17 L15 21 L3 16 Z', face: 'side' },
    { d: 'M27 12 L15 17 L15 21 L27 16 Z', face: 'side2' },
    { d: 'M15 7 L27 12 L15 17 L3 12 Z', face: 'top' },
  ],
  long: [
    { d: 'M2 8 L20 15 L20 22 L2 15 Z', face: 'side' },
    { d: 'M28 11 L20 15 L20 22 L28 18 Z', face: 'side2' },
    { d: 'M10 4 L28 11 L20 15 L2 8 Z', face: 'top' },
  ],
  tent: [
    { d: 'M3 14 L15 19 L15 22 L3 17 Z', face: 'side' },
    { d: 'M27 14 L15 19 L15 22 L27 17 Z', face: 'side2' },
    { d: 'M3 14 L15 19 L21 7 L9 3 Z', face: 'top' },
    { d: 'M27 14 L15 19 L21 7 Z', face: 'side2' },
  ],
  cyl: [
    { d: 'M6 8 V17 A9 4 0 0 0 24 17 V8 Z', face: 'side' },
    { d: 'M6 8 A9 4 0 1 0 24 8 A9 4 0 1 0 6 8 Z', face: 'top' },
  ],
  net: [
    { d: 'M3 8 V19 M27 8 V19 M15 13 V23 M15 3 V8', face: 'line' },
    { d: 'M15 3 L27 8 L15 13 L3 8 Z', face: 'top' },
  ],
};

const FACE_CLASS: Record<Face, string> = {
  top: styles.faceTop, side: styles.faceSide, side2: styles.faceSide2, line: styles.faceLine,
};

function glyphOf(kind: SiteItemKind): Glyph {
  const preset = SITE_KINDS[kind];
  if (preset.shape === 'net') return 'net';
  if (preset.shape === 'tent') return 'tent';
  if (preset.shape === 'cylinder' || preset.shape === 'fire') return 'cyl';
  if (preset.shape === 'sofa') return 'low';
  if (preset.widthCm >= preset.depthCm * 2.5) return 'long';
  return preset.heightCm <= 110 ? 'low' : 'box';
}

function KindGlyph({ kind }: { kind: SiteItemKind }): ReactElement {
  const glyph = glyphOf(kind);
  return (
    <svg
      className={cx(styles.glyph, chrome[`g_${SITE_KINDS[kind].group}`])}
      data-glyph={glyph}
      width={30}
      height={24}
      viewBox="0 0 30 24"
      aria-hidden="true"
    >
      {GLYPHS[glyph].map((part) => <path key={part.d} d={part.d} className={FACE_CLASS[part.face]} />)}
    </svg>
  );
}

/** A press on a tile: the pointer that made it, where it went down, and whether it has become a drag. */
interface Press {
  pointer: number;
  x: number;
  y: number;
  dragging: boolean;
}

interface TileCallbacks {
  onActivate: (kind: SiteItemKind) => void;
  onDragMove: (kind: SiteItemKind, clientX: number, clientY: number) => void;
  onDrop: (kind: SiteItemKind, clientX: number, clientY: number) => void;
  onDragCancel: () => void;
}

function KindTile({ kind, defaults, onActivate, onDragMove, onDrop, onDragCancel }: TileCallbacks & {
  kind: SiteItemKind;
  defaults: KindDefaults;
}): ReactElement {
  const press = useRef<Press | null>(null);
  const dropped = useRef(false);
  const size = effectiveSize(kind, defaults);
  const customised = isCustomised(kind, defaults);
  const sizeText = formatSize(size.widthCm, size.depthCm);
  const label = SITE_KINDS[kind].label;

  /** The press this pointer owns, or null: one pointer drags a tile at a time, and a second finger is ignored. */
  function ownPress(event: PointerEvent<HTMLButtonElement>): Press | null {
    const current = press.current;
    return current !== null && current.pointer === event.pointerId ? current : null;
  }

  function down(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    if (press.current !== null && press.current.pointer !== event.pointerId) return;
    /* A new press starts clean. No click follows a finger's drag (a touch
       that moved is not a tap), so a flag left by that drop must not eat
       this press's click. */
    dropped.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  }

  function move(event: PointerEvent<HTMLButtonElement>): void {
    const current = ownPress(event);
    if (current === null) return;
    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_START_PX) return;
    current.dragging = true;
    onDragMove(kind, event.clientX, event.clientY);
  }

  function up(event: PointerEvent<HTMLButtonElement>): void {
    const current = ownPress(event);
    if (current === null) return;
    press.current = null;
    if (!current.dragging) return;
    // The browser follows a drop with a click on the tile; that click is not a second placement.
    dropped.current = true;
    onDrop(kind, event.clientX, event.clientY);
  }

  /* A cancel, or the capture lost without a lift (the tile unmounted, the
     window lost focus): the drag ends and the ghost goes. A cancel is itself
     followed by the capture's loss, and a lift by its release; the press is
     cleared by the first, so the second finds nothing to end. */
  function cancel(event: PointerEvent<HTMLButtonElement>): void {
    const current = ownPress(event);
    if (current === null) return;
    press.current = null;
    if (current.dragging) onDragCancel();
  }

  function click(event: MouseEvent<HTMLButtonElement>): void {
    // Enter or Space: a click with no press count, never the one a drop sends.
    if (dropped.current && event.detail !== 0) {
      dropped.current = false;
      return;
    }
    dropped.current = false;
    onActivate(kind);
  }

  return (
    <button
      type="button"
      className={styles.tile}
      // Through a fixed noun for the kind אחר: "הוספת אחר" does not read as adding an item.
      aria-label={`הוספת ${kind === 'other' ? `פריט מסוג ${label}` : label}, ${sizeText}${customised ? ', גודל ברירת המחדל שונה' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onClick={click}
    >
      <KindGlyph kind={kind} />
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileSize}><bdi>{sizeText}</bdi></span>
      {customised ? <span className={styles.tileDot} aria-hidden="true" /> : null}
    </button>
  );
}

export function LibraryPanel({ defaults, onActivate, onDragMove, onDrop, onDragCancel }: TileCallbacks & {
  defaults: KindDefaults;
}): ReactElement {
  const [query, setQuery] = useState('');
  const wanted = query.trim();
  const groups = KIND_GROUP_ORDER
    .map((group) => ({
      group,
      kinds: KIND_ORDER.filter((kind) => SITE_KINDS[kind].group === group
        && (wanted === '' || SITE_KINDS[kind].label.includes(wanted))),
    }))
    .filter((entry) => entry.kinds.length > 0);

  return (
    <div className={chrome.stack}>
      <label className={chrome.search}>
        <Icon name="search" size={15} />
        <input
          type="search"
          className={chrome.searchInput}
          placeholder="חיפוש פריט להוספה"
          aria-label="חיפוש פריט להוספה"
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
        />
      </label>
      <p className={chrome.hint}>
        גרירה אל המפה מניחה את הפריט בדיוק שם. לחיצה מניחה אותו במקום הפנוי הקרוב למרכז התצוגה.
      </p>
      {groups.map(({ group, kinds }) => (
        <div key={group} className={styles.group}>
          <div className={styles.groupLabel}>
            <span className={cx(chrome.swatch, chrome[`g_${group}`])} aria-hidden="true" />
            {KIND_GROUP_LABELS[group]}
          </div>
          <div className={styles.tiles}>
            {kinds.map((kind) => (
              <KindTile
                key={kind}
                kind={kind}
                defaults={defaults}
                onActivate={onActivate}
                onDragMove={onDragMove}
                onDrop={onDrop}
                onDragCancel={onDragCancel}
              />
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 ? (
        <p className={chrome.hint}>
          אין סוג כזה ברשימה. הסוג ״אחר״ מקבל כל שם, כך שאפשר לצייר גם את מה שהרשימה לא חשבה עליו.
        </p>
      ) : null}
    </div>
  );
}
