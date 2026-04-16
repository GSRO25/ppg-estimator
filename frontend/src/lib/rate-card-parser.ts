import * as XLSX from 'xlsx';
import type { RateCardItem } from '@/types/rate-card';

export const SECTION_MAP: Record<string, number> = {
  '1. Prelims': 1,
  '2. Temps': 2,
  '3. Civil-Stormwater': 3,
  '4. Decks': 4,
  '5. Fire Hydrant': 5,
  '6. Inground Pressure': 6,
  '7. Inground Sewer': 7,
  '8. Tradewaste': 8,
  '9. Lagging': 9,
  '10. Pressure Services': 10,
  '11. Sanitary Drainage': 11,
  '12. Rough-In': 12,
  '13. Fitout': 13,
  '14. Design': 14,
  '15. Plant & Tanks': 15,
  '16. FFE': 16,
  '17. Gas': 17,
  '18. DLP': 18,
  '18. Overhead': 19,
};

const SKIP_SHEETS = new Set([
  'Procore', 'Cost Codes', 'RAW FORMULA', 'Rates', 'Summary', 'Inground Calculations',
]);

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (row && String(row[0] || '').toLowerCase().includes('description')) return i;
  }
  return -1;
}

function matchSection(sheetName: string): { number: number; name: string } | null {
  // Direct match
  for (const [key, num] of Object.entries(SECTION_MAP)) {
    if (sheetName === key || sheetName.includes(key) || key.includes(sheetName)) {
      return { number: num, name: key };
    }
  }
  // Fuzzy: strip leading number and dot
  const stripped = sheetName.replace(/^\d+\.\s*/, '');
  for (const [key, num] of Object.entries(SECTION_MAP)) {
    const keyStripped = key.replace(/^\d+\.\s*/, '');
    if (stripped.toLowerCase().includes(keyStripped.toLowerCase()) ||
        keyStripped.toLowerCase().includes(stripped.toLowerCase())) {
      return { number: num, name: key };
    }
  }
  return null;
}

export function parseRateCardXlsx(buffer: ArrayBuffer): RateCardItem[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const items: RateCardItem[] = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName)) continue;

    const section = matchSection(sheetName);
    if (!section) continue;

    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const headerIdx = findHeaderRow(rows);
    if (headerIdx === -1) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] as (string | number)[];
      const desc = String(row[0] || '').trim();
      if (!desc) continue;

      const isSubtotal = /total/i.test(desc) || /sub.?total/i.test(desc);

      items.push({
        sectionNumber: section.number,
        sectionName: section.name,
        description: desc,
        productionRate: typeof row[1] === 'number' ? row[1] : null,
        uom: String(row[2] || ''),
        labourRate: typeof row[3] === 'number' ? row[3] : 0,
        materialRate: typeof row[4] === 'number' ? row[4] : 0,
        plantRate: typeof row[5] === 'number' ? row[5] : 0,
        sortOrder: i - headerIdx,
        isSubtotal,
      });
    }
  }

  return items;
}
