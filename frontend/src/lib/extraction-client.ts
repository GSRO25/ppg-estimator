const EXTRACTION_API_URL = process.env.EXTRACTION_API_URL || 'http://localhost:8000';

export async function extractDrawing(filePath: string, filename: string): Promise<Record<string, unknown>> {
  const fs = await import('fs');
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append('file', blob, filename);

  const response = await fetch(`${EXTRACTION_API_URL}/extract/dwg`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Extraction failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
