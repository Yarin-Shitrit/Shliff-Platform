import { Sidebar } from './shell/sidebar';
import styles from './layout.module.css';

/**
 * The shell (B1, B6). A Server Component — it holds no state and reads no
 * search params, because the App Router gives a layout none (Ruling S2).
 *
 * The top bar is not here: breadcrumbs, the scope chip and the page's
 * actions differ on every screen, so each page renders its own `TopBar` as
 * its first child (Ruling S1).
 *
 * A4 — plan 02 owns mounting the toast provider here, but plan 03's
 * `ToastProvider`/`useToast` (its Task 15) has not shipped yet at
 * `@/components/ui/toaster`. Toasts stay invisible until that file exists
 * and this seam is filled in:
 *
 *   import { ToastProvider } from '@/components/ui/toaster';
 *   …
 *   <ToastProvider>{children}</ToastProvider>
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.ground}>
      <Sidebar />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
