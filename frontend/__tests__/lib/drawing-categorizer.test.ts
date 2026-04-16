import { describe, it, expect } from 'vitest';
import { categorizeDrawing } from '@/lib/drawing-categorizer';

describe('categorizeDrawing', () => {
  it('detects drainage by H1xx number', () => {
    expect(categorizeDrawing('240231_H120_GROUND FLOOR DRAINAGE OVERALL_D.dwg')).toBe('drainage');
  });

  it('detects pressure by H2xx number', () => {
    expect(categorizeDrawing('H3101_PRESSURE SERVICES PLAN - GROUND FLOOR_D.dwg')).toBe('fire');
  });

  it('detects fire by H3xx number', () => {
    expect(categorizeDrawing('24187-H301_GROUND FLOOR FIRE COVERAGE LAYOUT_08.dwg')).toBe('fire');
  });

  it('detects gravity/drainage by keyword', () => {
    expect(categorizeDrawing('H2101_GRAVITY SERVICES PLAN - GROUND FLOOR_C.dwg')).toBe('pressure');
  });

  it('detects cover sheets', () => {
    expect(categorizeDrawing('24187-H000_COVER SHEET AND DRAWING LIST_03.dwg')).toBe('cover');
  });

  it('detects details', () => {
    expect(categorizeDrawing('24187-H601_DETAIL SHEET_02.dwg')).toBe('details');
  });

  it('returns other for unknown patterns', () => {
    expect(categorizeDrawing('random_file.dwg')).toBe('other');
  });
});
