import { ACT_PARAM, PEEK_PARAM } from '@/components/ui/drawer-url';

/**
 * The build screen's URL. Smaller than the other two: this screen has no
 * search and no sort, because its order is the argument — what is blocked
 * first, then what is due soonest — and a lead who can re-sort it can lose
 * that. The artboard draws no toolbar for the same reason.
 *
 * What it does carry is the season (R5) and one drawer.
 */

export const BUILD_PATH = '/logistics/build';

/** `?peek=<taskId>&act=material`: adding a requirement to one task. */
export const MATERIAL_ACT = 'material';

export interface BuildQuery {
  season: string;
  /** The task a drawer is open over. */
  peek: string | null;
  adding: boolean;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseBuildQuery(params: RawParams): BuildQuery {
  const peek = one(params[PEEK_PARAM]) || null;
  return {
    season: one(params.season),
    peek,
    /* No task, no drawer. `?act=material` on its own would ask a lead which
       thing to add to nothing in particular. */
    adding: peek !== null && one(params[ACT_PARAM]) === MATERIAL_ACT,
  };
}

const KEYS = ['season'] as const;
type PatchKey = (typeof KEYS)[number] | typeof PEEK_PARAM | typeof ACT_PARAM;

export function buildHref(
  params: RawParams,
  patch: Partial<Record<PatchKey, string | null>>,
): string {
  const next = new URLSearchParams();
  for (const key of KEYS) {
    const value = one(params[key]);
    if (value) next.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }

  const qs = next.toString();
  return qs ? `${BUILD_PATH}?${qs}` : BUILD_PATH;
}

/** The drawer that adds a requirement to one task. */
export function addMaterialHref(params: RawParams, taskId: string): string {
  return buildHref(params, { [PEEK_PARAM]: taskId, [ACT_PARAM]: MATERIAL_ACT });
}
