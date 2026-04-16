import { query } from '@/lib/db';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface AuditEntry {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
  user_email: string | null;
}

export default async function AuditLogPage() {
  const entries = await query<AuditEntry>(`
    SELECT al.*, u.email as user_email
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT 100
  `);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Audit Log</h2>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDate(entry.created_at)}</td>
                <td className="px-4 py-3 text-sm">{entry.user_email || 'System'}</td>
                <td className="px-4 py-3 text-sm font-medium">{entry.action}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{entry.entity_type}{entry.entity_id ? ` #${entry.entity_id}` : ''}</td>
                <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">{entry.details ? JSON.stringify(entry.details) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
