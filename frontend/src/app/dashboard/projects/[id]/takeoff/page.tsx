'use client';

import { useEffect, useState, useCallback, useMemo, use } from 'react';
import Link from 'next/link';
import TakeoffGrid, { type TakeoffRow } from '@/components/takeoff-grid';
import SectionTabs from '@/components/section-tabs';
import TakeoffRowEditor from '@/components/takeoff-row-editor';
import DrawingViewer, { type Highlight, type TooltipRow } from '@/components/drawing-viewer';
import { formatCurrency } from '@/lib/utils';

function toHighlight(r: TakeoffRow['drawing_region']): Highlight | null {
  if (!r?.type) return null;
  if (r.type === 'fixture' && r.block_name && r.locations) {
    return { type: 'fixture', block_name: r.block_name, locations: r.locations };
  }
  if (r.type === 'pipe' && r.layer && r.segments) {
    return { type: 'pipe', layer: r.layer, segments: r.segments };
  }
  if (r.type === 'fitting' && r.layer && r.positions) {
    return { type: 'fitting', layer: r.layer, positions: r.positions };
  }
  return null;
}

function findRowByRegion(
  items: TakeoffRow[],
  region: { type: string; key: string }
): TakeoffRow | undefined {
  return items.find(i => {
    const r = i.drawing_region;
    if (!r) return false;
    if (region.type === 'fixture') return r.type === 'fixture' && r.block_name === region.key;
    if (region.type === 'pipe') return r.type === 'pipe' && r.layer === region.key;
    if (region.type === 'fitting') return r.type === 'fitting' && r.layer === region.key;
    return false;
  });
}

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
  const [showGrid, setShowGrid] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${id}/takeoff`)
      .then(r => r.json())
      .then(data => { setItems(data); setLoading(false); });
  }, [id]);

  // On initial load, pick first drawing in items if any
  useEffect(() => {
    if (items.length > 0 && activeDrawingId === null) {
      const first = items.find(i => i.drawing_id);
      if (first?.drawing_id) setActiveDrawingId(first.drawing_id);
    }
  }, [items, activeDrawingId]);

  const sections = useMemo(() => Array.from(
    items.reduce((acc, item) => {
      if (!acc.has(item.section_number)) {
        acc.set(item.section_number, { number: item.section_number, name: item.section_name, count: 0 });
      }
      acc.get(item.section_number)!.count++;
      return acc;
    }, new Map<number, { number: number; name: string; count: number }>())
  ).map(([, v]) => v).sort((a, b) => a.number - b.number), [items]);

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

  const grandTotal = useMemo(() => items.reduce((sum, i) => {
    const qty = i.final_qty || 0;
    const rates = (i.labour_rate || 0) + (i.material_rate || 0) + (i.plant_rate || 0);
    return sum + qty * rates;
  }, 0), [items]);

  // Derived: hovered row (grid -> drawing highlight)
  const hoveredRow = hoveredItemId ? items.find(i => i.id === hoveredItemId) ?? null : null;

  // Derived: drawing region hover -> grid highlighted row id + tooltip data
  const hoveredByRegion = hoveredRegion ? findRowByRegion(items, hoveredRegion) ?? null : null;
  const gridHighlightId = hoveredByRegion?.id ?? null;
  const tooltipRow: TooltipRow | null = hoveredByRegion
    ? {
        description: hoveredByRegion.description,
        uom: hoveredByRegion.uom,
        final_qty: hoveredByRegion.final_qty,
        labour_rate: hoveredByRegion.labour_rate,
        material_rate: hoveredByRegion.material_rate,
        rate_card_item_id: hoveredByRegion.rate_card_item_id,
      }
    : null;

  const handleRowHover = useCallback((row: TakeoffRow | null) => {
    setHoveredItemId(row?.id ?? null);
    if (row?.drawing_id) setActiveDrawingId(row.drawing_id);
  }, []);

  const handleClickRegion = useCallback((region: { type: string; key: string }) => {
    const match = findRowByRegion(items, region);
    if (match) setEditingRow(match);
  }, [items]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900">
        <div className="text-slate-400 text-sm">Loading takeoff data…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
      {/* Top bar: back nav + section tabs + grand total + grid toggle */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/dashboard/projects/${id}`}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 shrink-0"
          >
            ← Back
          </Link>
          <div className="w-px h-4 bg-slate-200 shrink-0" />
          <SectionTabs sections={sections} activeSection={activeSection} onSelect={setActiveSection} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-sm font-semibold text-slate-700">
            Grand Total: <span className="text-ppg-amber text-base font-bold">{formatCurrency(grandTotal)}</span>
          </div>
          <button
            onClick={() => setShowGrid(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium border transition-colors ${showGrid ? 'bg-ppg-navy text-white border-ppg-navy' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
            title="Toggle takeoffs panel"
          >
            <span>📋</span> Takeoffs {showGrid ? '▶' : '◀'}
          </button>
        </div>
      </div>

      {/* Full-screen drawing with floating grid panel */}
      <div className="relative flex-1 overflow-hidden bg-slate-900">
        {/* Drawing fills the entire area */}
        {activeDrawingId ? (
          <DrawingViewer
            drawingId={activeDrawingId}
            highlight={toHighlight(hoveredRow?.drawing_region ?? null)}
            hoveredRegion={hoveredRegion}
            onHoverRegion={setHoveredRegion}
            onClickRegion={handleClickRegion}
            mode="inline"
            tooltipRow={tooltipRow}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm h-full">
            No drawing available
          </div>
        )}

        {/* Collapsible takeoffs panel — floats over the right side */}
        <div
          className={`absolute top-0 right-0 bottom-0 flex flex-col bg-white shadow-2xl border-l border-slate-200 transition-transform duration-200 z-10 ${showGrid ? 'translate-x-0' : 'translate-x-full'}`}
          style={{ width: '44%' }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Takeoffs — {filteredItems.length} items</span>
            <button
              onClick={() => setShowGrid(false)}
              className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              title="Hide panel"
            >×</button>
          </div>
          <div className="flex-1 relative overflow-hidden">
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
          </div>
        </div>
      </div>
    </div>
  );
}
