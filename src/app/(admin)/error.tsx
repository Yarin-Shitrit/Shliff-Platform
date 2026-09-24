'use client';

/**
 * The error boundary for every admin screen.
 *
 * `/logistics` has had its own since `4668961`, for a reason that is now
 * repeating one folder over: `/site` (מפת הקאמפ) reads `site_plans`, a table
 * migration `0010` creates and no real database has yet received, so in
 * production it throws during its server render and the platform's own error
 * page answers — `This page couldn't load — A server error occurred`. English,
 * on a Hebrew screen. The product rule is absolute ("no English error text
 * ever reaches a Hebrew screen"), and a rule that has to be remembered by
 * every screen separately is one that the next screen forgets. So the
 * refusal lives here, once, where Next renders the nearest boundary for
 * anything below this layout that has none of its own.
 *
 * `logistics/error.tsx` stays: a nearer boundary wins, and its way out is
 * the warehouse rather than the home screen, which is the better exit from
 * inside that feature. This one offers the home screen, because it does not
 * know which feature just failed.
 *
 * **The message is deliberately not rendered.** React error #441 explains the
 * shape of the problem: a Server Component's real message is withheld in
 * production so that nothing sensitive leaks, and a `digest` is attached
 * instead. So the only two honest things to show are a Hebrew sentence and
 * that digest — the string that finds the matching line in `vercel logs`.
 * Rendering `error.message` would put English on the screen in development
 * and an empty box in production, which is the worst of both.
 *
 * An error boundary must be a Client Component: React needs to catch below
 * it and re-render, and `reset()` is a callback rather than a URL.
 */

import { useEffect } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button, ButtonLink } from '@/components/ui/button';
import styles from './error.module.css';

export default function AdminError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /* For whoever is reading a stack trace rather than the screen. In
       production the full error is already in the server logs; in
       development there is no digest, so the console is the only place the
       real error is visible at all. */
    console.error('admin screen failed to render', error);
  }, [error]);

  return (
    <main className={styles.page}>
      <h1>המסך לא נטען</h1>

      <Banner
        tone="danger"
        label="תקלה בטעינת המסך"
        headline="משהו נכשל בצד השרת בזמן שהמסך נבנה."
        detail="זו לא טעות שלכם ולא משהו שנשמר לא נכון — שום נתון לא השתנה. אפשר לנסות שוב; אם זה חוזר, המזהה למטה הוא מה שמאתר את התקלה המדויקת ביומן השרת."
      />

      {/*
        The digest, and only the digest: a short hash with no Latin prose in
        it, the one string that ties what a lead saw to a line in the log,
        selectable so it can be pasted into a message. Absent in development,
        where the console above has the real thing.
      */}
      {error.digest === undefined ? null : (
        <p className={styles.digest}>
          מזהה התקלה: <code className={styles.code}>{error.digest}</code>
        </p>
      )}

      <div className={styles.actions}>
        <Button tone="primary" onClick={reset}>ניסיון נוסף</Button>
        <ButtonLink href="/">חזרה לבית</ButtonLink>
      </div>
    </main>
  );
}
