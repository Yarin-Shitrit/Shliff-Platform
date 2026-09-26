import * as THREE from 'three';
import { itemHeight } from '@/lib/site/defaults';
import { toPlaced } from '@/lib/site/derive';
import { rectOf, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { printSpots } from '@/lib/site/editor/prints';
import { SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { linePath } from '@/lib/site/lines';
import {
  buildItemObject, buildLineObject, disposeObject, geometryKey, lineGeometryKey, restyleItemObject, restyleLineObject,
  worldOf, type ItemLook, type LineLook,
} from './meshes';
import type { SceneTheme } from './palette';
import type { PrintRasteriser } from './print-texture';
import { applyPrints, clearPrints } from './prints';
import type { LabelMode } from './scene-view';

export interface SyncInput {
  doc: EditorDoc;
  /** Where a drag or a handle has an item right now; the store is not touched until the drop. */
  preview: ReadonlyMap<string, { xCm: number; yCm: number; widthCm: number; depthCm: number }>;
  selection: ReadonlySet<string>;
  hover: string | null;
  flags: { outside: ReadonlySet<string>; overlapping: ReadonlySet<string> };
  hiddenGroups: ReadonlySet<SiteKindGroup>;
  netsHidden: boolean;
  theme: SceneTheme;
  /** Shade by hour is on (spec §11). */
  sun?: boolean;
  /** How the items are named (plan 2026-09-26-site-label-modes); only 'printed' draws anything here. Floating when absent. */
  labelMode?: LabelMode;
  /** What draws the prints. Null or absent: no prints, whatever the mode — the engine passes one only once 'printed' was asked for. */
  prints?: PrintRasteriser | null;
  /** Bumped by the engine when the web font arrives: part of every print key, so each print is drawn again, once. */
  fontEpoch?: number;
}

function lookKey(look: ItemLook): string {
  return `${look.theme}|${look.state}|${look.issue}|${look.sun === true ? 'sun' : ''}`;
}

/**
 * Whether an item belongs in the scene at all: its group is not hidden, and
 * it is not a net while nets are hidden. A hidden item is REMOVED and
 * disposed, not made invisible — three's raycaster ignores `visible`, so an
 * item merely hidden would still catch a click. The engine (a later task)
 * imports this too, to keep picking and drawing agreed on what is "shown".
 */
export function isShown(item: EditorItem, hiddenGroups: ReadonlySet<SiteKindGroup>, netsHidden: boolean): boolean {
  if (hiddenGroups.has(SITE_KINDS[item.kind].group)) return false;
  return !(netsHidden && SITE_KINDS[item.kind].shape === 'net');
}

/**
 * Keeps the scene in step with the store by id (spec §7): an item new to the
 * doc is built, a moved one is moved, a resized or re-kinded one is rebuilt,
 * a restyled one is recoloured, and one that left — or whose group is hidden
 * — is taken out and freed. It never rebuilds the whole scene.
 */
export class SceneSync {
  readonly root = new THREE.Group();
  private readonly objects = new Map<string, THREE.Group>();
  private readonly looks = new Map<string, string>();
  /**
   * What each item's prints were drawn from — the name and the font epoch —
   * apart from the geometry key, so a rename re-prints without a rebuild
   * and a rebuild re-prints the same name. Empty means no prints.
   */
  private readonly printKeys = new Map<string, string>();
  /** The pipes and cables, by line id, apart from the items so neither map's ids can shadow the other's. */
  private readonly lines = new Map<string, THREE.Group>();
  private readonly lineLooks = new Map<string, string>();

  constructor() {
    this.root.name = 'items';
  }

  sync(input: SyncInput): void {
    const shown = new Set<string>();
    /** Where each shown item is drawn now — its drag preview, else the store's — for the lines that end on it. */
    const drawnRects = new Map<string, EditorItem>();
    for (const item of input.doc.items) {
      if (!isShown(item, input.hiddenGroups, input.netsHidden)) continue;
      shown.add(item.id);
      const rect = input.preview.get(item.id);
      const drawn: EditorItem = rect === undefined ? item : { ...item, ...rect };
      drawnRects.set(item.id, drawn);
      const height = itemHeight(item, input.doc.defaults);
      // A net's ropes: its own angle, else the camp's (spec §12); its height moves them too (D18).
      const ropeCm = toPlaced(drawn, input.doc.defaults).ropeCm;
      const key = geometryKey(drawn, height, ropeCm);
      const look: ItemLook = {
        theme: input.theme,
        state: input.selection.has(item.id) ? 'selected' : input.hover === item.id ? 'hover' : 'normal',
        issue: input.flags.outside.has(item.id) ? 'outside' : input.flags.overlapping.has(item.id) ? 'overlapping' : 'none',
        sun: input.sun === true,
      };

      let object = this.objects.get(item.id);
      if (object !== undefined && object.userData.key !== key) {
        this.drop(item.id);
        object = undefined;
      }
      if (object === undefined) {
        object = buildItemObject(drawn, height, look, ropeCm);
        this.root.add(object);
        this.objects.set(item.id, object);
        this.looks.set(item.id, lookKey(look));
      } else if (this.looks.get(item.id) !== lookKey(look)) {
        restyleItemObject(object, look);
        this.looks.set(item.id, lookKey(look));
      }
      object.position.copy(worldOf(drawn.xCm, drawn.yCm, 0));

      /* The name printed on the faces. A just-built object has no key yet, so
         it is printed; a rebuilt one lost its key with the old object, so it
         is printed again; an unchanged one is left alone. */
      const prints = input.labelMode === 'printed' ? input.prints ?? null : null;
      const printKey = prints === null ? '' : `${drawn.label}|${input.fontEpoch ?? 0}`;
      if (this.printKeys.get(item.id) !== printKey) {
        clearPrints(object);
        if (prints !== null) {
          const spots = printSpots(SITE_KINDS[item.kind].shape, drawn.widthCm, drawn.depthCm, height, drawn.facing, drawn.insetCm);
          applyPrints(object, drawn.label, spots, prints, look);
        }
        this.printKeys.set(item.id, printKey);
      }
    }
    for (const id of [...this.objects.keys()]) {
      if (!shown.has(id)) this.drop(id);
    }

    /* The lines: drawn between where their ends are drawn — a dragged fridge
       takes its cable with it — and only while both ends are shown, so
       hiding the utility group hides the runs to it too. A line whose end
       has left the map is drawn nowhere. */
    const shownLines = new Set<string>();
    for (const line of input.doc.lines) {
      const from = drawnRects.get(line.fromId);
      const to = drawnRects.get(line.toId);
      if (from === undefined || to === undefined) continue;
      shownLines.add(line.id);
      const path = linePath(line.points, rectOf(from), rectOf(to));
      const key = lineGeometryKey(line.kind, path);
      const look: LineLook = {
        theme: input.theme,
        state: input.selection.has(line.id) ? 'selected' : input.hover === line.id ? 'hover' : 'normal',
      };
      let object = this.lines.get(line.id);
      if (object !== undefined && object.userData.key !== key) {
        this.dropLine(line.id);
        object = undefined;
      }
      if (object === undefined) {
        object = buildLineObject(line, path, look);
        this.root.add(object);
        this.lines.set(line.id, object);
        this.lineLooks.set(line.id, `${look.theme}|${look.state}`);
      } else if (this.lineLooks.get(line.id) !== `${look.theme}|${look.state}`) {
        restyleLineObject(object, look);
        this.lineLooks.set(line.id, `${look.theme}|${look.state}`);
      }
    }
    for (const id of [...this.lines.keys()]) {
      if (!shownLines.has(id)) this.dropLine(id);
    }
    // Picking reads world matrices; nothing else updates them before a render.
    this.root.updateMatrixWorld(true);
  }

  objectOf(id: string): THREE.Group | undefined {
    return this.objects.get(id);
  }

  lineObjectOf(id: string): THREE.Group | undefined {
    return this.lines.get(id);
  }

  solidObjects(): THREE.Object3D[] {
    return [...this.objects.values()].filter((object) => object.userData.isNet !== true);
  }

  netObjects(): THREE.Object3D[] {
    return [...this.objects.values()].filter((object) => object.userData.isNet === true);
  }

  lineObjects(): THREE.Object3D[] {
    return [...this.lines.values()];
  }

  dispose(): void {
    for (const id of [...this.objects.keys()]) this.drop(id);
    for (const id of [...this.lines.keys()]) this.dropLine(id);
  }

  private drop(id: string): void {
    const object = this.objects.get(id);
    if (object === undefined) return;
    this.root.remove(object);
    disposeObject(object);
    this.objects.delete(id);
    this.looks.delete(id);
    this.printKeys.delete(id);
  }

  private dropLine(id: string): void {
    const object = this.lines.get(id);
    if (object === undefined) return;
    this.root.remove(object);
    disposeObject(object);
    this.lines.delete(id);
    this.lineLooks.delete(id);
  }
}
