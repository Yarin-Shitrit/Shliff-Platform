import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import styles from './sidebar.module.css';

/**
 * The `users` table carries an address and a role and no display name, so
 * the block shows the address someone signs in with rather than inventing a
 * name for them. D4's people are a different thing entirely.
 */
export function initialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const words = local.split(/[._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1
    ? `${words[0][0]}${words[1][0]}`
    : words[0].slice(0, 2);
  return letters.toUpperCase();
}

/**
 * B9's user block. Presentational on purpose: the sign-out action arrives as
 * a prop, so this file never imports `@/lib/auth/config` and stays testable
 * without a database. `children` is where the rail hangs the theme toggle,
 * so the two sit in the same row without this file knowing what a theme is.
 */
export function UserBlock(
  { email, onSignOut, children }: {
    email: string;
    onSignOut: () => Promise<void>;
    children?: ReactNode;
  },
) {
  return (
    <div className={styles.userrow}>
      <span className={styles.avatar} aria-hidden="true">{initialsFromEmail(email)}</span>
      <span className={styles.usermail} dir="ltr">{email}</span>
      <span className={styles.userActions}>
        {children}
        <form action={onSignOut}>
          <Button type="submit" tone="ghost" size="sm" iconLabel="יציאה מהחשבון">
            <Icon name="logout" size={16} />
          </Button>
        </form>
      </span>
    </div>
  );
}
