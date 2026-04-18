'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function ProjectForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name'),
      client: form.get('client'),
      address: form.get('address'),
      start_date: form.get('start_date') || null,
      end_date: form.get('end_date') || null,
    };
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const project = await res.json();
      router.push(`/dashboard/projects/${project.id}`);
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Project Name *</label>
        <input name="name" required className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Client</label>
        <input name="client" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Address</label>
        <input name="address" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Start Date</label>
          <input name="start_date" type="date" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">End Date</label>
          <input name="end_date" type="date" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm" />
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-ppg-blue text-white rounded-md hover:bg-ppg-navy disabled:opacity-50 text-sm font-medium"
      >
        {submitting ? 'Creating...' : 'Create Project'}
      </button>
    </form>
  );
}
