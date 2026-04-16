'use client';

const COLORS = {
  high: { bg: '#d4edda', text: '#155724', dot: '#28a745' },
  medium: { bg: '#fff3cd', text: '#856404', dot: '#ffc107' },
  low: { bg: '#f8d7da', text: '#721c24', dot: '#dc3545' },
};

export default function ConfidenceBadge({ level }: { level: string }) {
  const color = COLORS[level as keyof typeof COLORS] || COLORS.medium;
  return (
    <span
      style={{ backgroundColor: color.bg, color: color.text }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
    >
      <span style={{ backgroundColor: color.dot }} className="w-2 h-2 rounded-full inline-block" />
      {level}
    </span>
  );
}
