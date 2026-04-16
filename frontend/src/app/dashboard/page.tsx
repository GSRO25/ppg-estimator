import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/dashboard/projects/new" className="block p-6 bg-white rounded-lg shadow hover:shadow-md transition">
          <h3 className="text-lg font-semibold text-gray-900">New Project</h3>
          <p className="text-sm text-gray-500 mt-1">Start a new takeoff estimate</p>
        </Link>
        <Link href="/dashboard/projects" className="block p-6 bg-white rounded-lg shadow hover:shadow-md transition">
          <h3 className="text-lg font-semibold text-gray-900">Projects</h3>
          <p className="text-sm text-gray-500 mt-1">View and manage existing projects</p>
        </Link>
        <Link href="/dashboard/rate-cards" className="block p-6 bg-white rounded-lg shadow hover:shadow-md transition">
          <h3 className="text-lg font-semibold text-gray-900">Rate Cards</h3>
          <p className="text-sm text-gray-500 mt-1">Manage labour and material rates</p>
        </Link>
      </div>
    </div>
  );
}
