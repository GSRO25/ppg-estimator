import { describe, it, expect } from 'vitest';
import { parseRateCardXlsx, SECTION_MAP } from '@/lib/rate-card-parser';
import * as XLSX from 'xlsx';

function createMockWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const data = [
    ['3. Civil - Stormwater Breakdown', '', '', '', '', '', '', '', '', '', '', ''],
    ['In-Ground Labour Rate (Combined) P/Hr', 330, 'Full Day', 8, 'Hrs', '', '', '', '', '', '', ''],
    ['5T Excavator P/Hr', 130, 'Work Week', 5, 'Days', '', '', '', '', '', '', ''],
    ['', '', '', 'Per UOM Rates', '', '', 'Grand Total', 0, 0, 0, 0, ''],
    ['Description', 'Rate of Completion', 'UOM', 'Labour', 'Material', 'Plant', 'QTY', 'Labour', 'Material', 'Plant', 'Sub Total', ''],
    ['100mm PVC @ 600mm Depth Trench', 20, 'Per Meter', 132, 8.33, 52, 28, 3696, 233, 1456, 5385, ''],
    ['100mm PVC Bend', 30, 'Each', 88, 22, 0, 30, 2640, 660, 0, 3300, ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '3. Civil-Stormwater');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('parseRateCardXlsx', () => {
  it('parses civil stormwater section with correct rates', () => {
    const buffer = createMockWorkbook();
    const items = parseRateCardXlsx(buffer);
    const civilItems = items.filter(i => i.sectionNumber === 3);
    expect(civilItems.length).toBe(2);
    expect(civilItems[0].description).toBe('100mm PVC @ 600mm Depth Trench');
    expect(civilItems[0].labourRate).toBe(132);
    expect(civilItems[0].materialRate).toBe(8.33);
    expect(civilItems[0].plantRate).toBe(52);
    expect(civilItems[0].uom).toBe('Per Meter');
  });

  it('returns SECTION_MAP with all 18+ sections', () => {
    expect(Object.keys(SECTION_MAP).length).toBeGreaterThanOrEqual(18);
  });
});
