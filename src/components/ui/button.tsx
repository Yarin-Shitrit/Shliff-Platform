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

export type ButtonLinkProps = ButtonShared & {
  href: string;
  replace?: boolean;
  /**
   * The destination is a file, not a page. Next's `Link` declines to intercept
   * a click on an anchor carrying `download` (`next/dist/client/app-dir/link.js`
   * checks `hasAttribute('download')` alongside the modified-event test), so
   * the browser performs a real navigation and the file lands in the reader's
   * downloads folder. Without it, the client router fetches a Route Handler's
   * CSV as an RSC payload and nothing is saved — which is why the export
   * action reached for `window.location.assign` and an eslint disable.
   *
   * A download also opens in its own browsing context (`target="_blank"`).
   * The app is installable on the home screen (`appleWebApp.capable`,
   * `display: standalone`), and there a same-window navigation to a file
   * replaces the whole app with the phone's file preview — a black screen
   * with "Open in Notes" — and no back control, because a standalone app has
   * no browser chrome. In a new context the phone hands the file to a sheet
   * with its own "Done", and the app is still there underneath. In a desktop
   * browser the pair `download` + `_blank` just downloads, with no tab left
   * behind. `rel="noopener"` because that is what every `_blank` carries.
   */
  download?: boolean;
};

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
  tone = 'default', size = 'md', iconLabel, children, href, replace, download,
  'aria-describedby': describedBy,
}: ButtonLinkProps): ReactElement {
  return (
    <Link
      className={classes(tone, size, iconLabel)}
      href={href}
      replace={replace}
      download={download}
      target={download ? '_blank' : undefined}
      rel={download ? 'noopener' : undefined}
      aria-label={iconLabel}
      aria-describedby={describedBy}
    >
      {children}
    </Link>
  );
}
