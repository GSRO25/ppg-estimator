'use client';

import { useEffect, useState } from 'react';
import type { TakeoffRow } from './takeoff-grid';
import DrawingViewer from './drawing-viewer';

interface RateItem {
  id: number;
  section_number: number;
  section_name: string;
  description: string;
  uom: string;
  labour_rate: number;
  material_rate: number;
  plant_rate: number;
}

interface Props {
  row: TakeoffRow | null;
  onClose: () => void;
  onSaved: (updatedRow: TakeoffRow) => void;
  projectId: string;
}

export default function TakeoffRowEditor({ row, onClose, onSaved, projectId }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<RateItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showViewer, setShowViewer] = useState(false);

  useEffect(() => {
    if (!row) return;
    setSearch('');
    const defaultSection = row.section_number !== 99 ? `&section=${row.section_number}` : '';
    fetch(`/api/rate-cards/search?q=${defaultSection}`).then(r => r.json()).then(setResults);
  }, [row]);

  useEffect(() => {
    if (!row) return;
    const t = setTimeout(() => {
      const url = `/api/rate-cards/search?q=${encodeURIComponent(search)}`;
      fetch(url).then(r => r.json()).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [search, row]);

  if (!row) return null;

  async function assignItem(item: RateItem) {
    if (!row) return;
    setSaving(true);
    await fetch(`/api/projects/${projectId}/takeoff`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: row.id,
        rateCardItemId: item.id,
        rememberMapping: remember,
      }),
    });
    onSaved({
      ...row,
      rate_card_item_id: item.id,
      section_number: item.section_number,
      section_name: item.section_name,
      labour_rate: item.labour_rate,
      material_rate: item.material_rate,
      plant_rate: item.plant_rate,
    } as TakeoffRow);
    setSaving(false);
    onClose();
  }

  async function unassign() {
    if (!row) return;
    setSaving(true);
    await fetch(`/api/projects/${projectId}/takeoff`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: row.id, rateCardItemId: null }),
    });
    onSaved({ ...row, rate_card_item_id: null, labour_rate: null, material_rate: null, plant_rate: null } as TakeoffRow);
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <div
        className="w-[560px] bg-white shadow-2xl flex flex-col h-full"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs text-gray-400 uppercase">Edit Takeoff Row</div>
              <div className="text-base font-semibold text-gray-900 mt-1">{row.description}</div>
              <div className="text-xs text-gray-500 mt-1">
                Currently in: <span className="font-medium">{row.section_name}</span> · QTY {row.final_qty} {row.uom}
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

          {row.drawing_id && row.drawing_region && (
            <button
              onClick={() => setShowViewer(true)}
              className="mt-3 px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700"
            >
              📐 View in drawing
            </button>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search rate card (e.g. 100mm PVC, Basin)…"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {row.rate_card_item_id && (
              <button
                onClick={unassign}
                disabled={saving}
                className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap disabled:opacity-50"
              >
                Unassign
              </button>
            )}
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            Remember this mapping (apply to future extractions with the same CAD name)
          </label>
        </div>

        <div className="flex-1 overflow-auto">
          {results.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No matches</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map(item => {
                const isCurrent = item.id === row.rate_card_item_id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => assignItem(item)}
                      disabled={saving || isCurrent}
                      className={`w-full text-left px-5 py-3 hover:bg-blue-50 disabled:opacity-60 disabled:cursor-default ${isCurrent ? 'bg-blue-50' : ''}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">{item.description}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {item.section_name} · {item.uom || '—'}
                          </div>
                        </div>
                        <div className="text-xs text-right text-gray-600 tabular-nums whitespace-nowrap ml-4">
                          <div>L: ${item.labour_rate.toFixed(2)}</div>
                          <div>M: ${item.material_rate.toFixed(2)}</div>
                          {item.plant_rate > 0 && <div>P: ${item.plant_rate.toFixed(2)}</div>}
                        </div>
                      </div>
                      {isCurrent && <div className="text-xs text-blue-600 mt-1">✓ current selection</div>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {showViewer && row.drawing_id && row.drawing_region && (
        <DrawingViewer
          drawingId={row.drawing_id}
          highlight={row.drawing_region as Parameters<typeof DrawingViewer>[0]['highlight']}
          onClose={() => setShowViewer(false)}
        />
      )}
    </div>
  );
}
