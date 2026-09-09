import { Nav } from './nav';
import styles from './layout.module.css';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.ground}>
      <Nav />
      {children}
    </div>
  );
}
