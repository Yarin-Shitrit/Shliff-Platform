import { ToastProvider } from '@/components/ui/toaster';
import { Sidebar } from './shell/sidebar';
import { SidebarFrame } from './shell/sidebar-frame';
import { ShellCountsProvider } from './shell/shell-counts';
import { TabBar } from './shell/tab-bar';
import styles from './layout.module.css';

/**
 * The shell (B1, B6, B7). A Server Component — it holds no state and reads
 * no search params, because the App Router gives a layout none (Ruling S2).
 * `SidebarFrame` and `TabBar` are the two client islands B7 needs (the
 * panel that opens below 1024px, the tab bar below 767.98px); the rail they
 * wrap or sit beside stays server-rendered.
 *
 * The top bar is not here: breadcrumbs, the scope chip and the page's
 * actions differ on every screen, so each page renders its own `TopBar` as
 * its first child (Ruling S1).
 *
 * A4 — plan 02's toast provider, mounted here (Task 10). Without this every
 * `useToast()` call throws, because no `ToastProvider` sat above it; it wraps
 * `children` alone so the sidebar's own controls stay outside the live
 * regions that announce a page's writes.
 *
 * `ShellCountsProvider` wraps both nav surfaces and nothing else: B2's counts
 * appear on the rail's badges and on B7's tab bar, and a rail saying 12 beside
 * a tab saying 9 is worse than either saying nothing.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShellCountsProvider>
      <div className={styles.ground}>
        {/*
          E4. The first thing Tab reaches on every screen, before the rail's
          fifteen links. It is first in the DOM because tab order follows the
          DOM and nothing here uses a positive tabIndex to pretend otherwise.

          It targets the panel rather than a `<main>` of its own: each page
          renders its own `<main>` (that is where the landmark lives), so a
          second one here would nest two landmarks inside each other. The panel
          carries `tabIndex={-1}` because a skip link pointing at something
          that cannot take focus scrolls the page and leaves the caret in the
          rail — the next Tab carries on through the nav, which is the exact
          failure the link exists to prevent, hidden behind a page that
          appeared to do the right thing.
        */}
        <a className={styles.skip} href="#main">דילוג לתוכן</a>
        <SidebarFrame>
          <Sidebar />
        </SidebarFrame>
        <div className={styles.column}>
          <div className={styles.main} id="main" tabIndex={-1}>
            <ToastProvider>{children}</ToastProvider>
          </div>
          <TabBar />
        </div>
      </div>
    </ShellCountsProvider>
  );
}
