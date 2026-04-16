'use client';

import { useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type CellValueChangedEvent } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

export interface TakeoffRow {
  id: number;
  section_number: number;
  section_name: string;
  description: string;
  uom: string;
  extracted_qty: number;
  final_qty: number;
  confidence: string;
  source: string;
  labour_rate: number | null;
  material_rate: number | null;
  plant_rate: number | null;
}

interface TakeoffGridProps {
  rows: TakeoffRow[];
  onQuantityChange: (itemId: number, newQty: number) => void;
}

export default function TakeoffGrid({ rows, onQuantityChange }: TakeoffGridProps) {
  const gridRef = useRef<AgGridReact>(null);

  const columnDefs = useMemo<ColDef<TakeoffRow>[]>(() => [
    { field: 'description', headerName: 'Description', flex: 2, minWidth: 200 },
    { field: 'uom', headerName: 'UOM', width: 100 },
    {
      field: 'labour_rate', headerName: 'Labour Rate', width: 110,
      valueFormatter: (p) => p.value != null ? `$${Number(p.value).toFixed(2)}` : '—',
    },
    {
      field: 'material_rate', headerName: 'Material Rate', width: 120,
      valueFormatter: (p) => p.value != null ? `$${Number(p.value).toFixed(2)}` : '—',
    },
    {
      field: 'plant_rate', headerName: 'Plant Rate', width: 110,
      valueFormatter: (p) => p.value != null ? `$${Number(p.value).toFixed(2)}` : '—',
    },
    {
      field: 'final_qty', headerName: 'QTY', width: 100,
      editable: true,
      cellDataType: 'number',
      cellStyle: (p) => {
        const c = p.data?.confidence;
        if (c === 'high') return { backgroundColor: '#d4edda' };
        if (c === 'medium') return { backgroundColor: '#fff3cd' };
        if (c === 'low') return { backgroundColor: '#f8d7da' };
        return {};
      },
    },
    {
      headerName: 'Labour $', width: 110,
      valueGetter: (p) => {
        const qty = p.data?.final_qty || 0;
        const rate = p.data?.labour_rate || 0;
        return qty * rate;
      },
      valueFormatter: (p) => `$${Number(p.value).toFixed(0)}`,
    },
    {
      headerName: 'Material $', width: 110,
      valueGetter: (p) => {
        const qty = p.data?.final_qty || 0;
        const rate = p.data?.material_rate || 0;
        return qty * rate;
      },
      valueFormatter: (p) => `$${Number(p.value).toFixed(0)}`,
    },
    {
      headerName: 'Plant $', width: 100,
      valueGetter: (p) => {
        const qty = p.data?.final_qty || 0;
        const rate = p.data?.plant_rate || 0;
        return qty * rate;
      },
      valueFormatter: (p) => `$${Number(p.value).toFixed(0)}`,
    },
    {
      headerName: 'Sub Total', width: 120,
      valueGetter: (p) => {
        const qty = p.data?.final_qty || 0;
        const l = p.data?.labour_rate || 0;
        const m = p.data?.material_rate || 0;
        const pl = p.data?.plant_rate || 0;
        return qty * (l + m + pl);
      },
      valueFormatter: (p) => `$${Number(p.value).toFixed(0)}`,
      cellStyle: { fontWeight: 'bold' },
    },
    {
      field: 'confidence', headerName: '', width: 80,
      cellRenderer: (p: { value: string }) => {
        const colors: Record<string, string> = { high: '#28a745', medium: '#ffc107', low: '#dc3545' };
        const color = colors[p.value] || '#999';
        return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color}"></span>`;
      },
    },
  ], []);

  const onCellValueChanged = useCallback((event: CellValueChangedEvent<TakeoffRow>) => {
    if (event.colDef.field === 'final_qty' && event.data) {
      onQuantityChange(event.data.id, event.data.final_qty);
    }
  }, [onQuantityChange]);

  return (
    <div className="ag-theme-quartz" style={{ height: '100%', width: '100%' }}>
      <AgGridReact<TakeoffRow>
        ref={gridRef}
        rowData={rows}
        columnDefs={columnDefs}
        onCellValueChanged={onCellValueChanged}
        defaultColDef={{
          sortable: true,
          resizable: true,
        }}
        getRowId={(params) => String(params.data.id)}
        animateRows={true}
      />
    </div>
  );
}
