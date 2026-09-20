'use client';

/**
 * The error boundary for `/logistics` and everything under it.
 *
 * It exists because of a real failure: `/logistics/acquisitions` threw during
 * its server render in production and a lead saw
 * `This page couldn't load — A server error occurred`. English, on a Hebrew
 * screen, from a page that said nothing about what to do next. That is R9
 * failing at the outermost boundary, and `docs/deploy.md` §9 lists it as a
 * symptom in its own right: *"Hebrew screen shows English text — a platform
 * error escaped; the app's own Hebrew refusal did not fire first."* This is
 * the refusal firing first.
 *
 * **The message is deliberately not rendered.** React error #441 explains the
 * shape of the problem: a Server Component's real message is withheld in
 * production so that nothing sensitive leaks, and a `digest` is attached
 * instead. So the only two honest things to show are a Hebrew sentence and
 * that digest — which is the string that finds the matching line in
 * `vercel logs`. Rendering `error.message` would put English on the screen in
 * development and an empty box in production, which is the worst of both.
 *
 * An error boundary must be a Client Component: React needs to catch below it
 * and re-render, and `reset()` is a callback rather than a URL, so this is one
 * of the few places in this feature where a link will not do.
 */

import { useEffect } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button, ButtonLink } from '@/components/ui/button';
import { WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';
import styles from './error.module.css';

export default function LogisticsError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /* For whoever is reading a stack trace rather than the screen. The full
       error is already in the server logs in production; this is what makes
       it visible in a browser console in development, where there is no
       digest to correlate with. */
    console.error('logistics screen failed to render', error);
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
        The digest, and only the digest. It is a short hash with no Latin
        prose in it, it is the one string that ties what a lead saw to a line
        in the log, and it is selectable so it can be pasted into a message.
        Absent in development, where the console above has the real thing.
      */}
      {error.digest === undefined ? null : (
        <p className={styles.digest}>
          מזהה התקלה: <code className={styles.code}>{error.digest}</code>
        </p>
      )}

      <div className={styles.actions}>
        <Button tone="primary" onClick={reset}>ניסיון נוסף</Button>
        <ButtonLink href={WAREHOUSE_PATH}>חזרה למחסן</ButtonLink>
      </div>
    </main>
  );
}
