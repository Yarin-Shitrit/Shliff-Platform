'use client';

/**
 * תוכניות שמורות: the card for the map's saved plans. A row to keep the map
 * as it is now under a name, and the list of plans kept so far — each with
 * what it holds, when it was saved, a button that loads it over the map and
 * one that forgets it. A plan saved on a plot of another size says so on its
 * row, and the figure links to the plot settings (a figure links to what
 * changes it).
 *
 * Loading asks no question: it is one edit, and its toast offers ביטול, the
 * way a removal does (spec §8). Forgetting a plan is not an edit of the map
 * and cannot be undone, so that one asks first (the kit's `ConfirmDialog`).
 *
 * Presentational: `use-saved-plans.ts` holds the state and does the work.
 */

import { useId, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { formatDateFull, formatTime } from '@/lib/dates';
import { formatSize } from '@/lib/site/geometry';
import type { EditorPlot } from '@/lib/site/editor/model';
import { samePlot, snapshotNameRefusal, type SnapshotSummary } from '@/lib/site/snapshots';
import { isolate } from '../notices';
import chrome from './panel.module.css';
import styles from './plans-card.module.css';

export const PLANS_INVITATION = 'עוד לא נשמרה תוכנית. שמירה של המפה כמו שהיא עכשיו מאפשרת לנסות סידור אחר, ולחזור אליה — או להשוות בין כמה תוכניות ולהחליט אחר כך.';
const NAME_REQUIRED = 'לתוכנית צריך שם, כדי להבדיל בינה לבין אחרות.';
const NAME_TOO_LONG = 'שם התוכנית ארוך מדי — עד 60 תווים.';

export interface PlansCardProps {
  /** Null while the list is being read. */
  plans: SnapshotSummary[] | null;
  /** Why the list could not be read, in Hebrew; the card offers to try again. */
  listError: string | null;
  /** The map's plot now, for saying when a plan was saved on another. */
  plot: EditorPlot;
  plotHref: string;
  /** What the card is doing, if anything: a save, or a load or a delete of one plan. Its controls wait meanwhile. */
  busy: { what: 'save' } | { what: 'load' | 'delete'; id: string } | null;
  /** Why the last save was refused, in Hebrew. */
  saveError: string | null;
  /** The name the box proposes, as a new item is named: "תוכנית 3". */
  suggestedName: string;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

/** What a plan's row says it holds: "12 פריטים · 3 קווים", the lines only when there are any. */
export function holdsText(plan: Pick<SnapshotSummary, 'itemCount' | 'lineCount'>): string {
  const items = plan.itemCount === 1 ? 'פריט אחד' : `${plan.itemCount} פריטים`;
  if (plan.lineCount === 0) return items;
  const lines = plan.lineCount === 1 ? 'קו אחד' : `${plan.lineCount} קווים`;
  return `${items} · ${lines}`;
}

/** "נשמרה ב־26/09/2026 בשעה 15:40". */
export function savedText(createdAt: string): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return 'נשמרה';
  return `נשמרה ב־${formatDateFull(at)} בשעה ${formatTime(at)}`;
}

export function PlansCard(props: PlansCardProps): ReactElement {
  const { plans, listError, plot, plotHref, busy, saveError, suggestedName } = props;
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState(suggestedName);
  const [nameRefusal, setNameRefusal] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<SnapshotSummary | null>(null);
  /* A saved plan takes the next number: the box proposes it, unless the lead
     is mid-word on a name of their own. Set during render, the way React
     keeps information from an earlier render, rather than from an effect. */
  const [proposed, setProposed] = useState(suggestedName);
  if (proposed !== suggestedName) {
    setProposed(suggestedName);
    if (/^תוכנית \d+$/.test(name) || name === '') setName(suggestedName);
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    const refusal = snapshotNameRefusal(name);
    if (refusal !== null) {
      setNameRefusal(refusal.startsWith('a saved plan name must be') ? NAME_TOO_LONG : NAME_REQUIRED);
      return;
    }
    setNameRefusal(null);
    props.onSave(name.trim());
  }

  const saving = busy?.what === 'save';

  return (
    <div className={cx(chrome.card, styles.card)} role="group" aria-labelledby={titleId} data-panel="true">
      <div className={chrome.cardHead}>
        <h2 className={styles.title} id={titleId}>תוכניות שמורות</h2>
        <Button tone="ghost" size="sm" iconLabel="סגירה" onClick={props.onClose}>
          <Icon name="x" size={14} />
        </Button>
      </div>

      <form className={styles.saveRow} onSubmit={save}>
        <label htmlFor={nameId} className="sr-only">שם התוכנית</label>
        <input
          id={nameId}
          className={styles.input}
          type="text"
          value={name}
          maxLength={80}
          disabled={saving}
          aria-invalid={nameRefusal === null ? undefined : true}
          onChange={(event) => { setName(event.target.value); setNameRefusal(null); }}
        />
        <Button type="submit" size="sm" tone="primary" disabled={busy !== null}>
          <Icon name="plus" size={14} />
          שמירת המפה
        </Button>
      </form>
      {nameRefusal === null ? null : <p className={styles.error} role="alert">{nameRefusal}</p>}
      {saveError === null ? null : <p className={styles.error} role="alert">{saveError}</p>}
      <p className={chrome.hint}>המפה נשמרת כמו שהיא עכשיו, על הפריטים והקווים שבה. טעינה של תוכנית מחליפה את מה שעל המפה, ואפשר לבטל אותה כמו כל שינוי.</p>

      {plans === null && listError === null ? (
        <p className={chrome.hint} role="status">טוען…</p>
      ) : null}
      {listError === null ? null : (
        <>
          <p className={styles.error} role="alert">{listError}</p>
          <div>
            <Button size="sm" onClick={props.onRetry}>ניסיון חוזר</Button>
          </div>
        </>
      )}
      {plans !== null && plans.length === 0 ? (
        <p className={chrome.invite}>{PLANS_INVITATION}</p>
      ) : null}
      {plans !== null && plans.length > 0 ? (
        <ul className={styles.list} aria-label="התוכניות השמורות">
          {plans.map((plan) => {
            const loading = busy?.what === 'load' && busy.id === plan.id;
            const deleting = busy?.what === 'delete' && busy.id === plan.id;
            const otherPlot = !samePlot(plan.plot, plot);
            return (
              <li key={plan.id} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.name}><bdi>{plan.name}</bdi></span>
                  <span className={styles.rowActions}>
                    <Button
                      size="sm"
                      tone="ghost"
                      disabled={busy !== null}
                      onClick={() => { props.onLoad(plan.id); }}
                    >
                      <Icon name="history" size={14} />
                      {loading ? 'טוען…' : 'טעינה למפה'}
                    </Button>
                    <Button
                      size="sm"
                      tone="ghost"
                      iconLabel={`מחיקת התוכנית ${plan.name}`}
                      disabled={busy !== null}
                      onClick={() => { setForgetting(plan); }}
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </span>
                </div>
                <p className={chrome.meta}>{deleting ? 'מוחק…' : `${holdsText(plan)} · ${savedText(plan.createdAt)}`}</p>
                {otherPlot ? (
                  <p className={styles.plotNote}>
                    {'נשמרה על מגרש '}
                    <Link href={plotHref}>{formatSize(plan.plot.widthCm, plan.plot.depthCm)}</Link>
                    {`; המגרש עכשיו ${formatSize(plot.widthCm, plot.depthCm)}. הפריטים ייטענו למקומם, וסימון ״מחוץ למגרש״ יגיד מה חורג.`}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {forgetting === null ? null : (
        <ConfirmDialog
          title="מחיקת תוכנית שמורה"
          consequence={`התוכנית ${isolate(forgetting.name)} תימחק. המפה עצמה לא משתנה, אבל אי אפשר לשחזר תוכנית שנמחקה.`}
          confirmLabel="מחיקת התוכנית"
          tone="danger"
          onConfirm={() => { setForgetting(null); props.onDelete(forgetting.id); }}
          onCancel={() => { setForgetting(null); }}
        />
      )}
    </div>
  );
}
