import type { ScreenBox } from './camera';

/**
 * Places the map's labels so that no two overlap, at any zoom, in either view
 * (spec §9). Pure: screen rectangles in, screen rectangles out. The DOM layer
 * draws exactly what it is given and nothing else.
 *
 * What the caller decides, because it knows the selection and the scene:
 * - which items get a label at all — an item under 3 px on screen gets none
 *   unless it is selected or hovered (§9.6);
 * - each label's text (the selected item's with its size, "3 × 3 מ׳", §9.7),
 *   measured size (padding included) and anchor — a net's anchor is the
 *   middle of its north edge, so its label never sits on the furniture under
 *   it (§9.1);
 * - `priority`, higher placed first: selected, then hovered, then items with
 *   a problem, then larger footprints, nets last (§9.1);
 * - `groupKey` and `groupNoun`: items that may merge into one label share a
 *   key (the kind and base label) and give the kind's plural. Selected,
 *   hovered and problem items, and nets, get `groupKey: null` — they are
 *   always labelled on their own.
 *
 * What this decides: the slot for each label, in the order of §9.2; which
 * same-kind neighbours become one label; and whether last frame's slot still
 * works, which is tried first so labels do not jump while the view turns.
 */

export interface LabelInput {
  id: string;
  text: string;
  width: number;
  height: number;
  anchor: [number, number];
  box: ScreenBox;
  priority: number;
  groupKey: string | null;
  groupNoun: string | null;
  isNet: boolean;
}

export interface PlacedLabel {
  key: string;
  ids: string[];
  text: string;
  rect: ScreenBox;
  anchor: [number, number];
  leader: boolean;
  group: boolean;
  slot: string;
}

export interface LayoutOptions {
  bounds: ScreenBox;
  obstacles: readonly ScreenBox[];
  previous: ReadonlyMap<string, string>;
  measure: (text: string) => number;
  labelHeight: number;
}

/** Inside; above; below; the two sides; the four corners; a row further out above and below (§9.2). */
const SLOTS = ['in', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'nn', 'ss'] as const;
type Slot = (typeof SLOTS)[number];
/** Where a group's members try first: close to their own item. */
const NEAR_SLOTS: readonly Slot[] = ['in', 'n', 's'];

/** Between a label and its item's edge. */
const GAP_PX = 7;
/** How far a corner label tucks back over its item, so it still reads as that item's. */
const TUCK_PX = 4;
/** The least room a label keeps from the item's edge when it sits inside. */
const INSET_PX = 2;
/** The least room between two labels. */
const SPACING_PX = 2;

/** A label about to be placed: one item, or a group of them. */
interface Unit {
  key: string;
  ids: string[];
  text: string;
  width: number;
  height: number;
  anchor: [number, number];
  box: ScreenBox;
  isNet: boolean;
  group: boolean;
}

function rectAround(cx: number, cy: number, width: number, height: number): ScreenBox {
  return { l: cx - width / 2, t: cy - height / 2, r: cx + width / 2, b: cy + height / 2 };
}

/** Strict: labels that only touch do not collide. `pad` widens `b` on every side. */
function hits(a: ScreenBox, b: ScreenBox, pad: number): boolean {
  return a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
}

function slotRect(slot: Slot, unit: Unit): ScreenBox | null {
  const [ax, ay] = unit.anchor;
  const { box, width: w, height: h } = unit;
  switch (slot) {
    case 'in': {
      // A net's anchor is its north edge, so its label hangs just inside it.
      const rect = rectAround(ax, unit.isNet ? ay + TUCK_PX + h / 2 : ay, w, h);
      const fits = rect.l >= box.l + INSET_PX && rect.r <= box.r - INSET_PX
        && rect.t >= box.t + INSET_PX && rect.b <= box.b - INSET_PX;
      return fits ? rect : null;
    }
    case 'n': return rectAround(ax, box.t - GAP_PX - h / 2, w, h);
    case 's': return rectAround(ax, box.b + GAP_PX + h / 2, w, h);
    case 'e': return rectAround(box.r + GAP_PX + w / 2, ay, w, h);
    case 'w': return rectAround(box.l - GAP_PX - w / 2, ay, w, h);
    case 'ne': return rectAround(box.r + w / 2 - TUCK_PX, box.t - GAP_PX - h / 2, w, h);
    case 'nw': return rectAround(box.l - w / 2 + TUCK_PX, box.t - GAP_PX - h / 2, w, h);
    case 'se': return rectAround(box.r + w / 2 - TUCK_PX, box.b + GAP_PX + h / 2, w, h);
    case 'sw': return rectAround(box.l - w / 2 + TUCK_PX, box.b + GAP_PX + h / 2, w, h);
    case 'nn': return rectAround(ax, box.t - GAP_PX * 3 - h * 1.5, w, h);
    case 'ss': return rectAround(ax, box.b + GAP_PX * 3 + h * 1.5, w, h);
  }
}

/** The slots to try, last frame's first when it is among them (§9.5). */
function slotOrder(previous: string | undefined, near: boolean): readonly Slot[] {
  const base = near ? NEAR_SLOTS : SLOTS;
  const at = base.findIndex((slot) => slot === previous);
  return at <= 0 ? base : [base[at], ...base.slice(0, at), ...base.slice(at + 1)];
}

class Board {
  readonly placed: PlacedLabel[] = [];

  constructor(private readonly options: LayoutOptions) {}

  private free(rect: ScreenBox): boolean {
    const { bounds, obstacles } = this.options;
    if (rect.l < bounds.l || rect.r > bounds.r || rect.t < bounds.t || rect.b > bounds.b) return false;
    for (const obstacle of obstacles) if (hits(rect, obstacle, 0)) return false;
    for (const label of this.placed) if (hits(rect, label.rect, SPACING_PX)) return false;
    return true;
  }

  place(unit: Unit, near: boolean): boolean {
    for (const slot of slotOrder(this.options.previous.get(unit.key), near)) {
      const rect = slotRect(slot, unit);
      if (rect === null || !this.free(rect)) continue;
      this.placed.push({
        key: unit.key, ids: unit.ids, text: unit.text, rect, anchor: unit.anchor,
        leader: slot !== 'in', group: unit.group, slot,
      });
      return true;
    }
    return false;
  }

  /** Forget everything placed after `mark` — a group whose members did not all fit near. */
  rollBack(mark: number): void {
    this.placed.length = mark;
  }
}

function unitOf(input: LabelInput): Unit {
  return {
    key: input.id, ids: [input.id], text: input.text, width: input.width, height: input.height,
    anchor: input.anchor, box: input.box, isNet: input.isNet, group: false,
  };
}

/**
 * Same-key neighbours whose labels, centred on their anchors, would collide
 * (§9.4). Connected, not pairwise: in a row of twenty toilets each touches
 * the next, and all twenty are one group.
 */
function clusters(inputs: readonly LabelInput[]): number[][] {
  const parent = inputs.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    parent[index] = root;
    return root;
  };
  const byKey = new Map<string, number[]>();
  inputs.forEach((input, index) => {
    if (input.groupKey === null || input.groupNoun === null || input.isNet) return;
    const members = byKey.get(input.groupKey);
    if (members) members.push(index); else byKey.set(input.groupKey, [index]);
  });
  const centred = inputs.map((input) => rectAround(input.anchor[0], input.anchor[1], input.width, input.height));
  for (const members of byKey.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        if (hits(centred[members[i]], centred[members[j]], SPACING_PX)) parent[find(members[i])] = find(members[j]);
      }
    }
  }
  const out = new Map<number, number[]>();
  inputs.forEach((_, index) => {
    const root = find(index);
    const members = out.get(root);
    if (members) members.push(index); else out.set(root, [index]);
  });
  return [...out.values()];
}

function groupUnit(members: readonly LabelInput[], options: LayoutOptions): Unit {
  const text = `${members.length} ${members[0].groupNoun}`;
  const ids = members.map((member) => member.id);
  return {
    key: `group:${[...ids].sort().join(',')}`,
    ids,
    text,
    width: options.measure(text),
    height: options.labelHeight,
    anchor: [
      members.reduce((sum, member) => sum + member.anchor[0], 0) / members.length,
      members.reduce((sum, member) => sum + member.anchor[1], 0) / members.length,
    ],
    box: {
      l: Math.min(...members.map((member) => member.box.l)),
      t: Math.min(...members.map((member) => member.box.t)),
      r: Math.max(...members.map((member) => member.box.r)),
      b: Math.max(...members.map((member) => member.box.b)),
    },
    isNet: false,
    group: true,
  };
}

export function layoutLabels(inputs: readonly LabelInput[], options: LayoutOptions): PlacedLabel[] {
  const board = new Board(options);
  const units = clusters(inputs)
    .map((members) => ({
      members,
      priority: Math.max(...members.map((index) => inputs[index].priority)),
      first: Math.min(...members),
    }))
    .sort((a, b) => b.priority - a.priority || a.first - b.first);

  for (const { members } of units) {
    if (members.length === 1) {
      board.place(unitOf(inputs[members[0]]), false);
      continue;
    }
    // A group first tries every member close to its own item (§9.4) ...
    const ordered = [...members].sort((a, b) => inputs[b].priority - inputs[a].priority || a - b);
    const mark = board.placed.length;
    if (ordered.every((index) => board.place(unitOf(inputs[index]), true))) continue;
    // ... and if any does not fit, shows one label for all of them instead.
    board.rollBack(mark);
    board.place(groupUnit(members.map((index) => inputs[index]), options), false);
  }
  return board.placed;
}
