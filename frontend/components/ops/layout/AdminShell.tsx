import { AdminSidebar } from "./AdminSidebar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AdminSidebar />
      <main className="ml-56 min-h-screen p-6">
        {children}
      </main>
    </div>
  );
}
