'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

interface Firm {
  id: number;
  name: string;
  slug: string;
  is_seed: boolean;
}

export default function ProjectForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [consultingEngineers, setConsultingEngineers] = useState<Firm[]>([]);
  const [builders, setBuilders] = useState<Firm[]>([]);
  const [ceId, setCeId] = useState<string>('');
  const [builderId, setBuilderId] = useState<string>('');
  const [newCeName, setNewCeName] = useState('');
  const [newBuilderName, setNewBuilderName] = useState('');

  useEffect(() => {
    fetch('/api/consulting-engineers').then(r => r.json()).then(setConsultingEngineers).catch(() => {});
    fetch('/api/builders').then(r => r.json()).then(setBuilders).catch(() => {});
  }, []);

  async function ensureFirm(kind: 'consulting-engineers' | 'builders', dropdownValue: string, newName: string): Promise<number | null> {
    if (dropdownValue && dropdownValue !== '__new__') return Number(dropdownValue);
    if (dropdownValue === '__new__' && newName.trim()) {
      const res = await fetch(`/api/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `Failed to add ${kind}`);
      }
      const created = await res.json() as { id: number };
      return created.id;
    }
    return null;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(e.currentTarget);

    try {
      const finalCeId = await ensureFirm('consulting-engineers', ceId, newCeName);
      const finalBuilderId = await ensureFirm('builders', builderId, newBuilderName);

      const body = {
        name: form.get('name'),
        client: form.get('client'),
        address: form.get('address'),
        start_date: form.get('start_date') || null,
        end_date: form.get('end_date') || null,
        consulting_engineer_id: finalCeId,
        builder_id: finalBuilderId,
      };
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `${res.status} ${res.statusText}`);
      }
      const project = await res.json();
      router.push(`/dashboard/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
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

      {/* Consulting Engineer */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Consulting Engineer{' '}
          <span className="text-xs font-normal text-gray-400">— drives mapping dictionary</span>
        </label>
        <select
          value={ceId}
          onChange={e => setCeId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm bg-white"
        >
          <option value="">— select —</option>
          {consultingEngineers.map(f => (
            <option key={f.id} value={f.id}>{f.name}{!f.is_seed ? ' (custom)' : ''}</option>
          ))}
          <option value="__new__">+ Add new consulting engineer…</option>
        </select>
        {ceId === '__new__' && (
          <input
            value={newCeName}
            onChange={e => setNewCeName(e.target.value)}
            placeholder="Firm name, e.g. SomeNewCo Engineering"
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm"
            autoFocus
          />
        )}
      </div>

      {/* Builder */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Builder{' '}
          <span className="text-xs font-normal text-gray-400">— for reporting only</span>
        </label>
        <select
          value={builderId}
          onChange={e => setBuilderId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm bg-white"
        >
          <option value="">— select —</option>
          {builders.map(f => (
            <option key={f.id} value={f.id}>{f.name}{!f.is_seed ? ' (custom)' : ''}</option>
          ))}
          <option value="__new__">+ Add new builder…</option>
        </select>
        {builderId === '__new__' && (
          <input
            value={newBuilderName}
            onChange={e => setNewBuilderName(e.target.value)}
            placeholder="Builder name"
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm"
          />
        )}
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

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-ppg-blue text-white rounded-md hover:bg-ppg-navy disabled:opacity-50 text-sm font-medium"
      >
        {submitting ? 'Creating…' : 'Create Project'}
      </button>
    </form>
  );
}
