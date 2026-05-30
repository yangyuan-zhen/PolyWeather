import { AdminSidebar } from "./AdminSidebar";
import styles from "./AdminShell.module.css";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.root}>
      <AdminSidebar />
      <main className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
