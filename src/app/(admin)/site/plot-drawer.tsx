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
import { areaM2, formatArea, outsideIds } from '@/lib/site/geometry';
import { toPlaced, type ItemShape } from '@/lib/site/derive';
import { createPlanAction, setPlotAction } from './actions';
import { notePlotSaved } from './editor/own-plot-saves';
import { NORTH_INVALID, PLOT_SIDE_INVALID } from './failure-messages';
import styles from './site.module.css';

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

export function PlotDrawer({ seasonId, seasonName, plan, items, closeHref }: {
  seasonId: string;
  seasonName: string;
  plan: { id: string; widthCm: number; depthCm: number; gridCm: number; northDeg: number; notes: string | null } | null;
  items: readonly ItemShape[];
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [width, setWidth] = useState(plan === null ? '26' : String(plan.widthCm / 100));
  const [depth, setDepth] = useState(plan === null ? '24' : String(plan.depthCm / 100));
  const [grid, setGrid] = useState(String(plan?.gridCm ?? 50));
  const [north, setNorth] = useState(String(plan?.northDeg ?? 0));
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const widthCm = toCm(width);
  const depthCm = toCm(depth);
  const valid = Number.isInteger(widthCm) && Number.isInteger(depthCm)
    && widthCm >= 100 && depthCm >= 100 && widthCm <= 50_000 && depthCm <= 50_000;
  /* Whole degrees, 0–359: the same refusal `plan.ts` makes, made here first. */
  const northDeg = Number(north.trim());
  const northValid = north.trim() !== '' && Number.isInteger(northDeg) && northDeg >= 0 && northDeg <= 359;
  const wouldBeOutside = valid
    ? outsideIds(items.map((item) => toPlaced(item)), { widthCm, depthCm }).length
    : null;

  async function save(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    setRefusal(null);
    if (!valid) { setRefusal(PLOT_SIDE_INVALID); return; }
    if (!northValid) { setRefusal(NORTH_INVALID); return; }

    const input = { widthCm, depthCm, gridCm: Number(grid), northDeg, notes: plan?.notes ?? null };
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

        {valid ? (
          <p className={styles.preview}>
            <bdi>{`שטח המגרש: ${formatArea(areaM2({ widthCm, depthCm }))}`}</bdi>
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
        ) : null}

        {refusal === null ? null : (
          <p className={styles.formError} role="alert">{refusal}</p>
        )}
      </form>
    </Drawer>
  );
}
