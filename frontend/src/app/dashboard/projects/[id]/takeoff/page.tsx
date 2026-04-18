'use client';

import { useEffect, useState, useCallback, use } from 'react';
import TakeoffGrid, { type TakeoffRow } from '@/components/takeoff-grid';
import SectionTabs from '@/components/section-tabs';
import TakeoffRowEditor from '@/components/takeoff-row-editor';
import { formatCurrency } from '@/lib/utils';

export default function TakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [items, setItems] = useState<TakeoffRow[]>([]);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingRow, setEditingRow] = useState<TakeoffRow | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${id}/takeoff`)
      .then(r => r.json())
      .then(data => { setItems(data); setLoading(false); });
  }, [id]);

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

  if (loading) return <div className="p-8 text-gray-500">Loading takeoff data...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900">Takeoff Review</h2>
        <div className="text-lg font-semibold text-gray-900">
          Grand Total: {formatCurrency(grandTotal)}
        </div>
      </div>
      <SectionTabs sections={sections} activeSection={activeSection} onSelect={setActiveSection} />
      <div className="flex-1 mt-2 relative">
        <TakeoffGrid
          rows={filteredItems}
          onQuantityChange={handleQuantityChange}
          onRowClick={setEditingRow}
        />
      </div>
      <TakeoffRowEditor
        row={editingRow}
        onClose={() => setEditingRow(null)}
        onSaved={(updated) => setItems(prev => prev.map(i => i.id === updated.id ? updated : i))}
        projectId={id}
      />
    </div>
  );
}
