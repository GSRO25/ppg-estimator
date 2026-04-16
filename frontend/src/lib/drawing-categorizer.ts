import type { DrawingCategory } from '@/types/drawing';

const CATEGORY_PATTERNS: [RegExp, DrawingCategory][] = [
  [/COVER|LEGEND|SYMBOL/i, 'cover'],
  [/NOTE/i, 'notes'],
  [/DETAIL/i, 'details'],
  [/FIRE|FH[_\s-]/i, 'fire'],
  [/STORM/i, 'stormwater'],
  [/PENETRAT/i, 'other'],
  [/AMENITI/i, 'amenities'],
];

const NUMBER_PATTERNS: [RegExp, DrawingCategory][] = [
  [/H[_-]?0[0-4]\d/i, 'cover'],        // H000-H049
  [/H[_-]?05\d/i, 'site_drainage'],     // H050-H059 site plans
  [/H[_-]?1[0-4]\d/i, 'drainage'],      // H100-H149
  [/H[_-]?1[5-9]\d/i, 'drainage'],      // H150-H199
  [/H[_-]?2[0-9]\d/i, 'pressure'],      // H200-H299
  [/H[_-]?3[0-9]\d/i, 'fire'],          // H300-H399
  [/H[_-]?4[0-9]\d/i, 'details'],       // H400-H499
  [/H[_-]?5[0-9]\d/i, 'amenities'],     // H500-H599
  [/H[_-]?6[0-9]\d/i, 'details'],       // H600-H699
];

const KEYWORD_PATTERNS: [RegExp, DrawingCategory][] = [
  [/GRAVITY|DRAIN|SEWER|SANITARY|DWV/i, 'drainage'],
  [/PRESSURE|WATER|HW|CW|PCW/i, 'pressure'],
  [/SITE.*PLAN.*GRAV/i, 'site_drainage'],
  [/SITE.*PLAN.*PRESS/i, 'site_pressure'],
  [/SITE.*PLAN.*FIRE/i, 'site_fire'],
];

export function categorizeDrawing(filename: string): DrawingCategory {
  // Try H-number patterns first (most precise)
  for (const [pattern, category] of NUMBER_PATTERNS) {
    if (pattern.test(filename)) return category;
  }
  // Try keyword patterns
  for (const [pattern, category] of KEYWORD_PATTERNS) {
    if (pattern.test(filename)) return category;
  }
  // Try category-specific patterns last (broadest)
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(filename)) return category;
  }
  return 'other';
}
