import { query } from '@/lib/db';
import type { Project } from '@/types/project';
import type { Drawing } from '@/types/drawing';
import DrawingsSection from '@/components/drawings-section';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await query<Project>('SELECT * FROM projects WHERE id = $1', [id]);
  if (!project) notFound();

  const drawings = await query<Drawing>(
    'SELECT * FROM drawings WHERE project_id = $1 ORDER BY uploaded_at DESC',
    [id]
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{project.name}</h2>
        <p className="text-gray-500">{project.client} — {project.address}</p>
      </div>
      <DrawingsSection projectId={project.id} initialDrawings={drawings} />
    </div>
  );
}
