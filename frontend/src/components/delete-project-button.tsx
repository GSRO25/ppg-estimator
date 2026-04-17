'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DeleteProjectButton({ projectId, projectName }: { projectId: number; projectName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    router.refresh();
  }

  if (confirming) {
    return (
      <span className="inline-flex gap-2">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-2 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title={`Delete "${projectName}"`}
      className="px-2 py-1 text-red-500 hover:text-red-700 text-xs font-medium hover:bg-red-50 rounded"
    >
      Delete
    </button>
  );
}
