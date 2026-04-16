import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import ExcelJS from 'exceljs';
import { calculateSectionTotals, calculateGrandTotal, type TakeoffItemWithRates } from '@/lib/rate-engine';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const marginPercent = body.marginPercent ?? 10;

  // Load project
  const [project] = await query<{ name: string; client: string }>(
    'SELECT name, client FROM projects WHERE id = $1', [id]
  );
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Load takeoff items with rates
  const items = await query<TakeoffItemWithRates>(
    `SELECT ti.section_number, ti.section_name, ti.description, ti.uom,
            ti.final_qty, rci.labour_rate, rci.material_rate, rci.plant_rate, rci.production_rate
     FROM takeoff_items ti
     LEFT JOIN rate_card_items rci ON rci.id = ti.rate_card_item_id
     WHERE ti.project_id = $1
     ORDER BY ti.section_number, ti.id`,
    [id]
  );

  const sections = calculateSectionTotals(items);
  const totals = calculateGrandTotal(sections, marginPercent);

  // Create workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PPG Estimator';

  // Summary sheet
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: '', key: 'num', width: 5 },
    { header: 'Scope of Works', key: 'name', width: 30 },
    { header: 'Labour Cost', key: 'labour', width: 15 },
    { header: 'Materials', key: 'material', width: 15 },
    { header: 'Plant', key: 'plant', width: 15 },
    { header: 'Sub Total', key: 'total', width: 15 },
    { header: 'Margin %', key: 'marginPct', width: 10 },
    { header: 'Margin $', key: 'marginAmt', width: 15 },
    { header: 'Total + Margin', key: 'withMargin', width: 15 },
  ];

  // Style header
  summary.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
    cell.alignment = { horizontal: 'center' };
  });

  // Add project info rows
  summary.insertRow(1, ['', `Project: ${project.name}`]);
  summary.insertRow(2, ['', `Client: ${project.client || 'TBC'}`]);
  summary.insertRow(3, []);
  // Header is now row 4

  sections.forEach((s) => {
    const row = summary.addRow({
      num: s.sectionNumber,
      name: s.sectionName,
      labour: s.labour,
      material: s.material,
      plant: s.plant,
      total: s.total,
      marginPct: marginPercent / 100,
      marginAmt: s.total * (marginPercent / 100),
      withMargin: s.total * (1 + marginPercent / 100),
    });
    // Currency format
    ['labour', 'material', 'plant', 'total', 'marginAmt', 'withMargin'].forEach(key => {
      const cell = row.getCell(key);
      cell.numFmt = '$#,##0';
    });
    row.getCell('marginPct').numFmt = '0%';
  });

  // Totals row
  const totalRow = summary.addRow({
    name: 'GRAND TOTAL',
    labour: totals.subtotal,
    total: totals.subtotal,
    marginAmt: totals.margin,
    withMargin: totals.grandTotal,
  });
  totalRow.font = { bold: true, size: 12 };
  totalRow.eachCell(cell => { cell.numFmt = '$#,##0'; });

  // Section detail sheets
  for (const section of sections) {
    const sheetName = section.sectionName.substring(0, 31); // Excel 31 char limit
    const ws = wb.addWorksheet(sheetName);

    ws.columns = [
      { header: 'Description', key: 'description', width: 40 },
      { header: 'UOM', key: 'uom', width: 12 },
      { header: 'Labour Rate', key: 'labourRate', width: 12 },
      { header: 'Material Rate', key: 'materialRate', width: 14 },
      { header: 'Plant Rate', key: 'plantRate', width: 12 },
      { header: 'QTY', key: 'qty', width: 10 },
      { header: 'Labour $', key: 'labourTotal', width: 12 },
      { header: 'Material $', key: 'materialTotal', width: 14 },
      { header: 'Plant $', key: 'plantTotal', width: 12 },
      { header: 'Sub Total', key: 'subTotal', width: 14 },
    ];

    // Style header
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
    });

    section.items.forEach((item, idx) => {
      const rowNum = idx + 2;
      const row = ws.addRow({
        description: item.description,
        uom: item.uom,
        labourRate: item.labour_rate || 0,
        materialRate: item.material_rate || 0,
        plantRate: item.plant_rate || 0,
        qty: item.final_qty,
      });

      // Add FORMULAS for totals (not static values)
      row.getCell('labourTotal').value = { formula: `C${rowNum}*F${rowNum}` } as any;
      row.getCell('materialTotal').value = { formula: `D${rowNum}*F${rowNum}` } as any;
      row.getCell('plantTotal').value = { formula: `E${rowNum}*F${rowNum}` } as any;
      row.getCell('subTotal').value = { formula: `G${rowNum}+H${rowNum}+I${rowNum}` } as any;

      // Currency format
      ['labourRate', 'materialRate', 'plantRate', 'labourTotal', 'materialTotal', 'plantTotal', 'subTotal'].forEach(key => {
        row.getCell(key).numFmt = '$#,##0.00';
      });
      row.getCell('qty').numFmt = '0.00';
    });

    // Section total row
    const lastDataRow = section.items.length + 1;
    const sectionTotalRow = ws.addRow({ description: 'SECTION TOTAL' });
    sectionTotalRow.font = { bold: true };
    sectionTotalRow.getCell('labourTotal').value = { formula: `SUM(G2:G${lastDataRow})` } as any;
    sectionTotalRow.getCell('materialTotal').value = { formula: `SUM(H2:H${lastDataRow})` } as any;
    sectionTotalRow.getCell('plantTotal').value = { formula: `SUM(I2:I${lastDataRow})` } as any;
    sectionTotalRow.getCell('subTotal').value = { formula: `SUM(J2:J${lastDataRow})` } as any;
  }

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();

  // Record export
  await query(
    `INSERT INTO estimates (project_id, version) VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM estimates WHERE project_id = $1)) RETURNING id`,
    [id]
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_estimate.xlsx"`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
}
