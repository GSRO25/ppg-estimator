'use client';

import { useEffect, useState, useMemo } from 'react';

interface MappingRow {
  name: string;
  type: 'block' | 'layer';
  rate_card_item_id: number | null;
  rate_card_description: string | null;
}

interface RateCardItem {
  id: number;
  section_name: string;
  description: string;
  uom: string;
  labour_rate: number;
  material_rate: number;
}

export default function MappingsPage() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [rateItems, setRateItems] = useState<RateCardItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'block' | 'layer'>('all');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [rateSearch, setRateSearch] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/mappings').then(r => r.json()).then(setRows);
    // Get all rate card items from most recent version
    fetch('/api/rate-cards').then(r => r.json()).then(async (versions: { id: number }[]) => {
      if (!versions.length) return;
      const items = await fetch(`/api/rate-cards/${versions[0].id}`).then(r => r.json());
      setRateItems(items);
    });
  }, []);

  const filteredRows = useMemo(() =>
    rows.filter(r =>
      (filter === 'all' || r.type === filter) &&
      (!search || r.name.toLowerCase().includes(search.toLowerCase()))
    ), [rows, filter, search]);

  async function saveMapping(name: string, rateCardItemId: number) {
    setSaving(name);
    await fetch('/api/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rateCardItemId }),
    });
    setRows(prev => prev.map(r => {
      if (r.name !== name) return r;
      const item = rateItems.find(i => i.id === rateCardItemId);
      return { ...r, rate_card_item_id: rateCardItemId, rate_card_description: item ? `${item.section_name} — ${item.description}` : null };
    }));
    setSaving(null);
  }

  async function clearMapping(name: string) {
    await fetch('/api/mappings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setRows(prev => prev.map(r => r.name === name ? { ...r, rate_card_item_id: null, rate_card_description: null } : r));
  }

  const mappedCount = rows.filter(r => r.rate_card_item_id).length;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Rate Mappings</h2>
          <p className="text-sm text-gray-500 mt-1">{mappedCount} of {rows.length} mapped — regenerate takeoff after updating</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b flex gap-3 items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search block / layer names…"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm w-64"
          />
          <div className="flex gap-1">
            {(['all', 'block', 'layer'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded text-xs font-medium ${filter === f ? 'bg-ppg-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {f === 'all' ? 'All' : f === 'block' ? 'Fixture Blocks' : 'Pipe Layers'}
              </button>
            ))}
          </div>
        </div>

        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CAD Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate Card Item</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredRows.map(row => {
              const query = rateSearch[row.name] ?? '';
              const filteredItems = rateItems.filter(i =>
                !query || i.description.toLowerCase().includes(query.toLowerCase()) || i.section_name.toLowerCase().includes(query.toLowerCase())
              ).slice(0, 30);

              return (
                <tr key={row.name} className={row.rate_card_item_id ? '' : 'bg-yellow-50'}>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.type === 'block' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {row.type === 'block' ? 'fixture' : 'pipe'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-800">{row.name}</td>
                  <td className="px-4 py-2">
                    {row.rate_card_description ? (
                      <span className="text-sm text-gray-700">{row.rate_card_description}</span>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <input
                          value={query}
                          onChange={e => setRateSearch(prev => ({ ...prev, [row.name]: e.target.value }))}
                          placeholder="Search rate card…"
                          className="rounded border border-gray-300 px-2 py-1 text-xs w-52"
                        />
                        {query && (
                          <select
                            size={1}
                            onChange={e => { if (e.target.value) saveMapping(row.name, Number(e.target.value)); }}
                            className="rounded border border-gray-300 px-2 py-1 text-xs w-72"
                            defaultValue=""
                          >
                            <option value="">— select —</option>
                            {filteredItems.map(i => (
                              <option key={i.id} value={i.id}>
                                {i.section_name} — {i.description} ({i.uom})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {saving === row.name && <span className="text-xs text-gray-400">Saving…</span>}
                    {row.rate_card_item_id && saving !== row.name && (
                      <button onClick={() => clearMapping(row.name)} className="text-xs text-red-400 hover:text-red-600">Clear</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No items found. Run extraction on a project first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
