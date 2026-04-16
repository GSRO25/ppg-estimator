export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type TakeoffSource = 'dwg_parser' | 'pdf_vision' | 'manual';

export interface TakeoffItem {
  id: number;
  project_id: number;
  drawing_id: number | null;
  rate_card_item_id: number | null;
  section_number: number;
  section_name: string;
  description: string;
  uom: string;
  extracted_qty: number;
  final_qty: number;
  confidence: ConfidenceLevel;
  source: TakeoffSource;
  drawing_region: Record<string, unknown> | null;
  reviewed: boolean;
  reviewed_by: number | null;
  reviewed_at: string | null;
}
