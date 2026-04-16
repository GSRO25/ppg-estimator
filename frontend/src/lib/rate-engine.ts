export interface TakeoffItemWithRates {
  section_number: number;
  section_name: string;
  description: string;
  uom: string;
  final_qty: number;
  labour_rate: number | null;
  material_rate: number | null;
  plant_rate: number | null;
  production_rate: number | null;
}

export interface SectionTotal {
  sectionNumber: number;
  sectionName: string;
  labour: number;
  material: number;
  plant: number;
  total: number;
  items: TakeoffItemWithRates[];
}

export function calculateSectionTotals(items: TakeoffItemWithRates[]): SectionTotal[] {
  const sectionMap = new Map<number, SectionTotal>();

  for (const item of items) {
    const key = item.section_number;
    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        sectionNumber: key,
        sectionName: item.section_name,
        labour: 0, material: 0, plant: 0, total: 0,
        items: [],
      });
    }
    const s = sectionMap.get(key)!;
    const qty = item.final_qty || 0;
    const l = qty * (item.labour_rate || 0);
    const m = qty * (item.material_rate || 0);
    const p = qty * (item.plant_rate || 0);
    s.labour += l;
    s.material += m;
    s.plant += p;
    s.total += l + m + p;
    s.items.push(item);
  }

  return Array.from(sectionMap.values()).sort((a, b) => a.sectionNumber - b.sectionNumber);
}

export function calculateGrandTotal(sections: SectionTotal[], marginPercent: number) {
  const subtotal = sections.reduce((sum, s) => sum + s.total, 0);
  const margin = subtotal * (marginPercent / 100);
  return { subtotal, margin, grandTotal: subtotal + margin };
}
