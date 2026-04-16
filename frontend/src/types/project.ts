export interface Project {
  id: number;
  name: string;
  client: string | null;
  address: string | null;
  start_date: string | null;
  end_date: string | null;
  rate_card_version_id: number | null;
  margin_percent: number;
  status: 'draft' | 'extracting' | 'review' | 'estimated' | 'exported' | 'archived';
  created_by: number | null;
  created_at: string;
  updated_at: string;
}
