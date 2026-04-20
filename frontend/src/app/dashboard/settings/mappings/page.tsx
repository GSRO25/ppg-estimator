'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DrawingViewer from '@/components/drawing-viewer';

interface MappingRow {
  name: string;
  type: 'block' | 'layer';
  drawing_id: number | null;
  drawing_filename: string | null;
  project_name: string | null;
  rate_card_item_id: number | null;
  rate_card_description: string | null;
  usage_count: number;
  est_value: number;
  suggested_rate_card_item_id: number | null;
  suggested_description: string | null;
  suggested_confidence: 'high' | 'medium' | 'low' | null;
  suggested_reasoning: string | null;
  suggested_labour_rate: number | null;
  suggested_material_rate: number | null;
  suggested_uom: string | null;
}

interface RateCardItem {
  id: number;
  section_name: string;
  description: string;
  uom: string;
  labour_rate: number;
  material_rate: number;
}

interface MappingsResponse {
  rate_card_version_id: number | null;
  rows: MappingRow[];
}

function confidenceColor(c: 'high' | 'medium' | 'low' | null): string {
  if (c === 'high') return 'bg-emerald-100 text-emerald-800 ring-emerald-300';
  if (c === 'medium') return 'bg-amber-100 text-amber-800 ring-amber-300';
  if (c === 'low') return 'bg-slate-100 text-slate-700 ring-slate-300';
  return 'bg-slate-50 text-slate-500 ring-slate-200';
}

function fmtMoney(n: number): string {
  if (!n) return '—';
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export default function MappingsReviewPage() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [rateItems, setRateItems] = useState<RateCardItem[]>([]);
  const [previewRow, setPreviewRow] = useState<MappingRow | null>(null);
  const [rateSearch, setRateSearch] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [suggestingAll, setSuggestingAll] = useState(false);
  const [acceptingAllHigh, setAcceptingAllHigh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    const r = await fetch('/api/mappings').then(r => r.json()) as MappingsResponse;
    setRows(r.rows);
    // Auto-open the preview for the most impactful unmapped row so the
    // estimator sees context immediately on landing.
    const first = r.rows
      .filter(x => !x.rate_card_item_id && x.drawing_id != null)
      .sort((a, b) => b.usage_count - a.usage_count)[0];
    if (first) setPreviewRow(first);
  }, []);

  useEffect(() => {
    loadRows();
    fetch('/api/rate-cards').then(r => r.json()).then(async (versions: { id: number }[]) => {
      if (!versions.length) return;
      const items = await fetch(`/api/rate-cards/${versions[0].id}`).then(r => r.json());
      setRateItems(items);
    });
  }, [loadRows]);

  // Run the AI suggester for any unmapped blocks that don't yet have a
  // cached suggestion. Called once on mount (if there are any); user can
  // also trigger manually.
  const runSuggest = useCallback(async () => {
    setSuggestingAll(true);
    setError(null);
    try {
      const res = await fetch('/api/mappings/suggest', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Suggest failed');
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestingAll(false);
    }
  }, [loadRows]);

  useEffect(() => {
    // Kick off suggestions automatically if some are missing. Only runs
    // once per mount; avoids the API bill if the cache is already warm.
    const needsSuggest = rows.some(
      r => !r.rate_card_item_id && r.suggested_confidence === null
    );
    if (needsSuggest && !suggestingAll) {
      runSuggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Accept one suggestion (or manual selection)
  const acceptMapping = useCallback(async (row: MappingRow, rateCardItemId: number, isReject: boolean) => {
    setSaving(row.name);
    try {
      await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: row.name,
          rateCardItemId,
          // Feedback-loop payload — only when the user overrode the AI
          rejectedRateCardItemId: isReject ? row.suggested_rate_card_item_id : null,
          rejectedReasoning: isReject ? row.suggested_reasoning : null,
        }),
      });
      // Apply the backfill so existing takeoff_items using this block pick up the rate
      await fetch('/api/mappings/backfill', { method: 'POST' });
      await loadRows();
    } finally {
      setSaving(null);
    }
  }, [loadRows]);

  const clearMapping = useCallback(async (name: string) => {
    await fetch('/api/mappings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadRows();
  }, [loadRows]);

  const acceptAllHighConfidence = useCallback(async () => {
    const targets = rows.filter(
      r => !r.rate_card_item_id && r.suggested_confidence === 'high' && r.suggested_rate_card_item_id
    );
    if (targets.length === 0) return;
    setAcceptingAllHigh(true);
    try {
      for (const r of targets) {
        await fetch('/api/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: r.name, rateCardItemId: r.suggested_rate_card_item_id }),
        });
      }
      await fetch('/api/mappings/backfill', { method: 'POST' });
      await loadRows();
    } finally {
      setAcceptingAllHigh(false);
    }
  }, [rows, loadRows]);

  // Tier grouping
  const { mapped, high, medium, low, unsuggested } = useMemo(() => {
    const mapped: MappingRow[] = [];
    const high: MappingRow[] = [];
    const medium: MappingRow[] = [];
    const low: MappingRow[] = [];
    const unsuggested: MappingRow[] = [];
    for (const r of rows) {
      if (r.rate_card_item_id) { mapped.push(r); continue; }
      if (r.suggested_confidence === 'high') { high.push(r); continue; }
      if (r.suggested_confidence === 'medium') { medium.push(r); continue; }
      if (r.suggested_confidence === 'low') { low.push(r); continue; }
      unsuggested.push(r);
    }
    // Sort by usage_count within each tier — most impactful first
    const byUsage = (a: MappingRow, b: MappingRow) => b.usage_count - a.usage_count;
    high.sort(byUsage); medium.sort(byUsage); low.sort(byUsage); unsuggested.sort(byUsage);
    return { mapped, high, medium, low, unsuggested };
  }, [rows]);

  const totalUnmapped = high.length + medium.length + low.length + unsuggested.length;
  const reviewedPct = rows.length === 0 ? 0 : Math.round((mapped.length / rows.length) * 100);

  return (
    <div className="flex gap-4 h-full">
      {/* Left: review queue */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header / progress / bulk actions */}
        <div className="bg-white rounded-lg shadow p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Review Queue</h2>
              <p className="text-sm text-gray-500 mt-1">
                AI suggests the best rate-card match for every unmapped CAD block — you confirm or override.
                The system learns from your corrections for next time.
              </p>
            </div>
            <div className="flex gap-2">
              {high.length > 0 && (
                <button
                  onClick={acceptAllHighConfidence}
                  disabled={acceptingAllHigh}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm rounded font-semibold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {acceptingAllHigh ? 'Accepting…' : `Accept all ${high.length} high-confidence`}
                </button>
              )}
              <button
                onClick={runSuggest}
                disabled={suggestingAll}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-sm rounded font-medium hover:bg-slate-200 disabled:opacity-50"
              >
                {suggestingAll ? 'Asking AI…' : 'Re-run suggestions'}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-6 text-sm">
            <div>
              <div className="text-2xl font-bold text-slate-800">{reviewedPct}%</div>
              <div className="text-xs text-slate-500">confirmed</div>
            </div>
            <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
              <div className="h-full bg-emerald-500 rounded" style={{ width: `${reviewedPct}%` }} />
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-emerald-700 font-medium">{mapped.length} mapped</span>
              <span className="text-amber-700 font-medium">{totalUnmapped} to review</span>
              <span className="text-slate-500">{rows.length} total</span>
            </div>
          </div>

          {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        </div>

        {/* Tiered sections */}
        <Tier title="High confidence" subtitle="AI is confident these are correct — one-click approve" color="emerald" rows={high}
          rateItems={rateItems}
          previewRow={previewRow} onSelect={setPreviewRow}
          onAccept={r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false)}
          onReject={(r, id) => acceptMapping(r, id, true)}
          rateSearch={rateSearch} setRateSearch={setRateSearch}
          saving={saving} onClear={clearMapping}
        />
        <Tier title="Medium confidence" subtitle="Likely correct but worth a skim" color="amber" rows={medium}
          rateItems={rateItems}
          previewRow={previewRow} onSelect={setPreviewRow}
          onAccept={r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false)}
          onReject={(r, id) => acceptMapping(r, id, true)}
          rateSearch={rateSearch} setRateSearch={setRateSearch}
          saving={saving} onClear={clearMapping}
        />
        <Tier title="Low confidence" subtitle="AI is guessing — open the drawing to verify each one" color="slate" rows={low}
          rateItems={rateItems}
          previewRow={previewRow} onSelect={setPreviewRow}
          onAccept={r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false)}
          onReject={(r, id) => acceptMapping(r, id, true)}
          rateSearch={rateSearch} setRateSearch={setRateSearch}
          saving={saving} onClear={clearMapping}
        />
        {unsuggested.length > 0 && (
          <Tier title="No suggestion" subtitle="AI had no match for these — manual mapping only" color="slate" rows={unsuggested}
            rateItems={rateItems}
            previewRow={previewRow} onSelect={setPreviewRow}
            onAccept={r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false)}
            onReject={(r, id) => acceptMapping(r, id, true)}
            rateSearch={rateSearch} setRateSearch={setRateSearch}
            saving={saving} onClear={clearMapping}
          />
        )}

        {mapped.length > 0 && (
          <Tier title="Confirmed mappings" subtitle="Already mapped — these auto-apply to every drawing" color="emerald" rows={mapped}
            rateItems={rateItems}
            previewRow={previewRow} onSelect={setPreviewRow}
            onAccept={() => {}} onReject={() => {}}
            rateSearch={rateSearch} setRateSearch={setRateSearch}
            saving={saving} onClear={clearMapping}
            confirmed
          />
        )}
      </div>

      {/* Right: sticky drawing preview */}
      {previewRow && previewRow.drawing_id && (
        <div className="w-[520px] shrink-0 flex flex-col rounded-lg shadow bg-white overflow-hidden border border-slate-200" style={{ height: 640, position: 'sticky', top: 0 }}>
          <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
            <div>
              <span className="text-xs font-semibold text-slate-700">{previewRow.name}</span>
              <span className="text-xs text-slate-400 ml-2">{previewRow.project_name} · {previewRow.drawing_filename}</span>
            </div>
            <button onClick={() => setPreviewRow(null)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <DrawingViewer
              drawingId={previewRow.drawing_id}
              highlight={null}
              highlightByName={{ type: previewRow.type === 'block' ? 'fixture' : 'pipe', name: previewRow.name }}
              mode="inline"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier section
// ---------------------------------------------------------------------------

interface TierProps {
  title: string;
  subtitle: string;
  color: 'emerald' | 'amber' | 'slate';
  rows: MappingRow[];
  rateItems: RateCardItem[];
  previewRow: MappingRow | null;
  onSelect: (r: MappingRow) => void;
  onAccept: (r: MappingRow) => void;
  onReject: (r: MappingRow, chosenRateCardItemId: number) => void;
  rateSearch: Record<string, string>;
  setRateSearch: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  saving: string | null;
  onClear: (name: string) => void;
  confirmed?: boolean;
}

function Tier({ title, subtitle, color, rows, rateItems, previewRow, onSelect, onAccept, onReject, rateSearch, setRateSearch, saving, onClear, confirmed }: TierProps) {
  if (rows.length === 0) return null;
  const headerColor = color === 'emerald' ? 'border-emerald-400 bg-emerald-50' : color === 'amber' ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-slate-50';

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className={`px-5 py-3 border-l-4 ${headerColor}`}>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-sm font-bold text-slate-800">{title}</span>
            <span className="ml-2 text-xs text-slate-500">{subtitle}</span>
          </div>
          <span className="text-xs text-slate-500">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map(row => (
          <Row key={row.name} row={row} rateItems={rateItems}
            isSelected={previewRow?.name === row.name}
            onSelect={onSelect}
            onAccept={onAccept}
            onReject={onReject}
            rateSearch={rateSearch}
            setRateSearch={setRateSearch}
            saving={saving === row.name}
            onClear={onClear}
            confirmed={!!confirmed}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  row: MappingRow;
  rateItems: RateCardItem[];
  isSelected: boolean;
  onSelect: (r: MappingRow) => void;
  onAccept: (r: MappingRow) => void;
  onReject: (r: MappingRow, chosenRateCardItemId: number) => void;
  rateSearch: Record<string, string>;
  setRateSearch: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  saving: boolean;
  onClear: (name: string) => void;
  confirmed: boolean;
}

function Row({ row, rateItems, isSelected, onSelect, onAccept, onReject, rateSearch, setRateSearch, saving, onClear, confirmed }: RowProps) {
  const q = rateSearch[row.name] ?? '';
  const rateCandidates = rateItems.filter(
    i => !q || i.description.toLowerCase().includes(q.toLowerCase()) || i.section_name.toLowerCase().includes(q.toLowerCase())
  ).slice(0, 50);

  return (
    <div
      onClick={() => onSelect(row)}
      className={`px-5 py-3 flex items-center gap-4 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'}`}
    >
      {/* Type pill + CAD name */}
      <div className="w-56 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${row.type === 'block' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
            {row.type === 'block' ? 'FIXTURE' : 'PIPE'}
          </span>
          <span className="text-sm font-mono text-slate-800 truncate">{row.name}</span>
        </div>
        {row.usage_count > 0 && (
          <div className="text-xs text-slate-500 mt-0.5">
            used {row.usage_count}× {row.est_value > 0 && <span className="text-slate-400">· ~{fmtMoney(row.est_value)} impact</span>}
          </div>
        )}
      </div>

      {/* Suggestion or confirmed mapping */}
      <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
        {confirmed && row.rate_card_description ? (
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">✓ Confirmed</span>
            <span className="text-sm text-slate-700 truncate">{row.rate_card_description}</span>
          </div>
        ) : row.suggested_rate_card_item_id && row.suggested_confidence ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ring-1 ${confidenceColor(row.suggested_confidence)}`}>
                {row.suggested_confidence.toUpperCase()}
              </span>
              <span className="text-sm text-slate-800 truncate" title={row.suggested_reasoning ?? ''}>
                {row.suggested_description}
              </span>
            </div>
            {row.suggested_reasoning && (
              <div className="text-xs text-slate-500 italic truncate" title={row.suggested_reasoning}>
                {row.suggested_reasoning}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400 italic">No AI suggestion — map manually</span>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {confirmed ? (
          <button onClick={() => onClear(row.name)} className="text-xs text-red-500 hover:text-red-700">Clear</button>
        ) : (
          <>
            {row.suggested_rate_card_item_id && (
              <button
                onClick={() => onAccept(row)}
                disabled={saving}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? '…' : 'Accept'}
              </button>
            )}
            <div className="relative">
              <input
                value={q}
                onChange={e => setRateSearch(prev => ({ ...prev, [row.name]: e.target.value }))}
                placeholder={row.suggested_rate_card_item_id ? 'or override…' : 'search rate card…'}
                className="rounded border border-slate-300 px-2 py-1 text-xs w-40"
              />
              {q && (
                <div className="absolute right-0 top-full mt-1 z-20 w-72 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
                  {rateCandidates.map(i => (
                    <button
                      key={i.id}
                      onClick={() => onReject(row, i.id)}
                      className="block w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 border-b border-slate-50"
                    >
                      <div className="font-medium">{i.description}</div>
                      <div className="text-slate-500">{i.section_name} · {i.uom}</div>
                    </button>
                  ))}
                  {rateCandidates.length === 0 && (
                    <div className="px-2 py-2 text-xs text-slate-400">No matches</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
