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
  /**
   * The id of the sentence that says what this verb will do. `Button` assumes
   * a form layout, where that sentence sits above the control in the form's
   * own prose; a verb in a table row has it somewhere else — the cell beside
   * it, the row's warning — and must not swallow it, because the name has to
   * stay the verb (R8). So the sentence is tied by reference, the way `Field`
   * already ties a control to its hint. It is a description, never a name:
   * `iconLabel` is still what names an icon-only button.
   */
  'aria-describedby'?: string;
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
  'aria-describedby': describedBy,
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
      aria-describedby={describedBy}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  tone = 'default', size = 'md', iconLabel, children, href, replace,
  'aria-describedby': describedBy,
}: ButtonLinkProps): ReactElement {
  return (
    <Link
      className={classes(tone, size, iconLabel)}
      href={href}
      replace={replace}
      aria-label={iconLabel}
      aria-describedby={describedBy}
    >
      {children}
    </Link>
  );
}
