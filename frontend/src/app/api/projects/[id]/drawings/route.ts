import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { categorizeDrawing } from '@/lib/drawing-categorizer';
import { requireTenant } from '@/lib/require-tenant';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

async function assertProjectInTenant(projectId: string, tenantId: number): Promise<boolean> {
  const [row] = await query<{ id: number }>(
    'SELECT id FROM projects WHERE id = $1 AND tenant_id = $2',
    [projectId, tenantId]
  );
  return !!row;
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;
  const { id } = await params;

  if (!(await assertProjectInTenant(id, tenantId))) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const drawings = await query(
    'SELECT * FROM drawings WHERE project_id = $1 ORDER BY uploaded_at DESC',
    [id]
  );
  return NextResponse.json(drawings);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;
  const { id } = await params;

  if (!(await assertProjectInTenant(id, tenantId))) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const formData = await request.formData();
  const files = formData.getAll('files') as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  const projectDir = path.join(UPLOAD_DIR, id);
  await mkdir(projectDir, { recursive: true });

  const results = [];
  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    const format = ext === '.dwg' ? 'dwg' : ext === '.dxf' ? 'dxf' : ext === '.pdf' ? 'pdf' : null;
    if (!format) continue;

    const filePath = path.join(projectDir, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const category = categorizeDrawing(file.name);

    const [drawing] = await query<{ id: number }>(
      `INSERT INTO drawings (project_id, filename, file_path, format, category)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, file.name, filePath, format, category]
    );
    results.push(drawing);
  }

  return NextResponse.json(results, { status: 201 });
}
