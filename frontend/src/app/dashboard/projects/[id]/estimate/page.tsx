'use client';

import { useEffect, useState, use } from 'react';
import { formatCurrency } from '@/lib/utils';

interface SectionSummary {
  section_number: number;
  section_name: string;
  labour: number;
  material: number;
  plant: number;
  total: number;
}

export default function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [marginPercent, setMarginPercent] = useState(10);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/projects/${id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marginPercent }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'estimate.pdf';
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    fetch(`/api/projects/${id}/takeoff`)
      .then(r => r.json())
      .then((items: any[]) => {
        const sectionMap = new Map<number, SectionSummary>();
        for (const item of items) {
          const key = item.section_number;
          if (!sectionMap.has(key)) {
            sectionMap.set(key, {
              section_number: key,
              section_name: item.section_name,
              labour: 0, material: 0, plant: 0, total: 0,
            });
          }
          const s = sectionMap.get(key)!;
          const qty = item.final_qty || 0;
          s.labour += qty * (item.labour_rate || 0);
          s.material += qty * (item.material_rate || 0);
          s.plant += qty * (item.plant_rate || 0);
          s.total += qty * ((item.labour_rate || 0) + (item.material_rate || 0) + (item.plant_rate || 0));
        }
        setSections(Array.from(sectionMap.values()).sort((a, b) => a.section_number - b.section_number));
      });
  }, [id]);

  const subtotal = sections.reduce((sum, s) => sum + s.total, 0);
  const margin = subtotal * (marginPercent / 100);
  const grandTotal = subtotal + margin;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Estimate Summary</h2>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Section</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Labour</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Material</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Plant</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sections.map((s) => (
              <tr key={s.section_number}>
                <td className="px-6 py-3 text-sm">{s.section_name}</td>
                <td className="px-6 py-3 text-sm text-right">{formatCurrency(s.labour)}</td>
                <td className="px-6 py-3 text-sm text-right">{formatCurrency(s.material)}</td>
                <td className="px-6 py-3 text-sm text-right">{formatCurrency(s.plant)}</td>
                <td className="px-6 py-3 text-sm text-right font-medium">{formatCurrency(s.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td className="px-6 py-3 text-sm font-bold" colSpan={4}>Subtotal</td>
              <td className="px-6 py-3 text-sm text-right font-bold">{formatCurrency(subtotal)}</td>
            </tr>
            <tr>
              <td className="px-6 py-3 text-sm font-medium" colSpan={3}>
                Margin
                <input
                  type="number"
                  value={marginPercent}
                  onChange={(e) => setMarginPercent(Number(e.target.value))}
                  className="ml-2 w-16 border rounded px-2 py-1 text-sm"
                />
                %
              </td>
              <td className="px-6 py-3" />
              <td className="px-6 py-3 text-sm text-right font-medium">{formatCurrency(margin)}</td>
            </tr>
            <tr className="bg-ppg-surface">
              <td className="px-6 py-4 text-base font-bold" colSpan={4}>Grand Total (inc. Margin)</td>
              <td className="px-6 py-4 text-base text-right font-bold text-ppg-blue">{formatCurrency(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="mt-4 px-6 py-3 bg-ppg-blue text-white rounded-md hover:bg-ppg-navy font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exporting ? 'Exporting...' : 'Export to PDF'}
      </button>
    </div>
  );
}
