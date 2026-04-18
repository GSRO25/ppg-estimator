'use client';

import { useState, useRef, useEffect } from 'react';
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
  const pollGenRef = useRef(0);

  // Fix 1: Guard against state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // Fix 1: Clear interval on unmount to prevent leak
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, []);

  const done = drawings.filter(
    d => d.extraction_status === 'complete' || d.extraction_status === 'failed'
  ).length;
  const pct = drawings.length > 0 ? Math.round((done / drawings.length) * 100) : 0;

  async function handleProcess() {
    setProcessing(true);
    setError(null);

    // Fix 3: Capture generation counter to invalidate stale poll callbacks
    const gen = ++pollGenRef.current;

    // Start polling immediately so the UI shows the progress bar
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/drawings`);
        const data: Drawing[] = await res.json();
        // Fix 3: Only update state if this poll callback is still current
        if (pollGenRef.current === gen) {
          setDrawings(data);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    intervalRef.current = interval;

    try {
      // Trigger extraction (this blocks until all drawings are processed)
      const extractRes = await fetch(`/api/projects/${projectId}/drawings/extract`, { method: 'POST' });
      // Fix 4: Check for HTTP errors on extraction
      if (!extractRes.ok) throw new Error(`Extraction API error: ${extractRes.status}`);

      // After extraction completes, do one final poll to get latest state
      const res = await fetch(`/api/projects/${projectId}/drawings`);
      const finalDrawings: Drawing[] = await res.json();
      // Fix 3 + Fix 2: Invalidate in-flight callbacks and guard unmounted state update
      pollGenRef.current++;
      clearInterval(interval);
      intervalRef.current = null;
      if (!mountedRef.current) return;
      setDrawings(finalDrawings);

      // Generate takeoff from completed drawings
      const takeoffRes = await fetch(`/api/projects/${projectId}/takeoff`, { method: 'POST' });
      // Fix 4: Check for HTTP errors on takeoff generation
      if (!takeoffRes.ok) throw new Error(`Takeoff generation failed: ${takeoffRes.status}`);

      // Fix 2 + Fix 5: Guard unmount and reset processing before navigation
      if (!mountedRef.current) return;
      setProcessing(false);
      router.push(`/dashboard/projects/${projectId}/takeoff`);
    } catch {
      pollGenRef.current++;
      clearInterval(interval);
      intervalRef.current = null;
      setProcessing(false);
      setError('Processing failed. Please try again.');
    }
  }

  const hasPending = drawings.some(d => d.extraction_status === 'pending');

  // Auto-start processing if flagged by upload
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `ppg-autoprocess-${projectId}`;
    if (sessionStorage.getItem(key) === '1' && hasPending && !processing) {
      sessionStorage.removeItem(key);
      handleProcess();
    }
  }, [hasPending, processing, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {!processing && hasPending && (
        <button
          onClick={handleProcess}
          disabled={processing}
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
