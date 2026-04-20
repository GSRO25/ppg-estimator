'use client';

import { useState, useCallback, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';

const ACCEPTED_FORMATS = '.dwg,.dxf,.pdf';

// Nginx client_max_body_size is 500 MB; keep this slightly below so we warn
// the user before the upload even starts, instead of failing server-side.
const TOTAL_UPLOAD_LIMIT_MB = 490;

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DrawingUpload({ projectId }: { projectId: number }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  }, []);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const overLimit = totalBytes > TOTAL_UPLOAD_LIMIT_MB * 1024 * 1024;

  async function handleUpload() {
    if (files.length === 0) return;
    if (overLimit) {
      setError(`Total upload size (${fmtMB(totalBytes)}) exceeds the ${TOTAL_UPLOAD_LIMIT_MB} MB limit. Upload in smaller batches.`);
      return;
    }
    setUploading(true);
    setError(null);
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    try {
      const res = await fetch(`/api/projects/${projectId}/drawings`, { method: 'POST', body: formData });
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error(`Upload too large (${fmtMB(totalBytes)}). Server limit is 500 MB — upload in smaller batches.`);
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed: ${res.status} ${res.statusText}`);
      }
      setFiles([]);
      sessionStorage.setItem(`ppg-autoprocess-${projectId}`, '1');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
      <input
        type="file"
        multiple
        accept={ACCEPTED_FORMATS}
        onChange={handleFileChange}
        className="hidden"
        id="drawing-upload"
      />
      <label htmlFor="drawing-upload" className="cursor-pointer">
        <p className="text-gray-500">Click to select or drag and drop DWG, DXF, or PDF files</p>
      </label>
      {files.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-gray-700">
            {files.length} file{files.length === 1 ? '' : 's'} selected · {fmtMB(totalBytes)}
          </p>
          <ul className="text-sm text-gray-500 mt-1">
            {files.map((f, i) => <li key={i}>{f.name} <span className="text-gray-400">({fmtMB(f.size)})</span></li>)}
          </ul>
          {overLimit && (
            <p className="mt-2 text-xs text-red-600">
              Over {TOTAL_UPLOAD_LIMIT_MB} MB limit — reduce the selection or upload in batches.
            </p>
          )}
          <button
            onClick={handleUpload}
            disabled={uploading || overLimit}
            className="mt-3 px-4 py-2 bg-ppg-blue text-white rounded-md hover:bg-ppg-navy disabled:opacity-50 text-sm"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}
      {error && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 text-left">
          {error}
        </div>
      )}
    </div>
  );
}
