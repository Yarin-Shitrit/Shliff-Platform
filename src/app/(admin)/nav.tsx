'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './nav.module.css';

interface Section {
  href: string;
  label: string;
  /** Planned but not built: shown, never linked. */
  planned?: boolean;
}

const SECTIONS: Section[] = [
  { href: '/', label: 'סקירה' },
  { href: '/data', label: 'נתונים' },
  { href: '/upload', label: 'ייבוא' },
  { href: '/members', label: 'חברי מחנה' },
  { href: '/fees', label: 'דמי קאמפ' },
  { href: '/tasks', label: 'משימות' },
];

export function Nav() {
  const current = usePathname();

  return (
    <nav className={styles.nav} aria-label="ניווט ראשי">
      <span className={styles.brand}>
        <Image src="/logo-dark.png" alt="" width={64} height={64} className={styles.mark} />
        <span className={styles.wordmark}>קופת שליף</span>
      </span>
      <ul className={styles.list}>
        {SECTIONS.map((section) =>
          section.planned ? (
            <li key={section.href}>
              <span className={styles.planned} aria-disabled="true">
                {section.label}
                <span className={styles.soon}>בקרוב</span>
              </span>
            </li>
          ) : (
            <li key={section.href}>
              <Link
                href={section.href}
                className={styles.link}
                aria-current={current === section.href ? 'page' : undefined}
              >
                {section.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
