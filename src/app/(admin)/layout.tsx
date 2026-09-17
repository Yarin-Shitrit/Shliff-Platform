import { Nav } from './nav';
import { ThemeToggle } from '@/components/theme-toggle';
import styles from './layout.module.css';

/**
 * The toggle sits here, above the page, until Plan 02 replaces this shell:
 * B1 puts it in the sidebar footer beside the signed-in user. It is mounted
 * now rather than later so that the theme this plan builds is switchable the
 * day the plan lands, instead of being a component with a test and no home.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.ground}>
      <Nav />
      <ThemeToggle />
      {children}
    </div>
  );
}
