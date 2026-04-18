import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import SidebarNav from './sidebar-nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen flex bg-ppg-surface">
      <aside className="w-60 bg-ppg-navy text-white p-5 flex flex-col min-h-screen shrink-0">
        <div className="mb-8">
          <div className="text-2xl font-bold tracking-wide font-display">PPG</div>
          <p className="text-xs text-white/50 mt-1">Estimator</p>
          <p className="text-xs text-white/40 mt-0.5 truncate">{session.user?.email}</p>
        </div>
        <SidebarNav />
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
