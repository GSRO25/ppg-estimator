import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractDrawing } from '@/lib/extraction-client';

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const drawings = await query<{ id: number; file_path: string; filename: string; format: string }>(
    "SELECT * FROM drawings WHERE project_id = $1 AND extraction_status = 'pending'",
    [id]
  );

  if (drawings.length === 0) {
    return NextResponse.json({ message: 'No pending drawings to extract' });
  }

  const results = [];
  for (const drawing of drawings) {
    await query("UPDATE drawings SET extraction_status = 'processing' WHERE id = $1", [drawing.id]);

    try {
      const result = await extractDrawing(drawing.file_path, drawing.filename);
      await query(
        "UPDATE drawings SET extraction_status = 'complete', extraction_result = $1 WHERE id = $2",
        [JSON.stringify(result), drawing.id]
      );
      results.push({ id: drawing.id, status: 'complete' });
    } catch (error) {
      await query(
        "UPDATE drawings SET extraction_status = 'failed' WHERE id = $1",
        [drawing.id]
      );
      results.push({ id: drawing.id, status: 'failed', error: String(error) });
    }
  }

  return NextResponse.json(results);
}
