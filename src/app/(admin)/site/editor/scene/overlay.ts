import type { ScreenBox } from '@/lib/site/editor/camera';

/**
 * The flat marks drawn over the scene in screen space: resize handles, snap
 * guides, gap and measure lines with their readouts, the selection box, the
 * dots under a grouped label. Plain DOM, redrawn by the engine after each
 * frame — never through React, which would re-render the editor sixty times
 * a second during a drag. Colours are classes from `scene.module.css`, so
 * they come from `tokens.css` and follow the theme.
 */

export interface OverlayClasses {
  overlay: string;
  handle: string;
  guide: string;
  gap: string;
  measure: string;
  marquee: string;
  dot: string;
  member: string;
  pills: string;
  pill: string;
  pillGuide: string;
  pillFocus: string;
  pillBad: string;
}

export interface OverlayModel {
  handles: Array<{ x: number; y: number }>;
  lines: Array<{ from: [number, number]; to: [number, number]; kind: 'guide' | 'gap' | 'measure' }>;
  dots: Array<{ x: number; y: number; kind: 'measure' | 'member' }>;
  pills: Array<{ x: number; y: number; text: string; tone: 'guide' | 'focus' | 'bad' }>;
  marquee: ScreenBox | null;
}

export const EMPTY_OVERLAY: OverlayModel = { handles: [], lines: [], dots: [], pills: [], marquee: null };

const SVG = 'http://www.w3.org/2000/svg';

function svg(name: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export class OverlayLayer {
  private readonly svg: SVGSVGElement;
  private readonly pills: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly classes: OverlayClasses) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', classes.overlay);
    this.svg.setAttribute('aria-hidden', 'true');
    this.pills = document.createElement('div');
    this.pills.className = classes.pills;
    this.pills.setAttribute('aria-hidden', 'true');
    parent.append(this.svg, this.pills);
  }

  draw(model: OverlayModel): void {
    const c = this.classes;
    const marks: SVGElement[] = [];
    if (model.marquee !== null) {
      const box = model.marquee;
      marks.push(svg('rect', { class: c.marquee, x: box.l, y: box.t, width: box.r - box.l, height: box.b - box.t }));
    }
    for (const line of model.lines) {
      marks.push(svg('line', {
        class: c[line.kind], x1: line.from[0], y1: line.from[1], x2: line.to[0], y2: line.to[1],
      }));
    }
    for (const dot of model.dots) {
      marks.push(svg('circle', { class: dot.kind === 'measure' ? c.dot : c.member, cx: dot.x, cy: dot.y, r: dot.kind === 'measure' ? 3.5 : 2.6 }));
    }
    for (const handle of model.handles) {
      marks.push(svg('rect', { class: c.handle, x: handle.x - 4.5, y: handle.y - 4.5, width: 9, height: 9, rx: 1.5 }));
    }
    this.svg.replaceChildren(...marks);

    const pills = model.pills.map((pill) => {
      const node = document.createElement('div');
      node.className = `${c.pill} ${pill.tone === 'bad' ? c.pillBad : pill.tone === 'focus' ? c.pillFocus : c.pillGuide}`;
      node.textContent = pill.text;
      node.style.transform = `translate(${Math.round(pill.x)}px, ${Math.round(pill.y)}px) translate(-50%, -50%)`;
      return node;
    });
    this.pills.replaceChildren(...pills);
  }

  dispose(): void {
    this.svg.remove();
    this.pills.remove();
  }
}
