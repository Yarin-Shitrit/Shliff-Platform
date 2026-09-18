/**
 * C9: an icon, a sentence, and at most one action — enforced by the type
 * (`action` is a single optional object, never an array). A banner that needs
 * to write belongs in a Drawer or a ConfirmDialog, so the action is always an
 * `href`: that keeps this component free of `'use client'` and lets a banner
 * survive a refresh.
 *
 * R3: warning is gold (`--warn`), never orange — `--brand` is reserved for
 * primary action. Tone is never colour alone: the headline is the sentence
 * that says what is wrong, and the icon is a second, independent signal.
 */
import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { ButtonLink } from './button';
import { cx } from './cx';
import styles from './banner.module.css';

export type BannerTone = 'neutral' | 'info' | 'warn' | 'danger';

export type BannerProps = {
  tone?: BannerTone;
  /** The lead clause, rendered at weight 600. */
  headline: ReactNode;
  /** The rest of the sentence. */
  detail?: ReactNode;
  /** C9: at most one. A link, never a form. */
  action?: { label: string; href: string };
  /** Overrides the tone's default icon. */
  icon?: IconName;
  /** `role="status"` for a banner that appears in response to an action (E2). */
  live?: boolean;
};

const TONE_ICON: Record<BannerTone, IconName> = {
  neutral: 'info',
  info: 'info',
  warn: 'alert',
  danger: 'alert',
};

export function Banner({
  tone = 'neutral', headline, detail, action, icon, live,
}: BannerProps): ReactElement {
  return (
    <div className={cx(styles.banner, styles[tone])} role={live ? 'status' : undefined}>
      <span className={styles.icon}>
        <Icon name={icon ?? TONE_ICON[tone]} size={16} />
      </span>
      <span className={styles.text}>
        <b className={styles.headline}>{headline}</b>
        {detail ? <> {detail}</> : null}
      </span>
      {action ? (
        <ButtonLink size="sm" href={action.href}>{action.label}</ButtonLink>
      ) : null}
    </div>
  );
}
