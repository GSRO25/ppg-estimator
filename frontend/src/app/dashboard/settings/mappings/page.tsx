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
  mapping_scope: 'ce-specific' | 'tenant-wide' | null;
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

interface ConsultingEngineer {
  id: number;
  name: string;
  slug: string;
  is_seed: boolean;
}

interface MappingsResponse {
  rate_card_version_id: number | null;
  consulting_engineer_id: number | null;
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

interface LlmUsageTotals {
  today_usd: number;
  month_usd: number;
  month_calls: number;
}

export default function MappingsReviewPage() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [rateItems, setRateItems] = useState<RateCardItem[]>([]);
  const [consultingEngineers, setConsultingEngineers] = useState<ConsultingEngineer[]>([]);
  const [activeCeId, setActiveCeId] = useState<number | null>(null);
  const [previewRow, setPreviewRow] = useState<MappingRow | null>(null);
  const [rateSearch, setRateSearch] = useState<Record<string, string>>({});
  const [rowScope, setRowScope] = useState<Record<string, 'ce' | 'all'>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [suggestingAll, setSuggestingAll] = useState(false);
  const [acceptingAllHigh, setAcceptingAllHigh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<LlmUsageTotals | null>(null);

  const loadUsage = useCallback(async () => {
    try {
      const r = await fetch('/api/llm-usage').then(r => r.json());
      setUsage(r.totals);
    } catch { /* non-fatal */ }
  }, []);

  const loadRows = useCallback(async (ceId: number | null) => {
    loadUsage();
    const url = ceId
      ? `/api/mappings?consultingEngineerId=${ceId}`
      : '/api/mappings';
    const r = await fetch(url).then(r => r.json()) as MappingsResponse;
    setRows(r.rows);
    const first = r.rows
      .filter(x => !x.rate_card_item_id && x.drawing_id != null)
      .sort((a, b) => b.usage_count - a.usage_count)[0];
    if (first) setPreviewRow(first);
  }, [loadUsage]);

  useEffect(() => {
    fetch('/api/consulting-engineers').then(r => r.json()).then(setConsultingEngineers);
    fetch('/api/rate-cards').then(r => r.json()).then(async (versions: { id: number }[]) => {
      if (!versions.length) return;
      const items = await fetch(`/api/rate-cards/${versions[0].id}`).then(r => r.json());
      setRateItems(items);
    });
  }, []);

  useEffect(() => {
    loadRows(activeCeId);
  }, [activeCeId, loadRows]);

  const runSuggest = useCallback(async () => {
    setSuggestingAll(true);
    setError(null);
    try {
      const res = await fetch('/api/mappings/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultingEngineerId: activeCeId }),
      });
      const body = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
      if (!res.ok) throw new Error(body.error ?? 'Suggest failed');
      await loadRows(activeCeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestingAll(false);
    }
  }, [activeCeId, loadRows]);

  const [autoRanOnce, setAutoRanOnce] = useState(false);
  useEffect(() => {
    if (autoRanOnce || suggestingAll || error) return;
    const needsSuggest = rows.some(
      r => !r.rate_card_item_id && r.suggested_confidence === null
    );
    if (needsSuggest) {
      setAutoRanOnce(true);
      runSuggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, autoRanOnce, suggestingAll, error]);

  // When CE changes, allow the auto-run to fire once again for the new scope.
  useEffect(() => { setAutoRanOnce(false); }, [activeCeId]);

  const acceptMapping = useCallback(async (row: MappingRow, rateCardItemId: number, isReject: boolean) => {
    setSaving(row.name);
    try {
      // Default scope for new mappings: "CE only" if a CE is active, else tenant-wide
      const scope = rowScope[row.name] ?? (activeCeId ? 'ce' : 'all');
      const ceIdForMapping = scope === 'ce' ? activeCeId : null;
      await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: row.name,
          rateCardItemId,
          consultingEngineerId: ceIdForMapping,
          rejectedRateCardItemId: isReject ? row.suggested_rate_card_item_id : null,
          rejectedReasoning: isReject ? row.suggested_reasoning : null,
        }),
      });
      await fetch('/api/mappings/backfill', { method: 'POST' });
      await loadRows(activeCeId);
    } finally {
      setSaving(null);
    }
  }, [activeCeId, rowScope, loadRows]);

  const clearMapping = useCallback(async (row: MappingRow) => {
    // Clear at the row's current scope: if it was CE-specific, clear the CE
    // version; if tenant-wide, clear that one.
    const ceIdForDelete = row.mapping_scope === 'ce-specific' ? activeCeId : null;
    await fetch('/api/mappings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: row.name, consultingEngineerId: ceIdForDelete }),
    });
    await loadRows(activeCeId);
  }, [activeCeId, loadRows]);

  const acceptAllHighConfidence = useCallback(async () => {
    const targets = rows.filter(
      r => !r.rate_card_item_id && r.suggested_confidence === 'high' && r.suggested_rate_card_item_id
    );
    if (targets.length === 0) return;
    setAcceptingAllHigh(true);
    try {
      for (const r of targets) {
        const scope = rowScope[r.name] ?? (activeCeId ? 'ce' : 'all');
        const ceIdForMapping = scope === 'ce' ? activeCeId : null;
        await fetch('/api/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: r.name,
            rateCardItemId: r.suggested_rate_card_item_id,
            consultingEngineerId: ceIdForMapping,
          }),
        });
      }
      await fetch('/api/mappings/backfill', { method: 'POST' });
      await loadRows(activeCeId);
    } finally {
      setAcceptingAllHigh(false);
    }
  }, [rows, activeCeId, rowScope, loadRows]);

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
    const byUsage = (a: MappingRow, b: MappingRow) => b.usage_count - a.usage_count;
    high.sort(byUsage); medium.sort(byUsage); low.sort(byUsage); unsuggested.sort(byUsage);
    return { mapped, high, medium, low, unsuggested };
  }, [rows]);

  const totalUnmapped = high.length + medium.length + low.length + unsuggested.length;
  const reviewedPct = rows.length === 0 ? 0 : Math.round((mapped.length / rows.length) * 100);
  const activeCe = consultingEngineers.find(c => c.id === activeCeId) ?? null;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 4rem)' }}>
      <div className="flex-1 min-w-0 space-y-4 overflow-y-auto pr-2">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold text-gray-900">Review Queue</h2>
                <select
                  value={activeCeId ?? ''}
                  onChange={e => setActiveCeId(e.target.value ? Number(e.target.value) : null)}
                  className="text-sm rounded-md border border-slate-300 px-3 py-1.5 bg-white"
                >
                  <option value="">All consulting engineers (tenant-wide)</option>
                  {consultingEngineers.map(ce => (
                    <option key={ce.id} value={ce.id}>{ce.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {activeCe
                  ? <>Viewing mappings for <span className="font-semibold text-slate-700">{activeCe.name}</span>. Confirmed mappings default to {activeCe.name}-specific, but you can mark any as tenant-wide if they apply to every drafting firm.</>
                  : <>Showing all tenant-wide mappings. Pick a consulting engineer above to see firm-specific mappings.</>}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {usage && (
                <a
                  href="/dashboard/settings/ai-usage"
                  title={`${usage.month_calls} AI calls this month`}
                  className="text-right text-xs leading-tight text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-3 py-1.5"
                >
                  <div className="font-mono font-semibold text-slate-800">${usage.month_usd.toFixed(2)}</div>
                  <div className="text-[10px] uppercase tracking-wide">AI spend · MTD</div>
                </a>
              )}
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

        <Tier title="High confidence" subtitle="AI is confident these are correct — one-click approve" color="emerald" rows={high}
          {...{ rateItems, previewRow, onSelect: setPreviewRow, onAccept: r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false),
                onReject: (r, id) => acceptMapping(r, id, true), rateSearch, setRateSearch, saving, onClear: clearMapping,
                rowScope, setRowScope, activeCe }} />
        <Tier title="Medium confidence" subtitle="Likely correct but worth a skim" color="amber" rows={medium}
          {...{ rateItems, previewRow, onSelect: setPreviewRow, onAccept: r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false),
                onReject: (r, id) => acceptMapping(r, id, true), rateSearch, setRateSearch, saving, onClear: clearMapping,
                rowScope, setRowScope, activeCe }} />
        <Tier title="Low confidence" subtitle="AI is guessing — open the drawing to verify each one" color="slate" rows={low}
          {...{ rateItems, previewRow, onSelect: setPreviewRow, onAccept: r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false),
                onReject: (r, id) => acceptMapping(r, id, true), rateSearch, setRateSearch, saving, onClear: clearMapping,
                rowScope, setRowScope, activeCe }} />
        {unsuggested.length > 0 && (
          <Tier title="No suggestion" subtitle="AI had no match for these — manual mapping only" color="slate" rows={unsuggested}
            {...{ rateItems, previewRow, onSelect: setPreviewRow, onAccept: r => r.suggested_rate_card_item_id && acceptMapping(r, r.suggested_rate_card_item_id, false),
                  onReject: (r, id) => acceptMapping(r, id, true), rateSearch, setRateSearch, saving, onClear: clearMapping,
                  rowScope, setRowScope, activeCe }} />
        )}
        {mapped.length > 0 && (
          <Tier title="Confirmed mappings" subtitle="Already mapped — auto-apply to every matching drawing" color="emerald" rows={mapped}
            {...{ rateItems, previewRow, onSelect: setPreviewRow, onAccept: () => {}, onReject: () => {},
                  rateSearch, setRateSearch, saving, onClear: clearMapping,
                  rowScope, setRowScope, activeCe, confirmed: true }} />
        )}
      </div>

      {previewRow && previewRow.drawing_id && (
        <div className="w-[520px] shrink-0 flex flex-col rounded-lg shadow bg-white overflow-hidden border border-slate-200 h-full">
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
  rowScope: Record<string, 'ce' | 'all'>;
  setRowScope: (fn: (prev: Record<string, 'ce' | 'all'>) => Record<string, 'ce' | 'all'>) => void;
  saving: string | null;
  onClear: (row: MappingRow) => void;
  activeCe: ConsultingEngineer | null;
  confirmed?: boolean;
}

function Tier(props: TierProps) {
  const { title, subtitle, color, rows } = props;
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
        {rows.map(row => <Row key={row.name} row={row} {...props} confirmed={!!props.confirmed} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps extends TierProps {
  row: MappingRow;
  confirmed: boolean;
}

function Row({ row, rateItems, previewRow, onSelect, onAccept, onReject, rateSearch, setRateSearch, rowScope, setRowScope, saving, onClear, confirmed, activeCe }: RowProps) {
  const q = rateSearch[row.name] ?? '';
  const rateCandidates = rateItems.filter(
    i => !q || i.description.toLowerCase().includes(q.toLowerCase()) || i.section_name.toLowerCase().includes(q.toLowerCase())
  ).slice(0, 50);
  const isSelected = previewRow?.name === row.name;
  const scope = rowScope[row.name] ?? (activeCe ? 'ce' : 'all');

  return (
    <div
      onClick={() => onSelect(row)}
      className={`px-5 py-3 flex items-start gap-4 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'}`}
    >
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

      <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
        {confirmed && row.rate_card_description ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">✓ Confirmed</span>
              {row.mapping_scope === 'ce-specific' && activeCe && (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700" title={`Only applies to ${activeCe.name} drawings`}>
                  {activeCe.name} only
                </span>
              )}
              {row.mapping_scope === 'tenant-wide' && (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700" title="Applies to every consulting engineer">
                  All CEs
                </span>
              )}
              <span className="text-sm text-slate-700 truncate">{row.rate_card_description}</span>
            </div>
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

      <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {confirmed ? (
          <button onClick={() => onClear(row)} className="text-xs text-red-500 hover:text-red-700">Clear</button>
        ) : (
          <>
            {/* Scope toggle — only visible when a CE is selected.
                Controls whether accepting writes a CE-specific mapping or a
                tenant-wide one. */}
            {activeCe && (
              <div className="flex rounded border border-slate-200 overflow-hidden text-[10px] font-semibold">
                <button
                  onClick={() => setRowScope(prev => ({ ...prev, [row.name]: 'ce' }))}
                  className={`px-2 py-1 ${scope === 'ce' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
                  title={`Apply only to ${activeCe.name} drawings`}
                >
                  {activeCe.name} only
                </button>
                <button
                  onClick={() => setRowScope(prev => ({ ...prev, [row.name]: 'all' }))}
                  className={`px-2 py-1 ${scope === 'all' ? 'bg-slate-100 text-slate-700' : 'text-slate-500 hover:bg-slate-50'}`}
                  title="Apply to every consulting engineer"
                >
                  All CEs
                </button>
              </div>
            )}
            {row.suggested_rate_card_item_id && (
              <button
                onClick={() => onAccept(row)}
                disabled={saving === row.name}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving === row.name ? '…' : 'Accept'}
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
