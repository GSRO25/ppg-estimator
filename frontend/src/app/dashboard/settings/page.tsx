import Link from 'next/link';

const SETTING_LINKS = [
  { href: '/dashboard/settings/ai-usage', title: 'AI Usage', description: 'Claude API spend and call volume for this workspace.' },
  { href: '/dashboard/settings/audit', title: 'Audit Log', description: 'Record of important changes across the workspace.' },
];

export default function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Settings</h2>
      <div className="space-y-2">
        {SETTING_LINKS.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className="block bg-white rounded-lg shadow p-5 hover:shadow-md hover:bg-slate-50 transition-all"
          >
            <div className="text-sm font-semibold text-slate-800">{link.title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{link.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
