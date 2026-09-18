'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { isBlank } from '@/lib/text/normalize';
import { ROLE_LABELS } from '@/lib/members/labels';
import { addMemberAction, createPersonAction } from './actions';
import styles from './people.module.css';

export interface SeasonOption {
  id: string;
  name: string;
}

const ROLES = Object.keys(ROLE_LABELS);

/**
 * Creates a brand-new person. Name is the only required field — the season is
 * optional, because "joined the camp but not assigned to a season yet" is a
 * real, valid state, not a form left half-filled.
 *
 * Blankness is checked client-side before the action is ever called, and a
 * name that resolves to an existing person is refused server-side — this
 * form only surfaces that refusal, it never decides identity itself.
 */
export function AddMember({ seasons }: { seasons: SeasonOption[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (isBlank(name)) {
      setError('שם לא יכול להיות ריק.');
      return;
    }

    setPending(true);
    try {
      const result = await createPersonAction(name, seasonId || undefined);
      if (result.ok) {
        setName('');
        setSeasonId('');
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.addMember}>
      <label>
        שם
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="שם מלא"
        />
      </label>
      <label>
        שיוך לשנה
        <select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}>
          <option value="">— ללא שנה כרגע —</option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>{season.name}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>הוסף אדם</button>
      {error && <p className="badge-warn" role="alert">{error}</p>}
    </form>
  );
}

/**
 * Adds an existing person to a season they are not on yet.
 *
 * A person already on every season sees a disabled message rather than a
 * select with nothing usable in it — an empty-but-enabled control invites a
 * click that can only fail.
 */
export function AddToSeason({
  personId, seasons, memberSeasonIds,
}: {
  personId: string;
  seasons: SeasonOption[];
  memberSeasonIds: string[];
}) {
  const router = useRouter();
  const available = seasons.filter((season) => !memberSeasonIds.includes(season.id));
  const [seasonId, setSeasonId] = useState(available[0]?.id ?? '');
  const [role, setRole] = useState(ROLES[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Distinguished from "already on every season": with no seasons at all in
  // the system, that message would misleadingly imply there was ever
  // something to join.
  if (seasons.length === 0) {
    return <p className="muted">עדיין אין שנים במערכת.</p>;
  }
  if (available.length === 0) {
    return <p className="muted">משויך/ת כבר לכל השנים הקיימות.</p>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!seasonId) return;
    setError(null);
    setPending(true);
    try {
      const result = await addMemberAction(personId, seasonId, role);
      if (result.ok) router.refresh();
      else setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.addToSeason}>
      <label>
        שנה
        <select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}>
          {available.map((season) => (
            <option key={season.id} value={season.id}>{season.name}</option>
          ))}
        </select>
      </label>
      <label>
        תפקיד
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {ROLES.map((value) => (
            <option key={value} value={value}>{ROLE_LABELS[value]}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>שייך לשנה</button>
      {error && <p className="badge-warn" role="alert">{error}</p>}
    </form>
  );
}
