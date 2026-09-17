import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { cx } from './cx';
import styles from './button.module.css';

export type ButtonTone = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

type ButtonShared = {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Icon-only: `children` is the icon and this is the button's name (E4). */
  iconLabel?: string;
  children: ReactNode;
};

export type ButtonProps = ButtonShared & {
  type?: 'button' | 'submit';
  disabled?: boolean;
  name?: string;
  value?: string;
  onClick?: () => void;
};

export type ButtonLinkProps = ButtonShared & { href: string; replace?: boolean };

function classes(tone: ButtonTone, size: ButtonSize, iconLabel: string | undefined): string {
  return cx(
    styles.btn,
    tone !== 'default' && styles[tone],
    size === 'sm' && styles.sm,
    iconLabel !== undefined && styles.icon,
  );
}

export function Button({
  tone = 'default', size = 'md', iconLabel, children,
  type = 'button', disabled, name, value, onClick,
}: ButtonProps): ReactElement {
  return (
    <button
      className={classes(tone, size, iconLabel)}
      type={type}
      disabled={disabled}
      name={name}
      value={value}
      onClick={onClick}
      aria-label={iconLabel}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  tone = 'default', size = 'md', iconLabel, children, href, replace,
}: ButtonLinkProps): ReactElement {
  return (
    <Link
      className={classes(tone, size, iconLabel)}
      href={href}
      replace={replace}
      aria-label={iconLabel}
    >
      {children}
    </Link>
  );
}
