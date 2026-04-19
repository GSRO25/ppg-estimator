import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import SidebarNav from './sidebar-nav';
import SignOutButton from './sign-out-button';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  return (
    <div className="h-screen flex bg-ppg-surface overflow-hidden">
      <aside className="w-60 bg-ppg-navy text-white p-5 flex flex-col overflow-y-auto shrink-0" aria-label="Sidebar">
        <div className="mb-8">
          <div className="text-2xl font-bold tracking-wide font-display">PPG</div>
          <p className="text-xs text-white/50 mt-1">Estimator</p>
          <p className="text-xs text-white/40 mt-0.5 truncate">{session.user?.email}</p>
        </div>
        <SidebarNav />
        <div className="mt-auto pt-4 border-t border-white/10">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-y-auto">{children}</main>
    </div>
  );
}
