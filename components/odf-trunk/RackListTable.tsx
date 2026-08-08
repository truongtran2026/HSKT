"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { compareRackCode, formatRackCodeDisplay } from "@/lib/rackCode";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
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
          <ColumnPicker items={COLUMN_ITEMS} visible={visible} onToggle={toggleColumn} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: 120 }} />
            {visible.route && <col style={{ width: colWidths.route }} />}
            {visible.odfType && <col style={{ width: 110 }} />}
            {visible.portCount && <col style={{ width: 90 }} />}
            {visible.inUse && <col style={{ width: 90 }} />}
            {visible.standby && <col style={{ width: 90 }} />}
            {visible.empty && <col style={{ width: 90 }} />}
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
              {visible.route && (
                <DataTh
                  label="Tuyến cáp"
                  sortKey="route"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  width={colWidths.route}
                  onResize={(w) => resizeCol("route", w)}
                  filterValue={filters.route}
                  onFilterChange={(v) => setFilter("route", v)}
                />
              )}
              {visible.odfType && (
                <DataTh
                  label="Loại ODF"
                  sortKey="odfType"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.odfType}
                  onFilterChange={(v) => setFilter("odfType", v)}
                />
              )}
              {visible.portCount && (
                <DataTh
                  label="Số port"
                  sortKey="portCount"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  align="right"
                  filterValue={filters.portCount}
                  onFilterChange={(v) => setFilter("portCount", v)}
                />
              )}
              {visible.inUse && (
                <DataTh
                  label="Đang dùng"
                  sortKey="inUse"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  align="right"
                  filterValue={filters.inUse}
                  onFilterChange={(v) => setFilter("inUse", v)}
                />
              )}
              {visible.standby && (
                <DataTh
                  label="Dự phòng"
                  sortKey="standby"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  align="right"
                  filterValue={filters.standby}
                  onFilterChange={(v) => setFilter("standby", v)}
                />
              )}
              {visible.empty && (
                <DataTh
                  label="Trống"
                  sortKey="empty"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  align="right"
                  filterValue={filters.empty}
                  onFilterChange={(v) => setFilter("empty", v)}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((rack) => (
              <tr key={rack.id} className="border-t border-slate-100 hover:bg-primary-50/50">
                <td className="px-4 py-2">
                  <Link href={`/odf-trunk/${rack.id}`} className="font-medium text-primary-700 hover:underline">
                    {formatRackCodeDisplay(rack.code)}
                  </Link>
                </td>
                {visible.route && <td className="px-4 py-2 text-slate-600 break-words">{rack.cableRouteName}</td>}
                {visible.odfType && <td className="px-4 py-2 text-slate-600">{odfTypeLabel(rack.odfType)}</td>}
                {visible.portCount && <td className="px-4 py-2 text-right text-slate-600">{rack.portCount}</td>}
                {visible.inUse && <td className="px-4 py-2 text-right text-slate-600">{rack.inUsePorts}</td>}
                {visible.standby && <td className="px-4 py-2 text-right text-slate-600">{rack.standbyPorts}</td>}
                {visible.empty && <td className="px-4 py-2 text-right text-slate-600">{emptyPortsOf(rack)}</td>}
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
