'use client';

/**
 * The sheet's two decisions, where the sheet is: its season (W10) and which
 * copy of a colliding pair is the real one (W13). D10 puts the sheet in the
 * rail, so the controls live in the rail's header — a lead who reads
 * `בלי שנה` here should not have to go somewhere else to fix it.
 *
 * Both halves are real `<form action={…}>` submits, so they work with
 * JavaScript disabled and hold no draft state of anyone's. The one thing this
 * component does hold is the action's answer: `setSheetAuthority` refuses an
 * unlabelled sheet in Hebrew, and that sentence has to land on the screen
 * rather than in a server log. `useActionState` is what carries it back while
 * keeping the progressive-enhancement property of a plain form.
 *
 * Nothing here can infer a season. That is W10's rule made structural rather
 * than remembered.
 */
import { useActionState } from 'react';
import { Pill } from '@/components/ui/pill';
import type { SheetLabel } from '@/lib/import/register';
import type { ActionResult } from '@/lib/import/sheet-labels';
import { setSeasonAction, setAuthorityAction } from './actions';
import styles from './import-review.module.css';

function Refusal({ state }: { state: ActionResult | null }) {
  if (state === null || state.ok) return null;
  return <p className={styles.errorNote} role="alert">{state.message}</p>;
}

export function SheetLabelControls(
  { sheet, seasons }: {
    sheet: SheetLabel;
    seasons: Array<{ id: string; name: string }>;
  },
) {
  const [seasonState, saveSeason, savingSeason] =
    useActionState<ActionResult | null, FormData>(setSeasonAction, null);
  /**
   * One state for both authority forms on purpose: only one refusal can be
   * true of one sheet at a time, and two slots would mean a lead reading a
   * stale sentence beside the button they did not press.
   */
  const [authorityState, saveAuthority, savingAuthority] =
    useActionState<ActionResult | null, FormData>(setAuthorityAction, null);

  const contested = sheet.state === 'undecided' || sheet.state === 'ambiguous';

  return (
    <div className={styles.sheetControls}>
      <form action={saveSeason} className={styles.sheetForm}>
        <input type="hidden" name="sheetId" value={sheet.sheetId} />
        <label className="sr-only" htmlFor={`season-${sheet.sheetId}`}>
          השנה של הגיליון <bdi>{sheet.name}</bdi>
        </label>
        <select
          id={`season-${sheet.sheetId}`}
          name="seasonId"
          className={styles.sheetSelect}
          defaultValue={sheet.seasonId ?? ''}
          disabled={savingSeason}
        >
          <option value="">בלי שנה</option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>{season.name}</option>
          ))}
        </select>
        <button type="submit" className={styles.sheetSubmit} disabled={savingSeason}>
          שמירה
        </button>
      </form>

      <Refusal state={seasonState} />

      {contested && sheet.authoritative !== true ? (
        <form action={saveAuthority} className={styles.sheetForm}>
          <input type="hidden" name="sheetId" value={sheet.sheetId} />
          <input type="hidden" name="authoritative" value="true" />
          <button type="submit" className={styles.sheetSubmit} disabled={savingAuthority}>
            זה העותק הקובע
          </button>
        </form>
      ) : null}

      {sheet.authoritative === true ? (
        <form action={saveAuthority} className={styles.sheetForm}>
          <input type="hidden" name="sheetId" value={sheet.sheetId} />
          <input type="hidden" name="authoritative" value="false" />
          <Pill tone="ok">עותק קובע</Pill>
          <button type="submit" className={styles.sheetSubmit} disabled={savingAuthority}>
            ביטול הסימון
          </button>
        </form>
      ) : null}

      <Refusal state={authorityState} />
    </div>
  );
}
