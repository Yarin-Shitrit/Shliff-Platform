import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect, unstable_rethrow } from 'next/navigation';
import { signIn } from '@/lib/auth/config';
import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';
import styles from './signin.module.css';

/** Ruling S1: this rewrite subsumes Task 8's title rather than duplicating it. */
export const metadata: Metadata = { title: 'התחברות' };

/**
 * R9's one Hebrew line for a failed credentials sign-in, consulted through
 * the shared boundary every other server action already uses
 * (`src/app/(admin)/fees/actions.ts`) rather than a second, page-local map.
 */
const SIGNIN_ERRORS: HebrewErrors = [
  ['bad', 'האימייל או הסיסמה אינם נכונים'],
];

async function authenticate(formData: FormData) {
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
    redirect('/signin?error=bad');
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
            {toHebrewError(error, SIGNIN_ERRORS)}
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
