'use client';

/**
 * One form in two modes: `topic === null` adds a topic, and a topic edits
 * it. A client component because a form is state. The drawer is still a
 * URL (R6): the page reads `?topic=` / `?act=topic` and hands it the record.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, TextInput, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import type { Topic } from '@/lib/logistics/plan';
import { createTopicAction, updateTopicAction, setTopicArchivedAction } from './actions';
import { TOPIC_NAME_REQUIRED } from './failure-messages';
import styles from './plan.module.css';

type Refusal = { where: 'name' | 'form'; message: string };

const NAME_ID = 'plan-topic-name';

export function TopicDrawer({
  topic, seasonId, seasonName, closeHref,
}: {
  topic: Topic | null;
  seasonId: string;
  seasonName: string;
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [name, setName] = useState(topic?.name ?? '');
  const [notes, setNotes] = useState(topic?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);
    if (isBlank(name)) { setRefusal({ where: 'name', message: TOPIC_NAME_REQUIRED }); return; }

    const input = { name, notes: isBlank(notes) ? null : notes };
    setPending(true);
    try {
      const result = topic === null
        ? await createTopicAction(seasonId, input)
        : await updateTopicAction(topic.id, input);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: topic === null ? `${name.trim()} נוסף לנושאים` : `${name.trim()} עודכן`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function setArchived(archived: boolean) {
    if (topic === null) return;
    setRefusal(null);
    setPending(true);
    try {
      const result = await setTopicArchivedAction(topic.id, archived);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: archived ? `${topic.name} הועבר לארכיון` : `${topic.name} חזר ללוח`, tone: 'ok' });
      setArchiving(false);
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const creating = topic === null;
  const archived = topic?.archivedAt != null;

  return (
    <Drawer
      title={creating ? 'נושא חדש' : topic.name}
      subtitle={creating ? `בלוח העבודה של ${seasonName}` : (
        <>
          {archived ? <Pill tone="outline">בארכיון</Pill> : null}
          {archived ? ' · ' : ''}
          {'עודכן לאחרונה '}
          <DateText at={topic.updatedAt} />
          {topic.updatedBy === null ? null : <>{' · '}{topic.updatedBy}</>}
        </>
      )}
      closeHref={closeHref}
      phone="full"
      footer={(
        <span className={styles.footActions}>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספת הנושא' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
          {creating ? null : archived ? (
            <Button tone="ghost" onClick={() => { void setArchived(false); }} disabled={pending}>
              החזרה ללוח
            </Button>
          ) : (
            <Button tone="ghost" onClick={() => { setArchiving(true); }} disabled={pending}>
              העברה לארכיון
            </Button>
          )}
        </span>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field
          id={NAME_ID}
          label="שם הנושא"
          required
          error={refusal?.where === 'name' ? refusal.message : undefined}
          hint="״סלון״, ״מטבח״, ״שירותים״, ״מחנה״ — כותרת שהמשימות מסודרות תחתיה."
        >
          <TextInput id={NAME_ID} value={name} onChange={setName} />
        </Field>

        <Field id="plan-topic-notes" label="הערות" hint="מה צריך לדעת מי שאחראי על הנושא הזה.">
          <Textarea id="plan-topic-notes" value={notes} onChange={setNotes} rows={3} />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>

      {archiving && topic !== null ? (
        <ConfirmDialog
          title="העברת נושא לארכיון"
          consequence={`${topic.name} ייעלם מרשימת הנושאים. המשימות שתחתיו נשארות בלוח, והנושא יופיע כ״בארכיון״ כל עוד יש בו משימות. אפשר להחזיר אותו.`}
          confirmLabel="העברה לארכיון"
          onConfirm={() => { void setArchived(true); }}
          onCancel={() => { setArchiving(false); }}
        />
      ) : null}
    </Drawer>
  );
}
