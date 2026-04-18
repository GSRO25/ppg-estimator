'use client';

import { useState, useCallback, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';

const ACCEPTED_FORMATS = '.dwg,.dxf,.pdf';

export default function DrawingUpload({ projectId }: { projectId: number }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  }, []);

  async function handleUpload() {
    if (files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    await fetch(`/api/projects/${projectId}/drawings`, { method: 'POST', body: formData });
    setFiles([]);
    setUploading(false);
    sessionStorage.setItem(`ppg-autoprocess-${projectId}`, '1');
    router.refresh();
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
          <p className="text-sm font-medium text-gray-700">{files.length} file(s) selected</p>
          <ul className="text-sm text-gray-500 mt-1">
            {files.map((f, i) => <li key={i}>{f.name}</li>)}
          </ul>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="mt-3 px-4 py-2 bg-ppg-blue text-white rounded-md hover:bg-ppg-navy disabled:opacity-50 text-sm"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      )}
    </div>
  );
}
