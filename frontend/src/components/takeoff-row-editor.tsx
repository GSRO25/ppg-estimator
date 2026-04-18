'use client';

import { useEffect, useState } from 'react';
import type { TakeoffRow } from './takeoff-grid';

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
  mode?: 'drawer' | 'modal';
  onRequestHighlight?: (region: TakeoffRow['drawing_region']) => void;
}

export default function TakeoffRowEditor({ row, onClose, onSaved, projectId, mode = 'drawer', onRequestHighlight }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<RateItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [remember, setRemember] = useState(true);

  // Reset search whenever a new row is opened
  useEffect(() => {
    if (!row) return;
    setSearch('');
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search — filter by the row's section when user hasn't typed anything,
  // so default results match the row. Clear search to search everywhere.
  useEffect(() => {
    if (!row) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (!search.trim() && row.section_number !== 99) params.set('section', String(row.section_number));
      fetch(`/api/rate-cards/search?${params.toString()}`).then(r => r.json()).then(setResults);
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

  const innerContent = (
    <>
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

        {row.drawing_id && row.drawing_region && onRequestHighlight && (
          <button
            onClick={() => onRequestHighlight(row.drawing_region)}
            className="mt-3 px-3 py-1.5 bg-ppg-blue text-white rounded text-xs font-medium hover:bg-ppg-navy"
          >
            📐 Highlight in drawing
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
                    className={`w-full text-left px-5 py-3 hover:bg-ppg-surface disabled:opacity-60 disabled:cursor-default ${isCurrent ? 'bg-ppg-surface' : ''}`}
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
                    {isCurrent && <div className="text-xs text-ppg-blue mt-1">✓ current selection</div>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );

  if (mode === 'drawer') {
    return (
      <div
        className="absolute bottom-0 left-0 right-0 bg-white shadow-2xl flex flex-col rounded-t-xl border-t border-slate-200 z-30 overflow-hidden"
        style={{ maxHeight: '55%' }}
      >
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-12 h-1.5 bg-slate-300 rounded-full cursor-pointer" onClick={onClose} />
        </div>
        {innerContent}
      </div>
    );
  }

  // modal mode: existing full-screen overlay
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <div
        className="w-[560px] bg-white shadow-2xl flex flex-col h-full"
        onClick={e => e.stopPropagation()}
      >
        {innerContent}
      </div>
    </div>
  );
}
