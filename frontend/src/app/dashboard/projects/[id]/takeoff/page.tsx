'use client';

import { useEffect, useState, useCallback, use } from 'react';
import TakeoffGrid, { type TakeoffRow } from '@/components/takeoff-grid';
import SectionTabs from '@/components/section-tabs';
import TakeoffRowEditor from '@/components/takeoff-row-editor';
import DrawingViewer from '@/components/drawing-viewer';
import { formatCurrency } from '@/lib/utils';

export default function TakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [items, setItems] = useState<TakeoffRow[]>([]);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingRow, setEditingRow] = useState<TakeoffRow | null>(null);

  // Bidirectional hover sync
  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<{ type: string; key: string } | null>(null);
  const [activeDrawingId, setActiveDrawingId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${id}/takeoff`)
      .then(r => r.json())
      .then(data => { setItems(data); setLoading(false); });
  }, [id]);

  // On initial load, pick first drawing in items if any
  useEffect(() => {
    if (items.length > 0 && !activeDrawingId) {
      const first = items.find(i => i.drawing_id);
      if (first?.drawing_id) setActiveDrawingId(first.drawing_id);
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = Array.from(
    items.reduce((acc, item) => {
      if (!acc.has(item.section_number)) {
        acc.set(item.section_number, { number: item.section_number, name: item.section_name, count: 0 });
      }
      acc.get(item.section_number)!.count++;
      return acc;
    }, new Map<number, { number: number; name: string; count: number }>())
  ).map(([, v]) => v).sort((a, b) => a.number - b.number);

  const filteredItems = activeSection !== null
    ? items.filter(i => i.section_number === activeSection)
    : items;

  const handleQuantityChange = useCallback(async (itemId: number, newQty: number) => {
    await fetch(`/api/projects/${id}/takeoff`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, finalQty: newQty }),
    });
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, final_qty: newQty } : i));
  }, [id]);

  const grandTotal = items.reduce((sum, i) => {
    const qty = i.final_qty || 0;
    const rates = (i.labour_rate || 0) + (i.material_rate || 0) + (i.plant_rate || 0);
    return sum + qty * rates;
  }, 0);

  // Derived: hovered row (grid -> drawing highlight)
  const hoveredRow = hoveredItemId ? items.find(i => i.id === hoveredItemId) ?? null : null;

  // Derived: drawing region hover -> grid highlighted row id
  const gridHighlightId = hoveredRegion
    ? (items.find(i => {
        const r = i.drawing_region;
        if (!r) return false;
        if (hoveredRegion.type === 'fixture') return r.type === 'fixture' && r.block_name === hoveredRegion.key;
        if (hoveredRegion.type === 'pipe') return r.type === 'pipe' && r.layer === hoveredRegion.key;
        if (hoveredRegion.type === 'fitting') return r.type === 'fitting' && r.layer === hoveredRegion.key;
        return false;
      })?.id ?? null)
    : null;

  function handleRowHover(row: TakeoffRow | null) {
    setHoveredItemId(row?.id ?? null);
    if (row?.drawing_id) setActiveDrawingId(row.drawing_id);
  }

  function handleClickRegion(region: { type: string; key: string }) {
    const match = items.find(i => {
      const r = i.drawing_region;
      if (!r) return false;
      if (region.type === 'fixture') return r.type === 'fixture' && r.block_name === region.key;
      if (region.type === 'pipe') return r.type === 'pipe' && r.layer === region.key;
      if (region.type === 'fitting') return r.type === 'fitting' && r.layer === region.key;
      return false;
    });
    if (match) setEditingRow(match);
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-slate-400 text-sm">Loading takeoff data…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar: section tabs + grand total */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white shrink-0">
        <SectionTabs sections={sections} activeSection={activeSection} onSelect={setActiveSection} />
        <div className="text-sm font-semibold text-slate-700">
          Grand Total: <span className="text-ppg-amber text-base font-bold">{formatCurrency(grandTotal)}</span>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Drawing viewer (42% width) */}
        <aside className="w-[42%] shrink-0 border-r bg-slate-900 flex flex-col">
          {activeDrawingId ? (
            <DrawingViewer
              drawingId={activeDrawingId}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              highlight={(hoveredRow?.drawing_region ?? null) as any}
              hoveredRegion={hoveredRegion}
              onHoverRegion={setHoveredRegion}
              onClickRegion={handleClickRegion}
              mode="inline"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Hover a row with a drawing to see it here
            </div>
          )}
        </aside>

        {/* Right panel: grid + drawer */}
        <section className="flex-1 flex flex-col relative overflow-hidden">
          <TakeoffGrid
            rows={filteredItems}
            onQuantityChange={handleQuantityChange}
            onRowClick={setEditingRow}
            onRowHover={handleRowHover}
            highlightedRowId={gridHighlightId}
          />
          {editingRow && (
            <TakeoffRowEditor
              row={editingRow}
              onClose={() => setEditingRow(null)}
              onSaved={(updated) => setItems(prev => prev.map(i => i.id === updated.id ? updated : i))}
              projectId={id}
              mode="drawer"
              onRequestHighlight={(region) => {
                if (region && editingRow.drawing_id) {
                  setActiveDrawingId(editingRow.drawing_id);
                }
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}
