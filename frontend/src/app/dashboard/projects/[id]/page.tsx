import { query } from '@/lib/db';
import type { Project } from '@/types/project';
import type { Drawing } from '@/types/drawing';
import DrawingsSection from '@/components/drawings-section';
import ProjectFirmPicker from '@/components/project-firm-picker';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface ProjectWithFirms extends Project {
  consulting_engineer_id: number | null;
  consulting_engineer_name: string | null;
  builder_id: number | null;
  builder_name: string | null;
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await query<ProjectWithFirms>(
    `SELECT p.*,
            ce.name AS consulting_engineer_name,
            b.name AS builder_name
     FROM projects p
     LEFT JOIN consulting_engineers ce ON ce.id = p.consulting_engineer_id
     LEFT JOIN builders b ON b.id = p.builder_id
     WHERE p.id = $1`,
    [id]
  );
  if (!project) notFound();

  const drawings = await query<Drawing>(
    'SELECT * FROM drawings WHERE project_id = $1 ORDER BY uploaded_at DESC',
    [id]
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{project.name}</h2>
        <p className="text-gray-500">
          {project.client}
          {project.address ? ` — ${project.address}` : ''}
          {project.consulting_engineer_name && (
            <> · <span className="text-slate-600 font-medium">{project.consulting_engineer_name}</span></>
          )}
          {project.builder_name && (
            <> for <span className="text-slate-600 font-medium">{project.builder_name}</span></>
          )}
        </p>
      </div>

      <ProjectFirmPicker
        projectId={project.id}
        initialConsultingEngineerId={project.consulting_engineer_id}
        initialConsultingEngineerName={project.consulting_engineer_name}
        initialBuilderId={project.builder_id}
        initialBuilderName={project.builder_name}
      />

      <DrawingsSection projectId={project.id} initialDrawings={drawings} />
    </div>
  );
}
