'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderOpen, CheckSquare, CreditCard, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderOpen },
  { href: '/dashboard/settings/mappings', label: 'Review Queue', icon: CheckSquare },
  { href: '/dashboard/rate-cards', label: 'Rate Cards', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== '/dashboard' &&
           pathname.startsWith(item.href + '/') &&
           !NAV_ITEMS.some(
             (other) => other.href !== item.href && pathname.startsWith(other.href) && other.href.length > item.href.length
           ));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-white/15 text-white font-semibold'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon size={16} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
