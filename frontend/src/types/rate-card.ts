export interface RateCardItem {
  sectionNumber: number;
  sectionName: string;
  description: string;
  productionRate: number | null;
  uom: string;
  labourRate: number;
  materialRate: number;
  plantRate: number;
  sortOrder: number;
  isSubtotal: boolean;
}

export interface RateCardVersion {
  id: number;
  name: string;
  version: string;
  sourceFilename: string;
  importedAt: string;
  itemCount: number;
}
