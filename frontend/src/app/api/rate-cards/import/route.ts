import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { parseRateCardXlsx } from '@/lib/rate-card-parser';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const name = (formData.get('name') as string) || file.name;
  const version = (formData.get('version') as string) || 'v1';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const items = parseRateCardXlsx(buffer);

  if (items.length === 0) {
    return NextResponse.json({ error: 'No rate card items found in file' }, { status: 400 });
  }

  const [rcv] = await query<{ id: number }>(
    'INSERT INTO rate_card_versions (name, version, source_filename) VALUES ($1, $2, $3) RETURNING id',
    [name, version, file.name]
  );

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const item of items) {
    placeholders.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
    );
    values.push(
      rcv.id, item.sectionNumber, item.sectionName, item.description,
      item.productionRate, item.uom, item.labourRate, item.materialRate,
      item.plantRate, item.sortOrder, item.isSubtotal
    );
  }

  await query(
    `INSERT INTO rate_card_items
      (rate_card_version_id, section_number, section_name, description,
       production_rate, uom, labour_rate, material_rate, plant_rate,
       sort_order, is_subtotal)
     VALUES ${placeholders.join(', ')}`,
    values
  );

  return NextResponse.json({ id: rcv.id, itemCount: items.length });
}
