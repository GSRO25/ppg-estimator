import { query } from '@/lib/db';
import type { Project } from '@/types/project';
import type { Drawing } from '@/types/drawing';
import Link from 'next/link';
import DrawingUpload from '@/components/drawing-upload';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function ExtractButton({ projectId }: { projectId: number }) {
  return (
    <form action={async () => {
      'use server';
      await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/projects/${projectId}/drawings/extract`, { method: 'POST' });
    }}>
      <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium">
        Run Extraction
      </button>
    </form>
  );
}

async function GenerateTakeoffButton({ projectId }: { projectId: number }) {
  return (
    <form action={async () => {
      'use server';
      await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/projects/${projectId}/takeoff`, { method: 'POST' });
    }}>
      <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm font-medium">
        Generate Takeoff
      </button>
    </form>
  );
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  processing: 'bg-yellow-100 text-yellow-700',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await query<Project>('SELECT * FROM projects WHERE id = $1', [id]);
  if (!project) notFound();

  const drawings = await query<Drawing>(
    'SELECT * FROM drawings WHERE project_id = $1 ORDER BY uploaded_at DESC',
    [id]
  );

  const hasCompleteDrawings = drawings.some(d => d.extraction_status === 'complete');
  const hasPendingDrawings = drawings.some(d => d.extraction_status === 'pending');

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{project.name}</h2>
          <p className="text-gray-500">{project.client} — {project.address}</p>
        </div>
        <div className="flex gap-3">
          {hasPendingDrawings && <ExtractButton projectId={project.id} />}
          {hasCompleteDrawings && <GenerateTakeoffButton projectId={project.id} />}
          {hasCompleteDrawings && (
            <Link href={`/dashboard/projects/${id}/takeoff`} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
              View Takeoff
            </Link>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Drawings</h3>
          <DrawingUpload projectId={project.id} />
          {drawings.length > 0 && (
            <table className="min-w-full divide-y divide-gray-200 mt-4">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Format</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {drawings.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 text-sm">{d.filename}</td>
                    <td className="px-4 py-3 text-sm uppercase text-gray-500">{d.format}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{d.category.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[d.extraction_status]}`}>
                        {d.extraction_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
