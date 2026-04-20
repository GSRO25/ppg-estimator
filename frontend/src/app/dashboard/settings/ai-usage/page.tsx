'use client';

import { useEffect, useState } from 'react';

interface UsageData {
  totals: {
    today_usd: number;
    month_usd: number;
    lifetime_usd: number;
    today_calls: number;
    month_calls: number;
    lifetime_calls: number;
  };
  by_purpose: Array<{
    purpose: string;
    calls: number;
    total_cost_usd: number;
    total_tokens: number;
  }>;
  daily: Array<{ day: string; cost_usd: number; calls: number }>;
}

function fmtUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return '$0.00';
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function AiUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/llm-usage')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6 text-slate-500">Loading usage…</div>;
  }
  if (!data) {
    return <div className="p-6 text-red-600">Failed to load usage data.</div>;
  }

  // Chart scale for the last-30-days bar chart
  const maxDailyCost = data.daily.reduce((m, d) => Math.max(m, d.cost_usd), 0) || 1;

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">AI Usage</h2>
      <p className="text-sm text-gray-500 mb-6">
        Cost and call volume for Anthropic Claude API calls made by this workspace.
        Pricing is captured at the moment of each call — future price changes do not
        retroactively affect historical totals.
      </p>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Today" cost={data.totals.today_usd} calls={data.totals.today_calls} />
        <StatCard label="Month to date" cost={data.totals.month_usd} calls={data.totals.month_calls} primary />
        <StatCard label="Lifetime" cost={data.totals.lifetime_usd} calls={data.totals.lifetime_calls} />
      </div>

      {/* By purpose */}
      <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
        <div className="px-5 py-3 border-b bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-800">By purpose</h3>
        </div>
        {data.by_purpose.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-400">No AI calls recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 bg-slate-50/50">
              <tr>
                <th className="text-left px-5 py-2">Purpose</th>
                <th className="text-right px-5 py-2">Calls</th>
                <th className="text-right px-5 py-2">Tokens</th>
                <th className="text-right px-5 py-2">Total cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.by_purpose.map(p => (
                <tr key={p.purpose}>
                  <td className="px-5 py-2 font-mono text-xs">{p.purpose}</td>
                  <td className="text-right px-5 py-2">{p.calls}</td>
                  <td className="text-right px-5 py-2 text-slate-500">{fmtTokens(p.total_tokens)}</td>
                  <td className="text-right px-5 py-2 font-mono font-semibold">{fmtUsd(p.total_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Daily series (last 30 days) */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-800">Last 30 days</h3>
        </div>
        {data.daily.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-400">No AI calls in the last 30 days.</div>
        ) : (
          <div className="px-5 py-4">
            <div className="flex items-end gap-1 h-32">
              {data.daily.map(d => (
                <div
                  key={d.day}
                  className="flex-1 bg-blue-500/80 hover:bg-blue-600 rounded-t min-w-[4px] transition-colors"
                  title={`${d.day} · ${fmtUsd(d.cost_usd)} · ${d.calls} call${d.calls === 1 ? '' : 's'}`}
                  style={{ height: `${(d.cost_usd / maxDailyCost) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-mono">
              <span>{data.daily[0]?.day ?? ''}</span>
              <span>{data.daily[data.daily.length - 1]?.day ?? ''}</span>
            </div>
          </div>
        )}
      </div>

      <p className="mt-8 text-xs text-slate-400">
        Track billing and top up credits at{' '}
        <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener" className="underline hover:text-slate-600">
          console.anthropic.com/settings/billing
        </a>.
      </p>
    </div>
  );
}

function StatCard({ label, cost, calls, primary }: { label: string; cost: number; calls: number; primary?: boolean }) {
  return (
    <div className={`rounded-lg shadow p-5 ${primary ? 'bg-ppg-navy text-white' : 'bg-white'}`}>
      <div className={`text-xs uppercase tracking-wide ${primary ? 'text-white/60' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-3xl font-bold font-mono mt-1 ${primary ? 'text-white' : 'text-slate-900'}`}>{fmtUsd(cost)}</div>
      <div className={`text-xs mt-1 ${primary ? 'text-white/70' : 'text-slate-500'}`}>{calls} call{calls === 1 ? '' : 's'}</div>
    </div>
  );
}
