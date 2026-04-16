export type DrawingFormat = 'dwg' | 'dxf' | 'pdf';
export type DrawingCategory = 'cover' | 'notes' | 'site_drainage' | 'site_pressure' | 'site_fire' | 'drainage' | 'pressure' | 'fire' | 'details' | 'amenities' | 'stormwater' | 'other';
export type ExtractionStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface Drawing {
  id: number;
  project_id: number;
  filename: string;
  file_path: string;
  format: DrawingFormat;
  category: DrawingCategory;
  extraction_status: ExtractionStatus;
  extraction_result: Record<string, unknown> | null;
  tile_path: string | null;
  uploaded_at: string;
}
