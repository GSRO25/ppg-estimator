'use client';

import { useEffect, useState } from 'react';

interface Firm {
  id: number;
  name: string;
  slug: string;
  is_seed: boolean;
}

interface Props {
  projectId: number;
  initialConsultingEngineerId: number | null;
  initialConsultingEngineerName: string | null;
  initialBuilderId: number | null;
  initialBuilderName: string | null;
}

/**
 * Small inline editor for a project's consulting engineer + builder.
 * Used when auto-detection comes back "unknown" (e.g. drawings without
 * a readable title block), or when the estimator wants to override
 * the detected values.
 *
 * Writing here updates the project's FKs. All future drawings on this
 * project inherit the assignment via mapping resolution, and the
 * Review Queue (scoped to this CE) will auto-apply any prior
 * confirmed mappings from the same firm.
 */
export default function ProjectFirmPicker({
  projectId,
  initialConsultingEngineerId,
  initialConsultingEngineerName,
  initialBuilderId,
  initialBuilderName,
}: Props) {
  const [consultingEngineers, setConsultingEngineers] = useState<Firm[]>([]);
  const [builders, setBuilders] = useState<Firm[]>([]);
  const [ceId, setCeId] = useState<string>(initialConsultingEngineerId ? String(initialConsultingEngineerId) : '');
  const [builderId, setBuilderId] = useState<string>(initialBuilderId ? String(initialBuilderId) : '');
  const [ceName, setCeName] = useState(initialConsultingEngineerName ?? '');
  const [builderName, setBuilderName] = useState(initialBuilderName ?? '');
  const [newCeName, setNewCeName] = useState('');
  const [newBuilderName, setNewBuilderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/consulting-engineers').then(r => r.json()).then(setConsultingEngineers).catch(() => {});
    fetch('/api/builders').then(r => r.json()).then(setBuilders).catch(() => {});
  }, []);

  async function ensureFirm(kind: 'consulting-engineers' | 'builders', dropdownValue: string, newName: string): Promise<number | null> {
    if (!dropdownValue) return null;
    if (dropdownValue !== '__new__') return Number(dropdownValue);
    if (!newName.trim()) return null;
    const res = await fetch(`/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.error ?? 'Failed to add firm');
    }
    const created = await res.json() as { id: number; name: string };
    return created.id;
  }

  async function saveField(kind: 'consulting_engineer_id' | 'builder_id') {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const id = kind === 'consulting_engineer_id'
        ? await ensureFirm('consulting-engineers', ceId, newCeName)
        : await ensureFirm('builders', builderId, newBuilderName);
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [kind]: id }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `${res.status} ${res.statusText}`);
      }
      // Refresh the displayed name from the list
      if (kind === 'consulting_engineer_id') {
        const found = consultingEngineers.find(f => f.id === id);
        setCeName(found?.name ?? newCeName);
        setNewCeName('');
      } else {
        const found = builders.find(f => f.id === id);
        setBuilderName(found?.name ?? newBuilderName);
        setNewBuilderName('');
      }
      setSaved(kind === 'consulting_engineer_id' ? 'Consulting Engineer saved' : 'Builder saved');
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">Project attribution</h3>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          auto-detected on extraction · override below
        </span>
      </div>
      {error && <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>}
      {saved && <div className="mb-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">{saved}</div>}

      <div className="grid grid-cols-2 gap-4">
        {/* Consulting engineer */}
        <div>
          <label className="block text-xs font-medium text-slate-600">
            Consulting Engineer <span className="text-slate-400">(drives mapping dictionary)</span>
          </label>
          {ceName && !ceId && (
            <div className="mt-1 text-sm text-slate-700 font-medium">{ceName}</div>
          )}
          <select
            value={ceId}
            onChange={e => setCeId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">— not set (auto-detect) —</option>
            <option value="__new__">+ Add new firm</option>
            {consultingEngineers.length > 0 && <option disabled>──────────</option>}
            {consultingEngineers.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          {ceId === '__new__' && (
            <input
              value={newCeName}
              onChange={e => setNewCeName(e.target.value)}
              placeholder="Firm name, e.g. Jacobs"
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              autoFocus
            />
          )}
          <button
            onClick={() => saveField('consulting_engineer_id')}
            disabled={saving}
            className="mt-2 px-3 py-1.5 bg-ppg-navy text-white text-xs rounded hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save consulting engineer'}
          </button>
        </div>

        {/* Builder */}
        <div>
          <label className="block text-xs font-medium text-slate-600">
            Builder <span className="text-slate-400">(reporting only)</span>
          </label>
          {builderName && !builderId && (
            <div className="mt-1 text-sm text-slate-700 font-medium">{builderName}</div>
          )}
          <select
            value={builderId}
            onChange={e => setBuilderId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">— not set (auto-detect) —</option>
            <option value="__new__">+ Add new builder</option>
            {builders.length > 0 && <option disabled>──────────</option>}
            {builders.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          {builderId === '__new__' && (
            <input
              value={newBuilderName}
              onChange={e => setNewBuilderName(e.target.value)}
              placeholder="Builder name, e.g. Lendlease"
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          )}
          <button
            onClick={() => saveField('builder_id')}
            disabled={saving}
            className="mt-2 px-3 py-1.5 bg-ppg-navy text-white text-xs rounded hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save builder'}
          </button>
        </div>
      </div>
    </div>
  );
}
