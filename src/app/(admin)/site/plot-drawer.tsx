'use client';

/**
 * The plot: how big the ground is this year, and how fine the grid. One
 * form for creating the map and for resizing it, because they are one set
 * of fields with one set of refusals.
 *
 * Resizing moves nothing. Before the lead saves, the form says how many
 * items the new fence would cut through — computed here, from the rows the
 * page handed over, with the same function the server uses — so the
 * decision is made with the number in front of them rather than discovered
 * on the map afterwards.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { SourceChip } from '@/components/ui/source-chip';
import { useToast } from '@/components/ui/toaster';
import {
  areaM2, formatArea, formatSize, fourSidedPlot, outsideIds, type Plot, type PlotSides,
} from '@/lib/site/geometry';
import { toPlaced, type ItemShape } from '@/lib/site/derive';
import type { KindDefaults } from '@/lib/site/defaults';
import { createPlanAction, setPlotAction } from './actions';
import { notePlotSaved } from './editor/own-plot-saves';
import { NORTH_INVALID, PLOT_SIDE_INVALID, PLOT_SIDES_OPEN } from './failure-messages';
import styles from './site.module.css';

/**
 * A rectangle, or four sides measured one by one. The camp's ground is 33 m
 * along the north, 35 along the south and 25 down each side, which no
 * width and depth can say.
 */
const SHAPE_OPTIONS = [
  { value: 'rect', label: 'מלבן' },
  { value: 'four', label: 'ארבע צלעות' },
];

const GRID_OPTIONS = [
  { value: '10', label: '10 ס״מ' },
  { value: '25', label: '25 ס״מ' },
  { value: '50', label: '50 ס״מ' },
  { value: '100', label: 'מטר' },
];

/** Metres typed by a lead → whole centimetres. `NaN` stays `NaN` and is refused. */
function toCm(metresText: string): number {
  const value = Number(metresText.trim());
  return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
}

/** The same bounds `plan.ts` keeps: a whole number of centimetres from a metre to half a kilometre. */
function sideOk(cm: number): boolean {
  return Number.isInteger(cm) && cm >= 100 && cm <= 50_000;
}

/** A side's metres as the field shows them: `2498` → `24.98`. */
function metresText(cm: number): string {
  return String(cm / 100);
}

export function PlotDrawer({ seasonId, seasonName, plan, items, defaults = {}, closeHref }: {
  seasonId: string;
  seasonName: string;
  plan: {
    id: string; widthCm: number; depthCm: number; sides: PlotSides | null; gridCm: number; northDeg: number; notes: string | null;
  } | null;
  items: readonly ItemShape[];
  /** The camp's kind defaults: a net's rope footprint takes the camp's angle, so this count agrees with the editor's (spec §14). */
  defaults?: KindDefaults;
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const saved = plan?.sides ?? null;
  const [shape, setShape] = useState<'rect' | 'four'>(saved === null ? 'rect' : 'four');
  const [width, setWidth] = useState(plan === null ? '26' : metresText(plan.widthCm));
  const [depth, setDepth] = useState(plan === null ? '24' : metresText(plan.depthCm));
  /* The four sides start as the rectangle they replace, so switching the
     shape changes nothing until a side is typed. */
  const [northSide, setNorthSide] = useState(saved === null ? width : metresText(saved.northCm));
  const [southSide, setSouthSide] = useState(saved === null ? width : metresText(saved.southCm));
  const [westSide, setWestSide] = useState(saved === null ? depth : metresText(saved.westCm));
  const [eastSide, setEastSide] = useState(saved === null ? depth : metresText(saved.eastCm));
  const [grid, setGrid] = useState(String(plan?.gridCm ?? 50));
  const [north, setNorth] = useState(String(plan?.northDeg ?? 0));
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  /* The plot the fields describe, and why not — the same refusals `plan.ts`
     makes, made here first. A rectangle is its two sides; four sides are
     the box their fence fits in, worked out with the one function the server
     uses, so the preview's area and outside count are the server's. */
  const sides: PlotSides | null = shape === 'four'
    ? { northCm: toCm(northSide), southCm: toCm(southSide), westCm: toCm(westSide), eastCm: toCm(eastSide) }
    : null;
  const sidesOk = sides === null
    ? sideOk(toCm(width)) && sideOk(toCm(depth))
    : [sides.northCm, sides.southCm, sides.westCm, sides.eastCm].every(sideOk);
  const four = sides === null || !sidesOk ? null : fourSidedPlot(sides);
  const plot: Plot | null = !sidesOk
    ? null
    : sides === null
      ? { widthCm: toCm(width), depthCm: toCm(depth), sides: null }
      : four === null ? null : { widthCm: four.widthCm, depthCm: four.depthCm, sides };
  const fieldRefusal = !sidesOk ? PLOT_SIDE_INVALID : plot === null ? PLOT_SIDES_OPEN : null;
  /* Whole degrees, 0–359: the same refusal `plan.ts` makes, made here first. */
  const northDeg = Number(north.trim());
  const northValid = north.trim() !== '' && Number.isInteger(northDeg) && northDeg >= 0 && northDeg <= 359;
  const wouldBeOutside = plot !== null
    ? outsideIds(items.map((item) => toPlaced(item, defaults)), plot).length
    : null;

  async function save(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    setRefusal(null);
    if (plot === null) { setRefusal(fieldRefusal); return; }
    if (!northValid) { setRefusal(NORTH_INVALID); return; }

    const input = {
      widthCm: plot.widthCm, depthCm: plot.depthCm, sides: plot.sides ?? null,
      gridCm: Number(grid), northDeg, notes: plan?.notes ?? null,
    };
    setPending(true);
    try {
      if (plan === null) {
        const created = await createPlanAction(seasonId, input);
        if (!created.ok) { setRefusal(created.error); return; }
      } else {
        const saved = await setPlotAction(plan.id, input);
        if (!saved.ok) { setRefusal(saved.error); return; }
        // The editor, handed this version after the refresh, knows it is this lead's own plot save.
        if (saved.value !== undefined) notePlotSaved(plan.id, saved.value);
      }
      show({
        message: plan === null ? `נוצרה מפה ל${seasonName}` : 'הגדרות המגרש עודכנו',
        tone: 'ok',
      });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      title={plan === null ? 'יצירת מפה' : 'הגדרות המגרש'}
      subtitle={seasonName}
      closeHref={closeHref}
      phone="full"
      footer={(
        <>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {plan === null ? 'יצירת המפה' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={(event) => { void save(event); }}>
        <Field
          id="plot-shape"
          label="צורת המגרש"
          hint="כשהגדר אינה מלבנית, מקלידים כל צלע בנפרד. צפון הוא החלק העליון של המפה; צפון ודרום נחשבים מקבילים, ומערב ומזרח סוגרים ביניהם."
        >
          <Select id="plot-shape" value={shape} onChange={(value) => { setShape(value === 'four' ? 'four' : 'rect'); }} options={SHAPE_OPTIONS} />
        </Field>

        {shape === 'rect' ? (
          <div className={styles.pair}>
            <Field id="plot-width" label="רוחב במטרים" required hint={<SourceChip source={{ kind: 'manual' }} />}>
              <input
                className={styles.plainInput}
                id="plot-width"
                type="number" min="1" step="0.5" inputMode="decimal"
                value={width}
                onChange={(event) => { setWidth(event.target.value); }}
              />
            </Field>
            <Field id="plot-depth" label="עומק במטרים" required>
              <input
                className={styles.plainInput}
                id="plot-depth"
                type="number" min="1" step="0.5" inputMode="decimal"
                value={depth}
                onChange={(event) => { setDepth(event.target.value); }}
              />
            </Field>
          </div>
        ) : (
          <>
            <div className={styles.pair}>
              <Field id="plot-north-side" label="צפון במטרים" required hint={<SourceChip source={{ kind: 'manual' }} />}>
                <input
                  className={styles.plainInput}
                  id="plot-north-side"
                  type="number" min="1" step="0.5" inputMode="decimal"
                  value={northSide}
                  onChange={(event) => { setNorthSide(event.target.value); }}
                />
              </Field>
              <Field id="plot-south-side" label="דרום במטרים" required>
                <input
                  className={styles.plainInput}
                  id="plot-south-side"
                  type="number" min="1" step="0.5" inputMode="decimal"
                  value={southSide}
                  onChange={(event) => { setSouthSide(event.target.value); }}
                />
              </Field>
            </div>
            <div className={styles.pair}>
              <Field id="plot-west-side" label="מערב במטרים" required>
                <input
                  className={styles.plainInput}
                  id="plot-west-side"
                  type="number" min="1" step="0.5" inputMode="decimal"
                  value={westSide}
                  onChange={(event) => { setWestSide(event.target.value); }}
                />
              </Field>
              <Field id="plot-east-side" label="מזרח במטרים" required>
                <input
                  className={styles.plainInput}
                  id="plot-east-side"
                  type="number" min="1" step="0.5" inputMode="decimal"
                  value={eastSide}
                  onChange={(event) => { setEastSide(event.target.value); }}
                />
              </Field>
            </div>
          </>
        )}

        <Field id="plot-grid" label="צעד הרשת" hint="הפריטים נצמדים לרשת הזו כשגוררים אותם.">
          <Select id="plot-grid" value={grid} onChange={setGrid} options={GRID_OPTIONS} />
        </Field>

        <Field
          id="plot-north"
          label="כיוון הצפון"
          hint="במעלות שלמות, מ־0 עד 359: לאן פונה החלק העליון של המפה. 0 הוא צפון. משמש לצל לפי שעה, למחט המצפן ולכפתור ״צפון למעלה״."
        >
          <input
            className={styles.plainInput}
            id="plot-north"
            type="number" min="0" max="359" step="1" inputMode="numeric"
            value={north}
            onChange={(event) => { setNorth(event.target.value); }}
          />
        </Field>

        {plot !== null ? (
          <p className={styles.preview}>
            <bdi>{`שטח המגרש: ${formatArea(areaM2(plot))}`}</bdi>
            {/* Four sides: the box the fence fits in, which the grid and the minimap frame. */}
            {plot.sides === null || plot.sides === undefined ? null : (
              <>
                {' · '}
                <bdi>{`נכנס בתוך ${formatSize(plot.widthCm, plot.depthCm)}`}</bdi>
              </>
            )}
            {plan !== null && wouldBeOutside !== null ? (
              <>
                {' · '}
                <bdi>
                  {wouldBeOutside === 0
                    ? 'כל הפריטים יישארו בתוך המגרש'
                    : `${wouldBeOutside} פריטים יהיו מחוץ למגרש החדש. הם לא יזוזו לבד.`}
                </bdi>
              </>
            ) : null}
          </p>
        ) : (
          /* Fields that make no plot say so before the save does, in the server's words. */
          <p className={styles.preview}><bdi>{fieldRefusal}</bdi></p>
        )}

        {refusal === null ? null : (
          <p className={styles.formError} role="alert">{refusal}</p>
        )}
      </form>
    </Drawer>
  );
}
