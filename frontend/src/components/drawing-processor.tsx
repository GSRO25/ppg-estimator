'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Drawing } from '@/types/drawing';

interface Props {
  projectId: number;
  initialDrawings: Drawing[];
}

export default function DrawingProcessor({ projectId, initialDrawings }: Props) {
  const router = useRouter();
  const [drawings, setDrawings] = useState<Drawing[]>(initialDrawings);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const done = drawings.filter(
    d => d.extraction_status === 'complete' || d.extraction_status === 'failed'
  ).length;
  const pct = drawings.length > 0 ? Math.round((done / drawings.length) * 100) : 0;

  async function handleProcess() {
    setProcessing(true);
    setError(null);

    // Start polling immediately so the UI shows the progress bar
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/drawings`);
        const data: Drawing[] = await res.json();
        setDrawings(data);
      } catch {
        // ignore polling errors
      }
    }, 2000);
    intervalRef.current = interval;

    try {
      // Trigger extraction (this blocks until all drawings are processed)
      await fetch(`/api/projects/${projectId}/drawings/extract`, { method: 'POST' });

      // After extraction completes, do one final poll to get latest state
      const res = await fetch(`/api/projects/${projectId}/drawings`);
      const finalDrawings: Drawing[] = await res.json();
      setDrawings(finalDrawings);
      clearInterval(interval);
      intervalRef.current = null;

      // Generate takeoff from completed drawings
      await fetch(`/api/projects/${projectId}/takeoff`, { method: 'POST' });

      // Navigate to takeoff review
      router.push(`/dashboard/projects/${projectId}/takeoff`);
    } catch {
      clearInterval(interval);
      intervalRef.current = null;
      setProcessing(false);
      setError('Processing failed. Please try again.');
    }
  }

  const hasPending = drawings.some(d => d.extraction_status === 'pending');

  return (
    <div>
      {!processing && hasPending && (
        <button
          onClick={handleProcess}
          className="bg-ppg-blue hover:bg-ppg-navy text-white px-5 py-2.5 rounded-lg font-semibold text-sm"
        >
          Process Drawings
        </button>
      )}

      {processing && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600 font-medium">Processing drawings…</span>
            <span className="text-slate-500">{done}/{drawings.length} complete</span>
          </div>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="bg-ppg-blue h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          {drawings.some(d => d.extraction_status === 'failed') && (
            <p className="text-sm text-amber-600">
              Some drawings failed to process — continuing with successful ones
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
