"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { compareRackCode, formatRackCodeDisplay } from "@/lib/rackCode";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";

export interface RackListItem {
  id: string;
  code: string;
  cableRouteName: string | null;
  odfType: "welded" | "distribution";
  portCount: number;
  inUsePorts: number;
  standbyPorts: number;
}

type SortKey = "code" | "route" | "odfType" | "portCount" | "inUse" | "standby" | "empty";

function odfTypeLabel(t: RackListItem["odfType"]): string {
  return t === "welded" ? "Hàn nối" : "Phân phối";
}

// Trống = tổng port - đang dùng - dự phòng — tính lại mỗi lần cần thay vì lưu
// riêng 1 field, để không bao giờ lệch tổng dù inUsePorts/standbyPorts đến từ
// nguồn nào (trung kế: port_circuit_links thật; thiết bị: đối chiếu text qua
// lib/deviceRackPorts.ts — xem 2 nơi gọi RackListTable).
function emptyPortsOf(r: RackListItem): number {
  return r.portCount - r.inUsePorts - r.standbyPorts;
}

function compareByKey(key: SortKey, a: RackListItem, b: RackListItem): number {
  switch (key) {
    case "code":
      return compareRackCode(a.code, b.code);
    case "route":
      return compareValues(a.cableRouteName, b.cableRouteName);
    case "odfType":
      return compareValues(a.odfType, b.odfType);
    case "portCount":
      return compareValues(a.portCount, b.portCount);
    case "inUse":
      return compareValues(a.inUsePorts, b.inUsePorts);
    case "standby":
      return compareValues(a.standbyPorts, b.standbyPorts);
    case "empty":
      return compareValues(emptyPortsOf(a), emptyPortsOf(b));
  }
}

function cellText(r: RackListItem, key: SortKey): string | number | null {
  switch (key) {
    case "code":
      return formatRackCodeDisplay(r.code);
    case "route":
      return r.cableRouteName;
    case "odfType":
      return odfTypeLabel(r.odfType);
    case "portCount":
      return r.portCount;
    case "inUse":
      return r.inUsePorts;
    case "standby":
      return r.standbyPorts;
    case "empty":
      return emptyPortsOf(r);
  }
}

const FILTER_KEYS: SortKey[] = ["code", "route", "odfType", "portCount", "inUse", "standby", "empty"];

// Chỉ "Tuyến cáp" cần kéo dãn (có thể dài, vd "96FO#1 ADN1 - 2T9") — các cột
// còn lại giá trị ngắn/cố định (yêu cầu người dùng 2026-07-27: "các bảng dữ
// liệu đều" kéo dãn được).
type ResizableCol = "route";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = { route: 220 };

// Mã rack luôn hiện (như Port/Tên luồng ở các bảng khác) — 6 cột còn lại ẩn/
// hiện được (quy định chung mọi bảng, xem architecture.md).
type VisibleCol = "route" | "odfType" | "portCount" | "inUse" | "standby" | "empty";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = {
  route: true,
  odfType: true,
  portCount: true,
  inUse: true,
  standby: true,
  empty: true,
};
const COLUMN_ITEMS: { key: VisibleCol; label: string }[] = [
  { key: "route", label: "Tuyến cáp" },
  { key: "odfType", label: "Loại ODF" },
  { key: "portCount", label: "Số port" },
  { key: "inUse", label: "Đang dùng" },
  { key: "standby", label: "Dự phòng" },
  { key: "empty", label: "Trống" },
];

export default function RackListTable({ racks }: { racks: RackListItem[] }) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("code");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("rack-list-col-widths", DEFAULT_COL_WIDTHS);
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("rack-list-col-visibility", DEFAULT_VISIBLE);
  // Kéo-thả đổi thứ tự cột (yêu cầu người dùng 2026-08-08) — chỉ áp dụng cho
  // cột TÙY CHỌN, "Mã rack" luôn giữ đầu bảng (xem lib/useColumnOrder.ts).
  const { order: colOrder, moveColumn, reset: resetColOrder } = useColumnOrder<VisibleCol>(
    "rack-list-col-order",
    COLUMN_ITEMS.map((c) => c.key)
  );
  const orderedVisible = colOrder.filter((key) => visible[key]);
  const [filters, setFilters] = useState<Record<SortKey, string>>({
    code: "",
    route: "",
    odfType: "",
    portCount: "",
    inUse: "",
    standby: "",
    empty: "",
  });

  function setFilter(key: SortKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const sorted = useMemo(() => {
    const arr = [...racks].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [racks, sortKey, sortDir]);

  const filtered = useMemo(
    () => sorted.filter((r) => FILTER_KEYS.every((k) => matchesFilter(cellText(r, k), filters[k]))),
    [sorted, filters]
  );

  const exportColumns = useMemo(() => {
    const cols: { label: string; getValue: (r: RackListItem) => string | number | null }[] = [
      { label: "Mã rack", getValue: (r) => formatRackCodeDisplay(r.code) },
    ];
    if (visible.route) cols.push({ label: "Tuyến cáp", getValue: (r) => r.cableRouteName });
    if (visible.odfType) cols.push({ label: "Loại ODF", getValue: (r) => odfTypeLabel(r.odfType) });
    if (visible.portCount) cols.push({ label: "Số port", getValue: (r) => r.portCount });
    if (visible.inUse) cols.push({ label: "Đang dùng", getValue: (r) => r.inUsePorts });
    if (visible.standby) cols.push({ label: "Dự phòng", getValue: (r) => r.standbyPorts });
    if (visible.empty) cols.push({ label: "Trống", getValue: (r) => emptyPortsOf(r) });
    return cols;
  }, [visible]);

  const visibleColCount = 1 + COLUMN_ITEMS.filter((c) => visible[c.key]).length;

  // Cột "Mã rack" (đầu bảng) không nằm trong đây — luôn hiện, không kéo-thả
  // được (xem lib/useColumnOrder.ts). 6 cột còn lại vẽ ĐÚNG theo `orderedVisible`
  // (đã lọc ẩn/hiện lẫn thứ tự người dùng đã kéo) thay vì thứ tự cố định cũ.
  function colWidthOf(key: VisibleCol): number {
    return key === "route" ? colWidths.route : 90;
  }

  function renderHeaderCell(key: VisibleCol) {
    // `activeSortKey` ép kiểu VisibleCol (thay vì SortKey rộng hơn) chỉ để
    // TypeScript suy luận đúng K=VisibleCol cho <DataTh> ở đây — so sánh
    // "===" bên trong DataTh vẫn đúng dù giá trị thật đang là "code" (không
    // khớp bất kỳ VisibleCol nào, đơn giản là không tô đậm, không lỗi).
    const common = {
      key,
      sortKey: key,
      activeSortKey: sortKey as VisibleCol,
      sortDir,
      onSort: toggleSort as (k: VisibleCol) => void,
      filterValue: filters[key],
      onFilterChange: (v: string) => setFilter(key, v),
      reorderKey: key,
      onReorderColumn: moveColumn,
    } as const;
    switch (key) {
      case "route":
        return <DataTh {...common} label="Tuyến cáp" width={colWidths.route} onResize={(w) => resizeCol("route", w)} />;
      case "odfType":
        return <DataTh {...common} label="Loại ODF" />;
      case "portCount":
        return <DataTh {...common} label="Số port" align="right" />;
      case "inUse":
        return <DataTh {...common} label="Đang dùng" align="right" />;
      case "standby":
        return <DataTh {...common} label="Dự phòng" align="right" />;
      case "empty":
        return <DataTh {...common} label="Trống" align="right" />;
    }
  }

  function renderCell(key: VisibleCol, rack: RackListItem) {
    switch (key) {
      case "route":
        return (
          <td key={key} className="px-3 py-2 text-slate-600 break-words">
            {rack.cableRouteName}
          </td>
        );
      case "odfType":
        return (
          <td key={key} className="px-3 py-2 text-slate-600">
            {odfTypeLabel(rack.odfType)}
          </td>
        );
      case "portCount":
        return (
          <td key={key} className="px-3 py-2 text-right text-slate-600">
            {rack.portCount}
          </td>
        );
      case "inUse":
        return (
          <td key={key} className="px-3 py-2 text-right text-slate-600">
            {rack.inUsePorts}
          </td>
        );
      case "standby":
        return (
          <td key={key} className="px-3 py-2 text-right text-slate-600">
            {rack.standbyPorts}
          </td>
        );
      case "empty":
        return (
          <td key={key} className="px-3 py-2 text-right text-slate-600">
            {emptyPortsOf(rack)}
          </td>
        );
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm text-slate-500">
          {filtered.length}/{racks.length} rack
        </p>
        {Object.values(filters).some((v) => v) && (
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={() => setFilters({ code: "", route: "", odfType: "", portCount: "", inUse: "", standby: "", empty: "" })}
          >
            Xóa bộ lọc
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Rack" fileNamePrefix="Danh_sach_rack" />
          <ColumnPicker
            items={COLUMN_ITEMS}
            order={colOrder}
            visible={visible}
            onToggle={toggleColumn}
            onReorderColumn={moveColumn}
            onResetOrder={resetColOrder}
          />
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: 120 }} />
            {orderedVisible.map((key) => (
              <col key={key} style={{ width: colWidthOf(key) }} />
            ))}
          </colgroup>
          <thead className="text-primary-800">
            <tr>
              <DataTh
                label="Mã rack"
                sortKey="code"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                filterValue={filters.code}
                onFilterChange={(v) => setFilter("code", v)}
              />
              {orderedVisible.map((key) => renderHeaderCell(key))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((rack) => (
              <tr key={rack.id} className="border-t border-slate-100 hover:bg-primary-50/50">
                <td className="px-3 py-2">
                  <Link href={`/odf-trunk/${rack.id}`} className="font-medium text-primary-700 hover:underline">
                    {formatRackCodeDisplay(rack.code)}
                  </Link>
                </td>
                {orderedVisible.map((key) => renderCell(key, rack))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColCount} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy rack nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
