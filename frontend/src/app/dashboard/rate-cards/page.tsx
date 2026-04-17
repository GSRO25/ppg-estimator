import { query } from '@/lib/db';
import { formatDate } from '@/lib/utils';
import DeleteRateCardButton from '@/components/delete-rate-card-button';

export const dynamic = 'force-dynamic';

export default async function RateCardsPage() {
  const versions = await query<{ id: number; name: string; version: string; source_filename: string; imported_at: string }>(
    `SELECT rcv.*, COUNT(rci.id)::int as item_count
     FROM rate_card_versions rcv
     LEFT JOIN rate_card_items rci ON rci.rate_card_version_id = rcv.id
     GROUP BY rcv.id ORDER BY rcv.imported_at DESC`
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Rate Cards</h2>
      </div>
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold mb-3">Import Rate Card</h3>
          <form action="/api/rate-cards/import" method="POST" encType="multipart/form-data" className="flex gap-3 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input name="name" required className="mt-1 block rounded-md border border-gray-300 px-3 py-2 shadow-sm text-sm" placeholder="PPG Master" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Version</label>
              <input name="version" required className="mt-1 block rounded-md border border-gray-300 px-3 py-2 shadow-sm text-sm" placeholder="V5.9" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Excel File</label>
              <input name="file" type="file" accept=".xlsx,.xls" required className="mt-1 block text-sm" />
            </div>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">Import</button>
          </form>
        </div>
        {(versions as any[]).length > 0 && (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Imported</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(versions as any[]).map((v: any) => (
                <tr key={v.id}>
                  <td className="px-6 py-4 text-sm font-medium">{v.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{v.version}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{v.item_count}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatDate(v.imported_at)}</td>
                  <td className="px-6 py-4 text-right"><DeleteRateCardButton id={v.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
