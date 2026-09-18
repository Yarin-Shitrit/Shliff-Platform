'use client';

/**
 * Client component: it reads `?act=`, matching `SeasonSwitch`'s own reasoning
 * (Ruling S2 — a layout is never given `searchParams`), and the form it opens
 * must show a Hebrew refusal and a pending state inline, without a full
 * navigation, while a lead is mid-form.
 *
 * Rendered once, in `sidebar.tsx` beside `SeasonSwitch`, so `?act=season`
 * opens it from any admin page — the rail's own "R6: a drawer is a URL, and
 * it survives a refresh" applies here exactly as it does to every record
 * drawer, even though this one names no record.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, TextInput, MoneyInput } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ACT_PARAM, closePeekHref } from '@/components/ui/drawer-url';
import { createSeasonAction } from './actions';
import styles from './new-season-drawer.module.css';

export function NewSeasonDrawer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [flatRate, setFlatRate] = useState('');
  const [plannedSize, setPlannedSize] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (searchParams.get(ACT_PARAM) !== 'season') return null;

  const closeHref = closePeekHref(pathname, searchParams);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await createSeasonAction({ name, year, flatRate, plannedSize, startsOn });
      if (result.ok) {
        // Closes the drawer the same way its own X does, back to the URL
        // this page had before it opened — now revalidated (in the action),
        // so the switcher's list already includes the season just created.
        router.replace(closeHref);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer title="שנה חדשה" closeHref={closeHref}>
      <form onSubmit={submit} className={styles.form}>
        <Field id="new-season-name" label="שם" required>
          <TextInput id="new-season-name" value={name} onChange={setName} />
        </Field>

        <Field id="new-season-year" label="שנה קלנדרית" required>
          <TextInput id="new-season-year" value={year} onChange={setYear} />
        </Field>

        <Field id="new-season-flat-rate" label="דמי קאמפ" required>
          <MoneyInput id="new-season-flat-rate" value={flatRate} onChange={setFlatRate} />
        </Field>

        <Field id="new-season-planned-size" label="גודל מחנה מתוכנן" hint="לא חובה">
          <TextInput id="new-season-planned-size" value={plannedSize} onChange={setPlannedSize} />
        </Field>

        <Field id="new-season-starts-on" label="פתיחת השער" hint="לא חובה">
          <input
            type="date"
            id="new-season-starts-on"
            className={styles.date}
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </Field>

        {error !== null ? <p className={styles.error} role="alert">{error}</p> : null}

        <div className={styles.actions}>
          <Button type="submit" tone="primary" disabled={pending}>יצירת שנה</Button>
        </div>
      </form>
    </Drawer>
  );
}
