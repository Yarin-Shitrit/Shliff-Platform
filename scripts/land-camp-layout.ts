/**
 * Lands the hand-drawn camp layout on a season's map, as data.
 *
 * The source is the 26 × 24 m sketch from 2026-09-25 (graph paper, one cell
 * = 0.5 m), landed on the 32 × 24 m plot the camp was given: one shade sail
 * over the whole 28 × 20 m built area with a 2 m margin for its guy lines, a sofa lounge in the north-west corner, sixteen
 * 2.3 m tents in facing rows on the east, showers and a sink on the east
 * edge, the kitchen, dressing area, stalls and water tanks down the west
 * side, and four caravans along the south. Every number below is that sketch read off the
 * grid — `notes` on each item says so — and the readings the sketch leaves
 * unclear are labelled as unclear rather than guessed (product rule: the
 * system never guesses).
 *
 * This is a script and not a migration or a seed because the map is a
 * season's data, not the schema's: it is created once, through the same
 * library the editor writes with (`createPlan`, `applySiteOps`), so every
 * refusal the editor would raise — a side below 10 cm, a duplicate id, a
 * season that already has a map — this raises too. It edits nothing under
 * `src/lib/site` or `src/app/(admin)/site`.
 *
 * ## Modes
 *
 * The dry run is a full rehearsal, not a print-out: it applies the whole
 * layout to a throwaway in-memory Postgres (the same PGlite the test suite
 * uses, with every migration in `drizzle/`), then reads back what the map
 * library derives — items, outside the fence, overlapping pairs. Those
 * counts are the library's arithmetic, not this file's, which is what makes
 * them worth printing.
 *
 * `--commit` does the same against `DATABASE_URL`, in the library's own
 * transaction. It refuses when the season already has a map, unless
 * `--replace` is passed too: then that map and everything on it are deleted
 * first and the sketch is landed fresh. Edits made in the editor since the
 * last landing are gone with it, so `--replace` is for when the sketch is
 * still the truth.
 *
 * ## Usage
 *
 *   npx tsx scripts/land-camp-layout.ts                        # dry run, "ברן 26"
 *   npx tsx scripts/land-camp-layout.ts "ברן 26"               # dry run, named season
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/land-camp-layout.ts "ברן 26" --commit --actor=lead@shliff.camp
 *   npx tsx scripts/land-camp-layout.ts "ברן 26" --commit --replace   # land it again
 *
 * The database must be at migration 0012 (`site_plans.version`,
 * `site_kind_defaults`): the commit refuses with the plain Postgres error
 * otherwise, and `docs/deploy.md` §6 says how the migrations are applied.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sitePlans, type SiteItemKind } from '@/db/schema/site';
import { seasons } from '@/db/schema/camp';
import type { AnyDb } from '@/lib/db-types';
import { derive } from '@/lib/site/derive';
import type { EditorItem } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import { applySiteOps, createPlan, listItems, planForSeason } from '@/lib/site/plan';

// ---------------------------------------------------------------------------
// The sketch, in centimetres. Origin is the plot's north-west corner; x runs
// east, y runs south, the way the map library reads them. The plot's "up" is
// taken as north (northDeg 0) — the sketch has no compass.
// ---------------------------------------------------------------------------

export const SKETCH_DATE = '2026-09-25';

/**
 * The sketch is drawn at 26 × 24 m. The plot the camp was given is 32 × 24
 * (the lead, 2026-09-25), so the sketch's west column stays where it is and
 * the east block — tents, showers, caravans — takes the extra six metres.
 * The 2 m guy-line margin holds on every side, so the built area is 28 × 20.
 */
export const SKETCH_PLOT = {
  widthCm: 3200,
  depthCm: 2400,
  gridCm: 50,
  northDeg: 0,
  notes: `מהסקיצה ${SKETCH_DATE} (צוירה 26×24 מ׳), על מגרש של 32×24 מ׳ לפי ראש הקאמפ. `
    + 'שוליים של 2 מ׳ מכל צד למיתרי הציליה; השטח הבנוי בפנים 28×20 מ׳. '
    + 'העמודה המערבית כמו בסקיצה; האוהלים, המקלחות והקראוונים נפרשו מזרחה.',
};

interface SketchItem {
  kind: SiteItemKind;
  label: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  /** Only where the sketch or the lead says so; otherwise the kind's height. */
  heightCm?: number;
  /** What the sketch left unclear about this item, in the lead's language. */
  unclear?: string;
}

const FROM_SKETCH = `מהסקיצה ${SKETCH_DATE}`;

function repeat(
  kind: SiteItemKind, labelBase: string, size: [number, number], at: Array<[number, number]>,
  from = 1,
): SketchItem[] {
  return at.map(([xCm, yCm], index) => ({
    kind, label: `${labelBase} ${from + index}`, xCm, yCm, widthCm: size[0], depthCm: size[1],
  }));
}

/**
 * Draw order is the order here: the shade net first (sort 0) so everything in
 * the lounge is drawn over it, then the lounge, the tents, and the rest.
 */
export function sketchItems(): SketchItem[] {
  return [
    // -- One shade over the whole built area ----------------------------------
    // The sketch's 2 m margin on every side is labelled "מיתרים ציליה": the
    // guy lines of a sail that covers the inner 22 × 20 m. It is drawn first
    // (sort 0) and stands at 4 m, above the tallest thing under it (a caravan
    // at 2.7 m).
    {
      kind: 'shade', label: 'ציליה ראשית', xCm: 200, yCm: 200, widthCm: 2800, depthCm: 2000, heightCm: 400,
    },
    // -- The lounge: the 8 × 10 m blue box in the north-west corner ---------
    // Drawn as a lower net of its own under the main sail; the sketch's word
    // for it is not certain, so the note says so.
    {
      kind: 'shade', label: 'רשת צל · שיין', xCm: 200, yCm: 200, widthCm: 800, depthCm: 1000, heightCm: 280,
      unclear: 'הכיתוב בסקיצה "שיין" — לא ברור אם זה שם הפינה, רשת נפרדת מתחת לציליה הראשית, או משהו אחר',
    },
    // Sofas along the net's north and south edges lie east–west (2 × 0.9);
    // the ones down its sides are turned (0.9 × 2).
    ...repeat('sofa', 'ספה', [200, 90], [[300, 200], [700, 200]]),
    ...repeat('sofa', 'ספה', [90, 200], [[200, 300], [500, 300], [600, 300], [910, 300]], 3),
    ...repeat('sofa', 'ספה', [90, 200], [[200, 600], [500, 600], [600, 600], [910, 600]], 7),
    ...repeat('sofa', 'ספה', [200, 90], [[300, 800], [700, 800], [300, 900], [700, 900]], 11),
    ...repeat('sofa', 'ספה', [90, 200], [[200, 1000], [500, 1000], [600, 1000], [910, 1000]], 15),
    // Two tables the sketch labels, four smaller squares it does not.
    ...repeat('table', 'שולחן', [130, 100], [[350, 350], [750, 350]]),
    ...repeat('table', 'שולחן', [90, 90], [[370, 650], [760, 650], [360, 1050], [760, 1050]], 3)
      .map((item) => ({ ...item, unclear: 'ריבוע קטן ללא כיתוב בסקיצה; נקרא כשולחן' })),

    // -- Sixteen 2.3 × 2.3 m tents in facing pairs, openings on the paths ---
    // The sketch draws each tent in a 2.5 m cell; the camp's tents are 2.3 m,
    // so each stands centred in its cell with 10 cm to spare on every side.
    // Rows one and two face each other across a 2 m path; rows three and
    // four across a 1.5 m one. Rows two and three stand back to back. The
    // block sits 3 m further east than the sketch draws it, in the wider plot.
    ...repeat('tent', 'אוהל', [230, 230], [
      [1460, 210], [1710, 210], [1960, 210], [2210, 210], [2460, 210],
      [1460, 660], [1710, 660], [1960, 660], [2210, 660], [2460, 660],
      [1460, 910], [1710, 910], [1960, 910],
      [1460, 1310], [1710, 1310], [1960, 1310],
    ]),

    // -- Showers and a sink on the east edge ---------------------------------
    { kind: 'shower', label: 'מקלחת 1', xCm: 2800, yCm: 1050, widthCm: 200, depthCm: 200 },
    { kind: 'shower', label: 'מקלחת 2', xCm: 2800, yCm: 1250, widthCm: 200, depthCm: 250 },
    {
      kind: 'other', label: 'כיור', xCm: 2700, yCm: 1250, widthCm: 100, depthCm: 250,
      unclear: 'הכיתוב המסובב בסקיצה ליד המקלחות לא קריא בוודאות; נקרא "כיור"',
    },

    // -- Down the west side: chairs, two unnamed boxes, kitchen, dressing ---
    ...repeat('other', 'כיסא', [60, 60], [[320, 1320], [420, 1320], [520, 1320]]),
    {
      kind: 'generator', label: 'גנרטור', xCm: 10, yCm: 1440, widthCm: 60, depthCm: 60,
      unclear: 'עיגול קטן בשוליים המערביים עם כיתוב אדום מסובב; נקרא "גנרטור"',
    },
    ...repeat('other', 'לא מזוהה', [200, 100], [[200, 1450], [400, 1450]])
      .map((item) => ({ ...item, unclear: 'מלבן אפור ללא כיתוב בסקיצה, מתחת לכיסאות' })),
    {
      kind: 'kitchen', label: 'מטבח', xCm: 200, yCm: 1550, widthCm: 600, depthCm: 250,
      unclear: 'הכיתוב הצהוב המסובב לא קריא בוודאות; נקרא "מטבח"',
    },
    {
      kind: 'changing', label: 'אזור הלבשה', xCm: 300, yCm: 1800, widthCm: 600, depthCm: 300,
      unclear: 'בסקיצה, בתוך האזור לאורך הצד הדרומי: "מקלחית" (כ-4×1.25 מ׳)',
    },

    // -- Stalls and water along the south-west --------------------------------
    { kind: 'toilet', label: 'תא שירותים 1', xCm: 470, yCm: 2100, widthCm: 110, depthCm: 100 },
    {
      kind: 'other', label: 'מי ניקוי', xCm: 580, yCm: 2100, widthCm: 110, depthCm: 100,
      unclear: 'הכיתוב בסקיצה בין שני התאים לא קריא בוודאות; נקרא "מי ניקוי"',
    },
    { kind: 'toilet', label: 'תא שירותים 2', xCm: 690, yCm: 2100, widthCm: 110, depthCm: 100 },
    { kind: 'greywater', label: 'מים אפורים', xCm: 320, yCm: 2200, widthCm: 150, depthCm: 150 },
    ...repeat('water', 'מי שתייה', [150, 150], [[480, 2200], [630, 2200]]),

    // -- Four caravans along the south, 2.5 wide × 6.5 deep, 5 m apart -------
    ...repeat('caravan', 'קראוון', [250, 650], [[1150, 1650], [1650, 1650], [2150, 1650], [2650, 1650]]),
  ];
}

export function toEditorItems(items: readonly SketchItem[]): EditorItem[] {
  return items.map((item, sort) => ({
    id: randomUUID(),
    kind: item.kind,
    label: item.label,
    xCm: item.xCm,
    yCm: item.yCm,
    widthCm: item.widthCm,
    depthCm: item.depthCm,
    heightCm: item.heightCm ?? null,
    insetCm: null,
    sort,
    taskId: null,
    locked: false,
    notes: item.unclear === undefined ? FROM_SKETCH : `${FROM_SKETCH}. לא ברור: ${item.unclear}`,
  }));
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

export interface Landed {
  planId: string;
  version: number;
  items: number;
  outside: number;
  overlapPairs: number;
  unclear: number;
}

/**
 * One plot and every item, through the library. Throws the library's own
 * refusal when the season already has a map — unless `replace` is set, in
 * which case that map goes first, items and all (the schema cascades), and
 * the sketch is landed fresh. Replacing is the one thing here the library
 * has no verb for, so it is the one raw delete, and it is opt-in.
 */
export async function landSketch(
  db: AnyDb, seasonId: string, actor: string, replace = false,
): Promise<Landed> {
  if (replace) await db.delete(sitePlans).where(eq(sitePlans.seasonId, seasonId));
  const planId = await createPlan(db, seasonId, SKETCH_PLOT, actor);
  const items = toEditorItems(sketchItems());
  const ops: SiteOp[] = items.map((item) => ({ type: 'add', item }));
  const result = await applySiteOps(db, planId, 0, ops, actor);
  if (result.status !== 'saved') {
    throw new Error(`the plan was created a moment ago and is already at version ${result.version}`);
  }

  const rows = await listItems(db, planId);
  const derived = derive(SKETCH_PLOT, rows);
  return {
    planId,
    version: result.version,
    items: derived.counts.items,
    outside: derived.counts.outside,
    overlapPairs: derived.counts.overlapPairs,
    unclear: rows.filter((row) => row.notes?.includes('לא ברור')).length,
  };
}

async function seasonNamed(db: AnyDb, name: string): Promise<{ id: string; name: string }> {
  const [season] = await db.select({ id: seasons.id, name: seasons.name })
    .from(seasons).where(eq(seasons.name, name)).limit(1);
  if (!season) throw new Error(`no season named "${name}" in this database`);
  return season;
}

const say = (line = ''): void => { console.log(line); };

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commit = argv.includes('--commit');
  const replace = argv.includes('--replace');
  const actor = argv.find((arg) => arg.startsWith('--actor='))?.slice('--actor='.length)
    ?? 'land-camp-layout';
  const seasonName = argv.find((arg) => !arg.startsWith('--')) ?? 'ברן 26';

  const items = sketchItems();
  say(`# Landing the ${SKETCH_DATE} sketch on the map of "${seasonName}"`);
  say(`plot ${SKETCH_PLOT.widthCm / 100} × ${SKETCH_PLOT.depthCm / 100} m, grid ${SKETCH_PLOT.gridCm} cm, `
    + `${items.length} items`);
  say(commit
    ? 'MODE: --commit, against DATABASE_URL.'
    : 'MODE: dry run, against a throwaway in-memory database. Pass --commit to land it for real.');
  say(`actor: ${actor}`);
  say();

  const byKind = new Map<string, number>();
  for (const item of items) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  for (const [kind, count] of byKind) say(`  ${kind.padEnd(10)} ${count}`);
  say();

  let db: AnyDb;
  let season: { id: string; name: string };
  if (commit) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    // Imported here, not at the top: `@/db` connects at import time.
    db = (await import('@/db')).db;
    season = await seasonNamed(db, seasonName);
    const existing = await planForSeason(db, season.id);
    if (existing && !replace) {
      throw new Error(`"${season.name}" already has a map (${existing.id}, version ${existing.version}). `
        + 'Pass --replace to delete it and land the sketch again, or delete it in the app first.');
    }
    if (existing) say(`replacing map ${existing.id} (version ${existing.version}) and everything on it`);
  } else {
    // The test suite's in-memory Postgres, with every migration applied.
    const { createTestDb } = await import('@/test/db');
    db = await createTestDb();
    const [row] = await db.insert(seasons)
      .values({ name: seasonName, year: 2026, flatRate: '0.00' }).returning();
    season = { id: row.id, name: row.name };
  }

  const landed = await landSketch(db, season.id, actor, commit && replace);
  say('## Landed');
  say(`plan ${landed.planId}, version ${landed.version}`);
  say(`items ${landed.items}, outside the fence ${landed.outside}, overlapping pairs ${landed.overlapPairs}`);
  say(`items whose notes say what the sketch left unclear: ${landed.unclear}`);
  if (landed.outside > 0 || landed.overlapPairs > 0) {
    say('The map library flags something above — open /site and read the checks bar before trusting this.');
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/land-camp-layout.ts') ?? false;
if (invokedDirectly) {
  main().then(
    () => process.exit(0),
    (error) => { console.error(error); process.exit(1); },
  );
}
