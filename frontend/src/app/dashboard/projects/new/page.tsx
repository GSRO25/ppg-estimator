import ProjectForm from '@/components/project-form';

export default function NewProjectPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">New Project</h2>
      <div className="bg-white rounded-lg shadow p-6">
        <ProjectForm />
      </div>
    </div>
  );
}
