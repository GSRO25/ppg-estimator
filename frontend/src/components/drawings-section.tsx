'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Drawing } from '@/types/drawing';
import DrawingUpload from '@/components/drawing-upload';

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  processing: 'bg-yellow-100 text-yellow-700 animate-pulse',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((endMs - startMs) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default function DrawingsSection({ projectId, initialDrawings }: { projectId: number; initialDrawings: Drawing[] }) {
  const router = useRouter();
  const [drawings, setDrawings] = useState<Drawing[]>(initialDrawings);
  const [processing, setProcessing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { setDrawings(initialDrawings); }, [initialDrawings]);
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const done = drawings.filter(d => d.extraction_status === 'complete' || d.extraction_status === 'failed').length;
  const pct = drawings.length > 0 ? Math.round((done / drawings.length) * 100) : 0;
  const hasPending = drawings.some(d => d.extraction_status === 'pending');
  const hasComplete = drawings.some(d => d.extraction_status === 'complete');

  async function handleProcess() {
    setProcessing(true);
    setError(null);

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/drawings`);
        const data: Drawing[] = await res.json();
        if (mountedRef.current) setDrawings(data);
      } catch { /* ignore */ }
    }, 1500);
    intervalRef.current = interval;

    let extractionFailed = false;
    try {
      const extractRes = await fetch(`/api/projects/${projectId}/drawings/extract`, { method: 'POST' });
      if (!extractRes.ok) extractionFailed = true;
    } catch {
      extractionFailed = true;
    }

    const deadline = Date.now() + 10 * 60 * 1000;
    let finalDrawings = drawings;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`/api/projects/${projectId}/drawings`);
        finalDrawings = await res.json();
        if (mountedRef.current) setDrawings(finalDrawings);
        const stillRunning = finalDrawings.some(d => d.extraction_status === 'pending' || d.extraction_status === 'processing');
        if (!stillRunning) break;
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 1500));
    }

    clearInterval(interval);
    intervalRef.current = null;
    if (!mountedRef.current) return;

    const anyComplete = finalDrawings.some(d => d.extraction_status === 'complete');
    if (!anyComplete) {
      setProcessing(false);
      setError(extractionFailed ? 'Extraction failed. Please try again.' : 'No drawings extracted successfully.');
      return;
    }

    try {
      const takeoffRes = await fetch(`/api/projects/${projectId}/takeoff`, { method: 'POST' });
      if (!takeoffRes.ok) throw new Error(`Takeoff generation failed: ${takeoffRes.status}`);
    } catch {
      setProcessing(false);
      setError('Takeoff generation failed. Please try again.');
      return;
    }

    setProcessing(false);
    router.push(`/dashboard/projects/${projectId}/takeoff`);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `ppg-autoprocess-${projectId}`;
    if (sessionStorage.getItem(key) === '1' && hasPending && !processing) {
      sessionStorage.removeItem(key);
      handleProcess();
    }
  }, [hasPending, processing, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="flex justify-end items-center gap-3 mb-4">
        {!processing && hasPending && (
          <button onClick={handleProcess} className="bg-ppg-blue hover:bg-ppg-navy text-white px-5 py-2.5 rounded-lg font-semibold text-sm">
            Process Drawings
          </button>
        )}
        {processing && (
          <div className="flex-1 max-w-md">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-slate-600 font-medium">Processing drawings…</span>
              <span className="text-slate-500">{done}/{drawings.length} complete</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="bg-ppg-blue h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {hasComplete && !processing && (
          <>
            <button
              onClick={async () => {
                setRegenerating(true);
                setError(null);
                try {
                  await fetch(`/api/projects/${projectId}/takeoff`, { method: 'POST' });
                  router.push(`/dashboard/projects/${projectId}/takeoff`);
                } catch {
                  setError('Takeoff regeneration failed.');
                } finally {
                  setRegenerating(false);
                }
              }}
              disabled={regenerating}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate Takeoffs'}
            </button>
            <Link href={`/dashboard/projects/${projectId}/takeoff`} className="px-4 py-2 bg-ppg-blue text-white rounded-md hover:bg-ppg-navy text-sm font-medium">
              View Takeoff
            </Link>
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Drawings</h3>
        <DrawingUpload projectId={projectId} />
        {drawings.length > 0 && (
          <table className="min-w-full divide-y divide-gray-200 mt-4">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Format</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Finished</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
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
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{fmtTime(d.extraction_started_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{fmtTime(d.extraction_completed_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{fmtDuration(d.extraction_started_at, d.extraction_completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
