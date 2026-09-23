'use client';

/**
 * The precise editor for one item: what the board does by dragging, this
 * does by typing. A client component because a form is state — what has
 * been typed, which refusal is showing, whether a save is in flight. The
 * drawer itself is still a URL (`?peek=<id>`, R6) and the page hands it the
 * record.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SiteItemKind } from '@/db/schema/site';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select, TextInput, Textarea } from '@/components/ui/field';
import { Button, ButtonLink } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import type { SiteItemView } from '@/lib/site/plan';
import { KIND_ORDER, SITE_KINDS } from '@/lib/site/kinds';
import {
  SHADE_STATE_LABELS, SHADE_STATE_TONES, SITE_STATE_LABELS, SITE_STATE_TONES,
} from '@/lib/site/labels';
import { updateItemAction } from './actions';
import { LABEL_REQUIRED, ITEM_SIDE_INVALID } from './failure-messages';
import styles from './site.module.css';

type Refusal = { where: 'label' | 'size' | 'form'; message: string };

const KIND_OPTIONS = KIND_ORDER.map((kind) => ({ value: kind, label: SITE_KINDS[kind].label }));

/** A centimetre box holds a string: an empty box is a state a number cannot hold. */
function whole(value: string): number {
  return Number(value.trim());
}

export function ItemDrawer({ item, buildTasks, closeHref, removeHref }: {
  item: SiteItemView;
  buildTasks: ReadonlyArray<{ id: string; title: string }>;
  closeHref: string;
  removeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [label, setLabel] = useState(item.label);
  const [kind, setKind] = useState<SiteItemKind>(item.kind);
  const [x, setX] = useState(String(item.xCm));
  const [y, setY] = useState(String(item.yCm));
  const [width, setWidth] = useState(String(item.widthCm));
  const [depth, setDepth] = useState(String(item.depthCm));
  const [inset, setInset] = useState(String(item.insetCm ?? 50));
  const [taskId, setTaskId] = useState(item.taskId ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  async function save(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    setRefusal(null);

    // The same refusals the library makes, made here so a lead finds out
    // without a round trip — in the same words, imported rather than retyped.
    if (isBlank(label)) { setRefusal({ where: 'label', message: LABEL_REQUIRED }); return; }
    if (whole(width) < 10 || whole(depth) < 10 || !Number.isInteger(whole(width)) || !Number.isInteger(whole(depth))) {
      setRefusal({ where: 'size', message: ITEM_SIDE_INVALID });
      return;
    }

    setPending(true);
    try {
      const result = await updateItemAction(item.id, {
        label,
        kind,
        xCm: whole(x),
        yCm: whole(y),
        widthCm: whole(width),
        depthCm: whole(depth),
        insetCm: kind === 'shade' ? whole(inset) : null,
        taskId: taskId === '' ? null : taskId,
        notes: isBlank(notes) ? null : notes,
      });
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: `${label.trim()} עודכן במפה`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      title={item.label}
      subtitle={(
        <>
          {SITE_KINDS[item.kind].label}
          {' · עודכן לאחרונה '}
          <DateText at={item.updatedAt} />
          {item.updatedBy === null ? null : <>{' · '}{item.updatedBy}</>}
        </>
      )}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>שמירה</Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={(event) => { void save(event); }}>
        <span className={styles.pills}>
          {item.outside ? <Pill tone={SITE_STATE_TONES.outside} dot>{SITE_STATE_LABELS.outside}</Pill> : null}
          {item.overlapping ? <Pill tone={SITE_STATE_TONES.overlapping} dot>{SITE_STATE_LABELS.overlapping}</Pill> : null}
          {!item.outside && !item.overlapping ? <Pill tone={SITE_STATE_TONES.inside}>{SITE_STATE_LABELS.inside}</Pill> : null}
          {item.shade === null ? null : (
            <Pill tone={SHADE_STATE_TONES[item.shade]} dot>{SHADE_STATE_LABELS[item.shade]}</Pill>
          )}
        </span>

        <Field id="site-label" label="שם" required error={errorFor('label')}>
          <TextInput id="site-label" value={label} onChange={setLabel} />
        </Field>

        <Field id="site-kind" label="סוג">
          <Select
            id="site-kind"
            value={kind}
            onChange={(value) => { setKind(value as SiteItemKind); }}
            options={KIND_OPTIONS}
          />
        </Field>

        <div className={styles.pair}>
          <Field id="site-width" label="רוחב בסנטימטרים" error={errorFor('size')} hint={<SourceChip source={{ kind: 'manual' }} />}>
            <input
              className={styles.plainInput}
              id="site-width"
              type="number" min="10" step="1" inputMode="numeric"
              value={width}
              onChange={(event) => { setWidth(event.target.value); }}
            />
          </Field>
          <Field id="site-depth" label="עומק בסנטימטרים">
            <input
              className={styles.plainInput}
              id="site-depth"
              type="number" min="10" step="1" inputMode="numeric"
              value={depth}
              onChange={(event) => { setDepth(event.target.value); }}
            />
          </Field>
        </div>

        <div className={styles.pair}>
          <Field id="site-x" label="מרחק מהפינה, לרוחב" hint="בסנטימטרים, מהקצה השמאלי של המגרש">
            <input
              className={styles.plainInput}
              id="site-x"
              type="number" step="1" inputMode="numeric"
              value={x}
              onChange={(event) => { setX(event.target.value); }}
            />
          </Field>
          <Field id="site-y" label="מרחק מהפינה, לעומק" hint="בסנטימטרים, מהקצה העליון של המגרש">
            <input
              className={styles.plainInput}
              id="site-y"
              type="number" step="1" inputMode="numeric"
              value={y}
              onChange={(event) => { setY(event.target.value); }}
            />
          </Field>
        </div>

        {kind === 'shade' ? (
          <Field
            id="site-inset"
            label="רצועה ללא צל בכל צד"
            hint="בסנטימטרים. רשת של 8 × 8 עם רצועה של 50 מצלה בפועל 7 × 7."
          >
            <input
              className={styles.plainInput}
              id="site-inset"
              type="number" min="0" step="1" inputMode="numeric"
              value={inset}
              onChange={(event) => { setInset(event.target.value); }}
            />
          </Field>
        ) : null}

        <Field id="site-task" label="משימת הקמה" hint="המשימה שמקימה את זה, מתוך ״הקמה״.">
          <Select
            id="site-task"
            value={taskId}
            onChange={setTaskId}
            emptyLabel="ללא משימת הקמה"
            options={buildTasks.map((task) => ({ value: task.id, label: task.title }))}
          />
        </Field>

        <Field id="site-notes" label="הערות">
          <Textarea id="site-notes" value={notes} onChange={setNotes} rows={3} />
        </Field>

        {refusal?.where === 'form' ? (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        ) : null}

        <div className={styles.drawerActions}>
          <ButtonLink tone="danger" size="sm" href={removeHref}>הסרה מהמפה</ButtonLink>
        </div>
      </form>
    </Drawer>
  );
}
