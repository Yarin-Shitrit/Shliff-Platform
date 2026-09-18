import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect, unstable_rethrow } from 'next/navigation';
import { CredentialsSignin } from 'next-auth';
import { signIn } from '@/lib/auth/config';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import styles from './signin.module.css';

/** Ruling S1: this rewrite subsumes Task 8's title rather than duplicating it. */
export const metadata: Metadata = { title: 'התחברות' };

/**
 * `error` is a public search param on an unauthenticated page — not a server
 * error `toHebrewError` was written to translate — so it is matched here
 * exactly, against a closed record, instead of being handed to that module's
 * Hebrew-passthrough. Anything that isn't one of these exact keys (including
 * a crafted string that merely starts with one, or contains Hebrew of its
 * own) renders the same shared `HEBREW_FALLBACK` every other server action
 * falls back to, never the attacker's text.
 */
const SIGNIN_ERRORS: Record<string, string> = {
  bad: 'האימייל או הסיסמה אינם נכונים',
  unknown: 'משהו השתבש. נסו שוב מאוחר יותר.',
};

function signinError(error: string | undefined): string {
  return SIGNIN_ERRORS[error ?? ''] ?? HEBREW_FALLBACK;
}

/**
 * Exported so the catch block below — which never returns a value, only
 * redirects — can be driven directly from a test instead of through a DOM
 * form submission.
 */
export async function authenticate(formData: FormData) {
  'use server';
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/',
    });
  } catch (error) {
    // A successful sign-in resolves by throwing Next's own redirect signal;
    // that must reach Next.js untouched, not be treated as a failed attempt.
    unstable_rethrow(error);

    // Without this, a wrong password, a dead database and an argon2 failure
    // were indistinguishable — to the person signing in AND to the operator,
    // because nothing was logged. Log the error, never the submitted
    // credentials: only `error` is passed here, not `formData`.
    console.error('signin failed', error);

    redirect(error instanceof CredentialsSignin ? '/signin?error=bad' : '/signin?error=unknown');
  }
}

export default async function SignInPage(
  { searchParams }: { searchParams: Promise<{ error?: string }> },
) {
  const { error } = await searchParams;

  return (
    <main className={styles.page}>
      <form action={authenticate} className={styles.card}>
        <div className={styles.brand}>
          <Image src="/logo.png" alt="" width={48} height={48} className={styles.markLight} />
          <Image src="/logo-dark.png" alt="" width={48} height={48} className={styles.markDark} />
          <span className={styles.wordmark}>קופת שליף</span>
        </div>

        {error !== undefined && (
          <p role="alert" className={styles.error}>
            {signinError(error)}
          </p>
        )}

        <label className={styles.field} htmlFor="email">
          <span>אימייל</span>
          <input
            id="email" name="email" type="email" autoComplete="email" required dir="ltr"
            className={styles.input}
          />
        </label>

        <label className={styles.field} htmlFor="password">
          <span>סיסמה</span>
          <input
            id="password" name="password" type="password" autoComplete="current-password" required
            dir="ltr" className={styles.input}
          />
        </label>

        <button type="submit" className={styles.submit}>כניסה</button>
      </form>
    </main>
  );
}
