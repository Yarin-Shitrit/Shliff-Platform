import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import { restoreOps } from '@/lib/site/editor/restore';
import { snapshotPlotOf, type Snapshot, type SnapshotSummary } from '@/lib/site/snapshots';
import {
  deleteSnapshotAction, listSnapshotsAction, readSnapshotAction, takeSnapshotAction,
} from '../actions';
import { isolate } from './notices';
import { isStaleBuild, SITE_UPDATED } from './unsaved-work';
import type { PlansCardProps } from './panels/plans-card';

/**
 * Saved plans, as the editor runs them (`src/lib/site/snapshots.ts`): the
 * card, its list, and the three things it does. It sits beside `SiteEditor`
 * the way `use-underlay.ts` does, so the editor changes by a few lines.
 *
 * - Saving keeps the map as the store shows it — an edit made a second ago
 *   and not yet saved in the background included — under the typed name.
 * - Loading goes through `runEdit`, the editor's one door: the ops that take
 *   the map on screen to the kept plan (`restore.ts`) are one undo step, are
 *   saved in the batch against the map's version, and take an older undo
 *   toast away (P6). The toast offers ביטול, as a removal's does.
 * - Forgetting a plan changes the map not at all; only the list.
 *
 * The list is read when the card opens, and again after every save and
 * delete from the server's answer — never kept from the page's load, so a
 * plan the other lead saved is there the next time the card opens.
 */

/** When a request itself failed — no answer came. */
export const PLANS_OFFLINE = 'לא הצלחנו להגיע לשרת. אפשר לנסות שוב.';

export interface SavedPlansDeps {
  planId: string;
  doc: EditorDoc;
  /** This season's build tasks: the only ones an item may link to. */
  buildTaskIds: ReadonlySet<string>;
  /** `SiteEditor`'s one door for edits; true when a step was recorded. */
  runEdit: (label: string, ops: SiteOp[]) => boolean;
  saidWithUndo: (message: string) => void;
  say: (message: string, tone: 'ok' | 'bad') => void;
  /** The editor's own stale-build handling: a deploy replaced this page's build (review I2). */
  onStaleBuild: () => void;
}

export interface SavedPlansController {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Everything the card shows and calls. */
  card: Omit<PlansCardProps, 'plot' | 'plotHref'>;
}

/** "תוכנית 4": one past the highest number any saved plan's name ends in, as items are numbered (`nextLabel`). */
export function nextPlanName(plans: ReadonlyArray<Pick<SnapshotSummary, 'name'>>): string {
  let top = 0;
  for (const plan of plans) {
    const match = /(\d+)\s*$/.exec(plan.name);
    top = Math.max(top, match ? Number(match[1]) : 0);
  }
  return `תוכנית ${top + 1}`;
}

/** What the load's toast says: the plan's name, then anything it could not do, each in its own sentence. */
export function loadedText(name: string, result: { lockedNames: string[]; droppedLineNames: string[]; tasksCleared: number }): string {
  const parts = [`התוכנית ${isolate(name)} נטענה למפה`];
  const locked = result.lockedNames.length;
  if (locked === 1) parts.push(`הפריט הנעול ${isolate(result.lockedNames[0])} נשאר כמו שהוא`);
  else if (locked > 1) parts.push(`${locked} פריטים נעולים נשארו כמו שהם`);
  const dropped = result.droppedLineNames.length;
  if (dropped === 1) parts.push(`הקו ${isolate(result.droppedLineNames[0])} לא נטען, כי קצה שלו נעול בסוג שהקו לא מגיע אליו`);
  else if (dropped > 1) parts.push(`${dropped} קווים לא נטענו, כי קצה שלהם נעול בסוג שהקו לא מגיע אליו`);
  if (result.tasksCleared === 1) parts.push('הקישור למשימת הקמה שכבר לא קיימת הוסר מפריט אחד');
  else if (result.tasksCleared > 1) parts.push(`הקישור למשימת הקמה שכבר לא קיימת הוסר מ־${result.tasksCleared} פריטים`);
  return parts.join('. ');
}

export function useSavedPlans(deps: SavedPlansDeps): SavedPlansController {
  const { planId, say, onStaleBuild } = deps;
  const [open, setOpenState] = useState(false);
  const [plans, setPlans] = useState<SnapshotSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PlansCardProps['busy']>(null);
  /* The latest deps, for work that finishes after a render: a load's answer
     lands against the map as it is then, not as it was when asked. */
  const latest = useRef(deps);
  useEffect(() => { latest.current = deps; });
  /** Which read of the list is current: an answer to an earlier one is ignored. */
  const reading = useRef(0);

  /** A request that threw: the stale build is the editor's to say; anything else is a dropped connection. */
  const failed = useCallback((error: unknown): string => {
    if (isStaleBuild(error)) {
      onStaleBuild();
      return SITE_UPDATED;
    }
    return PLANS_OFFLINE;
  }, [onStaleBuild]);

  const readList = useCallback(async () => {
    reading.current += 1;
    const mine = reading.current;
    try {
      const answer = await listSnapshotsAction(planId);
      if (reading.current !== mine) return;
      if (answer.ok && answer.value !== undefined) {
        setPlans(answer.value);
        setListError(null);
      } else {
        setListError(answer.ok ? PLANS_OFFLINE : answer.error);
      }
    } catch (error) {
      if (reading.current !== mine) return;
      setListError(failed(error));
    }
  }, [planId, failed]);

  /* Opening reads the list; closing keeps nothing, so the next open reads
     afresh — and a plan the other lead saved meanwhile is there. Done from
     the click, not from an effect on the open flag, so the list is asked for once. */
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    setPlans(null);
    setListError(null);
    setSaveError(null);
    if (next) void readList();
  }, [readList]);

  const save = useCallback(async (name: string) => {
    if (busy !== null) return;
    setBusy({ what: 'save' });
    setSaveError(null);
    const current = latest.current.doc;
    try {
      const answer = await takeSnapshotAction(planId, name, {
        plot: snapshotPlotOf(current.plot), items: current.items, lines: current.lines,
      });
      if (!answer.ok) {
        setSaveError(answer.error);
        return;
      }
      if (answer.value !== undefined) setPlans(answer.value);
      say(`התוכנית ${isolate(name)} נשמרה`, 'ok');
    } catch (error) {
      setSaveError(failed(error));
    } finally {
      setBusy(null);
    }
  }, [busy, planId, say, failed]);

  const load = useCallback(async (id: string) => {
    if (busy !== null) return;
    setBusy({ what: 'load', id });
    let plan: Snapshot;
    try {
      const answer = await readSnapshotAction(planId, id);
      if (!answer.ok || answer.value === undefined) {
        say(answer.ok ? PLANS_OFFLINE : answer.error, 'bad');
        return;
      }
      plan = answer.value;
    } catch (error) {
      say(failed(error), 'bad');
      return;
    } finally {
      setBusy(null);
    }
    const now = latest.current;
    const result = restoreOps(now.doc, plan, now.buildTaskIds);
    if (result.ops.length === 0) {
      if (result.lockedNames.length > 0) {
        say(`המפה זהה לתוכנית ${isolate(plan.name)}, חוץ מפריטים נעולים שנשארו כמו שהם.`, 'bad');
      } else {
        say(`המפה כבר זהה לתוכנית ${isolate(plan.name)}.`, 'ok');
      }
      return;
    }
    if (!now.runEdit('טעינת תוכנית שמורה', result.ops)) return;
    now.saidWithUndo(loadedText(plan.name, result));
  }, [busy, planId, say, failed]);

  const forget = useCallback(async (id: string) => {
    if (busy !== null) return;
    setBusy({ what: 'delete', id });
    try {
      const answer = await deleteSnapshotAction(planId, id);
      if (!answer.ok) {
        say(answer.error, 'bad');
        return;
      }
      if (answer.value !== undefined) setPlans(answer.value);
      say('התוכנית נמחקה', 'ok');
    } catch (error) {
      say(failed(error), 'bad');
    } finally {
      setBusy(null);
    }
  }, [busy, planId, say, failed]);

  return {
    open,
    setOpen,
    card: {
      plans,
      listError,
      busy,
      saveError,
      suggestedName: nextPlanName(plans ?? []),
      onSave: (name) => { void save(name); },
      onLoad: (id) => { void load(id); },
      onDelete: (id) => { void forget(id); },
      onRetry: () => { setListError(null); void readList(); },
      onClose: () => { setOpen(false); },
    },
  };
}
