import Link from 'next/link';
import { query } from '@/lib/db';
import type { Project } from '@/types/project';
import { formatDate } from '@/lib/utils';
import DeleteProjectButton from '@/components/delete-project-button';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await query<Project>('SELECT * FROM projects ORDER BY created_at DESC');

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    extracting: 'bg-yellow-100 text-yellow-700',
    review: 'bg-blue-100 text-blue-700',
    estimated: 'bg-green-100 text-green-700',
    exported: 'bg-purple-100 text-purple-700',
    archived: 'bg-gray-200 text-gray-500',
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Projects</h2>
        <Link
          href="/dashboard/projects/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
        >
          New Project
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="text-gray-500">No projects yet. Create your first project to get started.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {projects.map((project) => (
                <tr key={project.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link href={`/dashboard/projects/${project.id}`} className="text-blue-600 hover:underline font-medium">
                      {project.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{project.client || '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[project.status] || ''}`}>
                      {project.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatDate(project.created_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <DeleteProjectButton projectId={project.id} projectName={project.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
