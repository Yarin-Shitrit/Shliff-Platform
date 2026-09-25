import type { SiteLineKind } from '@/db/schema/site';
import type { SiteKindGroup } from '@/lib/site/kinds';

/**
 * The scene's own colours, light and dark — scoped data like the series
 * palette in `charts.module.css`'s `.viz`, and for the same reason: WebGL
 * cannot read a CSS custom property, and these colours paint only the 3D map.
 * Everything drawn in the DOM over the scene (labels, handles, guides) takes
 * its colours from `tokens.css` instead (`scene.module.css`).
 *
 * Transcribed from the mock (`6a-data.js`, `THEME` and `GROUP_COL`). Where the
 * mock blends a translucent line over the plot, the value here is that blend,
 * precomputed, so the ground can be drawn opaque and never flicker.
 */
export type SceneTheme = 'light' | 'dark';

export interface ScenePalette {
  outside: string;
  plot: string;
  gridMinor: string;
  gridMajor: string;
  fence: string;
  edge: string;
  selected: string;
  hover: string;
  bad: string;
  warn: string;
  cloth: string;
  clothEdge: string;
  shadeGround: string;
  guide: string;
  /** A fire's top. */
  ember: string;
  /** The soft patch under a solid while shade by hour is off. */
  contact: string;
  groups: Record<SiteKindGroup, string>;
  /** The pipes and cables on the ground: water blue, power amber — apart from every group colour, in both themes. */
  lines: Record<SiteLineKind, string>;
}

export const SCENE_PALETTE: Record<SceneTheme, ScenePalette> = {
  light: {
    outside: '#E6DDCF',
    plot: '#F4EDE2',
    gridMinor: '#E7DED2',
    gridMajor: '#D4CABD',
    fence: '#8C7B6B',
    edge: '#7D6D5E',
    selected: '#C8570F',
    hover: '#FFFFFF',
    bad: '#B42318',
    warn: '#B7770B',
    cloth: '#604A36',
    clothEdge: '#988877',
    shadeGround: '#E4DBCF',
    guide: '#2458C6',
    ember: '#E8743B',
    contact: '#46321E',
    groups: { sleep: '#E6D0A6', living: '#EDBF98', sanitation: '#B4CDEE', utility: '#B7D9C3', other: '#D5C4EA' },
    lines: { water: '#2F6FD6', power: '#D9861A' },
  },
  dark: {
    outside: '#141211',
    plot: '#1D1A17',
    gridMinor: '#282521',
    gridMajor: '#38342F',
    fence: '#A39B93',
    edge: '#C9BBA8',
    selected: '#F08A4B',
    hover: '#FFFFFF',
    bad: '#F2877C',
    warn: '#F0C05A',
    cloth: '#EBD7BE',
    clothEdge: '#7A6F62',
    shadeGround: '#171412',
    guide: '#7FA8F5',
    ember: '#C8612B',
    contact: '#000000',
    groups: { sleep: '#7C6948', living: '#83593D', sanitation: '#44607F', utility: '#42685A', other: '#5D4D78' },
    lines: { water: '#6FA3F0', power: '#F0B453' },
  },
};

/** The two colours the scene draws see-through, and how much. */
export const SCENE_ALPHA: Record<SceneTheme, { cloth: number; contact: number }> = {
  light: { cloth: 0.18, contact: 0.14 },
  dark: { cloth: 0.11, contact: 0.35 },
};

/**
 * The lights' colours, the same in both themes: a white sky, warm light
 * bounced off the playa, and a slightly warm sun (spec §7, "Lighting").
 */
export const SCENE_LIGHT = { sky: '#FFFFFF', ground: '#A89C8A', sun: '#FFF4E0' } as const;
