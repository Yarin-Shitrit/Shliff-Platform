'use client';

/**
 * The map itself: the plot, its grid, and every item as a rectangle a lead
 * can drag, stretch, turn and select.
 *
 * A client component because a drag is state that lives between two pointer
 * events. What it *shows* still comes from the server: the page loads the
 * rows and hands them over, and every commit is one server action followed
 * by `router.refresh()`, so the table under the board and the tiles above it
 * agree with the drawing within one round trip.
 *
 * One SVG user unit is one centimetre, so the plot scales to whatever width
 * the panel has and a pointer delta converts to centimetres with one
 * division. Unlike the charts, nothing here mirrors for RTL: the map is a
 * physical thing and the kitchen is where the kitchen is (`geometry.ts`).
 *
 * Every flag — outside the fence, overlapping, in the sag strip of a shade
 * net — is re-derived on every move with the same pure function the server
 * used, so the warning appears the moment a tent crosses the line and not
 * after the round trip.
 */

import {
  useId, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import type { SiteItemKind } from '@/db/schema/site';
import { Button, ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/toaster';
import {
  HANDLES, metres, formatSize, move, resize, shadedRect, swapSides,
  type Handle, type Rect,
} from '@/lib/site/geometry';
import { derive, toPlaced, type ItemShape, type PlotShape } from '@/lib/site/derive';
import {
  KIND_GROUP_LABELS, KIND_GROUP_ORDER, KIND_ORDER, SITE_KINDS,
} from '@/lib/site/kinds';
import {
  HANDLE_LABELS, SHADE_STATE_LABELS, SHADE_STATE_TONES, SITE_STATE_LABELS, SITE_STATE_TONES,
} from '@/lib/site/labels';
import { itemHref, removeItemHref } from '@/lib/site/views';
import { addItemAction, updateItemAction } from './actions';
import styles from './site.module.css';

export interface BoardItem extends ItemShape {
  label: string;
  sort: number;
}

export interface BoardPlan extends PlotShape {
  id: string;
}

/** Room around the plot for the dimension labels and for an item dragged past the fence. */
const PAD_CM = 200;

/** A darker grid line every five metres, so a lead can count without squinting. */
const MAJOR_CM = 500;

type Drag = {
  id: string;
  mode: 'move' | 'resize';
  handle: Handle;
  startX: number;
  startY: number;
  origin: Rect;
  moved: boolean;
};

function rectOf(item: ItemShape): Rect {
  return { x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm };
}

function withRect<Item extends ItemShape>(item: Item, rect: Rect): Item {
  return { ...item, xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth };
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.depth === b.depth;
}

/** Where each handle sits on a rectangle, as a fraction of its sides. */
const HANDLE_AT: Record<Handle, [number, number]> = {
  n: [0.5, 0], s: [0.5, 1], e: [1, 0.5], w: [0, 0.5],
  ne: [1, 0], nw: [0, 0], se: [1, 1], sw: [0, 1],
};

export function SiteBoard({ plan, items, season, initialSelected = null }: {
  plan: BoardPlan;
  items: readonly BoardItem[];
  season: string;
  initialSelected?: string | null;
}) {
  const router = useRouter();
  const { show } = useToast();
  /* `useId` may carry characters (`:`, `«`) that `url(#…)` will not resolve
     inside an SVG paint reference; only the alphanumerics are kept. */
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const gridId = `site-grid-${uid}`;
  const majorId = `site-major-${uid}`;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<Drag | null>(null);

  /* The rows are the server's; the board keeps a working copy so a drag can
     draw before it is saved. When the server sends new rows (after
     `router.refresh()`), the copy is replaced — React's own pattern for
     state that follows a prop, without an effect that renders twice. */
  const [seen, setSeen] = useState(items);
  const [local, setLocal] = useState(items);
  if (seen !== items) {
    setSeen(items);
    setLocal(items);
  }

  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [adding, setAdding] = useState<SiteItemKind | null>(null);

  const derived = derive(plan, local);
  const drawn = [...derived.items].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const current = derived.items.find((item) => item.id === selected) ?? null;

  const viewW = plan.widthCm + PAD_CM * 2;
  const viewD = plan.depthCm + PAD_CM * 2;
  const fontCm = Math.max(24, Math.round(viewW / 60));
  const handleCm = Math.max(20, Math.round(viewW / 80));

  function apply(id: string, rect: Rect): void {
    setLocal((rows) => rows.map((row) => (row.id === id ? withRect(row, rect) : row)));
  }

  async function commit(id: string, next: Rect, previous: Rect): Promise<void> {
    if (sameRect(next, previous)) return;
    const result = await updateItemAction(id, {
      xCm: next.x, yCm: next.y, widthCm: next.width, depthCm: next.depth,
    });
    if (!result.ok) {
      apply(id, previous);
      show({ message: result.error, tone: 'bad' });
      return;
    }
    router.refresh();
  }

  /** Pixels per centimetre right now — the one number a drag needs. */
  function scale(): number {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 1;
    return box.width / viewW;
  }

  function beginDrag(
    event: ReactPointerEvent<SVGElement>, item: ItemShape, mode: Drag['mode'], handle: Handle,
  ): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: item.id, mode, handle,
      startX: event.clientX, startY: event.clientY,
      origin: rectOf(item), moved: false,
    };
    setSelected(item.id);
  }

  function onPointerMove(event: ReactPointerEvent<SVGElement>): void {
    const active = drag.current;
    if (!active) return;
    const px = scale();
    const dx = (event.clientX - active.startX) / px;
    const dy = (event.clientY - active.startY) / px;
    const next = active.mode === 'move'
      ? move(active.origin, dx, dy, plan.gridCm)
      : resize(active.origin, active.handle, dx, dy, plan.gridCm);
    if (!sameRect(next, active.origin)) active.moved = true;
    apply(active.id, next);
  }

  function onPointerUp(event: ReactPointerEvent<SVGElement>): void {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active.moved) return;
    const row = local.find((item) => item.id === active.id);
    if (row) void commit(active.id, rectOf(row), active.origin);
  }

  function onKeyDown(event: ReactKeyboardEvent<SVGElement>, item: ItemShape): void {
    const rect = rectOf(item);
    const step = plan.gridCm;
    let next: Rect | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = event.shiftKey ? resize(rect, 'e', -step, 0, step) : move(rect, -step, 0, step);
        break;
      case 'ArrowRight':
        next = event.shiftKey ? resize(rect, 'e', step, 0, step) : move(rect, step, 0, step);
        break;
      case 'ArrowUp':
        next = event.shiftKey ? resize(rect, 's', 0, -step, step) : move(rect, 0, -step, step);
        break;
      case 'ArrowDown':
        next = event.shiftKey ? resize(rect, 's', 0, step, step) : move(rect, 0, step, step);
        break;
      case 'r': case 'R': case 'ר':
        next = swapSides(rect);
        break;
      case 'Enter':
        router.push(itemHref({ season }, item.id));
        return;
      case 'Escape':
        setSelected(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    apply(item.id, next);
    void commit(item.id, next, rect);
  }

  function turn(item: ItemShape): void {
    const rect = rectOf(item);
    const next = swapSides(rect);
    apply(item.id, next);
    void commit(item.id, next, rect);
  }

  async function add(kind: SiteItemKind): Promise<void> {
    setAdding(kind);
    try {
      const result = await addItemAction(plan.id, kind);
      if (!result.ok) {
        show({ message: result.error, tone: 'bad' });
        return;
      }
      setSelected(result.value ?? null);
      show({ message: `${SITE_KINDS[kind].label} נוסף למפה`, tone: 'ok' });
      router.refresh();
    } finally {
      setAdding(null);
    }
  }

  function describe(item: (typeof derived.items)[number]): string {
    const parts = [
      item.label,
      formatSize(item.widthCm, item.depthCm),
      `מיקום ${metres(item.xCm)} על ${metres(item.yCm)} מטר`,
    ];
    if (item.outside) parts.push(SITE_STATE_LABELS.outside);
    if (item.overlapping) parts.push(SITE_STATE_LABELS.overlapping);
    if (item.shade !== null && item.shade !== 'shaded') parts.push(SHADE_STATE_LABELS[item.shade]);
    return parts.join(', ');
  }

  return (
    <section className={styles.board} aria-label="לוח המפה">
      <div className={styles.palette} role="group" aria-label="הוספה למפה">
        <span className={styles.paletteTitle}>הוספה למפה</span>
        {KIND_GROUP_ORDER.map((group) => (
          <span key={group} className={styles.paletteGroup}>
            <span className={styles.paletteGroupLabel}>{KIND_GROUP_LABELS[group]}</span>
            {KIND_ORDER.filter((kind) => SITE_KINDS[kind].group === group).map((kind) => (
              <Button
                key={kind}
                size="sm"
                disabled={adding !== null}
                onClick={() => { void add(kind); }}
              >
                <Icon name="plus" size={14} />
                {SITE_KINDS[kind].label}
              </Button>
            ))}
          </span>
        ))}
      </div>

      <div className={styles.toolbar} role="group" aria-label="הפריט שנבחר">
        {current === null ? (
          <p className={styles.hint}>
            לחיצה על פריט בוחרת אותו. גרירה או חיצים מזיזים, הידיות או שיפט+חיצים משנים גודל, מקש ר מסובב.
          </p>
        ) : (
          <>
            <span className={styles.toolbarTitle}>{current.label}</span>
            <span className={styles.toolbarMeta}>
              <bdi>{formatSize(current.widthCm, current.depthCm)}</bdi>
              {' · '}
              <bdi>{`מיקום ${metres(current.xCm)} על ${metres(current.yCm)} מ׳`}</bdi>
            </span>
            {current.outside ? <Pill tone={SITE_STATE_TONES.outside} dot>{SITE_STATE_LABELS.outside}</Pill> : null}
            {current.overlapping ? <Pill tone={SITE_STATE_TONES.overlapping} dot>{SITE_STATE_LABELS.overlapping}</Pill> : null}
            {current.shade === null ? null : (
              <Pill tone={SHADE_STATE_TONES[current.shade]} dot>{SHADE_STATE_LABELS[current.shade]}</Pill>
            )}
            <span className={styles.toolbarActions}>
              <Button size="sm" onClick={() => { turn(current); }}>סיבוב</Button>
              <ButtonLink size="sm" href={itemHref({ season }, current.id)}>עריכה</ButtonLink>
              <ButtonLink size="sm" tone="danger" href={removeItemHref({ season }, current.id)}>הסרה</ButtonLink>
            </span>
          </>
        )}
      </div>

      <svg
        ref={svgRef}
        className={styles.canvas}
        viewBox={`${-PAD_CM} ${-PAD_CM} ${viewW} ${viewD}`}
        style={{ aspectRatio: `${viewW} / ${viewD}` }}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="מפת הקאמפ"
        onPointerDown={() => { setSelected(null); }}
      >
        <defs>
          <pattern id={gridId} width={plan.gridCm} height={plan.gridCm} patternUnits="userSpaceOnUse">
            <path d={`M ${plan.gridCm} 0 L 0 0 0 ${plan.gridCm}`} className={styles.gridLine} />
          </pattern>
          <pattern id={majorId} width={MAJOR_CM} height={MAJOR_CM} patternUnits="userSpaceOnUse">
            <path d={`M ${MAJOR_CM} 0 L 0 0 0 ${MAJOR_CM}`} className={styles.gridMajor} />
          </pattern>
        </defs>

        <rect x={0} y={0} width={plan.widthCm} height={plan.depthCm} className={styles.plot} />
        <rect x={0} y={0} width={plan.widthCm} height={plan.depthCm} fill={`url(#${gridId})`} />
        <rect x={0} y={0} width={plan.widthCm} height={plan.depthCm} fill={`url(#${majorId})`} />
        <rect x={0} y={0} width={plan.widthCm} height={plan.depthCm} className={styles.fence} />

        <text
          x={plan.widthCm / 2} y={-PAD_CM / 2}
          className={styles.dimension} fontSize={fontCm} textAnchor="middle"
        >
          {`${metres(plan.widthCm)} מ׳`}
        </text>
        <text
          x={plan.widthCm + PAD_CM / 2} y={plan.depthCm / 2}
          className={styles.dimension} fontSize={fontCm} textAnchor="middle"
          transform={`rotate(90 ${plan.widthCm + PAD_CM / 2} ${plan.depthCm / 2})`}
        >
          {`${metres(plan.depthCm)} מ׳`}
        </text>

        {drawn.map((item) => {
          const shade = item.kind === 'shade' ? shadedRect(toPlaced(item)) : null;
          const isSelected = item.id === selected;
          const group = SITE_KINDS[item.kind].group;
          return (
            <g
              key={item.id}
              className={cx(
                styles.item,
                styles[`group_${group}`],
                item.kind === 'shade' && styles.shade,
                isSelected && styles.selected,
                item.outside && styles.outside,
                item.overlapping && styles.overlapping,
                item.shade === 'partly' && styles.partly,
              )}
              transform={`translate(${item.xCm} ${item.yCm})`}
              tabIndex={0}
              role="button"
              aria-label={describe(item)}
              aria-pressed={isSelected}
              onPointerDown={(event) => { beginDrag(event, item, 'move', 'se'); }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(event) => { onKeyDown(event, item); }}
              onFocus={() => { setSelected(item.id); }}
            >
              <rect width={item.widthCm} height={item.depthCm} rx={fontCm / 4} className={styles.body} />
              {shade === null ? null : (
                <rect
                  x={shade.x - item.xCm} y={shade.y - item.yCm}
                  width={shade.width} height={shade.depth}
                  className={styles.shadeCore}
                />
              )}
              <text
                x={item.widthCm / 2} y={item.depthCm / 2}
                className={styles.label} fontSize={fontCm} textAnchor="middle"
              >
                {item.label}
              </text>
              <text
                x={item.widthCm / 2} y={item.depthCm / 2 + fontCm}
                className={styles.caption} fontSize={fontCm * 0.75} textAnchor="middle"
              >
                {shade === null
                  ? formatSize(item.widthCm, item.depthCm)
                  : `${formatSize(item.widthCm, item.depthCm)} · בצל ${metres(shade.width)} × ${metres(shade.depth)}`}
                {item.shade !== null && item.shade !== 'shaded' ? ` · ${SHADE_STATE_LABELS[item.shade]}` : ''}
              </text>

              {isSelected ? HANDLES.map((handle) => {
                const [fx, fy] = HANDLE_AT[handle];
                return (
                  <rect
                    key={handle}
                    x={fx * item.widthCm - handleCm / 2}
                    y={fy * item.depthCm - handleCm / 2}
                    width={handleCm} height={handleCm}
                    className={styles.handle}
                    data-handle={handle}
                    aria-hidden="true"
                    onPointerDown={(event) => { beginDrag(event, item, 'resize', handle); }}
                  >
                    <title>{HANDLE_LABELS[handle]}</title>
                  </rect>
                );
              }) : null}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
