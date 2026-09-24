'use client';

/**
 * Last year's map as this year's starting point. The plot size comes with
 * it — the lead then opens `הגדרות המגרש`, and the outside-count says what
 * has to move. Offered only while this season has no map: the library
 * refuses to replace one, and a form that always ends in a refusal is not
 * a form.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import { copyPlanAction } from './actions';
import styles from './site.module.css';

export function CopyDrawer({ seasonId, seasonName, sources, closeHref }: {
  seasonId: string;
  seasonName: string;
  sources: ReadonlyArray<{ seasonId: string; seasonName: string; items: number }>;
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [from, setFrom] = useState(sources[0]?.seasonId ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function copy(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    setRefusal(null);
    const source = sources.find((candidate) => candidate.seasonId === from);
    if (!source) { setRefusal('יש לבחור שנה להעתיק ממנה'); return; }

    setPending(true);
    try {
      const result = await copyPlanAction(source.seasonId, seasonId);
      if (!result.ok) { setRefusal(result.error); return; }
      show({ message: `המפה של ${source.seasonName} הועתקה ל${seasonName}`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      title="העתקה משנה אחרת"
      subtitle={seasonName}
      closeHref={closeHref}
      footer={(
        <>
          <Button tone="primary" onClick={() => { void copy(); }} disabled={pending || sources.length === 0}>
            העתקת המפה
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={(event) => { void copy(event); }}>
        <Field
          id="copy-from"
          label="להעתיק את המפה של"
          hint="גודל המגרש והפריטים מועתקים כמו שהם. קישורים למשימות הקמה לא מועתקים, כי הן של השנה ההיא."
        >
          <Select
            id="copy-from"
            value={from}
            onChange={setFrom}
            options={sources.map((source) => ({
              value: source.seasonId,
              label: `${source.seasonName} · ${source.items} פריטים`,
            }))}
          />
        </Field>

        {refusal === null ? null : (
          <p className={styles.formError} role="alert">{refusal}</p>
        )}
      </form>
    </Drawer>
  );
}
